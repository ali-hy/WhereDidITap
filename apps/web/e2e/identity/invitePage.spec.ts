// F-159's S-1 QA fixes (identity LLD v0.32, A-52 to A-57): a later link in the same tab, long
// text at 360 px, focus on a step change, the set-up privacy link in a new tab, a signed-in visitor.
// TP-1.48, TP-1.51 to TP-1.54, TP-1.56 (a fragment without t, A-65), TP-1.57 to TP-1.59 (stale
// responses and a hashchange during an accept, A-64), and TP-1.32x (a bootstrap problem has no ask
// line, A-58; review B-2).
import {
  catalogText,
  createInvitation,
  E2E_PASSWORD,
  expect,
  looseText,
  openInvitation,
  signUpThroughUi,
  test,
  uniqueEmail,
  type Page,
} from "../identity.js";

const PREVIEW = "/api/v1/invitations/preview";
const STORED = "budmon.invite";

/** The number of preview requests from now on. */
function countPreviews(page: Page): { readonly n: number } {
  const seen = { n: 0 };
  page.on("request", (r) => {
    if (new URL(r.url()).pathname === PREVIEW) seen.n += 1;
  });
  return seen;
}

/** The number of sign-up-options requests from now on. */
function countSignUpOptions(page: Page): { readonly n: number } {
  const seen = { n: 0 };
  page.on("request", (r) => {
    if (new URL(r.url()).pathname === "/api/v1/auth/sign-up-options") seen.n += 1;
  });
  return seen;
}

/** `looseText(text)` without its start anchor: the text at the end of a string. */
const endsWithLoose = (text: string): RegExp => new RegExp(looseText(text).source.slice(1));

test.describe("TP-1.48: a later link in the same tab (A-52)", () => {
  test("TP-1.48: /invite (incomplete), then location.hash = #t=<token> → the join screen, one preview, the hash stripped; Back leaves no #t= in the URL", async ({
    page,
    request,
  }) => {
    const email = uniqueEmail();
    const { token } = await createInvitation(request, { email });
    const previews = countPreviews(page);
    await page.goto("/invite");
    await expect(page.locator("main h1")).toHaveText(catalogText("This invitation can't be used"));

    await page.evaluate((t) => {
      location.hash = `#t=${t}`;
    }, token);

    await expect(page.locator("main h1")).toHaveText(catalogText("You've been invited"));
    await expect(page.getByText(looseText(`This invitation is for ${email}.`))).toBeVisible();
    expect(previews.n).toBe(1);
    await expect.poll(() => page.evaluate(() => location.hash)).toBe("");

    await page.goBack();

    expect(page.url()).not.toContain("#t=");
    expect(page.url()).not.toContain(token);
  });
});

test.describe("TP-1.51: long text at 360 px (A-54)", () => {
  const EMAIL = `${"a".repeat(88)}@example.test`;
  const INVITER = "N".repeat(80);

  /** No horizontal page overflow, and the element lies inside the viewport, wrapped in its box. */
  async function expectWrappedInside(page: Page, text: RegExp): Promise<void> {
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      360,
    );
    const line = page.locator("main").getByText(text);
    await expect(line).toBeVisible();
    const box = await line.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right, scroll: el.scrollWidth, client: el.clientWidth };
    });
    expect(box.left).toBeGreaterThanOrEqual(0);
    expect(box.right).toBeLessThanOrEqual(360);
    expect(box.scroll).toBeLessThanOrEqual(box.client);
  }

  test("TP-1.51: a 100-character email and an 80-character inviter name wrap on join and set-up; scrollWidth ≤ 360", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    // The preview is answered here, so any well-formed token will do.
    const token = `bmi_${"L".repeat(43)}`;
    await page.route(`**${PREVIEW}`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          invitationId: "0190a0b0-0000-7000-8000-000000000051",
          email: EMAIL,
          inviterName: INVITER,
          expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
          origin: "direct",
        }),
      }),
    );

    await page.goto(`/invite#t=${token}`);
    await expect(page.locator("main h1")).toHaveText(catalogText("You've been invited"));

    await expectWrappedInside(page, looseText(`${INVITER} invited ${EMAIL} to join.`));

    await page.getByRole("button", { name: catalogText("Use a password") }).click();
    await expect(page.locator("main h1")).toHaveText(catalogText("Set up your account"));

    await expectWrappedInside(page, new RegExp(EMAIL.replaceAll(".", "\\.")));
  });
});

test.describe("TP-1.52: focus on a step change (A-55)", () => {
  test("TP-1.52: on load the join h1 has focus; after Use a password, the h1 'Set up your account' (not BODY)", async ({
    page,
    request,
  }) => {
    const { token } = await createInvitation(request, { email: uniqueEmail() });

    await openInvitation(page, token);

    const h1 = page.locator("main h1");
    await expect(h1).toBeFocused();

    await page.getByRole("button", { name: catalogText("Use a password") }).click();

    await expect(h1).toHaveText(catalogText("Set up your account"));
    await expect(h1).toBeFocused();
    expect(await page.evaluate(() => document.activeElement?.tagName)).toBe("H1");
  });
});

test.describe("TP-1.53: the set-up privacy link opens in a new tab (A-56)", () => {
  test("TP-1.53: the link's name ends with '(opens in a new tab)'; activating it opens /privacy in a popup; the set-up page keeps the typed name", async ({
    page,
    request,
  }) => {
    const { token } = await createInvitation(request, { email: uniqueEmail() });
    await openInvitation(page, token);
    await page.getByRole("button", { name: catalogText("Use a password") }).click();
    await expect(page.locator("main h1")).toHaveText(catalogText("Set up your account"));
    const name = page.getByLabel(catalogText("Your name"));
    await name.fill("Mona Hassan");
    const link = page.locator("main").getByRole("link", { name: /privacy notice/ });

    await expect(link).toHaveAccessibleName(endsWithLoose("(opens in a new tab)"));
    await expect(link).toHaveAttribute("href", "/privacy");
    await expect(link).toHaveAttribute("target", "_blank");
    expect(await link.getAttribute("rel")).toContain("noopener");

    const popup = page.waitForEvent("popup");
    await link.click();

    const notice = await popup;
    await expect(notice).toHaveURL(/\/privacy$/);
    await expect(notice.locator("main h1")).toHaveText(catalogText("Privacy notice"));
    await expect(page).toHaveURL(/\/invite$/);
    await expect(page.locator("main h1")).toHaveText(catalogText("Set up your account"));
    await expect(name).toHaveValue("Mona Hassan");
  });
});

test.describe("TP-1.54: a signed-in visitor on /invite goes home (A-57)", () => {
  test("TP-1.54: signed in, /invite#t=<another token> and then /invite land on / with no preview, no #t= in the URL or history, nothing stored", async ({
    page,
    request,
  }) => {
    const first = await createInvitation(request, { email: uniqueEmail() });
    await signUpThroughUi(page, first.token, "Signed In");
    const second = await createInvitation(request, { email: uniqueEmail() });
    const previews = countPreviews(page);

    await page.goto(`/invite#t=${second.token}`);

    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator("main h1")).toHaveText(looseText("Welcome, Signed In."));
    expect(page.url()).not.toContain("#t=");
    expect(await page.evaluate((k) => sessionStorage.getItem(k), STORED)).toBeNull();
    // The /invite entry was replaced by /, so going back can't reach the token.
    await page.goBack();
    expect(page.url()).not.toContain("#t=");
    expect(page.url()).not.toContain(second.token);

    await page.goto("/invite");

    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator("main h1")).toHaveText(looseText("Welcome, Signed In."));
    expect(await page.evaluate((k) => sessionStorage.getItem(k), STORED)).toBeNull();
    expect(previews.n).toBe(0);
  });
});

test.describe("TP-1.32x: a bootstrap invitation's problem has no ask line (A-58, review B-2)", () => {
  for (const [code, status, message, data, text] of [
    [
      "INVITATION_REVOKED",
      410,
      "Invitation revoked",
      { inviterName: null, origin: "bootstrap" },
      "It was cancelled.",
    ],
    [
      "INVITATION_EXPIRED",
      410,
      "Invitation expired",
      { expiredAt: "2026-11-01T10:00:00.000Z", inviterName: null, origin: "bootstrap" },
      null,
    ],
  ] as const) {
    test(`TP-1.32x: ${code} with origin bootstrap shows neither askInviter nor askAnyone`, async ({
      page,
    }) => {
      // The preview is answered here, so any well-formed token will do.
      const token = `bmi_${"B".repeat(43)}`;
      await page.route(`**${PREVIEW}`, (route) =>
        route.fulfill({
          status,
          contentType: "application/json",
          body: JSON.stringify({ defined: true, code, status, message, data }),
        }),
      );

      await page.goto(`/invite#t=${token}`);

      await expect(page.locator("main h1")).toHaveText(
        catalogText("This invitation can't be used"),
      );
      if (text === null) await expect(page.getByText(/It expired on /)).toBeVisible();
      else await expect(page.getByText(catalogText(text))).toBeVisible();
      await expect(page.locator("main").getByText(/Ask /)).toHaveCount(0);
      await expect(
        page.getByText(catalogText("Ask someone who already has an account to invite you again.")),
      ).toHaveCount(0);
    });
  }
});

test.describe("TP-1.56: a fragment without t changes nothing (A-65)", () => {
  test("TP-1.56: on set-up with a typed name, location.hash = #main keeps set-up and the name, sends no preview or sign-up-options request, leaves focus off the h1, and keeps #main", async ({
    page,
    request,
  }) => {
    const { token } = await createInvitation(request, { email: uniqueEmail() });
    await openInvitation(page, token);
    await page.getByRole("button", { name: catalogText("Use a password") }).click();
    const h1 = page.locator("main h1");
    await expect(h1).toHaveText(catalogText("Set up your account"));
    const password = page.getByLabel(catalogText("Password"));
    const name = page.getByLabel(catalogText("Your name"));
    await password.fill(E2E_PASSWORD);
    await name.fill("Mona Hassan");
    const previews = countPreviews(page);
    const options = countSignUpOptions(page);

    // Waits for the page's hashchange and two frames, so any handler has run.
    await page.evaluate(async () => {
      const fired = new Promise((resolve) => {
        addEventListener("hashchange", resolve, { once: true });
      });
      location.hash = "#main";
      await fired;
      await new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
      });
    });

    await expect(h1).toHaveText(catalogText("Set up your account"));
    await expect(name).toHaveValue("Mona Hassan");
    await expect(password).toHaveValue(E2E_PASSWORD);
    await expect(h1).not.toBeFocused();
    expect(await page.evaluate(() => location.hash)).toBe("#main");
    expect(previews.n).toBe(0);
    expect(options.n).toBe(0);
  });
});

test.describe("TP-1.57 to TP-1.59: stale responses and a hashchange during an accept (A-64)", () => {
  test("TP-1.57: #t=<A> with A's preview delayed 2 s, then at once #t=<B>: join shows B's email after A's response arrives; the join h1 gets focus once", async ({
    page,
    request,
  }) => {
    const emailA = uniqueEmail();
    const emailB = uniqueEmail();
    const a = await createInvitation(request, { email: emailA });
    const b = await createInvitation(request, { email: emailB });
    await page.route(`**${PREVIEW}`, async (route) => {
      const body = route.request().postDataJSON() as { token?: unknown } | null;
      if (body?.token === a.token) await new Promise((resolve) => setTimeout(resolve, 2_000));
      // The page may have aborted A's request meanwhile; ignoring it is fine too.
      await route.continue().catch(() => undefined);
    });
    // The text of every h1 that receives focus, in order.
    await page.addInitScript(() => {
      const w = window as unknown as { h1Focus: string[] };
      w.h1Focus = [];
      document.addEventListener("focusin", (e) => {
        if (e.target instanceof HTMLHeadingElement && e.target.tagName === "H1") {
          w.h1Focus.push(e.target.textContent);
        }
      });
    });
    const aSent = page.waitForRequest(
      (r) =>
        new URL(r.url()).pathname === PREVIEW &&
        (r.postDataJSON() as { token?: unknown } | null)?.token === a.token,
    );

    await page.goto(`/invite#t=${a.token}`);
    const aRequest = await aSent;
    await page.evaluate((t) => {
      location.hash = `#t=${t}`;
    }, b.token);
    // A's response (or null when the page aborted it), then a moment for the page to handle it.
    await aRequest.response();
    await page.evaluate(
      () =>
        new Promise((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(resolve));
        }),
    );

    await expect(page.locator("main h1")).toHaveText(catalogText("You've been invited"));
    await expect(page.getByText(looseText(`This invitation is for ${emailB}.`))).toBeVisible();
    await expect(page.getByText(new RegExp(emailA.replaceAll(".", "\\.")))).toHaveCount(0);
    const focused = await page.evaluate(() => (window as unknown as { h1Focus: string[] }).h1Focus);
    expect(focused.filter((t) => looseText("You've been invited").test(t))).toHaveLength(1);
  });

  /** Records the text of every h1 that receives focus, from page load on. */
  async function recordH1Focus(page: Page): Promise<void> {
    await page.addInitScript(() => {
      const w = window as unknown as { h1Focus: string[] };
      w.h1Focus = [];
      document.addEventListener("focusin", (e) => {
        if (e.target instanceof HTMLHeadingElement && e.target.tagName === "H1") {
          w.h1Focus.push(e.target.textContent);
        }
      });
    });
  }

  const h1Focus = (page: Page): Promise<string[]> =>
    page.evaluate(() => (window as unknown as { h1Focus: string[] }).h1Focus);

  /** Two animation frames, so the page has handled whatever just arrived. */
  const settle = (page: Page): Promise<unknown> =>
    page.evaluate(
      () =>
        new Promise((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(resolve));
        }),
    );

  test("TP-1.58: #t=<B> during A's accept (delayed 2 s): the fragment is stripped at once, no preview or sign-up-options request, set-up stays busy until the accept answers, then / with nothing stored", async ({
    page,
    request,
  }) => {
    const a = await createInvitation(request, { email: uniqueEmail() });
    const b = await createInvitation(request, { email: uniqueEmail() });
    await page.route("**/api/v1/invitations/accept", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      await route.continue();
    });
    await openInvitation(page, a.token);
    await page.getByRole("button", { name: catalogText("Use a password") }).click();
    const h1 = page.locator("main h1");
    await expect(h1).toHaveText(catalogText("Set up your account"));
    await page.getByLabel(catalogText("Your name")).fill("Mona Hassan");
    await page.getByLabel(catalogText("Password")).fill(E2E_PASSWORD);
    const acceptSent = page.waitForRequest("**/api/v1/invitations/accept");
    const submit = page.getByRole("button", { name: catalogText("Create account") });
    await submit.click();
    const accept = await acceptSent;
    const previews = countPreviews(page);
    const options = countSignUpOptions(page);

    await page.evaluate((t) => {
      location.hash = `#t=${t}`;
    }, b.token);

    // Within the accept's 2 s: stripped, still set-up, busy.
    await expect.poll(() => page.evaluate(() => location.hash), { timeout: 1_000 }).toBe("");
    await expect(h1).toHaveText(catalogText("Set up your account"));
    await expect(submit).toHaveAttribute("aria-busy", "true");
    expect(accept.failure()).toBeNull();

    expect((await accept.response())?.status()).toBe(200);
    await expect(page).toHaveURL(/\/$/);
    expect(await page.evaluate((k) => sessionStorage.getItem(k), STORED)).toBeNull();
    expect(previews.n).toBe(0);
    expect(options.n).toBe(0);
  });

  test("TP-1.59: Use a password on A with sign-up-options delayed 2 s, then at once #t=<B>: B's join stays after the response lands, with no set-up and one focus move", async ({
    page,
    request,
  }) => {
    const emailB = uniqueEmail();
    const a = await createInvitation(request, { email: uniqueEmail() });
    const b = await createInvitation(request, { email: emailB });
    await page.route("**/api/v1/auth/sign-up-options", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      // The page may have aborted it meanwhile; ignoring it is fine too.
      await route.continue().catch(() => undefined);
    });
    await recordH1Focus(page);
    await openInvitation(page, a.token);
    const optionsSent = page.waitForRequest("**/api/v1/auth/sign-up-options");
    await page.getByRole("button", { name: catalogText("Use a password") }).click();
    const optionsRequest = await optionsSent;
    await page.evaluate(() => {
      (window as unknown as { h1Focus: string[] }).h1Focus = [];
    });

    await page.evaluate((t) => {
      location.hash = `#t=${t}`;
    }, b.token);
    await expect(page.getByText(looseText(`This invitation is for ${emailB}.`))).toBeVisible();
    // A's response (or null when the page aborted it), then a moment for the page to handle it.
    await optionsRequest.response();
    await settle(page);

    const h1 = page.locator("main h1");
    await expect(h1).toHaveText(catalogText("You've been invited"));
    await expect(page.getByText(looseText(`This invitation is for ${emailB}.`))).toBeVisible();
    await expect(page.getByLabel(catalogText("Your name"))).toHaveCount(0);
    const focused = await h1Focus(page);
    expect(focused.filter((t) => looseText("You've been invited").test(t))).toHaveLength(1);
    expect(focused.filter((t) => looseText("Set up your account").test(t))).toEqual([]);
  });
});
