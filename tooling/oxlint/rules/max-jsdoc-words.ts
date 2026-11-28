import { defineRule } from "@oxlint/plugins";

const DEFAULT_MAX = 50;
const BLOCK_TAG = /^@\w/;
const WORD = /[\p{L}\p{N}]/u;

/**
 * Counts the words of a JSDoc description. The description ends at the first block tag, so the text
 * of tags such as `@param` and `@returns` is not counted. A word is any run of non-space characters
 * that holds a letter or a digit.
 */
function countDescriptionWords(value: string): number {
  const description: string[] = [];

  for (const line of value.split("\n")) {
    const text = line.replace(/^\s*\*?\s?/, "").trim();

    if (BLOCK_TAG.test(text)) break;
    description.push(text);
  }

  return description
    .join(" ")
    .split(/\s+/)
    .filter((word) => WORD.test(word)).length;
}

/** Reject JSDoc blocks whose description is longer than the configured number of words. */
export const maxJsdocWordsRule = defineRule({
  meta: {
    type: "suggestion",
    docs: {
      description: "Limit the length of a JSDoc description so that it stays concise.",
    },
    schema: [
      {
        type: "object",
        properties: { max: { type: "integer", minimum: 1 } },
        additionalProperties: false,
      },
    ],
    messages: {
      tooLong:
        "This JSDoc description has {{count}} words; the limit is {{max}}. Keep the invariants and drop implementation details, history and scenarios.",
    },
  },
  createOnce(context) {
    return {
      Program() {
        const max: number = context.options[0]?.max ?? DEFAULT_MAX;

        for (const comment of context.sourceCode.getAllComments()) {
          if (comment.type !== "Block" || !comment.value.startsWith("*")) continue;

          const count = countDescriptionWords(comment.value.slice(1));

          if (count > max) {
            context.report({
              node: comment,
              messageId: "tooLong",
              data: { count: String(count), max: String(max) },
            });
          }
        }
      },
    };
  },
});
