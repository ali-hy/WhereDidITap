// S-1 sign-up from an invitation (identity LLD §8.1, §8.3, F-152, F-159, F-170, F-173).
// TP-1.30, TP-1.32, TP-1.37, TP-1.38, TP-1.39 (A-41, A-43, A-53, A-56, A-58), plus extra cases ending in "x".
// TP-1.48 and TP-1.51 to TP-1.54 (A-52 to A-57) are in invitePage.spec.ts.
// IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
import {
  accentRgb,
  catalogText,
  createInvitation,
  E2E_PASSWORD,
  expect,
  looseText,
  primaryCount,
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
  test("TP-1.30: /invite#t=<token> → Use a password → Create account: the fragment leaves the URL, then / shows 'Welcome, {name}.' with the title 'Welcome, {name}. – wDit'; in chromium (UTC) the zone is preselected 'UTC (GMT)' and sent as UTC (A-53)", async ({
    page,
    request,
  }, testInfo) => {
    const { token } = await createInvitation(request, { email: uniqueEmail() });

    await openInvitation(page, token);
    expect(new URL(page.url()).hash).toBe("");
    expect(page.url()).not.toContain(token);

    await page.getByRole("button", { name: catalogText("Use a password") }).click();
    await expect(page.locator("main h1")).toHaveText(catalogText("Set up your account"));
    if (testInfo.project.name === "chromium") {
      await expect(page.getByRole("combobox", { name: catalogText("Time zone") })).toHaveValue(
        "UTC (GMT)",
      );
    }
    await page.getByLabel(catalogText("Your name")).fill("Mona Hassan");
    await page.getByLabel(catalogText("Password")).fill(E2E_PASSWORD);
    const acceptSent = page.waitForRequest("**/api/v1/invitations/accept");
    await page.getByRole("button", { name: catalogText("Create account") }).click();
    const body = (await acceptSent).postDataJSON() as { timeZone?: unknown };
    if (testInfo.project.name === "chromium") expect(body.timeZone).toBe("UTC");
    await expect(page).toHaveURL(/\/$/);

    await expect(page.locator("main h1")).toHaveText(looseText("Welcome, Mona Hassan."));
    await expect(page.getByText(catalogText("Add your first account to start."))).toBeVisible();
    // app.documentTitle (A-26): no isolates; ar-XB's RLMs aside, exactly "{h1} – wDit".
    await expect.poll(() => page.title()).toMatch(/Welcome/);
    const title = await page.title();
    expect(title).not.toMatch(/[⁦-⁩]/);
    expect(title.replaceAll("\u200f", "")).toBe("Welcome, Mona Hassan. – wDit");
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

test.describe("TP-1.32: invitation problems (A-41, A-43, A-56, A-58)", () => {
  const INCOMPLETE =
    "This link isn't complete. Open it again from the email, or copy the whole link.";
  const ASK_DEV_OWNER = "Ask Dev Owner to send a new one.";
  const ASK_ANYONE = "Ask someone who already has an account to invite you again.";
  const STORED = "budmon.invite";

  /** The problem page: its h1, and exactly one primary Button, **Sign in**, linking to /sign-in. */
  async function expectProblemWithSignIn(page: Page): Promise<void> {
    await expect(page.locator("main h1")).toHaveText(catalogText("This invitation can't be used"));
    const signIn = page.locator("main").getByRole("link", { name: catalogText("Sign in") });
    await expect(signIn).toHaveAttribute("href", "/sign-in");
    expect(await primaryCount(page)).toBe(1);
    await expect(signIn).toHaveCSS("background-color", await accentRgb(page));
  }

  /** A-56 (b): a problem other than a failed load removes the stored token. */
  async function expectNothingStored(page: Page): Promise<void> {
    await expect.poll(() => page.evaluate((k) => sessionStorage.getItem(k), STORED)).toBeNull();
  }

  test("TP-1.32: an expired link from Dev Owner: 'It expired on {date}.' with the long date, 'Ask Dev Owner to send a new one.', Sign in, nothing stored", async ({
    page,
    request,
  }, testInfo) => {
    const { token } = await createInvitation(request, {
      email: uniqueEmail(),
      state: "expired",
      inviterEmail: "owner@budmon.local",
    });

    await page.goto(`/invite#t=${token}`);

    await expectProblemWithSignIn(page);
    const expired = page.getByText(/It expired on .+\.‏?$/);
    await expect(expired).toBeVisible();
    if (testInfo.project.name === "chromium") {
      // The test route stores expires_at = now − 1 day; chromium runs in UTC and en-US.
      const long = (ms: number) =>
        new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeZone: "UTC" }).format(ms);
      const yesterday = Date.now() - 24 * 3600 * 1000;
      expect([
        `It expired on ${long(yesterday)}.`,
        `It expired on ${long(yesterday - 60_000)}.`,
      ]).toContain((await expired.textContent())?.replace(/[⁦-⁩]/g, ""));
    } else {
      expect(await expired.textContent()).toMatch(/\d/);
    }
    await expect(page.getByText(looseText(ASK_DEV_OWNER))).toBeVisible();
    await expectNothingStored(page);
  });

  test("TP-1.32: a revoked link from Dev Owner: 'It was cancelled.', 'Ask Dev Owner to send a new one.', Sign in, nothing stored", async ({
    page,
    request,
  }) => {
    const { token } = await createInvitation(request, {
      email: uniqueEmail(),
      state: "revoked",
      inviterEmail: "owner@budmon.local",
    });

    await page.goto(`/invite#t=${token}`);

    await expectProblemWithSignIn(page);
    await expect(page.getByText(catalogText("It was cancelled."))).toBeVisible();
    await expect(page.getByText(looseText(ASK_DEV_OWNER))).toBeVisible();
    await expectNothingStored(page);
  });

  test("TP-1.32 (A-41): used just before (recent: true): 'Your account is ready. Sign in to continue.', no ask line, Sign in, nothing stored", async ({
    page,
    request,
  }) => {
    const email = uniqueEmail();
    const { token } = await createInvitation(request, {
      email,
      inviterEmail: "owner@budmon.local",
    });
    const accepted = await request.post("/api/v1/invitations/accept", {
      headers: { "X-Budmon-Client": "web/1" },
      data: {
        token,
        displayName: "Used Already",
        locale: "en",
        timeZone: "UTC",
        baseCurrency: "USD",
        method: { kind: "password", password: E2E_PASSWORD },
        tokenDelivery: "body",
      },
    });
    expect(accepted.status(), await accepted.text()).toBe(200);

    await page.goto(`/invite#t=${token}`);

    await expectProblemWithSignIn(page);
    await expect(
      page.getByText(catalogText("Your account is ready. Sign in to continue.")),
    ).toBeVisible();
    await expect(page.getByText(looseText(ASK_DEV_OWNER))).toHaveCount(0);
    await expect(page.getByText(catalogText(ASK_ANYONE))).toHaveCount(0);
    await expectNothingStored(page);
  });

  test("TP-1.32 (A-41, A-58): used earlier (recent: false): 'It has already been used. If that was you, sign in.', 'Ask Dev Owner to send a new one.', Sign in, nothing stored", async ({
    page,
  }) => {
    // The preview is answered here, so any well-formed token will do.
    const token = `bmi_${"U".repeat(43)}`;
    await page.route("**/api/v1/invitations/preview", (route) =>
      route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({
          defined: true,
          code: "INVITATION_USED",
          status: 409,
          message: "Invitation already used",
          data: { recent: false, inviterName: "Dev Owner", origin: "direct" },
        }),
      }),
    );

    await page.goto(`/invite#t=${token}`);

    await expectProblemWithSignIn(page);
    await expect(
      page.getByText(catalogText("It has already been used. If that was you, sign in.")),
    ).toBeVisible();
    await expect(page.getByText(looseText(ASK_DEV_OWNER))).toBeVisible();
    await expectNothingStored(page);
  });

  for (const [label, path] of [
    ["no fragment", "/invite"],
    ["an empty #t=", "/invite#t="],
    ["a malformed token", "/invite#t=bmi_short"],
  ] as const) {
    test(`TP-1.32 (A-43): an incomplete link (${label}): the incomplete text, no preview request, nothing stored`, async ({
      page,
    }) => {
      let previews = 0;
      page.on("request", (r) => {
        if (new URL(r.url()).pathname === "/api/v1/invitations/preview") previews += 1;
      });

      await page.goto(path);

      await expect(page.locator("main h1")).toHaveText(
        catalogText("This invitation can't be used"),
      );
      await expect(page.getByText(catalogText(INCOMPLETE))).toBeVisible();
      expect(previews).toBe(0);
      expect(await page.evaluate(() => sessionStorage.getItem("budmon.invite"))).toBeNull();
    });
  }

  // A-62: the opened link wins, so a token stored before the page loads is removed too.
  for (const [label, path] of [
    ["an empty #t=", "/invite#t="],
    ["a malformed token", "/invite#t=bmi_short"],
  ] as const) {
    test(`TP-1.32 (A-62): an incomplete link (${label}) with a token stored before the load: the incomplete text, no preview, the stored token removed`, async ({
      page,
    }) => {
      await page.addInitScript(
        ([key, token]) => {
          sessionStorage.setItem(key, JSON.stringify({ t: token, at: Date.now() }));
        },
        [STORED, `bmi_${"S".repeat(43)}`] as const,
      );
      let previews = 0;
      page.on("request", (r) => {
        if (new URL(r.url()).pathname === "/api/v1/invitations/preview") previews += 1;
      });

      await page.goto(path);

      await expect(page.locator("main h1")).toHaveText(
        catalogText("This invitation can't be used"),
      );
      await expect(page.getByText(catalogText(INCOMPLETE))).toBeVisible();
      expect(previews).toBe(0);
      await expectNothingStored(page);
    });
  }
});

test.describe("TP-1.37: the privacy notice", () => {
  const SECTIONS = [
    "What we keep",
    "Signing in with Google",
    "Emails we send",
    "Your data is yours",
    "Deleting your account",
    "If an address is banned",
    "What the administrator sees",
    "Questions",
  ];

  test("TP-1.37: /privacy has one h1 'Privacy notice' with the intro and 'Last updated', then exactly eight h2s in §8.3's order", async ({
    page,
  }) => {
    await page.goto("/privacy");

    const h1 = page.locator("main h1");
    await expect(h1).toHaveCount(1);
    await expect(h1).toHaveText(catalogText("Privacy notice"));
    await expect(page.locator("main")).toContainText("Last updated");
    const h2 = page.locator("main h2");
    await expect(h2).toHaveCount(8);
    for (const [i, title] of SECTIONS.entries()) {
      await expect(h2.nth(i)).toHaveText(catalogText(title));
    }
    // ar-XB adds RLMs around literal segments; the title is otherwise exact.
    await expect
      .poll(async () => (await page.title()).replaceAll("\u200f", ""))
      .toBe("Privacy notice – wDit");
  });

  test("TP-1.37: the set-up screen's privacy link opens /privacy (in a new tab, A-56)", async ({
    page,
    request,
  }) => {
    const { token } = await createInvitation(request, { email: uniqueEmail() });
    await openInvitation(page, token);
    await page.getByRole("button", { name: catalogText("Use a password") }).click();
    await expect(page.locator("main h1")).toHaveText(catalogText("Set up your account"));

    const link = page.locator("main").getByRole("link", { name: /privacy notice/ });
    const popup = page.waitForEvent("popup");
    await link.click();

    const notice = await popup;
    await expect(notice).toHaveURL(/\/privacy$/);
    await expect(notice.locator("main h1")).toHaveText(catalogText("Privacy notice"));
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
    await expect
      .poll(async () => (await page.title()).replaceAll("\u200f", ""))
      .toBe("Sign in – wDit");
  });

  test("TP-1.38x: the guarded / signed out redirects to /sign-in?next=/ with no request", async ({
    page,
  }) => {
    const seen = record(page);

    await page.goto("/");

    await expect(page).toHaveURL(/\/sign-in\?next=(%2F|\/)$/);
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

test.describe("TP-1.30x (review B-6): the stored invitation token (F-159)", () => {
  const STORED = "budmon.invite";

  /** The tokens sent to /api/v1/invitations/preview, in order. */
  function previews(page: Page): string[] {
    const sent: string[] = [];
    page.on("request", (r) => {
      if (new URL(r.url()).pathname !== "/api/v1/invitations/preview") return;
      const body = r.postDataJSON() as { token?: unknown } | null;
      sent.push(typeof body?.token === "string" ? body.token : "");
    });
    return sent;
  }

  test("TP-1.30x: after a successful accept the stored token is gone", async ({
    page,
    request,
  }) => {
    const { token } = await createInvitation(request, { email: uniqueEmail() });

    await openInvitation(page, token);
    expect(await page.evaluate((k) => sessionStorage.getItem(k), STORED)).not.toBeNull();
    await signUpThroughUi(page, token, "Stored Token");

    expect(await page.evaluate((k) => sessionStorage.getItem(k), STORED)).toBeNull();
  });

  test("TP-1.30x: /invite without a fragment within 30 minutes reuses the stored token (a preview is sent)", async ({
    page,
    request,
  }) => {
    const { token } = await createInvitation(request, { email: uniqueEmail() });
    const sent = previews(page);
    const start = Date.now();
    await page.clock.setFixedTime(start);
    await openInvitation(page, token);

    await page.clock.setFixedTime(start + 29 * 60_000);
    await page.goto("/invite");

    await expect(page.locator("main h1")).toHaveText(catalogText("You've been invited"));
    expect(sent).toEqual([token, token]);
  });

  test("TP-1.30x: after 30 minutes /invite without a fragment shows the incomplete problem, sends nothing and removes the entry", async ({
    page,
    request,
  }) => {
    const { token } = await createInvitation(request, { email: uniqueEmail() });
    const sent = previews(page);
    const start = Date.now();
    await page.clock.setFixedTime(start);
    await openInvitation(page, token);

    await page.clock.setFixedTime(start + 31 * 60_000);
    await page.goto("/invite");

    await expect(page.locator("main h1")).toHaveText(catalogText("This invitation can't be used"));
    await expect(
      page.getByText(
        catalogText(
          "This link isn't complete. Open it again from the email, or copy the whole link.",
        ),
      ),
    ).toBeVisible();
    expect(sent).toEqual([token]);
    expect(await page.evaluate((k) => sessionStorage.getItem(k), STORED)).toBeNull();
  });

  test("TP-1.30x: a valid fragment replaces an older stored token", async ({ page, request }) => {
    const first = await createInvitation(request, { email: uniqueEmail() });
    const second = await createInvitation(request, { email: uniqueEmail() });
    const sent = previews(page);
    await openInvitation(page, first.token);
    await openInvitation(page, second.token);

    await page.goto("/invite");

    await expect(page.locator("main h1")).toHaveText(catalogText("You've been invited"));
    expect(sent).toEqual([first.token, second.token, second.token]);
  });
});

test.describe("TP-1.45: no inviter (A-45)", () => {
  test("TP-1.45: join without an inviter reads 'This invitation is for {email}.', and no text starts with a space or 'invited'", async ({
    page,
    request,
  }) => {
    const email = uniqueEmail();
    const { token } = await createInvitation(request, { email });

    await openInvitation(page, token);

    await expect(page.getByText(looseText(`This invitation is for ${email}.`))).toBeVisible();
    const texts = await page
      .locator("main p, main span, main div")
      .evaluateAll((els) =>
        els.map((el) => el.textContent.replace(/[‏⁦-⁩]/g, "")).filter((t) => t !== ""),
      );
    expect(texts.filter((t) => /^\s|^invited/.test(t))).toEqual([]);
  });

  test("TP-1.45: join with inviterEmail owner@budmon.local reads 'Dev Owner invited {email} to join.'", async ({
    page,
    request,
  }) => {
    const email = uniqueEmail();
    const { token } = await createInvitation(request, {
      email,
      inviterEmail: "owner@budmon.local",
    });

    await openInvitation(page, token);

    await expect(page.getByText(looseText(`Dev Owner invited ${email} to join.`))).toBeVisible();
  });

  test("TP-1.45: an expired invitation without an inviter: 'Ask someone who already has an account to invite you again.'", async ({
    page,
    request,
  }) => {
    const { token } = await createInvitation(request, { email: uniqueEmail(), state: "expired" });

    await page.goto(`/invite#t=${token}`);

    await expect(page.locator("main h1")).toHaveText(catalogText("This invitation can't be used"));
    await expect(
      page.getByText(catalogText("Ask someone who already has an account to invite you again.")),
    ).toBeVisible();
  });

  test("TP-1.45: USER_CAP_REACHED without an inviter: the set-up form shows the no-inviter text", async ({
    page,
    request,
  }) => {
    const { token } = await createInvitation(request, { email: uniqueEmail() });
    await page.route("**/api/v1/invitations/accept", (route) =>
      route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({
          defined: true,
          code: "USER_CAP_REACHED",
          status: 409,
          message: "User cap reached",
        }),
      }),
    );
    await openInvitation(page, token);
    await page.getByRole("button", { name: catalogText("Use a password") }).click();
    await page.getByLabel(catalogText("Your name")).fill("Cap Check");
    await page.getByLabel(catalogText("Password")).fill(E2E_PASSWORD);

    await page.getByRole("button", { name: catalogText("Create account") }).click();

    await expect(page.locator("main h1")).toHaveText(catalogText("Set up your account"));
    await expect(
      page.getByText(
        catalogText("There's no room for new people right now. The administrator has been told."),
      ),
    ).toBeVisible();
  });
});

test.describe("TP-1.46: the sign-in shell's privacy link (A-47)", () => {
  test("TP-1.46: a link 'Privacy notice' after the invite-only note, href /privacy, not a primary button; it opens /privacy", async ({
    page,
  }) => {
    await page.goto("/sign-in");
    const note = page.getByText(
      catalogText("You need an invitation to join. Got one? Open the link in the email."),
    );
    const link = page.locator("main").getByRole("link", { name: catalogText("Privacy notice") });
    await expect(note).toBeVisible();
    await expect(link).toHaveAttribute("href", "/privacy");

    const after = await note.evaluate(
      (n, l) => Boolean(n.compareDocumentPosition(l) & Node.DOCUMENT_POSITION_FOLLOWING),
      await link.elementHandle(),
    );
    expect(after).toBe(true);
    expect(await primaryCount(page)).toBe(0);
    await expect(link).not.toHaveCSS("background-color", await accentRgb(page));

    await link.click();

    await expect(page).toHaveURL(/\/privacy$/);
    await expect(page.locator("main h1")).toHaveText(catalogText("Privacy notice"));
  });
});
