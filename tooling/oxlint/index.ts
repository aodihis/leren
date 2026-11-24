import { eslintCompatPlugin } from "@oxlint/plugins";

import { maxCommentLengthRule } from "./rules/max-comment-length.ts";
import { noArrayFilterMapRule } from "./rules/no-array-filter-map.ts";
import { noChainedTypeAssertionsRule } from "./rules/no-chained-type-assertions.ts";
import { noConditionalEmptyObjectSpreadRule } from "./rules/no-conditional-empty-object-spread.ts";
import { noImplicitStateRule } from "./rules/no-implicit-state.ts";
import { noInlineCommentsRule } from "./rules/no-inline-comments.ts";
import { requireReadableSpacingRule } from "./rules/require-readable-spacing.ts";

/** Project-specific Oxlint rules. */
const antiSlopPlugin = eslintCompatPlugin({
  meta: { name: "rules" },
  rules: {
    "max-comment-length": maxCommentLengthRule,
    "no-array-filter-map": noArrayFilterMapRule,
    "no-chained-type-assertions": noChainedTypeAssertionsRule,
    "no-conditional-empty-object-spread": noConditionalEmptyObjectSpreadRule,
    "no-implicit-state": noImplicitStateRule,
    "no-inline-comments": noInlineCommentsRule,
    "require-readable-spacing": requireReadableSpacingRule,
  },
});

export default antiSlopPlugin;
