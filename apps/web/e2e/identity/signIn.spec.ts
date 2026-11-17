// S-3 sign-in, sign-out and session end in the browser (identity LLD §8.1, F-150, F-152, F-153,
// F-155, F-159's signedInAsOther state, F-162's account menu). TP-1.31, TP-3.28 (E), TP-3.40,
// TP-3.42, TP-3.43, TP-3.47, plus extra cases ending in "x".
// IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
import { randomInt } from "node:crypto";
import {
  accountMenuButton,
  catalogText,
  createInvitation,
  createUser,
  E2E_PASSWORD,
  expect,
  looseText,
  signOutFromMenu,
  signUpThroughUi,
  submitSignIn,
  test,
  uniqueEmail,
  WEB_CLIENT,
  type Page,
} from "../identity.js";

const MARKER = "budmon.session";
const SESSION_ENDED = "Your session ended. Sign in again.";
const MARKS = /[‏⁦-⁩]/g;

const signInButton = (page: Page) =>
  page.locator("main").getByRole("button", { name: catalogText("Sign in") });

/** The current URL's path and search parameters. */
function here(page: Page): { path: string; search: URLSearchParams } {
  const url = new URL(page.url());
  return { path: url.pathname, search: url.searchParams };
}

/** Requests to each path from now on. */
function countRequests(page: Page, paths: readonly string[]): Record<string, number> {
  const seen = Object.fromEntries(paths.map((p) => [p, 0]));
  page.on("request", (r) => {
    const path = new URL(r.url()).pathname;
    if (path in seen) seen[path] = (seen[path] ?? 0) + 1;
  });
  return seen;
}

/** Statuses of /api/v1/me responses, and status and error code of /api/v1/auth/refresh ones. */
function recordAuth(page: Page) {
  const me: number[] = [];
  const refresh: { status: number; code: unknown }[] = [];
  const pending: Promise<void>[] = [];
  page.on("response", (r) => {
    const path = new URL(r.url()).pathname;
    if (path === "/api/v1/me") me.push(r.status());
    if (path === "/api/v1/auth/refresh") {
      pending.push(
        r.json().then(
          (body: unknown) => {
            refresh.push({ status: r.status(), code: (body as { code?: unknown }).code });
          },
          () => {
            refresh.push({ status: r.status(), code: undefined });
          },
        ),
      );
    }
  });
  return { me, refresh, settled: () => Promise.all(pending) };
}

/** A user signed up through the UI in this browser: signed in, with the boot marker set. */
async function signedInUser(
  page: Page,
  request: Parameters<typeof createInvitation>[0],
  name: string,
) {
  const email = uniqueEmail();
  const { token } = await createInvitation(request, { email });
  await signUpThroughUi(page, token, name);
  return { email, name };
}

test.describe("TP-3.40: boot paths (F-152, F-153; review N-4)", () => {
  test("TP-3.40 (a): a fresh context opening /settings lands on /sign-in with next=/settings and no reason, with no request to /api/v1/me or /api/v1/auth/refresh", async ({
    page,
  }) => {
    const requests = countRequests(page, ["/api/v1/me", "/api/v1/auth/refresh"]);

    await page.goto("/settings");

    await expect(page).toHaveURL(/\/sign-in\?/);
    await expect(page.locator("main h1")).toHaveText(catalogText("Sign in"));
    const { path, search } = here(page);
    expect(path).toBe("/sign-in");
    expect(search.get("next")).toBe("/settings");
    expect(search.has("reason")).toBe(false);
    await expect(page.getByText(catalogText(SESSION_ENDED))).toHaveCount(0);
    expect(requests).toEqual({ "/api/v1/me": 0, "/api/v1/auth/refresh": 0 });
  });

  test("TP-3.40 (b): a stale marker without cookies: the boot screen, then /sign-in with reason=ended and next=/settings and 'Your session ended. Sign in again.'; one me request (401), one refresh (401 REFRESH_INVALID); the marker removed", async ({
    page,
  }) => {
    await page.addInitScript((key) => {
      localStorage.setItem(key, "1");
    }, MARKER);
    await page.route("**/api/v1/me", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 500));
      await route.continue();
    });
    const seen = recordAuth(page);

    await page.goto("/settings");

    await expect(page.locator('main[aria-busy="true"]')).toBeAttached();
    await expect(page).toHaveURL(/\/sign-in\?/);
    await expect(page.getByText(catalogText(SESSION_ENDED))).toBeVisible();
    const { path, search } = here(page);
    expect(path).toBe("/sign-in");
    expect(search.get("reason")).toBe("ended");
    expect(search.get("next")).toBe("/settings");
    await seen.settled();
    expect(seen.me).toEqual([401]);
    expect(seen.refresh).toEqual([{ status: 401, code: "REFRESH_INVALID" }]);
    // The redirect is client-side: no new document, so the init script hasn't set it again.
    expect(await page.evaluate((key) => localStorage.getItem(key), MARKER)).toBeNull();
  });
});

test.describe("TP-3.42: the reuse message", () => {
  test("TP-3.42: /sign-in?reason=reuse shows 'For your security, you've been signed out. Sign in again.'", async ({
    page,
  }) => {
    await page.goto("/sign-in?reason=reuse");

    await expect(
      page.getByText(catalogText("For your security, you've been signed out. Sign in again.")),
    ).toBeVisible();
    await expect(page.getByText(catalogText(SESSION_ENDED))).toHaveCount(0);
  });

  test("TP-3.42x: /sign-in?reason=ended shows 'Your session ended. Sign in again.' and not the reuse text", async ({
    page,
  }) => {
    await page.goto("/sign-in?reason=ended");

    await expect(page.getByText(catalogText(SESSION_ENDED))).toBeVisible();
    await expect(
      page.getByText(catalogText("For your security, you've been signed out. Sign in again.")),
    ).toHaveCount(0);
  });
});

test.describe("TP-3.43: the sign-in rate limit (P-F-214)", () => {
  test("TP-3.43: 11 wrong sign-ins for one email from one browser: the 11th shows 'Too many attempts. Try again in # minutes.' and Sign in is disabled while blocked", async ({
    page,
    request,
  }, testInfo) => {
    const { email } = await createUser(request);
    await page.goto("/sign-in");
    await expect(page.getByLabel(catalogText("Email"))).toBeVisible();
    await page.getByLabel(catalogText("Email")).fill(email);
    const password = page.getByLabel(catalogText("Password"));
    const answered = () =>
      page.waitForResponse((r) => new URL(r.url()).pathname === "/api/v1/auth/sign-in");

    for (let i = 1; i <= 10; i += 1) {
      await password.fill(`wrong password number ${String(i)}`);
      const response = answered();
      await signInButton(page).click();
      expect((await response).status(), `attempt ${String(i)}`).toBe(401);
      await expect(page.getByText(catalogText("Email or password is incorrect."))).toBeVisible();
    }
    await password.fill("wrong password number 11");
    const eleventh = answered();
    await signInButton(page).click();
    expect((await eleventh).status()).toBe(429);

    const notice = page.getByRole("status").filter({ hasText: /Too many attempts/ });
    await expect(notice).toBeVisible();
    const text = ((await notice.textContent()) ?? "").replace(MARKS, "").trim();
    const match = /^Too many attempts\. Try again in ([\d٠-٩]+) minutes?\.$/.exec(text);
    expect(match, text).not.toBeNull();
    if (testInfo.project.name === "chromium") {
      const minutes = Number(match?.[1]);
      expect(minutes).toBeGreaterThanOrEqual(1);
      expect(minutes).toBeLessThanOrEqual(15);
      expect(text).toBe(
        minutes === 1
          ? "Too many attempts. Try again in 1 minute."
          : `Too many attempts. Try again in ${String(minutes)} minutes.`,
      );
    }
    await expect(signInButton(page)).toBeDisabled();
  });
});

test.describe("TP-3.47: sign in, sign out, next (F-155, F-162)", () => {
  test("TP-3.47: sign in at /sign-in?next=/settings → /settings; sign out from the menu → /sign-in; sign in with next=//evil.com → /", async ({
    page,
    request,
  }) => {
    const { email, name } = await createUser(request, { name: "Next Param" });

    await submitSignIn(page, email, E2E_PASSWORD, "/sign-in?next=/settings");

    await expect(page).toHaveURL(/\/settings$/);
    expect(here(page).path).toBe("/settings");
    await expect(page.locator("main h1")).toHaveText(catalogText("Settings"));
    const origin = new URL(page.url()).origin;

    await signOutFromMenu(page);

    await expect(page).toHaveURL(/\/sign-in$/);
    await expect(page.locator("main h1")).toHaveText(catalogText("Sign in"));

    await submitSignIn(page, email, E2E_PASSWORD, "/sign-in?next=//evil.com");

    await expect(page.locator("main h1")).toHaveText(looseText(`Welcome, ${name}.`));
    const url = new URL(page.url());
    expect(url.origin).toBe(origin);
    expect(url.pathname).toBe("/");
  });

  test("TP-3.47x: sign in without next → / (the first-run home), and the marker is set", async ({
    page,
    request,
  }) => {
    const { email, name } = await createUser(request, { name: "No Next" });

    await submitSignIn(page, email);

    await expect(page.locator("main h1")).toHaveText(looseText(`Welcome, ${name}.`));
    expect(here(page).path).toBe("/");
    expect(await page.evaluate((key) => localStorage.getItem(key), MARKER)).toBe("1");
  });

  test("TP-3.47x: a wrong password shows 'Email or password is incorrect.' and stays on /sign-in", async ({
    page,
    request,
  }) => {
    const { email } = await createUser(request);

    await submitSignIn(page, email, "not the right password");

    await expect(page.getByText(catalogText("Email or password is incorrect."))).toBeVisible();
    expect(here(page).path).toBe("/sign-in");
    await expect(page.getByLabel(catalogText("Password"))).toHaveValue("not the right password");
  });

  test("TP-3.47x: an unknown email shows the same 'Email or password is incorrect.'", async ({
    page,
  }) => {
    await submitSignIn(page, uniqueEmail());

    await expect(page.getByText(catalogText("Email or password is incorrect."))).toBeVisible();
    expect(here(page).path).toBe("/sign-in");
  });

  test("TP-3.47x: submitting empty fields shows 'Enter your email.' and 'Enter your password.' and sends nothing", async ({
    page,
  }) => {
    const sent = countRequests(page, ["/api/v1/auth/sign-in"]);
    await page.goto("/sign-in");
    await expect(page.getByLabel(catalogText("Email"))).toBeVisible();

    await signInButton(page).click();

    await expect(page.getByText(catalogText("Enter your email."))).toBeVisible();
    await expect(page.getByText(catalogText("Enter your password."))).toBeVisible();
    await expect(page.getByLabel(catalogText("Email"))).toHaveAttribute("aria-invalid", "true");
    expect(sent["/api/v1/auth/sign-in"]).toBe(0);
  });

  test("TP-3.47x: an email without @ shows 'Enter an email address like name@example.com.' and sends nothing", async ({
    page,
  }) => {
    const sent = countRequests(page, ["/api/v1/auth/sign-in"]);
    await page.goto("/sign-in");
    await expect(page.getByLabel(catalogText("Email"))).toBeVisible();
    await page.getByLabel(catalogText("Email")).fill("mona.example.com");
    await page.getByLabel(catalogText("Password")).fill(E2E_PASSWORD);

    await signInButton(page).click();

    await expect(
      page.getByText(catalogText("Enter an email address like name@example.com.")),
    ).toBeVisible();
    expect(sent["/api/v1/auth/sign-in"]).toBe(0);
  });

  test("TP-3.47x: the fields: Email type=email autocomplete=username; Password autocomplete=current-password with Show password", async ({
    page,
  }) => {
    await page.goto("/sign-in");

    const email = page.getByLabel(catalogText("Email"));
    await expect(email).toHaveAttribute("type", "email");
    await expect(email).toHaveAttribute("autocomplete", "username");
    const password = page.getByLabel(catalogText("Password"));
    await expect(password).toHaveAttribute("autocomplete", "current-password");
    await expect(password).toHaveAttribute("type", "password");
    await page.getByRole("button", { name: catalogText("Show password") }).click();
    await expect(password).toHaveAttribute("type", "text");
  });

  test("TP-3.47x: after signing out, the sign-in page prefills the last email (localStorage budmon.lastEmail), and the marker is gone", async ({
    page,
    request,
  }) => {
    const { email } = await createUser(request);
    await submitSignIn(page, email);
    await expect(page).toHaveURL(/\/$/);

    await signOutFromMenu(page);

    await expect(page).toHaveURL(/\/sign-in$/);
    await expect(page.getByLabel(catalogText("Email"))).toHaveValue(email);
    expect(await page.evaluate(() => localStorage.getItem("budmon.lastEmail"))).toBe(email);
    expect(await page.evaluate((key) => localStorage.getItem(key), MARKER)).toBeNull();
  });

  test("TP-3.47x: signed in, /sign-in redirects to /", async ({ page, request }) => {
    const { name } = await signedInUser(page, request, "Already In");

    await page.goto("/sign-in");

    await expect(page.locator("main h1")).toHaveText(looseText(`Welcome, ${name}.`));
    expect(here(page).path).toBe("/");
  });

  test("TP-3.47x: signing out when auth.signOut fails (network): the unavailable toast, still signed in, the marker kept", async ({
    page,
    request,
  }) => {
    const { name } = await signedInUser(page, request, "Sign Out Fails");
    await page.route("**/api/v1/auth/sign-out", (route) => route.abort("connectionrefused"));

    await signOutFromMenu(page);

    await expect(
      page.getByText(looseText("wDit is temporarily unavailable. Try again in a few minutes.")),
    ).toBeVisible();
    expect(here(page).path).toBe("/");
    await expect(page.locator("main h1")).toHaveText(looseText(`Welcome, ${name}.`));
    await expect(accountMenuButton(page)).toBeVisible();
    expect(await page.evaluate((key) => localStorage.getItem(key), MARKER)).toBe("1");
  });

  test("TP-3.47x: the account menu offers Settings, which opens /settings", async ({
    page,
    request,
  }) => {
    await signedInUser(page, request, "Menu Settings");

    await expect(accountMenuButton(page)).toBeVisible();
    await accountMenuButton(page).click();
    await page.getByRole("menuitem", { name: catalogText("Settings") }).click();

    await expect(page).toHaveURL(/\/settings$/);
    await expect(page.locator("main h1")).toHaveText(catalogText("Settings"));
  });

  test("TP-3.47x: signed out, the header has no account menu", async ({ page }) => {
    await page.goto("/sign-in");

    await expect(page.locator("main h1")).toHaveText(catalogText("Sign in"));
    await expect(accountMenuButton(page)).toHaveCount(0);
  });
});

test.describe("TP-3.28 (E): the web device cookie survives sign-out (P-9)", () => {
  test("TP-3.28 (E): signed in once in the browser, signed out (the device cookie kept), 30 wrong attempts from other IPs exhaust the unknown-device bucket, and the browser's next sign-in still succeeds", async ({
    page,
    request,
  }) => {
    const { email, name } = await createUser(request, { name: "Device Cookie" });
    await submitSignIn(page, email);
    await expect(page.locator("main h1")).toHaveText(looseText(`Welcome, ${name}.`));
    const origin = new URL(page.url()).origin;
    const deviceCookie = async () =>
      (await page.context().cookies(`${origin}/api/v1/auth/sign-in`)).find((c) =>
        /^(__Secure-)?budmon_dv$/.test(c.name),
      );
    const before = await deviceCookie();
    expect(before, "the device cookie after the first sign-in").toBeDefined();
    expect(before?.path).toBe("/api/v1");

    await signOutFromMenu(page);
    await expect(page).toHaveURL(/\/sign-in$/);

    expect((await deviceCookie())?.value).toBe(before?.value);

    // Other IPs without the cookie: one per attempt, so only the per-email bucket fills up.
    const base = randomInt(0, 1 << 20);
    const ip = (n: number) => {
      const k = base + n;
      return `172.${String(16 + ((k >> 16) & 15))}.${String((k >> 8) & 255)}.${String(k & 255)}`;
    };
    for (let i = 0; i < 30; i += 1) {
      const res = await request.post("/api/v1/auth/sign-in", {
        headers: { ...WEB_CLIENT, "X-Forwarded-For": ip(i) },
        data: { email, password: "wrong password", tokenDelivery: "body" },
      });
      expect(res.status(), `wrong attempt ${String(i + 1)}`).toBe(401);
    }
    const blocked = await request.post("/api/v1/auth/sign-in", {
      headers: { ...WEB_CLIENT, "X-Forwarded-For": ip(30) },
      data: { email, password: E2E_PASSWORD, tokenDelivery: "body" },
    });
    expect(blocked.status()).toBe(429);
    expect(((await blocked.json()) as { code: string }).code).toBe("RATE_LIMITED");

    await submitSignIn(page, email);

    await expect(page.locator("main h1")).toHaveText(looseText(`Welcome, ${name}.`));
    expect(here(page).path).toBe("/");
  });
});

test.describe("TP-1.31: signed in as someone else on /invite (F-159, A-57)", () => {
  test("TP-1.31: signed in as A, B's link shows 'You're signed in as {A}. Sign out to accept this invitation.' and Sign out and continue leads to B's Join screen", async ({
    page,
    request,
  }) => {
    const a = await signedInUser(page, request, "Person A");
    const b = uniqueEmail();
    const { token } = await createInvitation(request, { email: b });

    await page.goto(`/invite#t=${token}`);

    await expect(
      page.getByText(
        looseText(`You're signed in as ${a.email}. Sign out to accept this invitation.`),
      ),
    ).toBeVisible();
    expect(page.url()).not.toContain(token);
    expect(here(page).path).toBe("/invite");

    await page.getByRole("button", { name: catalogText("Sign out and continue") }).click();

    await expect(page.locator("main h1")).toHaveText(catalogText("You've been invited"));
    await expect(page.getByText(looseText(`This invitation is for ${b}.`))).toBeVisible();
    expect(here(page).path).toBe("/invite");
  });

  test("TP-1.31x: signed in, an expired link (a problem) still goes home with nothing stored (A-57)", async ({
    page,
    request,
  }) => {
    const { name } = await signedInUser(page, request, "Expired Link");
    const { token } = await createInvitation(request, { email: uniqueEmail(), state: "expired" });

    await page.goto(`/invite#t=${token}`);

    await expect(page.locator("main h1")).toHaveText(looseText(`Welcome, ${name}.`));
    expect(here(page).path).toBe("/");
    expect(page.url()).not.toContain(token);
    expect(await page.evaluate(() => sessionStorage.getItem("budmon.invite"))).toBeNull();
  });
});
