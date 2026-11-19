/**
 * Browser code must not use Node.js globals. The template and the web
 * apps run in a browser, where `Buffer` (and `process`, `__dirname`,
 * `require`) do not exist — but vitest runs in Node, where they do,
 * so a bare `Buffer.from` passes all 355 unit tests and then throws
 * "Buffer is not defined" on the live sites. That is exactly what
 * happened in November 2026: the market read failed on every load
 * because `getListings` built its memcmp filter with the global
 * `Buffer`, and the failure hid behind a generic network message
 * until the cause was surfaced.
 *
 * This test scans the browser sources (template + both apps, test
 * files excluded) and fails when a file uses the `Buffer` VALUE
 * without importing it from "buffer", or uses any other Node-only
 * global. Type-only uses (`data: Buffer`) are fine: they are erased
 * at compile time. The CLI is excluded on purpose: it runs in Node.
 *
 * The scan is a guard, not a parser: comments are stripped with a
 * simple regex first, so a `Buffer.from` inside a comment does not
 * trip it. A file that genuinely needs `Buffer` adds
 * `import { Buffer } from "buffer"` (Node resolves it natively; the
 * apps' import maps point "buffer" at the esm.sh browser build).
 */

import { readdirSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..", "..");
const SCAN_DIRS = [
  join(ROOT, "packages", "template", "src"),
  join(ROOT, "apps", "ghost-mint", "src"),
  join(ROOT, "apps", "market", "src"),
];

/** `Buffer.from(...)`, `Buffer.alloc(...)`, `new Buffer(...)`, ... */
const BUFFER_VALUE_USE =
  /\bBuffer\s*\.\s*(from|alloc|concat|isBuffer|byteLength)\b|\bnew\s+Buffer\b/;
const BUFFER_IMPORT = /from\s+["']buffer["']/;

/** Globals with no browser equivalent: any use in browser code fails. */
const FORBIDDEN_GLOBALS: Array<{ name: string; pattern: RegExp }> = [
  { name: "process", pattern: /\bprocess\s*\./ },
  { name: "__dirname", pattern: /\b__dirname\b/ },
  { name: "__filename", pattern: /\b__filename\b/ },
  { name: "require", pattern: /\brequire\s*\(/ },
];

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|\s)\/\/.*$/gm, "$1");
}

function browserSources(): Array<{ file: string; source: string }> {
  const files: Array<{ file: string; source: string }> = [];
  for (const dir of SCAN_DIRS) {
    for (const name of readdirSync(dir)) {
      if (!name.endsWith(".ts") || name.endsWith(".test.ts")) {
        continue;
      }
      const file = join(dir, name);
      files.push({ file, source: stripComments(readFileSync(file, "utf8")) });
    }
  }
  return files;
}

describe("browser code uses no Node.js globals", () => {
  it("imports Buffer from 'buffer' wherever its value is used", () => {
    const offenders = browserSources()
      .filter(
        ({ source }) =>
          BUFFER_VALUE_USE.test(source) && !BUFFER_IMPORT.test(source),
      )
      .map(({ file }) => file);
    expect(offenders).toEqual([]);
  });

  it("never uses process, __dirname, __filename, or require", () => {
    const offenders: string[] = [];
    for (const { file, source } of browserSources()) {
      for (const { name, pattern } of FORBIDDEN_GLOBALS) {
        if (pattern.test(source)) {
          offenders.push(`${file} uses ${name}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
