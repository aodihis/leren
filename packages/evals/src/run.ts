/** Maps a suite name to a loader that runs it. */
export type SuiteMap = Readonly<Record<string, () => Promise<unknown>>>;

/** Options of `runSuites`. */
export interface RunSuitesOptions {
  readonly suites: SuiteMap;
  /** Suite names to run. Empty runs all. */
  readonly requested: readonly string[];
  /** Releases shared resources after the run. */
  readonly close?: () => Promise<void>;
}

/** Runs the named suites in order, or all of them. */
export async function runSuites(options: RunSuitesOptions): Promise<void> {
  const { suites, requested, close } = options;
  const names = requested.length === 0 ? Object.keys(suites) : requested;
  const unknown = names.filter((name) => !suites[name]);

  if (unknown.length > 0) {
    console.error(
      `Unknown eval: ${unknown.join(", ")}. Available: ${Object.keys(suites).join(", ")}`,
    );
    process.exitCode = 1;

    return;
  }

  try {
    for (const name of names) {
      await suites[name]?.();
    }
  } finally {
    await close?.();
  }
}
