// /__fixtures/virtual-table (A-341, A-342): 100,000 synthetic rows from an MSW handler with keyset
// paging, for TP-12.3 and the TP-12.4 performance run.
import { http, HttpResponse } from "msw";
import { setupWorker } from "msw/browser";
import { createEffect, createSignal, type JSX } from "solid-js";
import { createInfiniteList } from "../ui/table/infiniteList.js";
import { VirtualTable, type VirtualTableColumn } from "../ui/table/VirtualTable.js";

interface SyntheticRow {
  index: number;
  name: string;
  amount: string;
}

const TOTAL = 100_000;
const PAGE_SIZE = 100;

function rowAt(index: number): SyntheticRow {
  const cents = (index * 7919) % 100_000;
  return {
    index,
    name: `Row ${String(index)}`,
    amount: `${String(Math.floor(cents / 100))}.${String(cents % 100).padStart(2, "0")}`,
  };
}

let worker: Promise<unknown> | undefined;

/** Starts the MSW worker once; the route's loader awaits it, so it runs before rendering. */
export function startFixtureWorker(): Promise<unknown> {
  worker ??= setupWorker(
    http.get("/__fixtures/api/rows", ({ request }) => {
      const url = new URL(request.url);
      const start = Number.parseInt(url.searchParams.get("cursor") ?? "0", 10) || 0;
      const limit = Number.parseInt(url.searchParams.get("limit") ?? "", 10) || PAGE_SIZE;
      const end = Math.min(TOTAL, start + limit);
      const items = Array.from({ length: Math.max(0, end - start) }, (_, i) => rowAt(start + i));
      return HttpResponse.json({
        items,
        nextCursor: end < TOTAL ? String(end) : null,
        totalCount: TOTAL,
      });
    }),
  ).start({
    serviceWorker: { url: "/mockServiceWorker.js" },
    // msw 3 names §8.1's onUnhandledRequest option onUnhandledFrame.
    onUnhandledFrame: "bypass",
    quiet: true,
  });
  return worker;
}

const COLUMNS: readonly VirtualTableColumn<SyntheticRow>[] = [
  { id: "index", header: "Index", cell: (row) => <span>{row.index}</span>, align: "end" },
  { id: "name", header: "Name", cell: (row) => <span>{row.name}</span> },
  { id: "amount", header: "Amount", cell: (row) => <span>{row.amount}</span>, align: "end" },
];

export function VirtualTableFixture(): JSX.Element {
  let firstResponse = true;
  const source = createInfiniteList<SyntheticRow>({
    pageSize: PAGE_SIZE,
    fetchPage: async (cursor) => {
      const res = await fetch(
        `/__fixtures/api/rows?cursor=${cursor ?? "0"}&limit=${String(PAGE_SIZE)}`,
      );
      const page = (await res.json()) as {
        items: SyntheticRow[];
        nextCursor: string | null;
        totalCount: number;
      };
      if (firstResponse) {
        firstResponse = false;
        performance.mark("budmon:first-page-response");
      }
      return page;
    },
  });
  const [activated, setActivated] = createSignal<number | null>(null);

  let marked = false;
  createEffect(() => {
    if (marked || source.rowCount() === 0) return;
    marked = true;
    // The first frame after the first data row is in the DOM.
    queueMicrotask(() => {
      requestAnimationFrame(() => {
        performance.mark("budmon:first-rows-visible");
      });
    });
  });

  return (
    <>
      <h1 tabindex="-1">Virtual table</h1>
      <div style={{ height: "600px" }}>
        <VirtualTable<SyntheticRow>
          label="Synthetic rows"
          columns={COLUMNS}
          source={source}
          rowHeight={36}
          getRowId={(row) => String(row.index)}
          onRowActivate={(row) => setActivated(row.index)}
        />
      </div>
      <p role="status">{activated() === null ? "" : `Activated row ${String(activated())}`}</p>
    </>
  );
}
