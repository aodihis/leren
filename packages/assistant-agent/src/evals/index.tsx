import { runSuites } from "@leren/evals";
import { closeTarget } from "./target";

/** Runs the named assistant evals, or all of them. */
await runSuites({
  suites: {
    "write-confirmation": () => import("./write-confirmation"),
    "tool-use": () => import("./tool-use"),
    scope: () => import("./scope"),
    account: () => import("./account"),
    clarification: () => import("./clarification"),
    intake: () => import("./intake"),
    faithfulness: () => import("./faithfulness"),
    suggestions: () => import("./suggestions"),
    "edit-fidelity": () => import("./edit-fidelity"),
  },
  requested: process.argv.slice(2),
  close: closeTarget,
});
