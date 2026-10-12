// /__fixtures/flaky-loader (A-328): the loader throws on its first run after a page load, then
// succeeds. TP-11.8.
import type { JSX } from "solid-js";

let runs = 0;

export function flakyLoader(): void {
  runs += 1;
  if (runs === 1) throw new Error("fixture");
}

export function FlakyLoaderFixture(): JSX.Element {
  return <h1 tabindex="-1">Recovered</h1>;
}
