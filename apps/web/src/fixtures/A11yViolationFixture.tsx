// /__fixtures/a11y-violation (A-332): text #767676 on #808080, a colour-contrast violation that
// lint can't see. TP-11.14.
import type { JSX } from "solid-js";

export function A11yViolationFixture(): JSX.Element {
  return (
    <>
      <h1 tabindex="-1">Accessibility violation fixture</h1>
      <p style={{ color: "#767676", "background-color": "#808080" }}>
        This text doesn't have enough contrast.
      </p>
    </>
  );
}
