// S-1 sign-up from an invitation (identity LLD §8.1, §8.3, F-152, F-159, F-170, F-173).
// TP-1.30, TP-1.32, TP-1.37, TP-1.38, TP-1.39, plus extra cases ending in "x".
// IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
import {
  catalogText,
  createInvitation,
  expect,
  looseText,
  openInvitation,
  signUpThroughUi,
  test,
  uniqueEmail,
  type Page,
} from "../identity.js";

const WEB_CLIENT = { "X-Budmon-Client": "web/1" };

/** Requests to /api/v1/me and /api/v1/auth/refresh, and console errors, from now on. */
function record(page: Page) {
  const seen = { me: 0, refresh: 0, consoleErrors: [] as string[] };
  page.on("request", (r) => {
    const path = new URL(r.url()).pathname;
    if (path === "/api/v1/me") seen.me += 1;
    if (path === "/api/v1/auth/refresh") seen.refresh += 1;
  });
  page.on("console", (m) => {
    if (m.type() === "error") seen.consoleErrors.push(m.text());
  });
  return seen;
}

test.describe("TP-1.30: sign-up with a password", () => {
  test("TP-1.30: /invite#t=<token> → Use a password → Create account: the fragment leaves the URL, then / shows 'Welcome, {name}.' with the title 'Welcome, {name}. – wDit'", async ({
    page,
    request,
  }) => {
    const { token } = await createInvitation(request, { email: uniqueEmail() });

    await openInvitation(page, token);
    expect(new URL(page.url()).hash).toBe("");
    expect(page.url()).not.toContain(token);

    await signUpThroughUi(page, token, "Mona Hassan");

    await expect(page.locator("main h1")).toHaveText(looseText("Welcome, Mona Hassan."));
    await expect(page.getByText(catalogText("Add your first account to start."))).toBeVisible();
    await expect(page).toHaveTitle(/^.*Welcome, .*Mona Hassan.*\. – wDit$/);
  });

  test("TP-1.30x: the token is gone from the address bar while the invitation is checked", async ({
    page,
    request,
  }) => {
    const { token } = await createInvitation(request, { email: uniqueEmail() });
    await page.route("**/api/v1/invitations/preview", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      await route.continue();
    });

    await page.goto(`/invite#t=${token}`);

    await expect(page.getByText(catalogText("Checking your invitation…"))).toBeVisible();
    expect(page.url()).not.toContain(token);
  });

  test("TP-1.30x: a too-short password shows 'Use at least 12 characters.' on its field, and nothing is submitted", async ({
    page,
    request,
  }) => {
    const { token } = await createInvitation(request, { email: uniqueEmail() });
    let accepts = 0;
    page.on("request", (r) => {
      if (new URL(r.url()).pathname === "/api/v1/invitations/accept") accepts += 1;
    });
    await openInvitation(page, token);
    await page.getByRole("button", { name: catalogText("Use a password") }).click();
    await page.getByLabel(catalogText("Your name")).fill("Mona");
    const password = page.getByLabel(catalogText("Password"));
    await password.fill("short");

    await page.getByRole("button", { name: catalogText("Create account") }).click();

    await expect(page.getByText(catalogText("Use at least 12 characters."))).toBeVisible();
    await expect(password).toHaveAttribute("aria-invalid", "true");
    expect(accepts).toBe(0);
  });
});

test.describe("TP-1.32: invitation problems", () => {
  const problemTitle = (page: Page) =>
    expect(page.locator("main h1")).toHaveText(catalogText("This invitation can't be used"));

  test("TP-1.32: an expired link: 'It expired on {date}.' with the date, and 'Ask {inviter} to send a new one.'", async ({
    page,
    request,
  }) => {
    const { token } = await createInvitation(request, {
      email: uniqueEmail(),
      state: "expired",
      inviterEmail: "owner@budmon.local",
    });

    await page.goto(`/invite#t=${token}`);

    await problemTitle(page);
    const expired = page.getByText(/It expired on .+\.‏?$/);
    await expect(expired).toBeVisible();
    expect(await expired.textContent()).not.toContain("{date}");
    expect(await expired.textContent()).toMatch(/\d/);
    await expect(page.getByText(looseText("Ask Dev Owner to send a new one."))).toBeVisible();
  });

  test("TP-1.32: a revoked link: 'It was cancelled.'", async ({ page, request }) => {
    const { token } = await createInvitation(request, { email: uniqueEmail(), state: "revoked" });

    await page.goto(`/invite#t=${token}`);

    await problemTitle(page);
    await expect(page.getByText(catalogText("It was cancelled."))).toBeVisible();
  });

  for (const [label, path] of [
    ["no fragment", "/invite"],
    ["a malformed token", "/invite#t=bmi_short"],
  ] as const) {
    test(`TP-1.32: an incomplete link (${label}): 'This link isn't complete. …', and no preview request`, async ({
      page,
    }) => {
      let previews = 0;
      page.on("request", (r) => {
        if (new URL(r.url()).pathname === "/api/v1/invitations/preview") previews += 1;
      });

      await page.goto(path);

      await problemTitle(page);
      await expect(
        page.getByText(
          catalogText(
            "This link isn't complete. Open it again from the email, or copy the whole link.",
          ),
        ),
      ).toBeVisible();
      expect(previews).toBe(0);
    });
  }
});

test.describe("TP-1.37: the privacy notice", () => {
  const TITLES = [
    "Privacy notice",
    "What we keep",
    "Signing in with Google",
    "Emails we send",
    "Your data is yours",
    "Deleting your account",
    "If an address is banned",
    "What the administrator sees",
    "Questions",
  ];

  test("TP-1.37: /privacy has the h1 'Privacy notice' and nine sections with §8.3's titles, in order", async ({
    page,
  }) => {
    await page.goto("/privacy");

    await expect(page.locator("main h1")).toHaveText(catalogText("Privacy notice"));
    const headings = page.locator("main h1, main h2");
    await expect(headings).toHaveCount(9);
    for (const [i, title] of TITLES.entries()) {
      await expect(headings.nth(i)).toHaveText(catalogText(title));
    }
    await expect(page).toHaveTitle(/Privacy notice.* – wDit$/);
  });

  test("TP-1.37: the set-up screen's privacy link opens /privacy", async ({ page, request }) => {
    const { token } = await createInvitation(request, { email: uniqueEmail() });
    await openInvitation(page, token);
    await page.getByRole("button", { name: catalogText("Use a password") }).click();
    await expect(page.locator("main h1")).toHaveText(catalogText("Set up your account"));

    const link = page.getByRole("link", { name: /privacy notice/ });
    await link.click();

    await expect(page).toHaveURL(/\/privacy$/);
    await expect(page.locator("main h1")).toHaveText(catalogText("Privacy notice"));
  });
});

test.describe("TP-1.38: the first visit and the boot marker", () => {
  test("TP-1.38: a fresh context opening / makes no /me or /auth/refresh request, logs no console error, and shows /sign-in with one main#main h1; after an accept a reload calls me.get once and shows the home; after localStorage.clear() a reload makes neither request and shows the sign-in page", async ({
    page,
    request,
  }) => {
    const first = record(page);
    await page.goto("/");

    await expect(page).toHaveURL(/\/sign-in(\?.*)?$/);
    await expect(page.locator("main#main h1")).toHaveCount(1);
    await expect(page.locator("main#main h1")).toHaveText(catalogText("Sign in"));
    expect(first.me).toBe(0);
    expect(first.refresh).toBe(0);
    expect(first.consoleErrors).toEqual([]);

    const { token } = await createInvitation(request, { email: uniqueEmail() });
    await signUpThroughUi(page, token, "Boot Marker");
    const afterAccept = record(page);
    await page.reload();
    await expect(page.locator("main h1")).toHaveText(looseText("Welcome, Boot Marker."));
    expect(afterAccept.me).toBe(1);

    await page.evaluate(() => {
      localStorage.clear();
    });
    const afterClear = record(page);
    await page.reload();
    await expect(page).toHaveURL(/\/sign-in(\?.*)?$/);
    await expect(page.locator("main#main h1")).toHaveText(catalogText("Sign in"));
    expect(afterClear.me).toBe(0);
    expect(afterClear.refresh).toBe(0);
  });

  test("TP-1.38x: the sign-in page carries the invite-only note", async ({ page }) => {
    await page.goto("/sign-in");

    await expect(
      page.getByText(
        catalogText("You need an invitation to join. Got one? Open the link in the email."),
      ),
    ).toBeVisible();
    await expect(page).toHaveTitle(/^.*Sign in.* – wDit$/);
  });

  test("TP-1.38x: a guarded path signed out redirects to /sign-in?next=<path> with no request", async ({
    page,
  }) => {
    const seen = record(page);

    await page.goto("/settings");

    await expect(page).toHaveURL(/\/sign-in\?next=%2Fsettings$|\/sign-in\?next=\/settings$/);
    expect(seen.me).toBe(0);
  });
});

test.describe("TP-1.39: the e2e invitation route and preview", () => {
  test.skip(({ browserName }) => browserName !== "chromium", "API-level, chromium only");

  async function previewOf(request: Parameters<typeof createInvitation>[0], token: string) {
    return request.post("/api/v1/invitations/preview", {
      data: { token },
      headers: WEB_CLIENT,
    });
  }

  test("TP-1.39: { email } → a preview for that email with inviterName null and origin direct", async ({
    request,
  }) => {
    const email = uniqueEmail();
    const { token, invitationId } = await createInvitation(request, { email });

    const res = await previewOf(request, token);

    expect(res.status()).toBe(200);
    expect(await res.json()).toMatchObject({
      invitationId,
      email,
      inviterName: null,
      origin: "direct",
    });
  });

  test("TP-1.39: state expired → INVITATION_EXPIRED; state revoked → INVITATION_REVOKED", async ({
    request,
  }) => {
    const expired = await createInvitation(request, { email: uniqueEmail(), state: "expired" });
    const revoked = await createInvitation(request, { email: uniqueEmail(), state: "revoked" });

    const a = await previewOf(request, expired.token);
    const b = await previewOf(request, revoked.token);

    expect(a.status()).toBe(410);
    expect(((await a.json()) as { code: string }).code).toBe("INVITATION_EXPIRED");
    expect(b.status()).toBe(410);
    expect(((await b.json()) as { code: string }).code).toBe("INVITATION_REVOKED");
  });

  test("TP-1.39: inviterEmail owner@budmon.local → inviterName 'Dev Owner'", async ({
    request,
  }) => {
    const { token } = await createInvitation(request, {
      email: uniqueEmail(),
      inviterEmail: "owner@budmon.local",
    });

    const res = await previewOf(request, token);

    expect(((await res.json()) as { inviterName: unknown }).inviterName).toBe("Dev Owner");
  });

  test("TP-1.39: expiresInSeconds 0 → 400 from the test route (no invitation)", async ({
    request,
  }) => {
    const res = await request.post("/api/v1/__test/invitations", {
      data: { email: uniqueEmail(), expiresInSeconds: 0 },
    });

    expect(res.status()).toBe(400);
  });
});
