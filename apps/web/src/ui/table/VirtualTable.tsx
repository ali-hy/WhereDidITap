// F-219: a virtualised grid over an infinite list (D-7, A-338 to A-343).
import { createTable, tableFeatures } from "@tanstack/solid-table";
import { createVirtualizer, defaultRangeExtractor } from "@tanstack/solid-virtual";
import { createEffect, createSignal, createUniqueId, For, onMount, Show, type JSX } from "solid-js";
import { messageForError } from "../../api/errorMessages.js";
import { messages } from "../../i18n/messages.js";
import { useI18n } from "../../i18n/useI18n.js";
import type { InfiniteListSource } from "./infiniteList.js";

export interface VirtualTableColumn<T> {
  id: string;
  header: string;
  cell: (row: T) => JSX.Element;
  align?: "start" | "end";
}

const OVERSCAN = 10;
const EMPTY = "";
/** The next page is requested when the last rendered row is this close to the end. */
const PREFETCH_ROWS = 20;
/** A-458: skeleton rows while the first page loads. */
const SKELETON_ROWS = 3;

/** The roving tab stop: a row (col -1) or one of its cells. */
interface Stop {
  row: number;
  col: number;
}

export function VirtualTable<T>(props: {
  label: string;
  columns: readonly VirtualTableColumn<T>[];
  source: InfiniteListSource<T>;
  rowHeight: number;
  getRowId: (row: T) => string;
  onRowActivate?: (row: T) => void;
  /** A-458: what an empty table shows (default: table.empty). */
  empty?: () => JSX.Element;
}): JSX.Element {
  const { t } = useI18n();
  const emptyId = createUniqueId();
  // A-458: the first page is pending, or the list is known to be empty (an error keeps its row).
  const firstLoad = () =>
    props.source.rowCount() === 0 && props.source.hasMore() && props.source.error() === null;
  const isEmpty = () =>
    props.source.rowCount() === 0 && !props.source.hasMore() && props.source.error() === null;
  let scroller: HTMLDivElement | undefined;
  let grid: HTMLDivElement | undefined;

  // TanStack Table provides the header model (column order and ids); cells render from the
  // column definitions, over the virtual rows.
  const table = createTable({
    features: tableFeatures({}),
    columns: props.columns.map((c) => ({ id: c.id, header: c.header })),
    data: [] as Record<string, unknown>[],
  });
  const headers = () => table.getHeaderGroups()[0]?.headers ?? [];

  const [stop, setStop] = createSignal<Stop>({ row: 0, col: -1 });

  const virtualizer = createVirtualizer({
    get count() {
      return props.source.rowCount();
    },
    getScrollElement: () => scroller ?? null,
    estimateSize: () => props.rowHeight,
    overscan: OVERSCAN,
    // B-3: the tab-stop row is always rendered, so Tab always finds the grid's one tabindex 0.
    rangeExtractor: (range) => {
      const indexes = defaultRangeExtractor(range);
      const row = stop().row;
      if (row < range.count && !indexes.includes(row)) {
        indexes.push(row);
        indexes.sort((a, b) => a - b);
      }
      return indexes;
    },
  });

  // Page requests (A-338, A-340): never while in error.
  onMount(() => {
    if (props.source.rowCount() === 0 && props.source.error() === null) {
      props.source.ensurePage(0);
    }
  });
  createEffect(() => {
    const source = props.source;
    if (source.error() !== null) return;
    const items = virtualizer.getVirtualItems();
    const pages = new Set<number>();
    for (const item of items) {
      if (source.rowAt(item.index) === undefined) {
        pages.add(Math.floor(item.index / source.pageSize));
      }
    }
    for (const page of pages) source.ensurePage(page);
    const last = items.at(-1);
    const count = source.rowCount();
    if (last !== undefined && last.index >= count - PREFETCH_ROWS && source.hasMore()) {
      source.ensurePage(Math.ceil(count / source.pageSize));
    }
  });

  const isRtl = () => (grid === undefined ? false : getComputedStyle(grid).direction === "rtl");

  /** Moves the tab stop and focus, scrolling the row into view first. */
  const moveTo = (next: Stop) => {
    setStop(next);
    virtualizer.scrollToIndex(next.row, { align: "auto" });
    const focus = () => {
      const row = grid?.querySelector<HTMLElement>(`[data-row="${String(next.row)}"]`);
      const target =
        next.col < 0 ? row : row?.querySelector<HTMLElement>(`[data-col="${String(next.col)}"]`);
      target?.focus({ preventScroll: true });
      target?.scrollIntoView({ block: "nearest" });
    };
    // The row may only render after the scroll.
    requestAnimationFrame(() => {
      focus();
      requestAnimationFrame(focus);
    });
  };

  const firstLoaded = () => {
    const count = props.source.rowCount();
    for (let i = 0; i < count; i += 1) if (props.source.rowAt(i) !== undefined) return i;
    return 0;
  };
  const lastLoaded = () => {
    for (let i = props.source.rowCount() - 1; i >= 0; i -= 1) {
      if (props.source.rowAt(i) !== undefined) return i;
    }
    return 0;
  };

  /** A-459: the rows one viewport holds, at least 1. */
  const pageRows = () => Math.max(1, Math.floor((scroller?.clientHeight ?? 0) / props.rowHeight));

  const onKeyDown = (event: KeyboardEvent) => {
    // B-2: only the rows and cells navigate; a control inside the grid (the error row's Try
    // again) keeps its own keys.
    const target = event.target;
    if (!(target instanceof HTMLElement) || !target.matches("[data-row], [data-col]")) return;
    const current = stop();
    const lastRow = props.source.rowCount() - 1;
    const lastCol = props.columns.length - 1;
    const forward = isRtl() ? "ArrowLeft" : "ArrowRight";
    const backward = isRtl() ? "ArrowRight" : "ArrowLeft";
    let next: Stop | undefined;
    switch (event.key) {
      case "ArrowDown":
        next = { row: Math.min(lastRow, current.row + 1), col: current.col };
        break;
      case "ArrowUp":
        next = { row: Math.max(0, current.row - 1), col: current.col };
        break;
      // A-459: a page of rows at a time, keeping the column; not native, because a native page
      // scroll would unmount the focused row.
      case "PageDown":
        next = { row: Math.min(lastRow, current.row + pageRows()), col: current.col };
        break;
      case "PageUp":
        next = { row: Math.max(0, current.row - pageRows()), col: current.col };
        break;
      case "Home":
        next = { row: firstLoaded(), col: current.col };
        break;
      case "End":
        next = { row: lastLoaded(), col: current.col };
        break;
      case forward:
        next = { row: current.row, col: Math.min(lastCol, current.col + 1) };
        break;
      case backward:
        next = { row: current.row, col: Math.max(-1, current.col - 1) };
        break;
      case "Enter": {
        const row = props.source.rowAt(current.row);
        if (row !== undefined) props.onRowActivate?.(row);
        event.preventDefault();
        return;
      }
      default:
        return;
    }
    event.preventDefault();
    moveTo(next);
  };

  /** Focus from a click or Tab updates the stop to the focused row or cell. */
  const onFocusIn = (event: FocusEvent) => {
    const el = event.target as HTMLElement;
    const rowEl = el.closest<HTMLElement>("[data-row]");
    if (rowEl === null) return;
    const row = Number.parseInt(rowEl.dataset["row"] ?? "0", 10);
    const col = el.dataset["col"] === undefined ? -1 : Number.parseInt(el.dataset["col"], 10);
    const current = stop();
    if (current.row !== row || current.col !== col) setStop({ row, col });
  };

  /** A-396: the header row counts, so n data rows are n + 1 ARIA rows; -1 while unknown. */
  const totalRows = () => {
    const total = props.source.totalCount();
    return total === null ? -1 : total + 1;
  };

  const tabIndexOf = (row: number, col: number) =>
    stop().row === row && stop().col === col ? 0 : -1;

  return (
    <>
      <div
        ref={grid}
        role="grid"
        aria-label={props.label}
        aria-rowcount={totalRows()}
        aria-colcount={props.columns.length}
        aria-busy={firstLoad() ? "true" : undefined}
        aria-describedby={isEmpty() ? emptyId : undefined}
        class="flex h-full flex-col"
        onKeyDown={onKeyDown}
        onFocusIn={onFocusIn}
      >
        <div role="row" aria-rowindex={1} class="flex font-semibold">
          <For each={headers()}>
            {(header, i) => (
              <div
                role="columnheader"
                aria-colindex={i() + 1}
                class={`flex-1 px-2 ${props.columns[i()]?.align === "end" ? "text-end" : ""}`}
              >
                {props.columns[i()]?.header ?? header.id}
              </div>
            )}
          </For>
        </div>
        <div
          ref={scroller}
          data-scroll
          role="rowgroup"
          class="relative min-h-0 flex-1 overflow-y-auto"
        >
          <div
            role="presentation"
            class="relative w-full"
            style={{
              height: `${String(virtualizer.getTotalSize() + (props.source.error() === null ? 0 : props.rowHeight) + (firstLoad() ? SKELETON_ROWS * props.rowHeight : 0))}px`,
            }}
          >
            <Show when={firstLoad()}>
              <For each={Array.from({ length: SKELETON_ROWS }, (_, i) => i)}>
                {(i) => (
                  <div
                    data-placeholder
                    aria-hidden="true"
                    class="absolute w-full"
                    style={{
                      top: `${String(i * props.rowHeight)}px`,
                      height: `${String(props.rowHeight)}px`,
                    }}
                  />
                )}
              </For>
            </Show>
            <For each={virtualizer.getVirtualItems()}>
              {(item) => {
                const row = () => props.source.rowAt(item.index);
                const position = () => ({
                  position: "absolute" as const,
                  top: "0",
                  width: "100%",
                  height: `${String(props.rowHeight)}px`,
                  transform: `translateY(${String(item.start)}px)`,
                });
                return (
                  <Show
                    when={row()}
                    fallback={
                      <div
                        role="row"
                        aria-rowindex={item.index + 2}
                        aria-busy="true"
                        data-placeholder
                        data-row={item.index}
                        tabindex={tabIndexOf(item.index, -1)}
                        style={position()}
                      >
                        {/* One empty cell: the row's content is still loading (aria-busy). */}
                        <div role="gridcell" aria-colspan={props.columns.length}>
                          {EMPTY}
                        </div>
                      </div>
                    }
                  >
                    {(data) => (
                      <div
                        role="row"
                        aria-rowindex={item.index + 2}
                        data-row={item.index}
                        data-row-id={props.getRowId(data())}
                        tabindex={tabIndexOf(item.index, -1)}
                        class="flex items-center focus-visible:outline"
                        style={position()}
                      >
                        <For each={props.columns}>
                          {(column, c) => (
                            <div
                              role="gridcell"
                              aria-colindex={c() + 1}
                              data-col={c()}
                              tabindex={tabIndexOf(item.index, c())}
                              class={`flex-1 px-2 focus-visible:outline ${column.align === "end" ? "text-end" : ""}`}
                            >
                              {column.cell(data())}
                            </div>
                          )}
                        </For>
                      </div>
                    )}
                  </Show>
                );
              }}
            </For>
            <Show when={props.source.error()}>
              {(error) => (
                <div
                  role="row"
                  aria-rowindex={props.source.rowCount() + 2}
                  class="flex items-center gap-4"
                  style={{
                    position: "absolute",
                    top: `${String(props.source.rowCount() * props.rowHeight)}px`,
                    width: "100%",
                    height: `${String(props.rowHeight)}px`,
                  }}
                >
                  <div role="gridcell" aria-colspan={props.columns.length} class="flex gap-4 px-2">
                    {t(messageForError(error(), "read").descriptor)}
                    <button
                      type="button"
                      onClick={() => {
                        props.source.retry();
                      }}
                    >
                      {t(messages.errorFallbackRetry)}
                    </button>
                  </div>
                </div>
              )}
            </Show>
          </div>
        </div>
      </div>
      {/* A-458: after the grid, not inside it, so the grid holds no fake row. */}
      <Show when={isEmpty()}>
        <div id={emptyId} data-empty>
          {props.empty?.() ?? <p>{t(messages.tableEmpty)}</p>}
        </div>
      </Show>
    </>
  );
}
