// /__fixtures/slow-heading (A-542): the heading renders after a 300 ms resource. TP-11.38. With ?replace=1 the h1 is swapped for a new element 20 ms
// after it first shows (TP-11.39).
import { createEffect, createResource, createSignal, Show, Suspense, type JSX } from "solid-js";
import { useFixtureTitle } from "./title.js";

const DELAY_MS = 300;
const REPLACE_MS = 20;

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
  const replace = new URLSearchParams(window.location.search).get("replace") === "1";
  // A new number re-creates the h1.
  const [generation, setGeneration] = createSignal(1);
  createEffect(() => {
    if (ready() === true && replace) {
      setTimeout(() => {
        setGeneration(2);
      }, REPLACE_MS);
    }
  });
  return (
    <Suspense fallback={<p>Loading</p>}>
      <Show when={ready() === true ? generation() : undefined} keyed>
        <h1 tabindex="-1">Slow heading</h1>
      </Show>
    </Suspense>
  );
}
