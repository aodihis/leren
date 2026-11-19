import { RuleTester } from "oxlint/plugins-dev";

import { noInlineCommentsRule } from "./no-inline-comments.ts";

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: "ts" } } });
const error = { messageId: "inline" };

tester.run("rules/no-inline-comments", noInlineCommentsRule, {
  valid: [
    "/** Adds numbers. */\nfunction add(a: number, b: number) { return a + b; }",
    "/** A user. */\nclass User {}",
    "/* oxlint-disable no-console */\nconsole.log(1);",
    "// @ts-expect-error\nconst a: string = 1;",
  ],
  invalid: [
    { code: "// add one\nconst a = 1 + 1;", errors: [error] },
    { code: "function f() {\n  /* loop */\n  return 1;\n}", errors: [error] },
    { code: "const a = 1; // trailing", errors: [error] },
  ],
});
