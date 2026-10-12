// A-322: budmon/rtl-exempt-reason. A disable comment that covers csstools/use-logical (by name or
// by disabling every rule) needs the description `rtl-exempt: <reason>`. Without it the comment is
// reported, and it no longer exempts the declaration from csstools/use-logical.
import stylelint from "stylelint";

const ruleName = "budmon/rtl-exempt-reason";
const LOGICAL = "csstools/use-logical";
const ALL = "all";
const REASON = /^rtl-exempt:\s*\S/;

const messages = stylelint.utils.ruleMessages(ruleName, {
  rejected: () => `A disable covering ${LOGICAL} needs "-- rtl-exempt: <reason>" (D-38, AC-11.3)`,
});

/** @type {import("stylelint").Rule} */
const rule = (primary) => (root, result) => {
  const valid = stylelint.utils.validateOptions(result, ruleName, { actual: primary });
  if (!valid || primary !== true) return;
  const ranges = result.stylelint.disabledRanges;
  // The ranges csstools/use-logical honours: its own (which include blanket ones) or the blanket.
  const covering = ranges[LOGICAL] ?? ranges[ALL] ?? [];
  // This rule's own reports can't be disabled: a blanket disable is what it reports.
  ranges[ruleName] = [];
  const kept = [];
  const reported = new Set();
  for (const range of covering) {
    if (typeof range.description === "string" && REASON.test(range.description)) {
      kept.push(range);
      continue;
    }
    if (range.node !== undefined && !reported.has(range.node)) {
      reported.add(range.node);
      stylelint.utils.report({ ruleName, result, node: range.node, message: messages.rejected() });
    }
  }
  // Only the use-logical ranges change; other rules keep every disable.
  ranges[LOGICAL] = kept;
};

rule.ruleName = ruleName;
rule.messages = messages;
rule.meta = { url: "docs/design/platform/lld.md#a-322" };

export default stylelint.createPlugin(ruleName, rule);
