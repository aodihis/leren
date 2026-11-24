import { defineRule } from "@oxlint/plugins";

export const MAX_COMMENT_LENGTH = 50;

const DIRECTIVE =
  /^\s*(oxlint|eslint|oxfmt|prettier|istanbul|c8|v8)[-\s]|^\s*@ts-|^\s*#(end)?region\b|^\/\s*<reference|^!/;

/** Returns the plain words of a comment. */
function getCommentText(value: string): string {
  return value
    .split("\n")
    .map((line) => line.replace(/^\s*\*+/, "").trim())
    .filter((line) => line.length > 0)
    .join(" ");
}

/** Limits comments to a short general description. */
export const maxCommentLengthRule = defineRule({
  meta: {
    type: "suggestion",
    docs: {
      description: `Limit comments to ${MAX_COMMENT_LENGTH} characters of general information about the code.`,
    },
    messages: {
      tooLong: `Comments are limited to ${MAX_COMMENT_LENGTH} characters. Describe what the code is in general terms and leave bug details to the commit message or a test.`,
    },
  },
  createOnce(context) {
    return {
      Program() {
        for (const comment of context.sourceCode.getAllComments()) {
          if (DIRECTIVE.test(comment.value)) continue;

          if (getCommentText(comment.value).length > MAX_COMMENT_LENGTH) {
            context.report({ node: comment, messageId: "tooLong" });
          }
        }
      },
    };
  },
});
