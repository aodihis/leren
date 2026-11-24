import { closeTarget } from "./target";

/** Maps an eval name to the module that runs it when it is imported. */
const evals: Record<string, () => Promise<unknown>> = {
  pipeline: () => import("./pipeline"),
  judge: () => import("./judge"),
  recall: () => import("./recall"),
};

/**
 * Runs the named evals, or all of them when no name is given. Usage: `pnpm run evals [name...]`.
 * An unknown name prints the available names and exits with a failure. The exit code is
 * non-zero when any eval ends with an outcome that its cases did not expect.
 */
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
