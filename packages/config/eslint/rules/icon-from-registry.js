// F-3: `budmon/icon-from-registry` (D-38 rule 6, A-10). Icons come only from the registry.

const REGISTRY = /(^|\/)apps\/web\/src\/ui\/icons\/registry\.ts$/;
const ICON_DIR = /(^|\/)apps\/web\/src\/ui\/icons\//;
const SVG_FILE = /\.svg(\?.*)?$/;

function isRelative(specifier) {
  return specifier.startsWith("./") || specifier.startsWith("../") || specifier.startsWith("/");
}

function packageName(specifier) {
  const rest = specifier.replace(/^[a-z][a-z0-9+.-]*:/i, "");
  const segments = rest.split("/");
  return rest.startsWith("@") ? segments.slice(0, 2).join("/") : (segments[0] ?? "");
}

function isIconPackage(specifier) {
  const name = packageName(specifier);
  return name === "lucide-solid" || name === "@tabler/icons-solidjs" || /icon/i.test(name);
}

function literalSource(node) {
  if (node.type === "Literal" && typeof node.value === "string") return node.value;
  if (node.type === "TemplateLiteral" && node.expressions.length === 0) {
    return node.quasis[0]?.value.cooked ?? "";
  }
  return undefined;
}

/** @type {import("eslint").Rule.RuleModule} */
const rule = {
  meta: {
    type: "problem",
    schema: [],
    messages: {
      registry: "Use an icon from the registry (D-38 rule 6).",
    },
  },
  create(context) {
    const file = context.filename.split("\\").join("/");
    const inRegistry = REGISTRY.test(file);
    const inIcons = ICON_DIR.test(file);

    function checkSource(reportNode, sourceNode) {
      const specifier = literalSource(sourceNode);
      if (specifier === undefined) return;
      if (!isRelative(specifier) && isIconPackage(specifier) && !inRegistry) {
        context.report({ node: reportNode, messageId: "registry" });
      } else if (SVG_FILE.test(specifier) && !inIcons) {
        context.report({ node: reportNode, messageId: "registry" });
      }
    }

    function fromSource(node) {
      if (node.source) checkSource(node, node.source);
    }

    return {
      ImportDeclaration: fromSource,
      ExportNamedDeclaration: fromSource,
      ExportAllDeclaration: fromSource,
      ImportExpression(node) {
        checkSource(node, node.source);
      },
      JSXOpeningElement(node) {
        if (inIcons) return;
        if (node.name.type === "JSXIdentifier" && node.name.name === "svg") {
          context.report({ node, messageId: "registry" });
        }
      },
    };
  },
};

export default rule;
