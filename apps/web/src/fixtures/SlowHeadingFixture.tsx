// /__fixtures/slow-heading (A-542): the heading renders after a 300 ms resource. TP-11.38.
import { createResource, Show, Suspense, type JSX } from "solid-js";
import { useFixtureTitle } from "./title.js";

const DELAY_MS = 300;

export function SlowHeadingFixture(): JSX.Element {
  useFixtureTitle("Slow heading");
  const [ready] = createResource(
    () =>
      new Promise<boolean>((resolve) => {
        setTimeout(() => {
          resolve(true);
        }, DELAY_MS);
      }),
  );
  return (
    <Suspense fallback={<p>Loading</p>}>
      <Show when={ready() === true}>
        <h1 tabindex="-1">Slow heading</h1>
      </Show>
    </Suspense>
  );
}
