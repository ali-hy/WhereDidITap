// F-220 createInfiniteList: paging, dropping, refetching, errors and totals (A-338 to A-340).
// TP-12.1, plus extra cases TP-12.6x. IDs ending in "x" are test-architect additions, not LLD
// test-plan IDs.
import { describe, expect, it, vi } from "vitest";
import { type InfiniteListSource, loadInfiniteList } from "../../support/s12.js";

interface Row {
  id: string;
  index: number;
}

const PAGE = 100;
const PAGES = 100;

interface FakeOptions {
  failOn?: Set<number>;
  totalCount?: number;
  pages?: number;
}

/** `pages` pages of 100 rows; the cursor for page n is "c<n>". Pages in `failOn` reject. */
function fakeFetchPage(opts: FakeOptions = {}) {
  const pages = opts.pages ?? PAGES;
  let inFlight = 0;
  let maxInFlight = 0;
  const fn = vi.fn(async (cursor: string | null) => {
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((r) => setTimeout(r, 1));
    inFlight -= 1;
    const page = cursor === null ? 0 : Number(cursor.slice(1));
    if (opts.failOn?.has(page) === true) throw new TypeError("Failed to fetch");
    const items = Array.from({ length: PAGE }, (_, i) => ({
      id: `r${String(page * PAGE + i)}`,
      index: page * PAGE + i,
    }));
    return {
      items,
      nextCursor: page + 1 < pages ? `c${String(page + 1)}` : null,
      ...(opts.totalCount === undefined ? {} : { totalCount: opts.totalCount }),
    };
  });
  return Object.assign(fn, { maxInFlight: () => maxInFlight });
}

const cursors = (f: ReturnType<typeof fakeFetchPage>) => f.mock.calls.map((c) => c[0]);

/** Lets every queued fetch settle. */
async function settle(list: InfiniteListSource<Row>): Promise<void> {
  await new Promise((r) => setTimeout(r, 0));
  await vi.waitFor(() => {
    expect(list.loading()).toBe(false);
  });
  await new Promise((r) => setTimeout(r, 5));
}

async function loadPages(list: InfiniteListSource<Row>, count: number): Promise<void> {
  for (let i = 0; i < count; i += 1) {
    list.ensurePage(i);
    await settle(list);
  }
}

async function newList(opts: FakeOptions = {}, maxPagesInMemory?: number) {
  const { createInfiniteList } = await loadInfiniteList();
  const fetchPage = fakeFetchPage(opts);
  const list = createInfiniteList<Row>({
    fetchPage,
    pageSize: PAGE,
    ...(maxPagesInMemory === undefined ? {} : { maxPagesInMemory }),
  });
  return { list, fetchPage };
}

describe("TP-12.1: paging, dropping and refetching (F-220, A-338)", () => {
  it("TP-12.1: creating the list calls fetchPage 0 times; pageSize is the option", async () => {
    const { list, fetchPage } = await newList();
    await new Promise((r) => setTimeout(r, 10));

    expect(fetchPage).not.toHaveBeenCalled();
    expect(list.pageSize).toBe(PAGE);
    expect(list.rowCount()).toBe(0);
  });

  it("TP-12.1: after 60 pages, pages 0..9 are dropped (rowAt(5) undefined) and rowCount stays 6000", async () => {
    const { list } = await newList();

    await loadPages(list, 60);

    expect(list.rowCount()).toBe(6000);
    expect(list.rowAt(5)).toBeUndefined();
    expect(list.rowAt(999)).toBeUndefined();
    expect(list.rowAt(1000)).toEqual({ id: "r1000", index: 1000 });
    expect(list.rowAt(5999)).toEqual({ id: "r5999", index: 5999 });
    expect(list.error()).toBeNull();
  });

  it("TP-12.1: ensurePage(0) refetches page 0 with its recorded cursor (null); rowAt(5) is the original row", async () => {
    const { list, fetchPage } = await newList();
    await loadPages(list, 60);
    const before = fetchPage.mock.calls.length;

    list.ensurePage(0);
    await settle(list);

    expect(fetchPage.mock.calls.length).toBe(before + 1);
    expect(cursors(fetchPage).at(-1)).toBeNull();
    expect(list.rowAt(5)).toEqual({ id: "r5", index: 5 });
    expect(list.rowCount()).toBe(6000);
  });

  it("TP-12.1 (A-338): ensurePage(0) and ensurePage(1) back to back load in order, one fetch in flight at a time", async () => {
    const { list, fetchPage } = await newList();

    list.ensurePage(0);
    list.ensurePage(1);
    await settle(list);
    await settle(list);

    expect(cursors(fetchPage)).toEqual([null, "c1"]);
    expect(fetchPage.maxInFlight()).toBe(1);
    expect(list.rowCount()).toBe(200);
  });

  it("TP-12.1 (A-338): ensurePage(9) on a fresh list makes no call (its cursor is unknown)", async () => {
    const { list, fetchPage } = await newList();

    list.ensurePage(9);
    await settle(list);

    expect(fetchPage).not.toHaveBeenCalled();
    expect(list.rowCount()).toBe(0);
  });

  it("TP-12.1 (A-338): an error on page 3 sets error(); ensurePage(4) makes no call; retry() refetches page 3 with c3 and clears error()", async () => {
    const failOn = new Set([3]);
    const { list, fetchPage } = await newList({ failOn });
    await loadPages(list, 3);

    list.ensurePage(3);
    await settle(list);
    expect(list.error()).not.toBeNull();
    const afterError = fetchPage.mock.calls.length;

    list.ensurePage(4);
    await settle(list);
    expect(fetchPage.mock.calls.length).toBe(afterError);

    failOn.clear();
    list.retry();
    await settle(list);

    expect(fetchPage.mock.calls.length).toBe(afterError + 1);
    expect(cursors(fetchPage).at(-1)).toBe("c3");
    expect(list.error()).toBeNull();
    expect(list.rowAt(350)).toEqual({ id: "r350", index: 350 });
  });

  it("TP-12.6x (A-338): an error discards the rest of the queue", async () => {
    const failOn = new Set([1]);
    const { list, fetchPage } = await newList({ failOn });

    list.ensurePage(0);
    list.ensurePage(1);
    list.ensurePage(2);
    await settle(list);
    await settle(list);

    expect(cursors(fetchPage)).toEqual([null, "c1"]);
    expect(list.error()).not.toBeNull();
  });

  it("TP-12.6x: refetching a middle page uses its own cursor; the page farthest away (59) is dropped", async () => {
    const { list, fetchPage } = await newList();
    await loadPages(list, 60);

    list.ensurePage(7);
    await settle(list);

    expect(cursors(fetchPage).at(-1)).toBe("c7");
    expect(list.rowAt(750)).toEqual({ id: "r750", index: 750 });
    expect(list.rowAt(5999)).toBeUndefined();
  });

  it("TP-12.6x: maxPagesInMemory 3: loading 5 pages keeps pages 2..4", async () => {
    const { list } = await newList({}, 3);

    await loadPages(list, 5);

    expect(list.rowCount()).toBe(500);
    expect([0, 100, 200, 300, 400].map((i) => list.rowAt(i) !== undefined)).toEqual([
      false,
      false,
      true,
      true,
      true,
    ]);
  });

  it("TP-12.6x: loading() is true while a fetch is in flight", async () => {
    const { createInfiniteList } = await loadInfiniteList();
    let release: () => void = () => undefined;
    const fetchPage = vi.fn(
      () =>
        new Promise<{ items: Row[]; nextCursor: string | null }>((resolve) => {
          release = () => {
            resolve({ items: [{ id: "r0", index: 0 }], nextCursor: null });
          };
        }),
    );
    const list = createInfiniteList<Row>({ fetchPage, pageSize: 1 });

    list.ensurePage(0);
    await vi.waitFor(() => {
      expect(fetchPage).toHaveBeenCalled();
    });
    expect(list.loading()).toBe(true);

    release();
    await vi.waitFor(() => {
      expect(list.loading()).toBe(false);
    });
    expect(list.rowAt(0)).toEqual({ id: "r0", index: 0 });
  });
});

describe("TP-12.1: totals and hasMore (F-220, A-339, A-340)", () => {
  it("TP-12.1 (A-339): a fetchPage returning totalCount 10000 gives totalCount() 10000 after the first page", async () => {
    const { list } = await newList({ totalCount: 10_000 });
    expect(list.totalCount()).toBeNull();

    await loadPages(list, 1);

    expect(list.totalCount()).toBe(10_000);
    expect(list.hasMore()).toBe(true);
  });

  it("TP-12.1 (A-339): without totalCount it's null until the end, then rowCount(); hasMore() is false at the end", async () => {
    const { list } = await newList({ pages: 3 });

    await loadPages(list, 2);
    expect(list.totalCount()).toBeNull();
    expect(list.hasMore()).toBe(true);

    await loadPages(list, 3);
    expect(list.rowCount()).toBe(300);
    expect(list.totalCount()).toBe(300);
    expect(list.hasMore()).toBe(false);
  });

  it("TP-12.6x (A-338): a page past the end is discarded without a call", async () => {
    const { list, fetchPage } = await newList({ pages: 2 });
    await loadPages(list, 2);
    const before = fetchPage.mock.calls.length;

    list.ensurePage(2);
    await settle(list);

    expect(fetchPage.mock.calls.length).toBe(before);
  });
});
