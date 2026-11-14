// P-A-515 (e) "token utilities only", as a test helper (test-architect): every class token rendered
// under a root that names a Tailwind palette colour or an arbitrary colour. Variants are stripped.

const PALETTE =
  /^(bg|text|border|outline|ring|fill|stroke|divide|placeholder|decoration|caret|accent)-(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|black|white)(-\d+)?$/;
const ARBITRARY_COLOUR = /-\[(#|rgb\(|hsl\(|oklch\(|color:)/;

export function badClasses(root: Element): string[] {
  const tokens = [root, ...root.querySelectorAll("*")].flatMap((el) =>
    (el.getAttribute("class") ?? "").split(/\s+/).filter((c) => c !== ""),
  );
  return tokens.filter((c) => {
    const utility = c.split(":").at(-1) ?? c;
    return PALETTE.test(utility) || ARBITRARY_COLOUR.test(utility);
  });
}
