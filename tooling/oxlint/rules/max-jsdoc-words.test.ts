import { RuleTester } from "oxlint/plugins-dev";

import { maxJsdocWordsRule } from "./max-jsdoc-words.ts";

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: "ts" } } });
const error = { messageId: "tooLong" };
const words = (count: number) => Array.from({ length: count }, () => "word").join(" ");

tester.run("rules/max-jsdoc-words", maxJsdocWordsRule, {
  valid: [
    "/** Adds numbers. */\nfunction add(a: number, b: number) { return a + b; }",
    `/**\n * ${words(50)}\n */\nconst a = 1;`,
    `/**\n * Adds numbers.\n * @param a ${words(60)}\n */\nfunction add(a: number) { return a; }`,
    `/* ${words(80)} */\nconst a = 1;`,
    `/**\n * ${words(20)} - — | \`x\`\n */\nconst a = 1;`,
    { code: `/** ${words(10)} */\nconst a = 1;`, options: [{ max: 10 }] },
  ],
  invalid: [
    { code: `/**\n * ${words(51)}\n */\nconst a = 1;`, errors: [error] },
    {
      code: `/**\n * ${words(30)}\n *\n * ${words(30)}\n * @returns one\n */\nconst a = 1;`,
      errors: [error],
    },
    { code: `/** ${words(11)} */\nconst a = 1;`, options: [{ max: 10 }], errors: [error] },
  ],
});
