// Safe extraction of an untrusted build artifact (a ZIP from the GitHub artifacts API) in the
// privileged deploy job. Dependency-free (node:zlib). Fail closed on anything unusual:
//   - entry names: relative, `/`-separated, no `..`/empty/`.` segments, no backslash, no drive
//     letter, no control characters (zip-slip and log-forgery)
//   - no symlinks, no device/FIFO entries (unix mode in the external attributes)
//   - no encryption, no ZIP64, no multi-disk, only stored or deflated entries
//   - bounded entry count, per-file size, total size; CRC32 and size verified per file
//   - writes only inside an empty destination directory, never overwrites (`wx`)
import { closeSync, mkdirSync, openSync, readdirSync, writeSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { crc32, inflateRawSync } from "node:zlib";

export interface UnzipLimits {
  maxEntries: number;
  maxFileBytes: number;
  maxTotalBytes: number;
}

// Cloudflare's own limits (20,000 assets, 25 MiB each) plus the manifest, with headroom.
export const DEFAULT_LIMITS: UnzipLimits = { maxEntries: 25_000, maxFileBytes: 25 * 1024 * 1024 + 1, maxTotalBytes: 512 * 1024 * 1024 };

export class UnsafeArchive extends Error {}

const fail = (message: string): never => {
  throw new UnsafeArchive(message);
};

export function checkEntryName(name: string): string {
  if (name.length === 0 || name.length > 1024) fail("entry name empty or too long");
  if (/[\u0000-\u001f\u007f\\]/.test(name)) fail(`entry name with a control character or backslash: ${JSON.stringify(name)}`);
  if (name.startsWith("/") || /^[A-Za-z]:/.test(name)) fail(`absolute entry name: ${JSON.stringify(name)}`);
  const parts = (name.endsWith("/") ? name.slice(0, -1) : name).split("/");
  for (const part of parts) if (part === "" || part === "." || part === "..") fail(`unsafe path segment in ${JSON.stringify(name)}`);
  return name;
}

interface Entry {
  name: string;
  method: number;
  flags: number;
  crc: number;
  compressed: number;
  size: number;
  localOffset: number;
  isDir: boolean;
}

function readEntries(zip: Buffer, limits: UnzipLimits): Entry[] {
  // End of central directory: last 22..(22+65535) bytes.
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - 0xffff); i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) fail("not a ZIP archive (no end of central directory)");
  if (zip.readUInt16LE(eocd + 4) !== 0 || zip.readUInt16LE(eocd + 6) !== 0) fail("multi-disk archives are not supported");
  const count = zip.readUInt16LE(eocd + 10);
  const cdSize = zip.readUInt32LE(eocd + 12);
  const cdOffset = zip.readUInt32LE(eocd + 16);
  if (count === 0xffff || cdOffset === 0xffffffff || cdSize === 0xffffffff) fail("ZIP64 archives are not supported");
  if (count > limits.maxEntries) fail(`too many entries (${count} > ${limits.maxEntries})`);
  if (cdOffset + cdSize > eocd) fail("central directory out of bounds");

  const entries: Entry[] = [];
  const names = new Set<string>();
  let p = cdOffset;
  for (let i = 0; i < count; i++) {
    if (p + 46 > eocd || zip.readUInt32LE(p) !== 0x02014b50) fail("corrupt central directory");
    const madeBy = zip.readUInt16LE(p + 4) >> 8;
    const flags = zip.readUInt16LE(p + 8);
    const method = zip.readUInt16LE(p + 10);
    const crc = zip.readUInt32LE(p + 16);
    const compressed = zip.readUInt32LE(p + 20);
    const size = zip.readUInt32LE(p + 24);
    const nameLen = zip.readUInt16LE(p + 28);
    const extraLen = zip.readUInt16LE(p + 30);
    const commentLen = zip.readUInt16LE(p + 32);
    const external = zip.readUInt32LE(p + 38);
    const localOffset = zip.readUInt32LE(p + 42);
    const name = checkEntryName(zip.toString("utf8", p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;

    if (flags & 0x1) fail(`encrypted entry ${JSON.stringify(name)}`);
    if (compressed === 0xffffffff || size === 0xffffffff || localOffset === 0xffffffff) fail("ZIP64 entries are not supported");
    if (method !== 0 && method !== 8) fail(`unsupported compression method ${method} for ${JSON.stringify(name)}`);
    const mode = external >>> 16;
    const type = mode & 0o170000;
    if (madeBy === 3 && type !== 0 && type !== 0o100000 && type !== 0o040000) {
      fail(`${type === 0o120000 ? "symlink" : "special file"} entry ${JSON.stringify(name)}`);
    }
    const isDir = name.endsWith("/") || type === 0o040000 || (external & 0x10) !== 0;
    if (isDir && size !== 0) fail(`directory entry with data: ${JSON.stringify(name)}`);
    if (size > limits.maxFileBytes) fail(`${JSON.stringify(name)} is too large`);
    const key = name.replace(/\/$/, "");
    if (names.has(key)) fail(`duplicate entry ${JSON.stringify(name)}`);
    names.add(key);
    entries.push({ name, method, flags, crc, compressed, size, localOffset, isDir });
  }
  const total = entries.reduce((n, e) => n + e.size, 0);
  if (total > limits.maxTotalBytes) fail(`archive expands to ${total} bytes (> ${limits.maxTotalBytes})`);
  return entries;
}

/** Extract `zip` into `dest` (created if missing, must be empty). Returns the number of files. */
export function safeUnzip(zip: Buffer, dest: string, limits: UnzipLimits = DEFAULT_LIMITS): number {
  const root = resolve(dest);
  mkdirSync(root, { recursive: true });
  if (readdirSync(root).length) fail("destination directory is not empty");
  const entries = readEntries(zip, limits);
  let files = 0;
  for (const e of entries) {
    const target = resolve(root, ...e.name.replace(/\/$/, "").split("/"));
    if (!target.startsWith(root + sep)) fail(`entry escapes the destination: ${JSON.stringify(e.name)}`);
    if (e.isDir) {
      mkdirSync(target, { recursive: true });
      continue;
    }
    const h = e.localOffset;
    if (h + 30 > zip.length || zip.readUInt32LE(h) !== 0x04034b50) fail(`bad local header for ${JSON.stringify(e.name)}`);
    const start = h + 30 + zip.readUInt16LE(h + 26) + zip.readUInt16LE(h + 28);
    const raw = zip.subarray(start, start + e.compressed);
    if (raw.length !== e.compressed) fail(`truncated entry ${JSON.stringify(e.name)}`);
    let data: Buffer;
    try {
      // maxOutputLength stops a zip bomb at the declared size.
      data = e.method === 0 ? raw : inflateRawSync(raw, { maxOutputLength: Math.max(1, e.size) });
    } catch {
      return fail(`cannot inflate ${JSON.stringify(e.name)} within its declared size`);
    }
    if (data.length !== e.size) fail(`size mismatch for ${JSON.stringify(e.name)}`);
    if ((crc32(data) >>> 0) !== e.crc) fail(`CRC mismatch for ${JSON.stringify(e.name)}`);
    mkdirSync(dirname(target), { recursive: true });
    const fd = openSync(target, "wx", 0o644);
    try {
      writeSync(fd, data);
    } finally {
      closeSync(fd);
    }
    files += 1;
  }
  return files;
}

