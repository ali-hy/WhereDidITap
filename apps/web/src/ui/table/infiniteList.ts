// F-220: a cursor-paged list with a bounded number of pages in memory (A-338 to A-340).
import { createSignal } from "solid-js";
import { toAppError, type AppError } from "../../api/errors.js";

export interface InfiniteListSource<T> {
  /** A-340: the option as given; row index i is on page floor(i / pageSize). */
  readonly pageSize: number;
  rowCount(): number;
  totalCount(): number | null;
  /** A-340: false once a page has returned nextCursor null. */
  hasMore(): boolean;
  rowAt(index: number): T | undefined;
  ensurePage(pageIndex: number): void;
  /** A-338: clears the error and re-requests the failed page. */
  retry(): void;
  loading(): boolean;
  error(): AppError | null;
}

type Page<T> = { items: T[]; nextCursor: string | null; totalCount?: number };

const DEFAULT_MAX_PAGES = 50;

export function createInfiniteList<T>(opts: {
  fetchPage: (cursor: string | null) => Promise<Page<T>>;
  pageSize: number;
  maxPagesInMemory?: number;
}): InfiniteListSource<T> {
  const maxPages = opts.maxPagesInMemory ?? DEFAULT_MAX_PAGES;
  // Every change bumps the version, so Solid readers of the accessors update.
  const [version, setVersion] = createSignal(0);
  const changed = () => setVersion((v) => v + 1);

  const loaded = new Map<number, T[]>();
  /** Each known page's starting cursor (page 0 starts at null). */
  const cursors = new Map<number, string | null>([[0, null]]);
  /** Each known page's length, loaded or dropped; pages are contiguous from 0. */
  const lengths = new Map<number, number>();
  let ended = false;
  let reportedTotal: number | null = null;
  let inFlight: number | null = null;
  const queue: number[] = [];
  let failure: { page: number; error: AppError } | null = null;

  const rowCount = () => {
    let count = 0;
    for (let page = 0; lengths.has(page); page += 1) count += lengths.get(page) ?? 0;
    return count;
  };

  /** Drops the loaded page farthest from `near` while over the limit. */
  const evict = (near: number) => {
    while (loaded.size > maxPages) {
      let farthest = near;
      for (const page of loaded.keys()) {
        if (Math.abs(page - near) > Math.abs(farthest - near)) farthest = page;
      }
      if (farthest === near) return;
      loaded.delete(farthest);
    }
  };

  const pump = () => {
    if (inFlight !== null || failure !== null) return;
    while (queue.length > 0) {
      const page = queue.shift() as number;
      // Loaded already, or its starting cursor isn't known (beyond the known pages or past the
      // end): nothing to fetch.
      if (loaded.has(page) || !cursors.has(page)) continue;
      inFlight = page;
      changed();
      opts.fetchPage(cursors.get(page) ?? null).then(
        (result) => {
          inFlight = null;
          loaded.set(page, result.items);
          lengths.set(page, result.items.length);
          if (result.nextCursor === null) ended = true;
          else cursors.set(page + 1, result.nextCursor);
          if (result.totalCount !== undefined) reportedTotal = result.totalCount;
          evict(page);
          changed();
          pump();
        },
        (err: unknown) => {
          inFlight = null;
          failure = { page, error: toAppError(err) };
          queue.length = 0;
          changed();
        },
      );
      return;
    }
  };

  return {
    pageSize: opts.pageSize,
    rowCount: () => {
      version();
      return rowCount();
    },
    totalCount: () => {
      version();
      if (reportedTotal !== null) return reportedTotal;
      return ended ? rowCount() : null;
    },
    hasMore: () => {
      version();
      return !ended;
    },
    rowAt: (index) => {
      version();
      if (index < 0) return undefined;
      return loaded.get(Math.floor(index / opts.pageSize))?.[index % opts.pageSize];
    },
    ensurePage: (page) => {
      if (failure !== null || page < 0) return;
      if (loaded.has(page) || inFlight === page || queue.includes(page)) return;
      queue.push(page);
      pump();
    },
    retry: () => {
      if (failure === null) return;
      const { page } = failure;
      failure = null;
      changed();
      queue.push(page);
      pump();
    },
    loading: () => {
      version();
      return inFlight !== null;
    },
    error: () => {
      version();
      return failure?.error ?? null;
    },
  };
}
