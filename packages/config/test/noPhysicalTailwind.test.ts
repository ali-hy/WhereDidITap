// F-2 budmon/no-physical-tailwind. TP-11.18, plus extra cases TP-11.31x. IDs ending in "x" are
// test-architect additions, not LLD test-plan IDs.
import { budmonRule, ruleTester } from "./support/ruleTester.js";

const physical = (cls: string) => ({ messageId: "physical", data: { cls } });

ruleTester.run("TP-11.18: budmon/no-physical-tailwind (F-2)", budmonRule("no-physical-tailwind"), {
  valid: [
    { name: 'TP-11.18: class="ms-2"', code: 'const a = <div class="ms-2" />;' },
    { name: 'TP-11.18: class="rtl:ml-2"', code: 'const a = <div class="rtl:ml-2" />;' },
    {
      name: 'TP-11.18: class="space-x-2 rtl:space-x-reverse"',
      code: 'const a = <div class="space-x-2 rtl:space-x-reverse" />;',
    },
    {
      name: "TP-11.18: a line after // rtl-exempt: logo",
      code: 'const a = (\n  // rtl-exempt: logo\n  <div class="ml-2" />\n);',
    },
    { name: "TP-11.31x: ltr: variant", code: 'const a = <div class="ltr:mr-4" />;' },
    {
      name: "TP-11.31x: -space-x with rtl:space-x-reverse",
      code: 'const a = <div class="-space-x-2 rtl:space-x-reverse" />;',
    },
    {
      name: "TP-11.31x: divide-x with rtl:divide-x-reverse",
      code: 'const a = <div class="divide-x-2 rtl:divide-x-reverse" />;',
    },
    {
      name: "TP-11.31x: logical utilities",
      code: 'const a = <div class="ps-4 pe-2 text-start border-s" />;',
    },
    { name: "TP-11.31x: other calls aren't checked", code: 'other("ml-2");' },
  ],
  invalid: [
    {
      name: 'TP-11.18: class="ml-2"',
      code: 'const a = <div class="ml-2" />;',
      errors: [physical("ml-2")],
    },
    {
      name: 'TP-11.18: class="space-x-2"',
      code: 'const a = <div class="space-x-2" />;',
      errors: [physical("space-x-2")],
    },
    // N-5 (review N-7): the negative forms match too (^-?space-x-, ^-?divide-x-).
    {
      name: 'TP-11.31x: class="-space-x-2" (negative, no rtl reverse)',
      code: 'const a = <div class="-space-x-2" />;',
      errors: [physical("-space-x-2")],
    },
    {
      name: 'TP-11.31x: class="-divide-x-2" (negative, no rtl reverse)',
      code: 'const a = <div class="-divide-x-2" />;',
      errors: [physical("-divide-x-2")],
    },
    {
      name: 'TP-11.18: class="text-left"',
      code: 'const a = <div class="text-left" />;',
      errors: [physical("text-left")],
    },
    { name: 'TP-11.18: cn("pr-4")', code: 'cn("pr-4");', errors: [physical("pr-4")] },
    {
      name: "TP-11.31x: a variant prefix is stripped (hover:, md:)",
      code: 'const a = <div class="hover:mr-2 md:-ml-1" />;',
      errors: [physical("mr-2"), physical("-ml-1")],
    },
    {
      name: "TP-11.31x: borders and rounded corners",
      code: 'const a = <div class="border-l rounded-tr-lg" />;',
      errors: [physical("border-l"), physical("rounded-tr-lg")],
    },
    {
      name: "TP-11.31x: clsx and a template literal in class",
      code: 'clsx("float-right"); const a = <div class={`pl-2 ${x}`} />;',
      errors: [physical("float-right"), physical("pl-2")],
    },
    {
      name: "TP-11.31x: rtl-exempt without a reason doesn't exempt",
      code: 'const a = (\n  // rtl-exempt:\n  <div class="ml-2" />\n);',
      errors: [physical("ml-2")],
    },
  ],
});
