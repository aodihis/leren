import { closeTarget } from "./target";

/** Maps an eval name to its module. */
const evals: Record<string, () => Promise<unknown>> = {
  pipeline: () => import("./pipeline"),
  judge: () => import("./judge"),
  recall: () => import("./recall"),
};

/** Runs the named evals, or all of them. */
async function main(): Promise<void> {
  const requested = process.argv.slice(2);
  const names = requested.length === 0 ? Object.keys(evals) : requested;
  const unknown = names.filter((name) => !evals[name]);

  if (unknown.length > 0) {
    console.error(
      `Unknown eval: ${unknown.join(", ")}. Available: ${Object.keys(evals).join(", ")}`,
    );
    process.exitCode = 1;

    return;
  }

  try {
    for (const name of names) {
      await evals[name]?.();
    }
  } finally {
    await closeTarget();
  }
}

await main();
