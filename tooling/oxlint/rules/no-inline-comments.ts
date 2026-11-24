import { defineRule } from "@oxlint/plugins";

const DIRECTIVE =
  /^\s*(oxlint|eslint|oxfmt|prettier|istanbul|c8|v8)[-\s]|^\s*@ts-|^\s*#(end)?region\b|^\/\s*<reference|^!/;

/** Allows only JSDoc blocks and tool directives. */
export const noInlineCommentsRule = defineRule({
  meta: {
    type: "suggestion",
    docs: {
      description:
        "Disallow explanatory comments on individual lines; describe functions, classes and files with JSDoc instead.",
    },
    messages: {
      inline:
        "Avoid comments that explain individual lines. Make the code self-explanatory, or describe the function, class or file with a JSDoc block.",
    },
  },
  createOnce(context) {
    return {
      Program() {
        for (const comment of context.sourceCode.getAllComments()) {
          const isJsDoc = comment.type === "Block" && comment.value.startsWith("*");

          if (isJsDoc || DIRECTIVE.test(comment.value)) continue;
          context.report({ node: comment, messageId: "inline" });
        }
      },
    };
  },
});
