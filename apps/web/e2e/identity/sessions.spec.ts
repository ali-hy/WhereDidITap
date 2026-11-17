// S-3 sessions in the browser (identity LLD §8.1, F-25, F-150, F-152, F-164's sessions section,
// J-10). TP-3.41 (a session revoked elsewhere), TP-3.50 and TP-3.51 (concurrent refreshes, option
// (a)), plus extra cases ending in "x" for the sessions section.
// IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
import type { APIRequestContext, APIResponse, Request, Route } from "@playwright/test";
import {
  catalogText,
  createInvitation,
  expect,
  looseText,
  signInByApi,
  signUpThroughUi,
  jarCookie,
  test,
  toastWith,
  uniqueEmail,
  WEB_CLIENT,
  type Page,
} from "../identity.js";

const SESSION_ENDED = "Your session ended. Sign in again.";
const REUSE_SUBJECT = /^We signed you out of /;

/** A user signed up through the UI in this browser (a cookie session), on the home page. */
async function signedInUser(page: Page, request: APIRequestContext, name: string) {
  const email = uniqueEmail();
  const { token } = await createInvitation(request, { email });
  await signUpThroughUi(page, token, name);
  return { email, name };
}

/** Opens Sign-in & security from the settings navigation. */
async function openSecurityFromNav(page: Page): Promise<void> {
  await page
    .getByRole("navigation", { name: catalogText("Settings") })
    .getByRole("link", { name: catalogText("Sign-in & security") })
    .click();
}

/** Emails the e2e stack sent to `to` whose subject matches. */
async function emailsTo(request: APIRequestContext, to: string, subject: RegExp) {
  const res = await request.get("/api/v1/__test/emails");
  expect(res.status()).toBe(200);
  const all = (await res.json()) as { to: string; subject: string }[];
  return all.filter((m) => m.to === to && subject.test(m.subject));
}

function deferred<T = void>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** The refresh cookie's value from a response's Set-Cookie headers (unprefixed on localhost, A-76). */
function refreshCookieOf(res: APIResponse): string | undefined {
  for (const h of res.headersArray()) {
    if (h.name.toLowerCase() !== "set-cookie") continue;
    for (const line of h.value.split("\n")) {
      const m = /^budmon_rt=([^;]*)/.exec(line.trim());
      if (m !== null) return m[1];
    }
  }
  return undefined;
}

/** The refresh cookie the browser holds now (unprefixed on localhost, A-76). */
async function jarRefreshToken(page: Page): Promise<string | undefined> {
  return (await jarCookie(page, "budmon_rt"))?.value;
}

/**
 * TP-3.50/TP-3.51's race: two refreshes A and B sent from the page with the same cookie (bypassing
 * F-150's lock). The route forwards A, waits for its answer, then forwards B, so the server applies
 * R1 to A and R2 to B. Each is forwarded through its own request context, so the browser's jar
 * changes only when the page receives a response. The responses reach the page in `order`.
 */
async function raceTwoRefreshes(
  page: Page,
  newContext: () => Promise<APIRequestContext>,
  order: "B-then-A" | "A-then-B",
): Promise<{ tokenA: string | undefined; tokenB: string | undefined }> {
  const fetched = { A: deferred<APIResponse>(), B: deferred<APIResponse>() };
  const release = { A: deferred(), B: deferred() };
  const requests: { A?: Request; B?: Request } = {};
  let n = 0;

  const contexts: APIRequestContext[] = [];
  async function forward(route: Route): Promise<APIResponse> {
    const ctx = await newContext();
    contexts.push(ctx);
    const req = route.request();
    const headers = Object.fromEntries(
      Object.entries(await req.allHeaders()).filter(
        ([k]) => !["host", "content-length", "connection"].includes(k.toLowerCase()),
      ),
    );
    const res = await ctx.fetch(req.url(), {
      method: req.method(),
      headers,
      data: req.postDataBuffer() ?? undefined,
    });
    await res.body();
    return res;
  }

  await page.route("**/api/v1/auth/refresh", async (route) => {
    n += 1;
    const which = n === 1 ? "A" : n === 2 ? "B" : null;
    if (which === null) {
      await route.continue();
      return;
    }
    requests[which] = route.request();
    if (which === "B") await fetched.A.promise;
    const res = await forward(route);
    fetched[which].resolve(res);
    await release[which].promise;
    await route.fulfill({ response: res });
  });

  const statuses = page.evaluate(async () => {
    const send = () =>
      fetch("/api/v1/auth/refresh", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", "X-Budmon-Client": "web/0" },
        body: JSON.stringify({ tokenDelivery: "cookie" }),
      }).then((r) => r.status);
    return Promise.all([send(), send()]);
  });

  const a = await fetched.A.promise;
  const b = await fetched.B.promise;
  expect(a.status(), "A (R1)").toBe(200);
  expect(b.status(), "B (R2)").toBe(200);

  const [first, second] = order === "B-then-A" ? (["B", "A"] as const) : (["A", "B"] as const);
  const firstDone = page.waitForEvent("requestfinished", {
    predicate: (r) => r === requests[first],
  });
  release[first].resolve();
  await firstDone;
  release[second].resolve();
  expect(await statuses).toEqual([200, 200]);
  await Promise.all(contexts.map((c) => c.dispose()));

  return { tokenA: refreshCookieOf(a), tokenB: refreshCookieOf(b) };
}

test.describe("TP-3.41: a session revoked from another device (F-150, F-152)", () => {
  test("TP-3.41: B revokes the other sessions; the browser opens Sign-in & security: me.listSessions 401, the refresh REFRESH_INVALID, then /sign-in?reason=ended&next=/settings/security with 'Your session ended. Sign in again.'", async ({
    page,
    request,
  }) => {
    const { email } = await signedInUser(page, request, "Revoked Elsewhere");
    await page.goto("/settings");
    await expect(page.locator("main h1")).toHaveText(catalogText("Settings"));
    const b = await signInByApi(request, email);
    const revoked = await request.post("/api/v1/me/sessions/revoke-others", {
      headers: { ...WEB_CLIENT, Authorization: `Bearer ${b.accessToken}` },
      data: {},
    });
    expect(revoked.status(), await revoked.text()).toBe(200);
    expect(((await revoked.json()) as { revoked: number }).revoked).toBe(1);
    const sessions: number[] = [];
    const refreshes: Promise<{ status: number; code: unknown }>[] = [];
    page.on("response", (r) => {
      const path = new URL(r.url()).pathname;
      if (path === "/api/v1/me/sessions") sessions.push(r.status());
      if (path === "/api/v1/auth/refresh") {
        refreshes.push(
          r.json().then((body: unknown) => ({
            status: r.status(),
            code: (body as { code?: unknown }).code,
          })),
        );
      }
    });

    await openSecurityFromNav(page);

    await expect(page).toHaveURL(/\/sign-in\?/);
    await expect(page.getByText(catalogText(SESSION_ENDED))).toBeVisible();
    const url = new URL(page.url());
    expect(url.pathname).toBe("/sign-in");
    expect(url.searchParams.get("reason")).toBe("ended");
    // A-76: next is where the 401 happened.
    expect(url.searchParams.get("next")).toBe("/settings/security");
    expect(sessions).toEqual([401]);
    expect(await Promise.all(refreshes)).toEqual([{ status: 401, code: "REFRESH_INVALID" }]);
  });
});

test.describe("TP-3.50, TP-3.51: concurrent refreshes (F-25 option (a))", () => {
  test("TP-3.50: A then B reach the server; the page gets B's response first and A's last, so the jar holds A's discarded token; the next me.get → 401 → F-150's refresh (R3) → 200; signed in; no reuse email", async ({
    page,
    request,
    playwright,
  }) => {
    const { email, name } = await signedInUser(page, request, "Race A Last");

    const { tokenA, tokenB } = await raceTwoRefreshes(
      page,
      () => playwright.request.newContext(),
      "B-then-A",
    );

    expect(tokenA).toBeDefined();
    expect(tokenB).toBeDefined();
    expect(tokenA).not.toBe(tokenB);
    expect(await jarRefreshToken(page)).toBe(tokenA);

    const me: number[] = [];
    const refresh: number[] = [];
    page.on("response", (r) => {
      const path = new URL(r.url()).pathname;
      if (path === "/api/v1/me") me.push(r.status());
      if (path === "/api/v1/auth/refresh") refresh.push(r.status());
    });
    await page.reload();

    await expect(page.locator("main h1")).toHaveText(looseText(`Welcome, ${name}.`));
    expect(me).toEqual([401, 200]);
    expect(refresh).toEqual([200]);
    expect(await emailsTo(request, email, REUSE_SUBJECT)).toEqual([]);
  });

  test("TP-3.51: A's response reaches the page first and B's last, so the jar holds the current token; the next refresh (R1) → 200; signed in; no reuse email", async ({
    page,
    request,
    playwright,
  }) => {
    const { email, name } = await signedInUser(page, request, "Race B Last");

    const { tokenA, tokenB } = await raceTwoRefreshes(
      page,
      () => playwright.request.newContext(),
      "A-then-B",
    );

    expect(tokenB).toBeDefined();
    expect(tokenA).not.toBe(tokenB);
    expect(await jarRefreshToken(page)).toBe(tokenB);

    const next = await page.evaluate(async () => {
      const r = await fetch("/api/v1/auth/refresh", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", "X-Budmon-Client": "web/0" },
        body: JSON.stringify({ tokenDelivery: "cookie" }),
      });
      return r.status;
    });
    expect(next).toBe(200);

    const me: number[] = [];
    page.on("response", (r) => {
      if (new URL(r.url()).pathname === "/api/v1/me") me.push(r.status());
    });
    await page.reload();

    await expect(page.locator("main h1")).toHaveText(looseText(`Welcome, ${name}.`));
    expect(me).toEqual([200]);
    expect(await emailsTo(request, email, REUSE_SUBJECT)).toEqual([]);
  });
});

test.describe("TP-3.53x: the sessions section (F-164, J-10)", () => {
  const signOutButtons = (page: Page) =>
    page.locator("main").getByRole("button", { name: catalogText("Sign out") });

  test("TP-3.53x: 'Where you're signed in' lists this device first with 'This device' and no Sign out; another session has Sign out, which ends that session and removes it", async ({
    page,
    request,
  }) => {
    const { email } = await signedInUser(page, request, "Two Devices");
    const other = await signInByApi(request, email);

    await page.goto("/settings/security");

    await expect(page.locator("main h1")).toHaveText(catalogText("Sign-in & security"));
    await expect(
      page.getByRole("heading", { name: catalogText("Where you're signed in") }),
    ).toBeVisible();
    const thisDevice = page.locator("main").getByText(catalogText("This device"));
    await expect(thisDevice).toHaveCount(1);
    await expect(signOutButtons(page)).toHaveCount(1);
    const thisDeviceFirst = await thisDevice.evaluate(
      (el, button) =>
        Boolean(el.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING),
      await signOutButtons(page).elementHandle(),
    );
    expect(thisDeviceFirst).toBe(true);

    const revoke = page.waitForResponse(
      (r) => new URL(r.url()).pathname === "/api/v1/me/sessions/revoke",
    );
    await signOutButtons(page).click();
    expect((await revoke).status()).toBe(200);

    await expect(signOutButtons(page)).toHaveCount(0);
    await expect(thisDevice).toHaveCount(1);
    const otherMe = await request.get("/api/v1/me", {
      headers: { ...WEB_CLIENT, Authorization: `Bearer ${other.accessToken}` },
    });
    expect(otherMe.status()).toBe(401);
  });

  test("TP-3.53x: Sign out of all other devices with two other sessions: toast 'Signed out of 2 other devices.', only this device remains, and the button is gone (A-75)", async ({
    page,
    request,
  }) => {
    const { email } = await signedInUser(page, request, "Three Devices");
    await signInByApi(request, email);
    await signInByApi(request, email);
    await page.goto("/settings/security");
    await expect(signOutButtons(page)).toHaveCount(2);

    await page
      .locator("main")
      .getByRole("button", { name: catalogText("Sign out of all other devices") })
      .click();

    await expect(toastWith(page, looseText("Signed out of 2 other devices."))).toBeVisible();
    await expect(signOutButtons(page)).toHaveCount(0);
    await expect(page.locator("main").getByText(catalogText("This device"))).toHaveCount(1);
    await expect(
      page
        .locator("main")
        .getByRole("button", { name: catalogText("Sign out of all other devices") }),
    ).toHaveCount(0);
    expect(new URL(page.url()).pathname).toBe("/settings/security");
  });
});
