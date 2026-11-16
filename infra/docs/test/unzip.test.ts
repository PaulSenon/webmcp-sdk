import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { crc32, deflateRawSync } from "node:zlib";
import { checkEntryName, safeUnzip, UnsafeArchive } from "../src/unzip.ts";

interface E { name: string; data?: string; mode?: number; deflate?: boolean; crc?: number; size?: number; flags?: number }

/** Minimal ZIP writer for tests, able to craft hostile archives. */
function makeZip(entries: E[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const data = Buffer.from(e.data ?? "");
    const body = e.deflate ? deflateRawSync(data) : data;
    const name = Buffer.from(e.name);
    const crc = e.crc ?? crc32(data) >>> 0;
    const size = e.size ?? data.length;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(e.flags ?? 0, 6);
    local.writeUInt16LE(e.deflate ? 8 : 0, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, body);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE((3 << 8) | 20, 4); // made by unix
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(e.flags ?? 0, 8);
    central.writeUInt16LE(e.deflate ? 8 : 0, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(size, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(((e.mode ?? 0o100644) << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += 30 + name.length + body.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}

const dirs: string[] = [];
const dest = () => {
  const d = mkdtempSync(join(tmpdir(), "unzip-"));
  dirs.push(d);
  return join(d, "out");
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

test("extracts a normal artifact (stored and deflated, nested dirs)", () => {
  const out = dest();
  const n = safeUnzip(makeZip([{ name: "manifest.json", data: "{}" }, { name: "site/", mode: 0o040755 }, { name: "site/index.html", data: "<h1>x</h1>".repeat(50), deflate: true }]), out);
  assert.equal(n, 2);
  assert.equal(readFileSync(join(out, "site/index.html"), "utf8"), "<h1>x</h1>".repeat(50));
});

test("refuses zip-slip names", () => {
  for (const name of ["../evil", "site/../../evil", "/etc/passwd", "C:/x", "a\\..\\b", "a//b", "./a", "a\nb"]) {
    assert.throws(() => checkEntryName(name), UnsafeArchive, name);
    assert.throws(() => safeUnzip(makeZip([{ name, data: "x" }]), dest()), UnsafeArchive, name);
  }
});

test("refuses symlinks and special files", () => {
  assert.throws(() => safeUnzip(makeZip([{ name: "site/hosts", data: "/etc/hosts", mode: 0o120777 }]), dest()), /symlink/);
  assert.throws(() => safeUnzip(makeZip([{ name: "fifo", mode: 0o010644 }]), dest()), /special file/);
});

test("refuses encryption, CRC or size tampering, duplicates, and oversized content", () => {
  assert.throws(() => safeUnzip(makeZip([{ name: "a", data: "x", flags: 1 }]), dest()), /encrypted/);
  assert.throws(() => safeUnzip(makeZip([{ name: "a", data: "x", crc: 1 }]), dest()), /CRC/);
  assert.throws(() => safeUnzip(makeZip([{ name: "a", data: "xyz", deflate: true, size: 1 }]), dest()), UnsafeArchive);
  assert.throws(() => safeUnzip(makeZip([{ name: "a", data: "1" }, { name: "a", data: "2" }]), dest()), /duplicate/);
  const limits = { maxEntries: 2, maxFileBytes: 4, maxTotalBytes: 6 };
  assert.throws(() => safeUnzip(makeZip([{ name: "a" }, { name: "b" }, { name: "c" }]), dest(), limits), /too many entries/);
  assert.throws(() => safeUnzip(makeZip([{ name: "a", data: "12345" }]), dest(), limits), /too large/);
  assert.throws(() => safeUnzip(makeZip([{ name: "a", data: "1234" }, { name: "b", data: "1234" }]), dest(), limits), /expands/);
  assert.throws(() => safeUnzip(Buffer.from("not a zip"), dest()), /not a ZIP/);
});

test("never writes into a non-empty destination", () => {
  const out = dest();
  safeUnzip(makeZip([{ name: "a", data: "1" }]), out);
  assert.throws(() => safeUnzip(makeZip([{ name: "b", data: "2" }]), out), /not empty/);
  writeFileSync(join(out, "keep"), "k");
  assert.deepEqual(readdirSync(out).sort(), ["a", "keep"]);
});
