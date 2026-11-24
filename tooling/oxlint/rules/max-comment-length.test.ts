import { RuleTester } from "oxlint/plugins-dev";

import { maxCommentLengthRule } from "./max-comment-length.ts";

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: "ts" } } });
const error = { messageId: "tooLong" };
const long = "x".repeat(51);

tester.run("rules/max-comment-length", maxCommentLengthRule, {
  valid: [
    "/** Adds two numbers. */\nfunction add(a: number, b: number) { return a + b; }",
    `/** ${"x".repeat(50)} */\nclass A {}`,
    "/**\n * Adds two\n * numbers.\n */\nclass A {}",
    `/* oxlint-disable no-console -- ${long} */\nconsole.log(1);`,
    `// @ts-expect-error ${long}\nconst a: string = 1;`,
  ],
  invalid: [
    { code: `/** ${long} */\nclass A {}`, errors: [error] },
    { code: `// ${long}\nconst a = 1;`, errors: [error] },
    {
      code: `/**\n * ${"x".repeat(30)}\n * ${"y".repeat(30)}\n */\nclass A {}`,
      errors: [error],
    },
  ],
});
