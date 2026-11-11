// Builds dist/ (ESM .js + .d.ts, one file per source module) with the native TypeScript compiler.
import { rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
rmSync(join(root, "dist"), { recursive: true, force: true });
execFileSync(join(root, "node_modules/.bin/tsc"), ["-p", join(root, "tsconfig.build.json")], { stdio: "inherit" });
console.log("Built dist/.");
