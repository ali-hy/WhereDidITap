// F-3b: `budmon/message-id` (A-12). Message descriptors need an explicit, literal, dotted ID.

const ID_FORMAT = /^[a-z][A-Za-z0-9_]*(\.[a-z][A-Za-z0-9_]*)+$/;
const FUNCTIONS = new Set(["t", "defineMessage", "formatMessage"]);
const PROPERTIES = new Set(["t", "formatMessage"]);

function literalString(node) {
  if (node.type === "Literal" && typeof node.value === "string") return node.value;
  if (node.type === "TemplateLiteral" && node.expressions.length === 0) {
    return node.quasis[0]?.value.cooked ?? "";
  }
  return undefined;
}

function isNamed(callee, names, properties) {
  if (callee.type === "Identifier") return names.has(callee.name);
  return (
    callee.type === "MemberExpression" &&
    !callee.computed &&
    callee.property.type === "Identifier" &&
    properties.has(callee.property.name)
  );
}

/** @type {import("eslint").Rule.RuleModule} */
const rule = {
  meta: {
    type: "problem",
    schema: [],
    messages: {
      missing: "Give this message an explicit id (D-37).",
      notLiteral: "Message ids must be string literals so they can be extracted.",
      format:
        "Message id '{{id}}' must be dot-separated segments starting with a lowercase letter, like 'error.generic.read'.",
    },
  },
  create(context) {
    function checkDescriptor(node) {
      if (node.type !== "ObjectExpression") return;
      const idProperty = node.properties.find(
        (p) =>
          p.type === "Property" &&
          !p.computed &&
          ((p.key.type === "Identifier" && p.key.name === "id") ||
            (p.key.type === "Literal" && p.key.value === "id")),
      );
      if (idProperty === undefined) {
        if (!node.properties.some((p) => p.type === "SpreadElement")) {
          context.report({ node, messageId: "missing" });
        }
        return;
      }
      const id = literalString(idProperty.value);
      if (id === undefined) {
        context.report({ node: idProperty.value, messageId: "notLiteral" });
      } else if (!ID_FORMAT.test(id)) {
        context.report({ node: idProperty.value, messageId: "format", data: { id } });
      }
    }

    return {
      CallExpression(node) {
        const first = node.arguments[0];
        if (first === undefined) return;
        if (isNamed(node.callee, FUNCTIONS, PROPERTIES)) checkDescriptor(first);
        if (node.callee.type === "Identifier" && node.callee.name === "defineMessages") {
          if (first.type === "ObjectExpression") {
            for (const p of first.properties) if (p.type === "Property") checkDescriptor(p.value);
          }
        }
      },
    };
  },
};

export default rule;
