import { runSuites } from "@leren/evals";
import { closeObserver } from "./observer";

/** Runs the named reply evals, or all of them. */
await runSuites({
  suites: {
    recall: () => import("./recall/recall"),
  },
  requested: process.argv.slice(2),
  close: closeObserver,
});
