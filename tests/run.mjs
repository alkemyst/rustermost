// tests/run.mjs — test driver. Discovers tests/fe/*.test.mjs (sorted),
// imports them (each file self-registers tests via the harness's test()),
// then runs the registry. Exit code is non-zero if anything failed.
//
//   node tests/run.mjs

import { readdir } from "node:fs/promises";
import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const feDir = path.join(here, "fe");

const { runAll } = await import(pathToFileURL(path.join(here, "harness.mjs")).href);

let files = [];
try {
  files = (await readdir(feDir)).filter((f) => f.endsWith(".test.mjs")).sort();
} catch {
  console.log("no tests/fe directory found — nothing to run");
}

for (const f of files) await import(pathToFileURL(path.join(feDir, f)).href);

const failures = await runAll();
process.exit(failures ? 1 : 0);
