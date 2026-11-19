import { RuleTester } from "oxlint/plugins-dev";

import { noImplicitStateRule } from "./no-implicit-state.ts";

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: "ts" } } });
const error = { messageId: "implicit" };

tester.run("rules/no-implicit-state", noImplicitStateRule, {
  valid: [
    "const a = 1;",
    "export const b = { count: 0 };",
    "function f() { let n = 0; n += 1; return n; }",
  ],
  invalid: [
    { code: "let a = 1;", errors: [error] },
    { code: "export let b = 1;", errors: [error] },
    { code: "var c = 1;", errors: [error] },
  ],
});
