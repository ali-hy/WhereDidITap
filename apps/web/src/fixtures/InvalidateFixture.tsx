// /__fixtures/invalidate (A-416): the loader counts its runs; "Invalidate" calls
// router.invalidate(), which re-runs it without moving focus or announcing (A-402). TP-11.15 (b).
import { useRouter } from "@tanstack/solid-router";
import { createSignal, type JSX } from "solid-js";

const [runs, setRuns] = createSignal(0);

export function invalidateLoader(): void {
  setRuns((n) => n + 1);
}

export function InvalidateFixture(): JSX.Element {
  const router = useRouter();
  return (
    <>
      <h1 tabindex="-1">Invalidate fixture</h1>
      <p data-testid="loader-runs">Loader runs: {runs()}</p>
      <button
        type="button"
        onClick={() => {
          void router.invalidate();
        }}
      >
        Invalidate
      </button>
    </>
  );
}
