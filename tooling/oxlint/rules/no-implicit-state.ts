import { defineRule } from "@oxlint/plugins";

/** Bans module-level mutable bindings. */
export const noImplicitStateRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description: "Disallow module-level `let` and `var` declarations that hold implicit state.",
    },
    messages: {
      implicit:
        "Module-level mutable binding `{{kind}}` is implicit shared state. Use `const`, or hold the state in an explicit object, class or parameter.",
    },
  },
  createOnce(context) {
    return {
      VariableDeclaration(node) {
        if (node.kind !== "let" && node.kind !== "var") return;
        const parent = node.parent;

        const isModuleLevel =
          parent.type === "Program" ||
          (parent.type === "ExportNamedDeclaration" && parent.parent.type === "Program");

        if (!isModuleLevel) return;
        context.report({ node, messageId: "implicit", data: { kind: node.kind } });
      },
    };
  },
});
