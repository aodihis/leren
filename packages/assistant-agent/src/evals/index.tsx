import { closeTarget } from "./target";

/** Maps an eval name to the module that runs it when it is imported. */
const evals: Record<string, () => Promise<unknown>> = {
  "write-confirmation": () => import("./write-confirmation"),
  "tool-use": () => import("./tool-use"),
  scope: () => import("./scope"),
  account: () => import("./account"),
  clarification: () => import("./clarification"),
  faithfulness: () => import("./faithfulness"),
  suggestions: () => import("./suggestions"),
  "edit-fidelity": () => import("./edit-fidelity"),
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
