// /__fixtures/failing-loader (A-397): the loader always throws, so Try again keeps failing.
// TP-11.8 (b).
import type { JSX } from "solid-js";

export function failingLoader(): void {
  throw new Error("fixture");
}

export function FailingLoaderFixture(): JSX.Element {
  return <h1 tabindex="-1">Never shown</h1>;
}
