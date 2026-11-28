import { runSuites } from "@leren/evals";
import { closeObserver } from "./observer";

/** Runs the named reply evals, or all of them. */
await runSuites({
  suites: {
    "drafter-tool-calls": () => import("./drafter/tool-calls"),
    "drafter-content": () => import("./drafter/content"),
    "drafter-quality": () => import("./drafter/quality"),
    "pipeline-deterministic": () => import("./pipeline/deterministic"),
    "pipeline-quality": () => import("./pipeline/quality"),
  },
  requested: process.argv.slice(2),
  close: closeObserver,
});
