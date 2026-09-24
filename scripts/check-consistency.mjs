#!/usr/bin/env node
// Catches the exact class of drift bug that shipped or nearly shipped
// during the 0.2.x cycle: mcp-server.ts's version stuck at 0.1.1 through
// two releases, the companion website showing a stale component count
// for a full release cycle, a committed report left in present tense
// after its numbers became historical. None of these are type errors or
// test failures; all three are a number in one file disagreeing with
// the same fact stated in another. This script checks that class of
// fact, nothing about correctness of the tagging or matching itself.
//
// Run: node scripts/check-consistency.mjs
// Exits non-zero (and prints every mismatch found, not just the first)
// on any drift.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const errors = [];

function read(relPath) {
  return fs.readFileSync(path.join(root, relPath), "utf8");
}

// --- 1. package.json version === mcp-server.ts's McpServer version ---
const pkg = JSON.parse(read("package.json"));
const mcpServerSrc = read("src/mcp-server.ts");
const mcpVersionMatch = mcpServerSrc.match(/version:\s*"([^"]+)"/);
if (!mcpVersionMatch) {
  errors.push("Could not find a version field in src/mcp-server.ts's McpServer constructor.");
} else if (mcpVersionMatch[1] !== pkg.version) {
  errors.push(
    `package.json version (${pkg.version}) does not match src/mcp-server.ts's McpServer version (${mcpVersionMatch[1]}).`,
  );
}

// --- 2. Every registry in REGISTRIES has a matching data/tags/<name>.json, and vice versa ---
const registriesSrc = read("src/runtime/registries.ts");
const registryNames = [...registriesSrc.matchAll(/name:\s*"([^"]+)"/g)].map((m) => m[1]);
if (registryNames.length === 0) {
  errors.push("Could not find any registry names in src/runtime/registries.ts.");
}

const tagsDir = path.join(root, "data/tags");
const tagFiles = fs.existsSync(tagsDir)
  ? fs.readdirSync(tagsDir).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, ""))
  : [];

let totalComponents = 0;
for (const name of registryNames) {
  const file = path.join(tagsDir, `${name}.json`);
  if (!fs.existsSync(file)) {
    errors.push(`REGISTRIES lists "${name}" but data/tags/${name}.json does not exist.`);
    continue;
  }
  const records = JSON.parse(fs.readFileSync(file, "utf8"));
  totalComponents += records.length;
}

for (const name of tagFiles) {
  if (!registryNames.includes(name)) {
    // Not an error on its own (e.g. shadcnblocks.json is deliberately
    // kept on disk while excluded from REGISTRIES), but worth a note so
    // it's never silently assumed to be shipping.
    console.log(`Note: data/tags/${name}.json exists but "${name}" is not in REGISTRIES (fine if deliberate, e.g. a preserved-but-excluded registry).`);
  }
}

// --- 3. README's stated total matches the real sum, and its registry count matches REGISTRIES.length ---
const readme = read("README.md");
const totalMatch = readme.match(/([\d,]+)\s+components total/);
if (!totalMatch) {
  errors.push('Could not find a "<N> components total" statement in README.md.');
} else {
  const statedTotal = Number(totalMatch[1].replace(/,/g, ""));
  if (statedTotal !== totalComponents) {
    errors.push(
      `README.md states ${statedTotal} components total, but summing data/tags/*.json for every registry in REGISTRIES gives ${totalComponents}.`,
    );
  }
}

const countWords = { nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15 };
const registryCountMatch = readme.match(/(\d+|nine|ten|eleven|twelve|thirteen|fourteen|fifteen) of 372\+ shadcn-format registries/i);
if (!registryCountMatch) {
  errors.push('Could not find a "<N> of 372+ shadcn-format registries" statement in README.md.');
} else {
  const word = registryCountMatch[1].toLowerCase();
  const statedCount = countWords[word] ?? Number(word);
  if (statedCount !== registryNames.length) {
    errors.push(
      `README.md states "${registryCountMatch[1]} of 372+ shadcn-format registries", but REGISTRIES has ${registryNames.length} entries.`,
    );
  }
}

if (errors.length > 0) {
  console.error("\nConsistency check failed:\n");
  for (const e of errors) console.error("  - " + e);
  console.error("");
  process.exit(1);
}
console.log(`Consistency check passed: version ${pkg.version} agrees everywhere, ${registryNames.length} registries, ${totalComponents} components, README matches.`);
