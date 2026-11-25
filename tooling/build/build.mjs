/**
 * Builds the production output of the API and the worker into `out/` (decision 0056).
 *
 * Each entry point becomes one ES module in `out/dist` that contains the workspace packages and
 * every dependency, so the output needs no `node_modules`. The files that the code reads at run
 * time keep the paths they have relative to a bundle in the source tree: `out/drizzle` holds the
 * migrations, `out/skills` the assistant skills, and `out/harness.config.js` with `out/prompts`
 * the harness. `HARNESS_CONFIG` points the process at the config file.
 */
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const root = fileURLToPath(new URL("../..", import.meta.url));
const out = `${root}out`;

/**
 * CommonJS dependencies call `require` and `__dirname`, which an ES module does not define, so the
 * banner defines them for the bundled code.
 */
const banner = [
  'import { createRequire as __createRequire } from "node:module";',
  'import { fileURLToPath as __fileURLToPath } from "node:url";',
  'import { dirname as __dirname_of } from "node:path";',
  "const require = __createRequire(import.meta.url);",
  "const __filename = __fileURLToPath(import.meta.url);",
  "const __dirname = __dirname_of(__filename);",
].join("\n");

await rm(out, { recursive: true, force: true });

await mkdir(`${out}/dist`, { recursive: true });

await build({
  entryPoints: {
    "dist/api": `${root}apps/api/src/index.ts`,
    "dist/worker": `${root}apps/worker/src/index.ts`,
    "dist/migrate": `${root}packages/db/src/migrate.ts`,
    "harness.config": `${root}harness.config.ts`,
  },
  outdir: out,
  outExtension: { ".js": ".js" },
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  sourcemap: false,
  banner: { js: banner },
  external: ["pg-native", "@valibot/to-json-schema"],
  logLevel: "info",
});

await cp(`${root}packages/db/drizzle`, `${out}/drizzle`, { recursive: true });

await cp(`${root}packages/assistant-agent/skills`, `${out}/skills`, { recursive: true });

await cp(`${root}prompts`, `${out}/prompts`, { recursive: true });

await writeFile(`${out}/package.json`, `${JSON.stringify({ type: "module" }, null, 2)}\n`);
