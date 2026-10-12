// The virtualised table on /__fixtures/virtual-table, grid "Synthetic rows" (F-219, D-7, A-341,
// A-342). TP-12.3 and TP-12.4.
import { expect, test, type Page } from "./fixtures.js";

const ROUTE = "/__fixtures/virtual-table";

/** The focused element's row aria-rowindex and (for a cell) aria-colindex. */
async function focused(page: Page): Promise<{ row: number; col: number | null; inView: boolean }> {
  return page.evaluate(() => {
    const el = document.activeElement;
    const row = el?.closest('[role="row"]');
    const scroller = document.querySelector("div[data-scroll]");
    const r = el?.getBoundingClientRect();
    const v = scroller?.getBoundingClientRect();
    const col = el?.getAttribute("role") === "gridcell" ? el.getAttribute("aria-colindex") : null;
    return {
      row: Number(row?.getAttribute("aria-rowindex") ?? "NaN"),
      col: col === null ? null : Number(col),
      inView: r !== undefined && v !== undefined && r.top >= v.top - 1 && r.bottom <= v.bottom + 1,
    };
  });
}

/**
 * Counts the rows the fixture has loaded: wraps window.fetch before the app starts and sums the
 * items of each /__fixtures/api/rows response, tracking requests still in flight. A virtualised grid
 * doesn't render every loaded row, so the DOM can't say this.
 */
async function trackLoadedRows(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __rows: { loaded: number; inFlight: number } };
    w.__rows = { loaded: 0, inFlight: 0 };
    const original = window.fetch.bind(window);
    window.fetch = async (...args: Parameters<typeof fetch>) => {
      const url = String(args[0] instanceof Request ? args[0].url : args[0]);
      if (!url.includes("/__fixtures/api/rows")) return original(...args);
      w.__rows.inFlight += 1;
      try {
        const res = await original(...args);
        const body = (await res.clone().json()) as { items?: unknown[] };
        w.__rows.loaded += body.items?.length ?? 0;
        return res;
      } finally {
        w.__rows.inFlight -= 1;
      }
    };
  });
}

/** Loaded row count once no page request is in flight (stable for 300 ms). */
async function settledLoadedRows(page: Page): Promise<number> {
  const read = () =>
    page.evaluate(
      () => (window as unknown as { __rows: { loaded: number; inFlight: number } }).__rows,
    );
  let previous = -1;
  await expect
    .poll(
      async () => {
        const now = await read();
        const stable = now.inFlight === 0 && now.loaded === previous;
        previous = now.loaded;
        return stable;
      },
      { intervals: [300] },
    )
    .toBe(true);
  return previous;
}

/**
 * F-219 scrolls the target into view and then focuses it in an animation frame, so focus is checked
 * by polling; each key press waits for the previous one's focus to land.
 */
async function expectFocus(
  page: Page,
  expected: Partial<{ row: number; col: number | null; inView: boolean }>,
): Promise<void> {
  await expect.poll(() => focused(page)).toMatchObject(expected);
}

async function open(page: Page): Promise<void> {
  await trackLoadedRows(page);
  await page.goto(ROUTE);
  await page.getByRole("grid", { name: "Synthetic rows" }).waitFor();
  await page.locator('[role="row"][aria-rowindex="2"]').waitFor();
}

test("TP-12.3: Tab lands on row 2; ArrowDown ×3 and End move focus in view; Enter activates; ArrowRight enters cell 1", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "chromium project only");
  await open(page);

  await page.keyboard.press("Tab");
  await expectFocus(page, { row: 2 });

  for (let row = 3; row <= 5; row += 1) {
    await page.keyboard.press("ArrowDown");
    await expectFocus(page, { row, col: null });
  }
  await expectFocus(page, { row: 5, col: null, inView: true });

  // F-219: End goes to the last row loaded when it's pressed (header is aria-rowindex 1). Landing
  // near the end then loads the next page (A-340), which mustn't move focus.
  const loadedAtEnd = await settledLoadedRows(page);
  expect(loadedAtEnd + 1).toBeGreaterThan(5);
  await page.keyboard.press("End");
  await expectFocus(page, { row: loadedAtEnd + 1, inView: true });

  await settledLoadedRows(page);
  await expectFocus(page, { row: loadedAtEnd + 1, inView: true });

  await page.keyboard.press("Enter");
  // A-373: located by its text; the offline banner's status region is always mounted too.
  await expect(page.getByRole("status").filter({ hasText: "Activated row" })).toHaveText(
    `Activated row ${String(loadedAtEnd - 1)}`,
  );

  await page.keyboard.press("ArrowRight");
  await expectFocus(page, { row: loadedAtEnd + 1, col: 1 });
});

test("TP-12.3 (B-3): with the stop row scrolled out of view, Tab from the page heading lands on a row", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "chromium project only");
  await open(page);

  await page.locator("div[data-scroll]").evaluate((el) => {
    el.scrollTop = 80 * 36; // the fixture's rowHeight
  });
  await page.locator('[role="row"][aria-rowindex="82"]').waitFor();
  await page.locator("h1").first().focus();
  await page.keyboard.press("Tab");

  await expect
    .poll(() => page.evaluate(() => document.activeElement?.getAttribute("role")))
    .toBe("row");
});

test("TP-12.3: in ar-XB, Tab then ArrowLeft enters cell 1, ArrowLeft again goes to cell 2 (keys reversed)", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "pseudo-rtl", "pseudo-rtl project only");
  await open(page);

  await page.keyboard.press("Tab");
  await expectFocus(page, { row: 2, col: null });

  await page.keyboard.press("ArrowLeft");
  await expectFocus(page, { row: 2, col: 1 });

  await page.keyboard.press("ArrowLeft");
  await expectFocus(page, { row: 2, col: 2 });
});

test("TP-12.4 @perf: D-7 targets on 100,000 rows", async ({ page }) => {
  test.setTimeout(300_000);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });

  // 5 fresh loads: first rows visible − first page response (A-342 marks).
  const firstRows: number[] = [];
  for (let i = 0; i < 5; i += 1) {
    await page.goto(ROUTE);
    await page.waitForFunction(
      () => performance.getEntriesByName("budmon:first-rows-visible").length > 0,
    );
    firstRows.push(
      await page.evaluate(() => {
        const [response] = performance.getEntriesByName("budmon:first-page-response");
        const [visible] = performance.getEntriesByName("budmon:first-rows-visible");
        return (visible?.startTime ?? Infinity) - (response?.startTime ?? Infinity);
      }),
    );
  }
  firstRows.sort((a, b) => a - b);
  expect(firstRows[2]).toBeLessThanOrEqual(300);

  const topBefore = await page.evaluate(() => {
    const scroller = document.querySelector<HTMLElement>("div[data-scroll]");
    const s = scroller?.getBoundingClientRect();
    const rows = [...document.querySelectorAll<HTMLElement>('[role="row"][aria-rowindex]')];
    const top = rows.find(
      (r) =>
        Number(r.getAttribute("aria-rowindex")) >= 2 &&
        r.getBoundingClientRect().top >= (s?.top ?? 0) - 1,
    );
    return { id: top?.textContent ?? "", index: top?.getAttribute("aria-rowindex") ?? "" };
  });

  // Scroll 36 px per frame through 5,000 rows, past them and back, sampling as it goes.
  const result = await page.evaluate(async () => {
    const scroller = document.querySelector<HTMLElement>("div[data-scroll]");
    if (scroller === null) throw new Error("no div[data-scroll]");
    const frames: number[] = [];
    let longTasks = 0;
    let maxRows = 0;
    const observer = new PerformanceObserver((list) => {
      longTasks += list.getEntries().filter((e) => e.duration > 100).length;
    });
    observer.observe({ type: "longtask" });
    const frame = () => new Promise<number>((r) => requestAnimationFrame(r));
    const firstRow = scroller.querySelector<HTMLElement>(
      '[role="row"]:not([data-placeholder])[aria-rowindex="2"]',
    );
    const rowHeight = firstRow?.offsetHeight ?? 36;
    const busyInView = () => {
      const v = scroller.getBoundingClientRect();
      return [...scroller.querySelectorAll<HTMLElement>('[aria-busy="true"]')].some((r) => {
        const b = r.getBoundingClientRect();
        return b.bottom > v.top && b.top < v.bottom;
      });
    };
    let last = await frame();
    const step = async (target: number, dir: 1 | -1) => {
      while (dir === 1 ? scroller.scrollTop < target : scroller.scrollTop > target) {
        if (!busyInView()) scroller.scrollTop += 36 * dir;
        const now = await frame();
        frames.push(now - last);
        last = now;
        maxRows = Math.max(maxRows, document.querySelectorAll('[role="row"]').length);
      }
    };
    await step(5_000 * rowHeight, 1);
    await step(5_200 * rowHeight, 1);
    await step(0, -1);
    observer.disconnect();
    frames.sort((a, b) => a - b);
    return { p95: frames[Math.floor(frames.length * 0.95)] ?? Infinity, longTasks, maxRows };
  });

  expect(result.p95).toBeLessThanOrEqual(33);
  expect(result.longTasks).toBeLessThanOrEqual(5);
  expect(result.maxRows).toBeLessThan(200);

  const after = await page
    .locator(`[role="row"][aria-rowindex="${topBefore.index}"]`)
    .textContent();
  expect(after).toBe(topBefore.id);
});
