import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const rulesDir = new URL("./rules/", import.meta.url);
const tests = readdirSync(rulesDir).filter((name) => name.endsWith(".test.ts"));

for (const test of tests) {
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", fileURLToPath(new URL(test, rulesDir))],
    {
      stdio: "inherit",
    },
  );

  if (result.status !== 0) process.exit(result.status ?? 1);
}

console.log(`${tests.length} rule test files passed`);
