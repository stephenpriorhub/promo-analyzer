#!/usr/bin/env node
/**
 * Unit-style checks for detectGuru / detectGuruInText.
 *
 * Run from repo root (uses local typescript to transpile lib/detect-guru.ts — no extra deps):
 *   node scripts/test-detect-guru.mjs
 */
import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import ts from "typescript";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const srcPath = path.join(root, "lib/detect-guru.ts");
const src = fs.readFileSync(srcPath, "utf8");
const { outputText } = ts.transpileModule(src, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
    esModuleInterop: true,
  },
});

const require = createRequire(import.meta.url);
const module = { exports: {} };
const wrapper = new Function(
  "exports",
  "require",
  "module",
  "__filename",
  "__dirname",
  outputText
);
wrapper(module.exports, require, module, srcPath, path.dirname(srcPath));
const { detectGuruInText, GURU_ALIASES } = module.exports;

const GURUS = [
  "Bryan Bottarelli",
  "Karim Rahemtulla",
  "Nate Bear",
  "Matt McCall",
  "Chris Johnson",
];

function detect(text) {
  return detectGuruInText(text, GURUS, GURU_ALIASES);
}

const cases = [
  { name: "bear market → no Nate Bear", text: "This is a bear market for tech.", want: null },
  { name: "alternate → none", text: "Try an alternate approach today.", want: null },
  { name: "fortunate → none", text: "We were fortunate to catch the move.", want: null },
  { name: "Christmas → no Chris Johnson", text: "Merry Christmas from the desk.", want: null },
  { name: "it doesn't matter → no Matt McCall", text: "it doesn't matter what the Fed does", want: null },
  { name: "Matt McCall says → Matt McCall", text: "Matt McCall says buy the dip.", want: "Matt McCall" },
  { name: "McCall alone → Matt McCall", text: "Per McCall, XAI is the play.", want: "Matt McCall" },
  { name: "Nate Bear → Nate Bear", text: "Nate Bear walks through PSU.", want: "Nate Bear" },
  {
    name: "two gurus, more mentions wins",
    text: "Nate Bear opened. Bryan Bottarelli replied. Nate Bear closed the case.",
    want: "Nate Bear",
  },
  { name: "case-insensitive full name", text: "matt mccall on the wire", want: "Matt McCall" },
  { name: "case-insensitive alias", text: "mccall alone here", want: "Matt McCall" },
  { name: "Bottarelli alias", text: "Bottarelli laid out the thesis.", want: "Bryan Bottarelli" },
  { name: "Rahemtulla alias", text: "Rahemtulla flagged the risk.", want: "Karim Rahemtulla" },
  { name: "flexible whitespace", text: "Matt   McCall  said so.", want: "Matt McCall" },
  { name: "earliest wins on tie count", text: "Chris Johnson then Nate Bear.", want: "Chris Johnson" },
  { name: "empty → null", text: "", want: null },
];

let passed = 0;
let failed = 0;
for (const c of cases) {
  const got = detect(c.text);
  if (got === c.want) {
    passed += 1;
    console.log(`PASS  ${c.name}`);
  } else {
    failed += 1;
    console.log(`FAIL  ${c.name}`);
    console.log(`      want=${JSON.stringify(c.want)} got=${JSON.stringify(got)}`);
  }
}

console.log(`\n${passed} passed, ${failed} failed (${cases.length} total)`);
process.exit(failed === 0 ? 0 : 1);
