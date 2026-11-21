// /__fixtures/query-heading (A-545): an h1 over two regions that each read a query inside their
// own Suspense, resolving after 150 ms and 300 ms. TP-11.40.
import { createQuery } from "@tanstack/solid-query";
import { Suspense, type JSX } from "solid-js";
import { useFixtureTitle } from "./title.js";

function Region(props: { name: string; delayMs: number }): JSX.Element {
  const query = createQuery(() => ({
    queryKey: ["fixture-query-heading", props.name],
    queryFn: () =>
      new Promise<string>((resolve) => {
        setTimeout(() => {
          resolve(`${props.name} loaded`);
        }, props.delayMs);
      }),
    staleTime: 0,
    retry: false,
  }));
  return (
    <Suspense fallback={<p>Loading…</p>}>
      <p data-region={props.name}>{query.data}</p>
    </Suspense>
  );
}

export function QueryHeadingFixture(): JSX.Element {
  useFixtureTitle("Query heading");
  return (
    <>
      <h1 tabindex="-1">Query heading</h1>
      <Region name="first" delayMs={150} />
      <Region name="second" delayMs={300} />
    </>
  );
}
