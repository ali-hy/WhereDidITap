// F-4 the stylelint configuration (D-38, A-14). TP-11.20, plus extra cases TP-11.31x. IDs ending
// in "x" are test-architect additions, not LLD test-plan IDs.
//
// stylelint and packages/config/stylelint/index.js arrive with S-11a; until then they load through
// variable specifiers so typecheck passes.
import { describe, expect, it } from "vitest";

interface Warning {
  rule: string;
  severity: string;
}
interface Stylelint {
  lint: (options: { code: string; config: unknown; codeFilename?: string }) => Promise<{
    results: { warnings: Warning[] }[];
  }>;
}

const STYLELINT = "stylelint";
const CONFIG = "../stylelint/index.js";

async function lintCss(code: string): Promise<Warning[]> {
  const stylelint = ((await import(/* @vite-ignore */ STYLELINT)) as { default: Stylelint })
    .default;
  const config = ((await import(/* @vite-ignore */ CONFIG)) as { default: unknown }).default;
  const { results } = await stylelint.lint({ code, config, codeFilename: "apps/web/src/x.css" });
  return results.flatMap((r) => r.warnings);
}

describe("TP-11.20: physical CSS properties (F-4)", () => {
  it("TP-11.20: margin-left: 1px is an error (csstools/use-logical)", async () => {
    const warnings = await lintCss(".a { margin-left: 1px; }\n");

    expect(warnings).toContainEqual(
      expect.objectContaining({ rule: "csstools/use-logical", severity: "error" }),
    );
  });

  it("TP-11.20: margin-inline-start: 1px is ok", async () => {
    expect(await lintCss(".a { margin-inline-start: 1px; }\n")).toEqual([]);
  });

  it("TP-11.31x: a declaration after stylelint-disable-next-line csstools/use-logical with a reason is ignored", async () => {
    const code =
      ".a {\n  /* stylelint-disable-next-line csstools/use-logical -- rtl-exempt: logo */\n  margin-left: 1px;\n}\n";

    expect(await lintCss(code)).toEqual([]);
  });
});

// A-322: budmon/rtl-exempt-reason requires "rtl-exempt: <reason>" on any disable covering
// csstools/use-logical (or every rule).
describe("TP-11.20 (A-322): rtl-exempt reasons (budmon/rtl-exempt-reason)", () => {
  const rules = (warnings: Warning[]) => warnings.map((w) => w.rule);
  const declaration = (comment: string) => `.a {\n  ${comment}\n  margin-left: 1px;\n}\n`;

  it("TP-11.20 (A-322): -- rtl-exempt: logo passes", async () => {
    expect(
      await lintCss(
        declaration("/* stylelint-disable-next-line csstools/use-logical -- rtl-exempt: logo */"),
      ),
    ).toEqual([]);
  });

  it("TP-11.20 (A-322): the same disable without a description is a budmon/rtl-exempt-reason error", async () => {
    const warnings = await lintCss(
      declaration("/* stylelint-disable-next-line csstools/use-logical */"),
    );

    expect(warnings).toContainEqual(
      expect.objectContaining({ rule: "budmon/rtl-exempt-reason", severity: "error" }),
    );
  });

  it("TP-11.20 (A-322): -- because is a budmon/rtl-exempt-reason error", async () => {
    const warnings = await lintCss(
      declaration("/* stylelint-disable-next-line csstools/use-logical -- because */"),
    );

    expect(warnings).toContainEqual(
      expect.objectContaining({ rule: "budmon/rtl-exempt-reason", severity: "error" }),
    );
  });

  it("TP-11.20 (A-322): -- rtl-exempt: with an empty reason is a budmon/rtl-exempt-reason error", async () => {
    const warnings = await lintCss(
      declaration("/* stylelint-disable-next-line csstools/use-logical -- rtl-exempt: */"),
    );

    expect(rules(warnings)).toContain("budmon/rtl-exempt-reason");
  });

  it("TP-11.20 (A-322): a blanket /* stylelint-disable */ before margin-left is an error from both rules", async () => {
    const warnings = await lintCss("/* stylelint-disable */\n.a { margin-left: 1px; }\n");

    expect(rules(warnings)).toEqual(
      expect.arrayContaining(["budmon/rtl-exempt-reason", "csstools/use-logical"]),
    );
  });

  it("TP-11.20 (A-322): a disable for another rule (color-no-invalid-hex) isn't reported by budmon/rtl-exempt-reason", async () => {
    const warnings = await lintCss(
      ".a {\n  /* stylelint-disable-next-line color-no-invalid-hex */\n  color: #zzz;\n}\n",
    );

    expect(rules(warnings)).not.toContain("budmon/rtl-exempt-reason");
  });
});

describe("TP-11.31x: the stylelint configuration's wiring (F-4, §2.1, A-14)", () => {
  const ROOT_CONFIG = "../../../stylelint.config.js";
  const PACKAGE_CONFIG = "@budmon/config/stylelint";

  it("TP-11.31x: F-4 uses the stylelint-use-logical plugin with csstools/use-logical always, no exceptions, and enables budmon/rtl-exempt-reason (A-322)", async () => {
    const config = ((await import(/* @vite-ignore */ CONFIG)) as { default: unknown }).default as {
      plugins?: unknown;
      rules?: Record<string, unknown>;
    };

    expect(config.plugins).toContain("stylelint-use-logical");
    expect(config.rules?.["csstools/use-logical"]).toEqual(["always", { except: [] }]);
    expect(config.rules?.["budmon/rtl-exempt-reason"]).toBe(true);
  });

  it("TP-11.31x: the root stylelint.config.js default-exports @budmon/config/stylelint", async () => {
    const root = ((await import(/* @vite-ignore */ ROOT_CONFIG)) as { default: unknown }).default;
    const exported = ((await import(/* @vite-ignore */ PACKAGE_CONFIG)) as { default: unknown })
      .default;

    expect(root).toBe(exported);
  });
});
