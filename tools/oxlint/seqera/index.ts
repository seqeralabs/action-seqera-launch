import { defineRule, eslintCompatPlugin } from "@oxlint/plugins";

const HELPER = "optionalNullable";

/** Platform sends null for fields the spec types as plain optionals (9db92ba, 7c2fce6). */
const optionalResponseFieldRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description: "Require optionalNullable for optional Platform response fields.",
    },
    messages: {
      bareOptionalKey:
        "Use `optionalNullable` from src/api/schemas/common.ts instead of `Schema.optionalKey`. Platform sends null for unset fields, and a bare optionalKey fails to decode it.",
    },
  },
  createOnce(context) {
    let insideHelper = 0;
    return {
      FunctionDeclaration(node) {
        if (node.id?.name === HELPER) insideHelper++;
      },
      "FunctionDeclaration:exit"(node) {
        if (node.id?.name === HELPER) insideHelper--;
      },
      CallExpression(node) {
        const callee = node.callee;
        if (
          insideHelper === 0 &&
          callee.type === "MemberExpression" &&
          callee.object.type === "Identifier" &&
          callee.object.name === "Schema" &&
          callee.property.type === "Identifier" &&
          callee.property.name === "optionalKey"
        ) {
          context.report({ node, messageId: "bareOptionalKey" });
        }
      },
    };
  },
});

/** Repo-specific rules. Scoped per path in .oxlintrc.json overrides. */
export default eslintCompatPlugin({
  meta: { name: "seqera" },
  rules: { "optional-response-field": optionalResponseFieldRule },
});
