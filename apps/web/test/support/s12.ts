// S-12 loaders (test-architect): F-219 VirtualTable and F-220 createInfiniteList, with the LLD's
// signatures declared here for the tests' own fakes.
import type { JSX } from "solid-js";
import type { AppError } from "./s11b.js";

export interface InfiniteListSource<T> {
  /** A-340 */
  readonly pageSize: number;
  rowCount: () => number;
  totalCount: () => number | null;
  /** A-340 */
  hasMore: () => boolean;
  rowAt: (index: number) => T | undefined;
  ensurePage: (pageIndex: number) => void;
  /** A-338 */
  retry: () => void;
  loading: () => boolean;
  error: () => AppError | null;
}

export interface InfiniteListModule {
  createInfiniteList: <T>(opts: {
    fetchPage: (
      cursor: string | null,
    ) => Promise<{ items: T[]; nextCursor: string | null; totalCount?: number }>;
    pageSize: number;
    maxPagesInMemory?: number;
  }) => InfiniteListSource<T>;
}

export interface Column<T> {
  id: string;
  header: string;
  cell: (row: T) => JSX.Element;
  align?: "start" | "end";
}

export interface VirtualTableModule {
  VirtualTable: <T>(props: {
    label: string;
    columns: readonly Column<T>[];
    source: InfiniteListSource<T>;
    rowHeight: number;
    getRowId: (row: T) => string;
    onRowActivate?: (row: T) => void;
  }) => JSX.Element;
}

// N-8: plain imports of the real modules.
export const loadInfiniteList = () => import("../../src/ui/table/infiniteList.js");
export const loadVirtualTable = () => import("../../src/ui/table/VirtualTable.js");
