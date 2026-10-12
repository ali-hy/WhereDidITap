// F-219 VirtualTable: grid semantics, placeholders and end-aligned columns. TP-12.2 and TP-12.5,
// plus extra cases TP-12.6x. IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
//
// jsdom has no layout, so every element reports an 800 × 800 box and ResizeObserver is a stub:
// with rowHeight 40 the viewport holds 20 rows, and overscan 10 renders rows 0..29.
import { fireEvent, screen } from "@solidjs/testing-library";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { AppError } from "../../support/s11b.js";
import { renderWithI18n } from "../../support/render.js";
import { type Column, type InfiniteListSource, loadVirtualTable } from "../../support/s12.js";

interface Row {
  id: string;
  amount: string;
}

const ROW_HEIGHT = 40;
const TOTAL = 1000;
/** Page 2 of 10-row pages (rows 20..29) isn't in memory. */
const DROPPED = { from: 20, to: 29 };

function fakeSource(): InfiniteListSource<Row> {
  return {
    pageSize: 10,
    rowCount: () => TOTAL,
    totalCount: () => TOTAL,
    hasMore: () => false,
    retry: vi.fn<() => void>(),
    rowAt: (index: number) =>
      index < 0 || index >= TOTAL || (index >= DROPPED.from && index <= DROPPED.to)
        ? undefined
        : { id: `r${String(index)}`, amount: `${String(index)}.00` },
    ensurePage: vi.fn<(pageIndex: number) => void>(),
    loading: () => false,
    error: () => null,
  };
}

const COLUMNS: readonly Column<Row>[] = [
  { id: "id", header: "Row", cell: (row) => <span>{row.id}</span> },
  { id: "amount", header: "Amount", cell: (row) => <span>{row.amount}</span>, align: "end" },
];

const box = { x: 0, y: 0, top: 0, left: 0, right: 800, bottom: 800, width: 800, height: 800 };

beforeAll(() => {
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
    ...box,
    toJSON: () => box,
  });
  for (const prop of ["clientHeight", "offsetHeight", "clientWidth", "offsetWidth"] as const) {
    vi.spyOn(HTMLElement.prototype, prop, "get").mockReturnValue(800);
  }
  // jsdom has no scrollIntoView; F-219 calls it after moving focus.
  Element.prototype.scrollIntoView = vi.fn<() => void>();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe(): void {
        // jsdom has no layout to observe.
      }
      unobserve(): void {
        // As above.
      }
      disconnect(): void {
        // As above.
      }
    },
  );
});
afterAll(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function mount(source = fakeSource(), onRowActivate?: (row: Row) => void) {
  const { VirtualTable } = await loadVirtualTable();
  const result = renderWithI18n(() => (
    <VirtualTable<Row>
      label="Transactions"
      columns={COLUMNS}
      source={source}
      rowHeight={ROW_HEIGHT}
      getRowId={(row) => row.id}
      {...(onRowActivate === undefined ? {} : { onRowActivate })}
    />
  ));
  const grid = await screen.findByRole("grid");
  return { ...result, grid, source };
}

/** The data and placeholder rows (aria-rowindex ≥ 2). */
function bodyRows(grid: HTMLElement): HTMLElement[] {
  return [...grid.querySelectorAll<HTMLElement>('[role="row"]')].filter(
    (r) => Number(r.getAttribute("aria-rowindex")) >= 2,
  );
}

describe("TP-12.2: grid semantics and placeholders (F-219)", () => {
  it("TP-12.2 (A-396): role=grid with aria-label, aria-rowcount = totalCount + 1 (the header row) and aria-colcount = the column count", async () => {
    const { grid } = await mount();

    expect(grid.getAttribute("aria-label")).toBe("Transactions");
    expect(grid.getAttribute("aria-rowcount")).toBe(String(TOTAL + 1));
    expect(grid.getAttribute("aria-colcount")).toBe("2");
  });

  it("TP-12.2: the header row is aria-rowindex 1; each rendered row has aria-rowindex = index + 2 and gridcells", async () => {
    const { grid } = await mount();

    const header = [...grid.querySelectorAll('[role="row"]')].find(
      (r) => r.getAttribute("aria-rowindex") === "1",
    );
    expect(header?.textContent).toContain("Row");
    expect(header?.textContent).toContain("Amount");

    const rows = bodyRows(grid).filter((r) => !r.hasAttribute("data-placeholder"));
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      const id = row.querySelector('[role="gridcell"]')?.textContent ?? "";
      const index = Number(id.replace(/^r/, ""));
      expect(row.getAttribute("aria-rowindex")).toBe(String(index + 2));
      expect(row.querySelectorAll('[role="gridcell"]')).toHaveLength(2);
    }
  });

  it("TP-12.2: rows of the dropped page render as placeholders: aria-busy=true, data-placeholder, the same height as data rows, with the right aria-rowindex", async () => {
    const { grid } = await mount();

    const placeholders = bodyRows(grid).filter((r) => r.hasAttribute("data-placeholder"));
    const data = bodyRows(grid).find((r) => !r.hasAttribute("data-placeholder"));

    expect(
      placeholders.map((p) => Number(p.getAttribute("aria-rowindex"))).sort((a, b) => a - b),
    ).toEqual(
      Array.from({ length: DROPPED.to - DROPPED.from + 1 }, (_, i) => DROPPED.from + i + 2),
    );
    for (const p of placeholders) {
      expect(p.getAttribute("aria-busy")).toBe("true");
      // A-343: inline heights on both kinds of row.
      expect(p.style.height).toBe(`${String(ROW_HEIGHT)}px`);
      expect(p.style.height).toBe(data?.style.height);
    }
  });

  it("TP-12.6x: fewer than 200 rows are in the DOM for 1,000 rows", async () => {
    const { grid } = await mount();

    const count = bodyRows(grid).length;
    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThan(200);
  });

  it("TP-12.2 (A-341): header cells are columnheaders and every cell has aria-colindex = column + 1", async () => {
    const { grid } = await mount();

    const headers = [...grid.querySelectorAll('[role="columnheader"]')];
    expect(headers.map((h) => h.getAttribute("aria-colindex"))).toEqual(["1", "2"]);
    const rows = bodyRows(grid).filter((r) => !r.hasAttribute("data-placeholder"));
    for (const row of rows) {
      expect(
        [...row.querySelectorAll('[role="gridcell"]')].map((c) => c.getAttribute("aria-colindex")),
      ).toEqual(["1", "2"]);
    }
  });

  it('TP-12.2 (A-341): exactly one row has tabindex="0", the first data row', async () => {
    const { grid } = await mount();

    const stops = [...grid.querySelectorAll('[tabindex="0"]')];
    expect(stops).toHaveLength(1);
    expect(stops[0]?.getAttribute("role")).toBe("row");
    expect(stops[0]?.getAttribute("aria-rowindex")).toBe("2");
  });

  it("TP-12.2 (A-338): with error() set, an error row shows the read message and Try again calls retry(); no ensurePage call", async () => {
    const error: AppError = { kind: "unknown" };
    const source = { ...fakeSource(), error: () => error, hasMore: () => true };
    const { grid } = await mount(source);

    const errorRow = [...grid.querySelectorAll<HTMLElement>('[role="row"]')].find((r) =>
      r.textContent.includes("Something went wrong on our side. Try again in a moment."),
    );
    expect(errorRow).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(source.retry).toHaveBeenCalledTimes(1);
    expect(source.ensurePage).not.toHaveBeenCalled();
  });

  it("TP-12.6x (A-340): a placeholder page in view is requested as ensurePage(floor(index / pageSize))", async () => {
    const source = fakeSource();
    await mount(source);

    expect(source.ensurePage).toHaveBeenCalledWith(2);
  });

  it("TP-12.2 (A-396): an unknown totalCount gives aria-rowcount -1", async () => {
    const source = { ...fakeSource(), totalCount: () => null };
    const { grid } = await mount(source);

    expect(grid.getAttribute("aria-rowcount")).toBe("-1");
  });
});

describe("TP-12.5: end-aligned numeric columns (F-219)", () => {
  it("TP-12.5: cells of the align:\"end\" column have the class text-end; the other column's don't", async () => {
    const { grid } = await mount();

    const rows = bodyRows(grid).filter((r) => !r.hasAttribute("data-placeholder"));
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      const [idCell, amountCell] = [...row.querySelectorAll('[role="gridcell"]')];
      expect(amountCell?.classList.contains("text-end")).toBe(true);
      expect(idCell?.classList.contains("text-end")).toBe(false);
    }
  });
});

// T-4: page requests (A-338, A-340) and the A-341 keyboard model; B-2 and B-3.
/** A source of `count` loaded rows (rows below `firstLoaded` not in memory). */
function loadedSource(
  count: number,
  opts: { pageSize?: number; hasMore?: boolean; firstLoaded?: number } = {},
): InfiniteListSource<Row> {
  return {
    ...fakeSource(),
    pageSize: opts.pageSize ?? 100,
    rowCount: () => count,
    totalCount: () => count,
    hasMore: () => opts.hasMore ?? false,
    rowAt: (index: number) =>
      index < (opts.firstLoaded ?? 0) || index >= count
        ? undefined
        : { id: `r${String(index)}`, amount: `${String(index)}.00` },
  };
}

const rowEl = (grid: HTMLElement, index: number) =>
  grid.querySelector<HTMLElement>(`[role="row"][aria-rowindex="${String(index + 2)}"]`);
const cellEl = (grid: HTMLElement, index: number, col: number) =>
  rowEl(grid, index)?.querySelector<HTMLElement>(`[aria-colindex="${String(col + 1)}"]`) ?? null;

/** The focused element's row index (aria-rowindex − 2) and aria-colindex (null on a row). */
function focusedAt(): { row: number; col: number | null } {
  const el = document.activeElement;
  const row = el?.closest('[role="row"]');
  const col = el?.getAttribute("role") === "gridcell" ? el.getAttribute("aria-colindex") : null;
  return {
    row: Number(row?.getAttribute("aria-rowindex") ?? "NaN") - 2,
    col: col === null ? null : Number(col),
  };
}

function scrollTo(grid: HTMLElement, row: number): void {
  const scroller = grid.querySelector<HTMLElement>("[data-scroll]") ?? grid;
  scroller.scrollTop = row * ROW_HEIGHT;
  fireEvent.scroll(scroller);
}

describe("TP-12.6x (T-4): page requests (F-219, A-338, A-340)", () => {
  it("TP-12.6x: an empty source gets ensurePage(0) once on mount", async () => {
    const source = loadedSource(0);
    await mount(source);

    expect(source.ensurePage).toHaveBeenCalledTimes(1);
    expect(source.ensurePage).toHaveBeenCalledWith(0);
  });

  it("TP-12.6x: an empty source in error gets no ensurePage call", async () => {
    const source = { ...loadedSource(0), error: (): AppError => ({ kind: "network" }) };
    await mount(source);

    expect(source.ensurePage).not.toHaveBeenCalled();
  });

  it("TP-12.6x: 100 rows of 100, hasMore, rows in view at index 80+: ensurePage(1)", async () => {
    const source = loadedSource(100, { hasMore: true });
    const { grid } = await mount(source);
    expect(source.ensurePage).not.toHaveBeenCalledWith(1);

    scrollTo(grid, 80);

    await vi.waitFor(() => {
      expect(source.ensurePage).toHaveBeenCalledWith(1);
    });
  });

  it("TP-12.6x: as above with hasMore false: no ensurePage(1)", async () => {
    const source = loadedSource(100, { hasMore: false });
    const { grid } = await mount(source);

    scrollTo(grid, 80);
    await vi.waitFor(() => {
      expect(rowEl(grid, 85)).not.toBeNull();
    });

    expect(source.ensurePage).not.toHaveBeenCalledWith(1);
  });
});

describe("TP-12.6x (T-4): keyboard (A-341)", () => {
  it("TP-12.6x: ArrowUp moves to the previous row", async () => {
    const { grid } = await mount(loadedSource(100));
    rowEl(grid, 3)?.focus();

    fireEvent.keyDown(rowEl(grid, 3) as HTMLElement, { key: "ArrowUp" });

    await vi.waitFor(() => {
      expect(focusedAt()).toEqual({ row: 2, col: null });
    });
  });

  it("TP-12.6x: Home goes to the first loaded row", async () => {
    const { grid } = await mount(loadedSource(100, { firstLoaded: 10 }));
    rowEl(grid, 15)?.focus();

    fireEvent.keyDown(rowEl(grid, 15) as HTMLElement, { key: "Home" });

    await vi.waitFor(() => {
      expect(focusedAt()).toEqual({ row: 10, col: null });
    });
  });

  it("TP-12.6x: in LTR, ArrowLeft from the first cell goes back to the row", async () => {
    const { grid } = await mount(loadedSource(100));
    cellEl(grid, 0, 0)?.focus();

    fireEvent.keyDown(cellEl(grid, 0, 0) as HTMLElement, { key: "ArrowLeft" });

    await vi.waitFor(() => {
      expect(focusedAt()).toEqual({ row: 0, col: null });
    });
  });

  it("TP-12.6x: ArrowDown from a cell keeps its aria-colindex", async () => {
    const { grid } = await mount(loadedSource(100));
    cellEl(grid, 0, 1)?.focus();

    fireEvent.keyDown(cellEl(grid, 0, 1) as HTMLElement, { key: "ArrowDown" });

    await vi.waitFor(() => {
      expect(focusedAt()).toEqual({ row: 1, col: 2 });
    });
  });

  it("TP-12.6x: Enter on a cell activates its row", async () => {
    const onRowActivate = vi.fn<(row: Row) => void>();
    const { grid } = await mount(loadedSource(100), onRowActivate);
    cellEl(grid, 4, 1)?.focus();

    fireEvent.keyDown(cellEl(grid, 4, 1) as HTMLElement, { key: "Enter" });

    expect(onRowActivate).toHaveBeenCalledTimes(1);
    expect(onRowActivate).toHaveBeenCalledWith({ id: "r4", amount: "4.00" });
  });

  it("TP-12.6x (B-2): Enter on Try again isn't taken by the grid: the button's activation calls retry only", async () => {
    const onRowActivate = vi.fn<(row: Row) => void>();
    const source = { ...loadedSource(100), error: (): AppError => ({ kind: "unknown" }) };
    await mount(source, onRowActivate);
    const button = screen.getByRole("button", { name: "Try again" });
    button.focus();

    const notCancelled = fireEvent.keyDown(button, { key: "Enter" });
    // A browser turns an uncancelled Enter on a button into a click.
    if (notCancelled) fireEvent.click(button);

    expect(notCancelled).toBe(true);
    expect(source.retry).toHaveBeenCalledTimes(1);
    expect(onRowActivate).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(button);
  });

  it("TP-12.6x (B-3): with the stop row scrolled far away, the grid still has exactly one tabindex 0, on that row", async () => {
    const { grid } = await mount(loadedSource(1000, { pageSize: 100 }));

    scrollTo(grid, 800);
    await vi.waitFor(() => {
      expect(rowEl(grid, 805)).not.toBeNull();
    });

    const stops = [...grid.querySelectorAll('[tabindex="0"]')];
    expect(stops).toHaveLength(1);
    expect(stops[0]?.getAttribute("role")).toBe("row");
    expect(stops[0]?.getAttribute("aria-rowindex")).toBe("2");
  });
});
