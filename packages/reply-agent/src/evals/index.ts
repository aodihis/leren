import { runSuites } from "@leren/evals";
import { closeTarget } from "./target";

/** Runs the named reply evals, or all of them. */
await runSuites({
  suites: {
    pipeline: () => import("./pipeline"),
    judge: () => import("./judge"),
    recall: () => import("./recall"),
  },
  requested: process.argv.slice(2),
  close: closeTarget,
});
