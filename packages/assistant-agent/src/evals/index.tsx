import { runSuites } from "@leren/evals";
import { closeTarget } from "./target";

/** Runs the named assistant evals, or all of them. */
await runSuites({
  suites: {
    "tool-calls": () => import("./tool-calls"),
    "list-playbooks": () => import("./list-playbooks"),
    "empty-playbooks": () => import("./empty-playbooks"),
    faithfulness: () => import("./faithfulness"),
    clarification: () => import("./clarification"),
    "llm-judge": () => import("./llm-judge"),
    correctness: () => import("./correctness"),
  },
  requested: process.argv.slice(2),
  close: closeTarget,
});
