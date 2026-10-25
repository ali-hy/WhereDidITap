// F-3 budmon/icon-from-registry (A-10). TP-11.19. Filenames are absolute paths ending as given.
import { budmonRule, ruleTester } from "./support/ruleTester.js";

const HOME = "/repo/apps/web/src/pages/Home.tsx";
const REGISTRY = "/repo/apps/web/src/ui/icons/registry.ts";
const ICON = "/repo/apps/web/src/ui/icons/Icon.tsx";
const WINDOWS_REGISTRY = "C:\\repo\\apps\\web\\src\\ui\\icons\\registry.ts";
const registry = [{ messageId: "registry" }];

ruleTester.run("TP-11.19: budmon/icon-from-registry (F-3)", budmonRule("icon-from-registry"), {
  valid: [
    { name: "TP-11.19 (h)", filename: HOME, code: 'import { Icon } from "../ui/icons/Icon.js";' },
    {
      name: "TP-11.19 (i)",
      filename: HOME,
      code: 'import { icons } from "../ui/icons/registry.js";',
    },
    { name: "TP-11.19 (j)", filename: HOME, code: 'import { x } from "@budmon/shared/icons";' },
    { name: "TP-11.19 (k)", filename: HOME, code: 'import { createSignal } from "solid-js";' },
    {
      name: "TP-11.19 (k2)",
      filename: HOME,
      code: 'import { IconButton } from "./iconButton.js";',
    },
    { name: "TP-11.19 (n)", filename: HOME, code: "const m = await import(name);" },
    { name: "TP-11.19 (p)", filename: REGISTRY, code: 'import { Home } from "lucide-solid";' },
    { name: "TP-11.19 (q)", filename: REGISTRY, code: 'import a from "./arrow.svg";' },
    { name: "TP-11.19 (r)", filename: ICON, code: "const a = <svg />;" },
    {
      name: "TP-11.19 (t)",
      filename: WINDOWS_REGISTRY,
      code: 'import { Home } from "lucide-solid";',
    },
  ],
  invalid: [
    {
      name: "TP-11.19 (a)",
      filename: HOME,
      code: 'import { Home } from "lucide-solid";',
      errors: registry,
    },
    {
      name: "TP-11.19 (b)",
      filename: HOME,
      code: 'import x from "lucide-solid/icons/home";',
      errors: registry,
    },
    {
      name: "TP-11.19 (c)",
      filename: HOME,
      code: 'import type { P } from "@tabler/icons-solidjs";',
      errors: registry,
    },
    {
      name: "TP-11.19 (d)",
      filename: HOME,
      code: 'export { Home } from "lucide-solid";',
      errors: registry,
    },
    { name: "TP-11.19 (e)", filename: HOME, code: 'export * from "~icons/mdi";', errors: registry },
    {
      name: "TP-11.19 (f)",
      filename: HOME,
      code: 'const m = await import("virtual:icons/mdi/home");',
      errors: registry,
    },
    {
      name: "TP-11.19 (g)",
      filename: HOME,
      code: 'import x from "@iconify/utils";',
      errors: registry,
    },
    {
      name: "TP-11.19 (l)",
      filename: HOME,
      code: 'import logo from "./logo.svg";',
      errors: registry,
    },
    {
      name: "TP-11.19 (m)",
      filename: HOME,
      code: 'import logo from "./logo.svg?component";',
      errors: registry,
    },
    { name: "TP-11.19 (o)", filename: HOME, code: "const a = <svg />;", errors: registry },
    {
      name: "TP-11.19 (s)",
      filename: ICON,
      code: 'import { Home } from "lucide-solid";',
      errors: registry,
    },
  ],
});
