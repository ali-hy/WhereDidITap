// F-3b budmon/message-id (A-12). TP-11.30, filename apps/web/src/x.tsx.
import { budmonRule, ruleTester } from "./support/ruleTester.js";

const FILE = "/repo/apps/web/src/x.tsx";

ruleTester.run("TP-11.30: budmon/message-id (F-3b)", budmonRule("message-id"), {
  valid: [
    {
      name: "TP-11.30 (a)",
      filename: FILE,
      code: 't({ id: "error.generic.read", defaultMessage: "x" });',
    },
    {
      name: "TP-11.30 (b)",
      filename: FILE,
      code: 'defineMessage({ id: "validation.too_small", defaultMessage: "x" });',
    },
    {
      name: "TP-11.30 (c)",
      filename: FILE,
      code: 'defineMessages({ a: { id: "home.placeholder", defaultMessage: "x" } });',
    },
    { name: "TP-11.30 (h)", filename: FILE, code: 't({ id: `home.title`, defaultMessage: "x" });' },
    { name: "TP-11.30 (m)", filename: FILE, code: "t({ ...base });" },
    { name: "TP-11.30 (n)", filename: FILE, code: "t(m);" },
    { name: "TP-11.30 (o)", filename: FILE, code: 'other({ defaultMessage: "x" });' },
  ],
  invalid: [
    {
      name: "TP-11.30 (d)",
      filename: FILE,
      code: 't({ defaultMessage: "x" });',
      errors: [{ messageId: "missing" }],
    },
    {
      name: "TP-11.30 (e)",
      filename: FILE,
      code: 'defineMessages({ a: { defaultMessage: "x" } });',
      errors: [{ messageId: "missing" }],
    },
    {
      name: "TP-11.30 (f)",
      filename: FILE,
      code: 't({ id: key, defaultMessage: "x" });',
      errors: [{ messageId: "notLiteral" }],
    },
    {
      name: "TP-11.30 (g)",
      filename: FILE,
      code: 't({ id: `a.${k}`, defaultMessage: "x" });',
      errors: [{ messageId: "notLiteral" }],
    },
    {
      name: "TP-11.30 (i)",
      filename: FILE,
      code: 't({ id: "Error.read", defaultMessage: "x" });',
      errors: [{ messageId: "format", data: { id: "Error.read" } }],
    },
    {
      name: "TP-11.30 (j)",
      filename: FILE,
      code: 't({ id: "error", defaultMessage: "x" });',
      errors: [{ messageId: "format", data: { id: "error" } }],
    },
    {
      name: "TP-11.30 (k)",
      filename: FILE,
      code: 't({ id: "error.", defaultMessage: "x" });',
      errors: [{ messageId: "format", data: { id: "error." } }],
    },
    {
      name: "TP-11.30 (l)",
      filename: FILE,
      code: 'intl.formatMessage({ id: "a-b.c", defaultMessage: "x" });',
      errors: [{ messageId: "format", data: { id: "a-b.c" } }],
    },
  ],
});
