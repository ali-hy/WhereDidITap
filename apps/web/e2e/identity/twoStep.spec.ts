// S-4 two-step verification in the browser (identity LLD §8.1, F-156, F-164, F-165, F-166; HLD J-5,
// J-7, J-15, J-21; A-99 to A-104): TP-4.30 to TP-4.33, TP-4.39, TP-4.43, TP-4.44, TP-4.46, plus
// extra cases ending in "x".
// TP-4.49 (A-107: S-4 QA's gaps), with axe while a toast shows (A-541) and the step-up lapsing
// during a setup the server finds expired.
// IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
//
// Each test signs up its own user and turns two-step on from Sign-in & security's Turn on (§10.1);
// codes come from TestAuthenticator, which may wait for the next 30-second step, hence the longer
// timeout. TP-4.39's sign-in page cases route the first factor instead (no real two-step needed).
import { readFile } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import type { Locator } from "@playwright/test";
import {
  catalogText,
  createInvitation,
  createUser,
  enableTwoStep,
  expect,
  isPost,
  looseText,
  RECOVERY_CODE,
  signInByApi,
  signOutFromMenu,
  signUpThroughUi,
  submitSignIn,
  test,
  TestAuthenticator,
  toastWith,
  twoStepSection,
  uniqueEmail,
  unconfirmSessions,
  WEB_CLIENT,
  E2E_PASSWORD,
  type Page,
} from "../identity.js";

test.describe.configure({ timeout: 120_000 });

const WRONG_CODE = "That code didn't work. Check your app and try again.";
const TOO_MANY = "Too many attempts. Sign in again.";
const TIMED_OUT = "This sign-in timed out. Sign in again.";
const NEW_CODES_DONE = "Your old codes no longer work.";
const CONFIRM_ITS_YOU = "Confirm it's you";
/** F-166's code field (A-107 G-2: confirm.code); the sign-in and Turn off fields stay "Code". */
const STEP_UP_CODE = "Code from your authenticator app";
const TWO_STEP_ON =
  "Two-step verification is on. Your other devices have been signed out and will ask for a code next time.";
const UNSAVED = "You may not have saved your recovery codes.";

/** The current URL's path. */
const here = (page: Page) => new URL(page.url()).pathname;

/** A user signed up through the UI in `page` (signed in); returns its email and name. */
async function signedUpUser(
  page: Page,
  request: Parameters<typeof createInvitation>[0],
  name: string,
): Promise<{ email: string; name: string }> {
  const email = uniqueEmail();
  const { token } = await createInvitation(request, { email });
  await signUpThroughUi(page, token, name);
  return { email, name };
}

/** Signs out from the menu, then signs in with the password; waits for the two-step page. */
async function signInToTwoStep(page: Page, email: string): Promise<void> {
  await signOutFromMenu(page);
  await expect(page).toHaveURL(/\/sign-in/);
  await submitSignIn(page, email);
  await expect(page).toHaveURL(/\/sign-in\/two-step$/);
  await expect(page.locator("main h1")).toHaveText(looseText("Two-step verification"));
}

const codeField = (page: Page) => page.locator("main").getByLabel(catalogText("Code"));
/** F-166's dialog (its title "Confirm it's you"). */
const confirmDialog = (page: Page) =>
  page.getByRole("dialog").filter({ has: page.getByText(catalogText(CONFIRM_ITS_YOU)) });

/** A promise the test resolves when it chooses (a held route's release). */
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const json = (status: number, body: unknown) => ({
  status,
  contentType: "application/json",
  body: JSON.stringify(body),
});

/** Routes auth.signIn to answer two_step_required (cookie delivery) and submits the sign-in form. */
async function routedSignInToTwoStep(page: Page, email: string): Promise<void> {
  await page.route("**/api/v1/auth/sign-in", (route) =>
    route.fulfill(
      json(200, {
        status: "two_step_required",
        challengeToken: null,
        expiresAt: new Date(Date.now() + 300_000).toISOString(),
      }),
    ),
  );
  await submitSignIn(page, email);
  await expect(page).toHaveURL(/\/sign-in\/two-step$/);
}
const verifyButton = (page: Page) =>
  page.locator("main").getByRole("button", { name: catalogText("Verify") });

test.describe("TP-4.30: sign-in with two-step (F-156; §8.1 'Two-step wrong code')", () => {
  test("TP-4.30: a two-step user signs in with a password, then the code from the known secret, and lands on home", async ({
    page,
    request,
  }) => {
    const { email, name } = await signedUpUser(page, request, "Two Step Person");
    const { auth } = await enableTwoStep(page, { acknowledge: true });
    await signInToTwoStep(page, email);

    await expect(
      page
        .locator("main")
        .getByText(looseText("Enter the 6-digit code from your authenticator app.")),
    ).toBeVisible();
    await expect(codeField(page)).toHaveAttribute("inputmode", "numeric");
    await expect(codeField(page)).toHaveAttribute("autocomplete", "one-time-code");
    const verify = page.waitForResponse(isPost("/api/v1/auth/two-step/verify"));
    await codeField(page).fill(await auth.nextCode());
    await verifyButton(page).click();

    const answer = await verify;
    expect(answer.status(), await answer.text()).toBe(200);
    expect(((await answer.json()) as { status: string }).status).toBe("signed_in");
    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator("main h1")).toHaveText(looseText(`Welcome, ${name}.`));
  });

  test("TP-4.30, TP-4.39 (b): a wrong code shows 'That code didn't work…' with the field cleared and refocused; the fifth wrong code (TWO_STEP_CHALLENGE_EXPIRED too_many_attempts) ends on /sign-in?reason=two_step_too_many with 'Too many attempts. Sign in again.'", async ({
    page,
    request,
  }) => {
    const { email } = await signedUpUser(page, request, "Wrong Code Person");
    const { auth } = await enableTwoStep(page, { acknowledge: true });
    await signInToTwoStep(page, email);

    for (let attempt = 1; attempt <= 4; attempt += 1) {
      const verify = page.waitForResponse(isPost("/api/v1/auth/two-step/verify"));
      await codeField(page).fill(auth.wrongCode());
      await verifyButton(page).click();
      const answer = await verify;
      expect(answer.status()).toBe(400);
      expect(await answer.json()).toMatchObject({
        code: "TWO_STEP_CODE_INVALID",
        data: { attemptsLeft: 5 - attempt },
      });

      await expect(page.locator("main").getByText(looseText(WRONG_CODE))).toBeVisible();
      await expect(codeField(page)).toHaveValue("");
      await expect(codeField(page)).toBeFocused();
      expect(here(page)).toBe("/sign-in/two-step");
    }

    const fifth = page.waitForResponse(isPost("/api/v1/auth/two-step/verify"));
    await codeField(page).fill(auth.wrongCode());
    await verifyButton(page).click();

    const answer = await fifth;
    expect(answer.status()).toBe(401);
    expect(await answer.json()).toMatchObject({
      code: "TWO_STEP_CHALLENGE_EXPIRED",
      data: { reason: "too_many_attempts" },
    });
    await expect(page).toHaveURL(/\/sign-in\?reason=two_step_too_many$/);
    await expect(page.locator("main h1")).toHaveText(looseText("Sign in"));
    await expect(page.locator("main").getByText(looseText(TOO_MANY))).toBeVisible();
    await expect(page.locator("main").getByText(looseText(TIMED_OUT))).toHaveCount(0);
  });

  test("TP-4.30x: a recovery code via 'Use a recovery code instead' signs in and shows 'You used a recovery code. 9 codes left.'", async ({
    page,
    request,
  }) => {
    // HLD J-5: after a recovery code the user sees how many are left (§8.1 twostep.recoveryLeft).
    const { email, name } = await signedUpUser(page, request, "Recovery Person");
    const { codes } = await enableTwoStep(page, { acknowledge: true });
    await signInToTwoStep(page, email);

    await page.locator("main").getByText(catalogText("Use a recovery code instead")).click();
    const recoveryField = page.locator("main").getByLabel(catalogText("Recovery code"));
    await expect(recoveryField).toBeVisible();
    await expect(codeField(page)).toHaveCount(0);
    const verify = page.waitForResponse(isPost("/api/v1/auth/two-step/verify"));
    await recoveryField.fill(codes[0] ?? "");
    await verifyButton(page).click();

    const answer = await verify;
    expect(answer.status(), await answer.text()).toBe(200);
    expect(await answer.json()).toMatchObject({ status: "signed_in", recoveryCodesLeft: 9 });
    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator("main h1")).toHaveText(looseText(`Welcome, ${name}.`));
    await expect(
      toastWith(page, looseText("You used a recovery code. 9 codes left.")).first(),
    ).toBeVisible();
  });
});

test.describe("TP-4.31: step-up with a two-step code (F-166's two_step factor)", () => {
  test("TP-4.31, TP-4.39 (e): after unconfirm, Create new codes asks for a code; Confirm sends it and, without another click, a dialog shows the ten new codes with 'Your old codes no longer work.' as text in it, not a toast; ticking the box and Done calls me.acknowledgeRecoveryCodes and closes the dialog", async ({
    page,
    request,
  }) => {
    const { email } = await signedUpUser(page, request, "Step Up Person");
    const { auth, codes: oldCodes } = await enableTwoStep(page, { acknowledge: true });
    await unconfirmSessions(request, email);
    await page.goto("/settings/security");
    await expect(page.locator("main h1")).toHaveText(looseText("Sign-in & security"));
    const regenerate: number[] = [];
    page.on("response", (r) => {
      if (isPost("/api/v1/me/two-step/recovery-codes")(r)) regenerate.push(r.status());
    });
    const confirmBodies: unknown[] = [];
    page.on("request", (r) => {
      if (new URL(r.url()).pathname === "/api/v1/me/confirm") confirmBodies.push(r.postDataJSON());
    });

    await page
      .locator("main")
      .getByRole("button", { name: catalogText("Create new codes") })
      .click();

    const dialog = confirmDialog(page);
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel(catalogText(STEP_UP_CODE))).toBeVisible();
    await expect(dialog.getByLabel(catalogText("Password"))).toHaveCount(0);
    await expect(dialog.getByRole("button", { name: catalogText("Verify") })).toHaveCount(0);
    const code = await auth.nextCode();
    const fresh = page.waitForResponse(
      (r) => isPost("/api/v1/me/two-step/recovery-codes")(r) && r.status() === 200,
    );
    await dialog.getByLabel(catalogText(STEP_UP_CODE)).fill(code);
    await dialog.getByRole("button", { name: catalogText("Confirm") }).click();

    const answer = await fresh;
    const { recoveryCodes } = (await answer.json()) as { recoveryCodes: string[] };
    await expect(dialog).toHaveCount(0);
    expect(regenerate).toEqual([403, 200]);
    expect(confirmBodies).toEqual([{ code }]);
    expect(recoveryCodes).toHaveLength(10);
    // A-99 W5: the codes in a dialog on this page, newCodesDone inline in it.
    const codesDialog = page.getByRole("dialog").filter({ hasText: NEW_CODES_DONE });
    await expect(codesDialog).toBeVisible();
    await expect(codesDialog.getByText(looseText(NEW_CODES_DONE))).toBeVisible();
    for (const c of recoveryCodes) {
      expect(c).toMatch(RECOVERY_CODE);
      expect(oldCodes).not.toContain(c);
      await expect(codesDialog.getByText(c)).toBeVisible();
    }
    expect(new URL(page.url()).pathname).toBe("/settings/security");
    // The dialog's text is the only one outside the live regions: no toast.
    await expect(toastWith(page, looseText(NEW_CODES_DONE))).toHaveCount(1);

    // A-100 (2): Done (enabled once ticked) acknowledges, then closes the dialog.
    const acks: number[] = [];
    page.on("response", (r) => {
      if (isPost("/api/v1/me/two-step/acknowledge-codes")(r)) acks.push(r.status());
    });
    const done = codesDialog.getByRole("button", { name: catalogText("Done") });
    await expect(done).toBeDisabled();
    await codesDialog
      .getByRole("checkbox", { name: catalogText("I've saved my recovery codes") })
      .check();
    await expect(done).toBeEnabled();
    const ack = page.waitForResponse(isPost("/api/v1/me/two-step/acknowledge-codes"));
    await done.click();

    const ackAnswer = await ack;
    expect(ackAnswer.status(), await ackAnswer.text()).toBe(200);
    expect(await ackAnswer.json()).toEqual({ ok: true });
    await expect(codesDialog).toHaveCount(0);
    expect(acks).toEqual([200]);
    expect(here(page)).toBe("/settings/security");
  });

  test("TP-4.31x: Escape cancels the step-up: the dialog closes and no new codes are created", async ({
    page,
    request,
  }) => {
    // §8.1 Step-up: "Escape cancels"; F-166: cancel → undefined, run() isn't retried.
    const { email } = await signedUpUser(page, request, "Escape Person");
    await enableTwoStep(page, { acknowledge: true });
    await unconfirmSessions(request, email);
    await page.goto("/settings/security");
    await expect(page.locator("main h1")).toHaveText(looseText("Sign-in & security"));
    const regenerate: number[] = [];
    page.on("response", (r) => {
      if (isPost("/api/v1/me/two-step/recovery-codes")(r)) regenerate.push(r.status());
    });

    await page
      .locator("main")
      .getByRole("button", { name: catalogText("Create new codes") })
      .click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByLabel(catalogText(STEP_UP_CODE))).toBeFocused();
    await page.keyboard.press("Escape");

    await expect(dialog).toBeHidden();
    expect(regenerate).toEqual([403]);
    await expect(page.getByText(RECOVERY_CODE)).toHaveCount(0);
  });
});

test.describe("TP-4.32: recovery codes are shown once (F-165)", () => {
  test("TP-4.32: reloading on the codes step: me.twoStepSetup answers TWO_STEP_ALREADY_ENABLED and the page replaces itself with /settings/security, which shows 'You may not have saved your recovery codes.'; the codes are gone", async ({
    page,
    request,
  }) => {
    await signedUpUser(page, request, "Reload Person");
    const { codes } = await enableTwoStep(page, { acknowledge: false });
    const historyLength = await page.evaluate(() => history.length);
    const setup = page.waitForResponse(isPost("/api/v1/me/two-step/setup"));

    await page.reload();

    const answer = await setup;
    expect(answer.status()).toBe(409);
    expect(await answer.json()).toMatchObject({ code: "TWO_STEP_ALREADY_ENABLED" });
    await expect(page).toHaveURL(/\/settings\/security$/);
    await expect(page.locator("main h1")).toHaveText(looseText("Sign-in & security"));
    await expect(page.locator("main").getByText(looseText(UNSAVED))).toBeVisible();
    for (const code of codes) await expect(page.getByText(code)).toHaveCount(0);
    // navigate({ replace: true }): no history entry added.
    expect(await page.evaluate(() => history.length)).toBe(historyLength);
  });

  test("TP-4.32x: turning on from Turn on: QR with its alt text, the grouped key, Step 1 of 2; ten LTR codes; Download saves budmon-recovery-codes.txt; Done waits for the checkbox and returns with the 'on' toast; a password sign-in now needs a code", async ({
    page,
    request,
  }) => {
    // F-165 and HLD J-7 end to end; the helper does the same steps without these checks.
    const { email } = await signedUpUser(page, request, "Turn On Person");
    await page.goto("/settings/security");
    await expect(page.locator("main h1")).toHaveText(looseText("Sign-in & security"));
    const setup = page.waitForResponse(isPost("/api/v1/me/two-step/setup"));
    await twoStepSection(page)
      .getByRole("button", { name: catalogText("Turn on") })
      .click();
    await expect(page).toHaveURL(/\/settings\/security\/two-step$/);
    const { secret } = (await (await setup).json()) as { secret: string };

    const main = page.locator("main");
    await expect(main.locator("h1")).toHaveText(looseText("Turn on two-step verification"));
    await expect(main.getByText(looseText("Step 1 of 2"))).toBeVisible();
    await expect(
      main.getByRole("img", {
        name: catalogText(
          "QR code for your authenticator app. Use the key below if you can't scan.",
        ),
      }),
    ).toBeVisible();
    expect(secret).toMatch(/^([A-Z2-7]{4} )*[A-Z2-7]{1,4}$/);
    await expect(main.getByText(secret, { exact: true })).toBeVisible();
    await expect(main.getByText(looseText("Can't scan? Enter this key instead:"))).toBeVisible();
    await expect(main.getByRole("button", { name: catalogText("Copy") })).toBeVisible();

    const auth = TestAuthenticator.fromKey(secret);
    const enable = page.waitForResponse(isPost("/api/v1/me/two-step/enable"));
    await main.getByLabel(catalogText("Code")).fill(await auth.nextCode());
    await main.getByRole("button", { name: catalogText("Verify and turn on") }).click();
    const { recoveryCodes } = (await (await enable).json()) as { recoveryCodes: string[] };

    await expect(page.getByText(catalogText("Save your recovery codes"))).toBeVisible();
    expect(recoveryCodes).toHaveLength(10);
    for (const code of recoveryCodes) {
      expect(code).toMatch(RECOVERY_CODE);
      const shown = page.getByText(code).first();
      await expect(shown).toBeVisible();
      expect(await shown.evaluate((el) => getComputedStyle(el).direction)).toBe("ltr");
    }

    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: catalogText("Download") }).click();
    const file = await download;
    expect(file.suggestedFilename()).toBe("budmon-recovery-codes.txt");
    const text = await readFile(await file.path(), "utf8");
    for (const code of recoveryCodes) expect(text).toContain(code);

    const done = page.getByRole("button", { name: catalogText("Done") });
    await expect(done).toBeDisabled();
    const ack = page.waitForResponse(isPost("/api/v1/me/two-step/acknowledge-codes"));
    await page.getByRole("checkbox", { name: catalogText("I've saved my recovery codes") }).check();
    await expect(done).toBeEnabled();
    await done.click();

    expect((await ack).status()).toBe(200);
    await expect(page).toHaveURL(/\/settings\/security$/);
    await expect(toastWith(page, looseText(TWO_STEP_ON)).first()).toBeVisible();
    await expect(page.locator("main").getByText(looseText(UNSAVED))).toHaveCount(0);
    const signIn = await request.post("/api/v1/auth/sign-in", {
      headers: WEB_CLIENT,
      data: { email, password: E2E_PASSWORD, tokenDelivery: "body" },
    });
    expect(signIn.status()).toBe(200);
    expect(((await signIn.json()) as { status: string }).status).toBe("two_step_required");
  });
});

test.describe("TP-4.33: turning two-step off (F-164)", () => {
  test("TP-4.33: Turn off opens a confirmation dialog with a code field; with a code, two-step is off and a password sign-in no longer asks for one", async ({
    page,
    request,
  }) => {
    const { email } = await signedUpUser(page, request, "Turn Off Person");
    const { auth } = await enableTwoStep(page, { acknowledge: true });
    await expect(page.locator("main h1")).toHaveText(looseText("Sign-in & security"));
    const disableBodies: unknown[] = [];
    page.on("request", (r) => {
      if (new URL(r.url()).pathname === "/api/v1/me/two-step/disable")
        disableBodies.push(r.postDataJSON());
    });

    await page
      .locator("main")
      .getByRole("button", { name: catalogText("Turn off") })
      .click();

    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByText(
        looseText(
          "Turn off two-step verification? Your account will be protected by your password only.",
        ),
      ),
    ).toBeVisible();
    const code = await auth.nextCode();
    const disable = page.waitForResponse(isPost("/api/v1/me/two-step/disable"));
    await dialog.getByLabel(catalogText("Code")).fill(code);
    await dialog.getByRole("button", { name: catalogText("Turn off") }).click();

    const answer = await disable;
    expect(answer.status(), await answer.text()).toBe(200);
    expect(disableBodies).toEqual([{ code }]);
    await expect(dialog).toBeHidden();
    await expect(toastWith(page, looseText("Two-step verification is off.")).first()).toBeVisible();
    await expect(
      page.locator("main").getByRole("button", { name: catalogText("Turn off") }),
    ).toHaveCount(0);
    await expect(
      page.locator("main").getByRole("button", { name: catalogText("Create new codes") }),
    ).toHaveCount(0);
    // signInByApi expects status "signed_in" (no two-step challenge).
    await signInByApi(request, email);
  });
});

test.describe("TP-4.39: two-step focus, end messages and S-10's two-step section (A-99, A-100)", () => {
  test("TP-4.39 (a): arriving on /sign-in/two-step, the h1 'Two-step verification' is announced and focus ends on the code field", async ({
    page,
    request,
  }) => {
    const { email } = await createUser(request);

    await routedSignInToTwoStep(page, email);

    await expect(page.locator("main h1")).toHaveText(looseText("Two-step verification"));
    await expect(codeField(page)).toBeFocused();
    await expect(page.locator("#live-polite")).toHaveText(looseText("Two-step verification"));
  });

  test("TP-4.39 (c): a routed TWO_STEP_CHALLENGE_EXPIRED { reason: expired } → /sign-in?reason=two_step_timeout with 'This sign-in timed out. Sign in again.'", async ({
    page,
    request,
  }) => {
    const { email } = await createUser(request);
    await page.route("**/api/v1/auth/two-step/verify", (route) =>
      route.fulfill(
        json(401, {
          defined: true,
          code: "TWO_STEP_CHALLENGE_EXPIRED",
          status: 401,
          message: "Two-step challenge expired",
          data: { reason: "expired" },
        }),
      ),
    );
    await routedSignInToTwoStep(page, email);

    await codeField(page).fill("123456");
    await verifyButton(page).click();

    await expect(page).toHaveURL(/\/sign-in\?reason=two_step_timeout$/);
    await expect(page.locator("main h1")).toHaveText(looseText("Sign in"));
    await expect(page.locator("main").getByText(looseText(TIMED_OUT))).toBeVisible();
    await expect(page.locator("main").getByText(looseText(TOO_MANY))).toHaveCount(0);
  });

  test("TP-4.39x: a routed TWO_STEP_CHALLENGE_EXPIRED { reason: too_many_attempts } on the first try → /sign-in?reason=two_step_too_many (the reason decides, not a count)", async ({
    page,
    request,
  }) => {
    const { email } = await createUser(request);
    await page.route("**/api/v1/auth/two-step/verify", (route) =>
      route.fulfill(
        json(401, {
          defined: true,
          code: "TWO_STEP_CHALLENGE_EXPIRED",
          status: 401,
          message: "Two-step challenge expired",
          data: { reason: "too_many_attempts" },
        }),
      ),
    );
    await routedSignInToTwoStep(page, email);

    await codeField(page).fill("123456");
    await verifyButton(page).click();

    await expect(page).toHaveURL(/\/sign-in\?reason=two_step_too_many$/);
    await expect(page.locator("main").getByText(looseText(TOO_MANY))).toBeVisible();
    await expect(page.locator("main").getByText(looseText(TIMED_OUT))).toHaveCount(0);
  });

  test("TP-4.39x: opening /sign-in?reason=two_step_too_many and ?reason=two_step_timeout shows each message and not the other (F-155)", async ({
    page,
  }) => {
    await page.goto("/sign-in?reason=two_step_too_many");
    await expect(page.locator("main h1")).toHaveText(looseText("Sign in"));
    await expect(page.locator("main").getByText(looseText(TOO_MANY))).toBeVisible();
    await expect(page.locator("main").getByText(looseText(TIMED_OUT))).toHaveCount(0);

    await page.goto("/sign-in?reason=two_step_timeout");
    await expect(page.locator("main h1")).toHaveText(looseText("Sign in"));
    await expect(page.locator("main").getByText(looseText(TIMED_OUT))).toBeVisible();
    await expect(page.locator("main").getByText(looseText(TOO_MANY))).toHaveCount(0);
  });

  test("TP-4.39 (d): S-10's two-step section is the <section> labelled by its h2 'Two-step verification': without two-step, 'Off' and Turn on; after turning it on, 'On' with Turn off", async ({
    page,
    request,
  }) => {
    await signedUpUser(page, request, "Section Person");
    await page.goto("/settings/security");
    await expect(page.locator("main h1")).toHaveText(looseText("Sign-in & security"));
    const section = twoStepSection(page);

    // A-100 (4): <section aria-labelledby="<its h2 id>"> wrapping that h2.
    await expect(section).toHaveCount(1);
    expect(await section.evaluate((el) => el.tagName)).toBe("SECTION");
    const heading = section.getByRole("heading", {
      level: 2,
      name: catalogText("Two-step verification"),
    });
    await expect(heading).toHaveCount(1);
    const headingId = await heading.getAttribute("id");
    expect(headingId).toBeTruthy();
    await expect(section).toHaveAttribute("aria-labelledby", headingId ?? "");

    await expect(section).toBeVisible();
    await expect(section.getByText(catalogText("Off"))).toBeVisible();
    await expect(section.getByText(catalogText("On"))).toHaveCount(0);
    await expect(section.getByRole("button", { name: catalogText("Turn on") })).toBeVisible();
    await expect(section.getByRole("button", { name: catalogText("Turn off") })).toHaveCount(0);

    // enableTwoStep presses this section's Turn on and returns here after Done.
    await enableTwoStep(page, { acknowledge: true });

    await expect(section.getByText(catalogText("On"))).toBeVisible();
    await expect(section.getByText(catalogText("Off"))).toHaveCount(0);
    await expect(section.getByRole("button", { name: catalogText("Turn off") })).toBeVisible();
    await expect(section.getByRole("button", { name: catalogText("Turn on") })).toHaveCount(0);
  });

  test("TP-4.39 (f): without two-step and with the step-up expired, Turn on goes to /settings/security/two-step, where Confirm it's you opens on the page's mount; Cancel goes back to /settings/security", async ({
    page,
    request,
  }) => {
    const { email } = await signedUpUser(page, request, "Cancel Setup Person");
    await unconfirmSessions(request, email);
    await page.goto("/settings/security");
    await expect(page.locator("main h1")).toHaveText(looseText("Sign-in & security"));
    const setup: number[] = [];
    page.on("response", (r) => {
      if (isPost("/api/v1/me/two-step/setup")(r)) setup.push(r.status());
    });

    // A-100 (3): Turn on only navigates; the setup page's mount asks for the step-up.
    await twoStepSection(page)
      .getByRole("button", { name: catalogText("Turn on") })
      .click();

    const dialog = confirmDialog(page);
    await expect(dialog).toBeVisible();
    // Read once (not retried): already on the setup page when the dialog shows.
    expect(page.url()).toMatch(/\/settings\/security\/two-step$/);
    expect(setup).toEqual([403]);

    await dialog.getByRole("button", { name: catalogText("Cancel") }).click();

    await expect(page).toHaveURL(/\/settings\/security$/);
    await expect(page.locator("main h1")).toHaveText(looseText("Sign-in & security"));
    await expect(dialog).toHaveCount(0);
    // F-166: a cancel doesn't retry run().
    expect(setup).toEqual([403]);
  });
});

test.describe("TP-4.43: sign-in path, expired setup, and errors inside the dialogs (A-102)", () => {
  test("TP-4.43 (a): signing in from /sign-in with no next lands on exactly /sign-in/two-step", async ({
    page,
    request,
  }) => {
    const { email } = await signedUpUser(page, request, "No Next Person");
    await enableTwoStep(page, { acknowledge: true });
    await signOutFromMenu(page);
    await expect(page).toHaveURL(/\/sign-in/);

    await submitSignIn(page, email, E2E_PASSWORD, "/sign-in");

    await expect(page).toHaveURL(
      (u) => u.pathname === "/sign-in/two-step" && u.search === "" && u.hash === "",
    );
    await expect(page.locator("main h1")).toHaveText(looseText("Two-step verification"));
  });

  test("TP-4.43 (b): me.twoStepEnable answering TWO_STEP_SETUP_EXPIRED shows 'Setup timed out. Start again.' with Start again, which starts a new setup with a new QR code", async ({
    page,
    request,
  }) => {
    await signedUpUser(page, request, "Expired Setup Person");
    await page.goto("/settings/security");
    await expect(page.locator("main h1")).toHaveText(looseText("Sign-in & security"));
    const secrets: string[] = [];
    page.on("response", (r) => {
      if (isPost("/api/v1/me/two-step/setup")(r) && r.status() === 200) {
        void r.json().then((b: { secret: string }) => secrets.push(b.secret));
      }
    });
    await page.route("**/api/v1/me/two-step/enable", (route) =>
      route.fulfill(
        json(410, {
          defined: true,
          code: "TWO_STEP_SETUP_EXPIRED",
          status: 410,
          message: "Two-step setup expired",
        }),
      ),
    );
    const firstSetup = page.waitForResponse(isPost("/api/v1/me/two-step/setup"));
    await twoStepSection(page)
      .getByRole("button", { name: catalogText("Turn on") })
      .click();
    expect((await firstSetup).status()).toBe(200);
    const main = page.locator("main");
    const qr = main.getByRole("img", {
      name: catalogText("QR code for your authenticator app. Use the key below if you can't scan."),
    });
    await expect(qr).toBeVisible();
    const firstQr = await qr.innerHTML();

    await main.getByLabel(catalogText("Code")).fill("123456");
    await main.getByRole("button", { name: catalogText("Verify and turn on") }).click();

    await expect(main.getByText(looseText("Setup timed out. Start again."))).toBeVisible();
    const startAgain = main.getByRole("button", { name: catalogText("Start again") });
    await expect(startAgain).toBeVisible();
    await expect(main.getByRole("button", { name: catalogText("Try again") })).toHaveCount(0);
    const secondSetup = page.waitForResponse(isPost("/api/v1/me/two-step/setup"));

    await startAgain.click();

    expect((await secondSetup).status()).toBe(200);
    await expect.poll(() => secrets.length).toBe(2);
    expect(secrets[1]).not.toBe(secrets[0]);
    await expect(main.getByText(secrets[1] ?? "", { exact: true })).toBeVisible();
    await expect(qr).toBeVisible();
    expect(await qr.innerHTML()).not.toBe(firstQr);
    expect(here(page)).toBe("/settings/security/two-step");
  });

  test("TP-4.43 (c): Done with me.acknowledgeRecoveryCodes answering 503 keeps the codes dialog open with the platform's message inside it, and no toast", async ({
    page,
    request,
  }) => {
    await signedUpUser(page, request, "Done Fails Person");
    await enableTwoStep(page, { acknowledge: true });
    await page.route("**/api/v1/me/two-step/acknowledge-codes", (route) =>
      route.fulfill({ status: 503, contentType: "text/plain", body: "Service Unavailable" }),
    );
    await page
      .locator("main")
      .getByRole("button", { name: catalogText("Create new codes") })
      .click();
    const codesDialog = page.getByRole("dialog").filter({ hasText: NEW_CODES_DONE });
    await expect(codesDialog).toBeVisible();
    await codesDialog
      .getByRole("checkbox", { name: catalogText("I've saved my recovery codes") })
      .check();
    const ack = page.waitForResponse(isPost("/api/v1/me/two-step/acknowledge-codes"));

    await codesDialog.getByRole("button", { name: catalogText("Done") }).click();

    expect((await ack).status()).toBe(503);
    const unavailable = looseText("wDit is temporarily unavailable. Try again in a few minutes.");
    await expect(codesDialog).toBeVisible();
    await expect(codesDialog.getByText(unavailable)).toBeVisible();
    // Only the dialog's own text outside the live regions: no toast.
    await expect(toastWith(page, unavailable)).toHaveCount(1);
  });

  test("TP-4.43 (d): Turn off with me.twoStepDisable answering RATE_LIMITED keeps the dialog open with the rate-limit text and 'You can still use a recovery code.' on the field", async ({
    page,
    request,
  }) => {
    await signedUpUser(page, request, "Turn Off Limited Person");
    await enableTwoStep(page, { acknowledge: true });
    await page.route("**/api/v1/me/two-step/disable", (route) =>
      route.fulfill(
        json(429, {
          defined: true,
          code: "RATE_LIMITED",
          status: 429,
          message: "Too many requests",
          data: { retryAfterSeconds: 120 },
        }),
      ),
    );
    await page
      .locator("main")
      .getByRole("button", { name: catalogText("Turn off") })
      .click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toBeVisible();
    const disable = page.waitForResponse(isPost("/api/v1/me/two-step/disable"));
    // A 6-digit code: A-103 (3) shows the recovery hint only for a code attempt.
    await dialog.getByLabel(catalogText("Code")).fill("123456");

    await dialog.getByRole("button", { name: catalogText("Turn off") }).click();

    expect((await disable).status()).toBe(429);
    await expect(dialog).toBeVisible();
    // A-102: the field's message is F-174's text, a space, then twostep.limitRecovery (the
    // catalog's bidi marks allowed around each part and the number).
    const marks = `[${String.fromCharCode(0x200f, 0x2068, 0x2069)}]*`;
    const limited = new RegExp(
      String.raw`^${marks}Too many attempts\. Try again in ${marks}\d+${marks} minutes?\.${marks} ${marks}You can still use a recovery code\.${marks}$`,
    );
    await expect(dialog.getByText(limited)).toBeVisible();
  });
});

test.describe("TP-4.44: Done clears the unsaved-codes banner (A-103)", () => {
  test("TP-4.44: with codes not acknowledged, Create new codes, tick, Done: the dialog closes and 'You may not have saved your recovery codes.' is no longer in the two-step section", async ({
    page,
    request,
  }) => {
    await signedUpUser(page, request, "Banner Person");
    await enableTwoStep(page, { acknowledge: false });
    await page.goto("/settings/security");
    const section = twoStepSection(page);
    await expect(section.getByText(looseText(UNSAVED))).toBeVisible();

    await section.getByRole("button", { name: catalogText("Create new codes") }).click();
    const codesDialog = page.getByRole("dialog").filter({ hasText: NEW_CODES_DONE });
    await expect(codesDialog).toBeVisible();
    await codesDialog
      .getByRole("checkbox", { name: catalogText("I've saved my recovery codes") })
      .check();
    const ack = page.waitForResponse(isPost("/api/v1/me/two-step/acknowledge-codes"));
    await codesDialog.getByRole("button", { name: catalogText("Done") }).click();

    expect((await ack).status()).toBe(200);
    await expect(codesDialog).toHaveCount(0);
    await expect(section.getByText(looseText(UNSAVED))).toHaveCount(0);
  });
});

test.describe("TP-4.46: replace-mode wording, the sign-in recovery hint and busy dialogs (A-104)", () => {
  const QR_ALT = "QR code for your authenticator app. Use the key below if you can't scan.";
  /** The catalog's bidi marks, allowed around each part of a pattern built from parts. */
  const marks = `[${String.fromCharCode(0x200f, 0x2068, 0x2069)}]*`;
  /** F-165's step line in any step ("Step {n} of 2"). */
  const STEP_LINE = new RegExp(String.raw`Step ${marks}[\d٠-٩]+${marks} of 2`);
  const LIMIT_RECOVERY = "You can still use a recovery code.";

  /** Asserts `upper`'s box ends above where `lower`'s starts. */
  async function expectAbove(upper: Locator, lower: Locator): Promise<void> {
    const a = await upper.boundingBox();
    const b = await lower.boundingBox();
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect((a?.y ?? 0) + (a?.height ?? 0)).toBeLessThanOrEqual((b?.y ?? 0) + 0.5);
  }

  test("TP-4.46 (a): setup mode: <h1> 'Turn on two-step verification', 'Step 1 of 2', the <h2> 'Scan this code' above the QR, and Verify and turn on", async ({
    page,
    request,
  }) => {
    await signedUpUser(page, request, "Setup Wording Person");
    await page.goto("/settings/security");
    await expect(page.locator("main h1")).toHaveText(looseText("Sign-in & security"));

    await twoStepSection(page)
      .getByRole("button", { name: catalogText("Turn on") })
      .click();

    await expect(page).toHaveURL(/\/settings\/security\/two-step$/);
    const main = page.locator("main");
    const qr = main.getByRole("img", { name: catalogText(QR_ALT) });
    await expect(qr).toBeVisible();
    await expect(main.locator("h1")).toHaveText(looseText("Turn on two-step verification"));
    await expect(main.getByText(looseText("Step 1 of 2"))).toBeVisible();
    const scan = main.getByRole("heading", { level: 2, name: catalogText("Scan this code") });
    await expect(scan).toBeVisible();
    await expectAbove(scan, qr);
    await expect(
      main.getByRole("button", { name: catalogText("Verify and turn on") }),
    ).toBeVisible();
    await expect(main.getByRole("button", { name: catalogText("Verify") })).toHaveCount(0);
  });

  test("TP-4.46 (a), TP-4.46x: replace mode after step-up: <h1> 'Replace authenticator app', no step line, the <h2> 'Scan this code' above the QR, and Verify; a code from the new key → /settings/security with 'Your authenticator app was replaced.'", async ({
    page,
    request,
  }) => {
    // TP-4.46x: A-104 G-2's success (twostep.replaced) has no other web test.
    const { email } = await signedUpUser(page, request, "Replace Wording Person");
    const { auth } = await enableTwoStep(page, { acknowledge: true });
    await unconfirmSessions(request, email);
    await page.goto("/settings/security");
    await expect(page.locator("main h1")).toHaveText(looseText("Sign-in & security"));
    const starts: number[] = [];
    page.on("response", (r) => {
      if (isPost("/api/v1/me/two-step/replace/start")(r)) starts.push(r.status());
    });

    await twoStepSection(page)
      .getByRole("button", { name: catalogText("Replace authenticator app") })
      .click();
    const dialog = confirmDialog(page);
    await expect(dialog).toBeVisible();
    const started = page.waitForResponse(
      (r) => isPost("/api/v1/me/two-step/replace/start")(r) && r.status() === 200,
    );
    await dialog.getByLabel(catalogText(STEP_UP_CODE)).fill(await auth.nextCode());
    await dialog.getByRole("button", { name: catalogText("Confirm") }).click();
    const { secret } = (await (await started).json()) as { secret: string };

    await expect(dialog).toHaveCount(0);
    expect(starts).toEqual([403, 200]);
    await expect(page).toHaveURL(
      (u) =>
        u.pathname === "/settings/security/two-step" && u.searchParams.get("mode") === "replace",
    );
    const main = page.locator("main");
    const qr = main.getByRole("img", { name: catalogText(QR_ALT) });
    await expect(qr).toBeVisible();
    await expect(main.locator("h1")).toHaveText(looseText("Replace authenticator app"));
    await expect(main.getByText(STEP_LINE)).toHaveCount(0);
    const scan = main.getByRole("heading", { level: 2, name: catalogText("Scan this code") });
    await expect(scan).toBeVisible();
    await expectAbove(scan, qr);
    const verify = main.getByRole("button", { name: catalogText("Verify") });
    await expect(verify).toBeVisible();
    await expect(main.getByRole("button", { name: catalogText("Verify and turn on") })).toHaveCount(
      0,
    );

    // TP-4.46x: the new key's code replaces the app.
    const replaced = page.waitForResponse(isPost("/api/v1/me/two-step/replace/confirm"));
    const newApp = TestAuthenticator.fromKey(secret);
    await main.getByLabel(catalogText("Code")).fill(await newApp.nextCode());
    await verify.click();

    const answer = await replaced;
    expect(answer.status(), await answer.text()).toBe(200);
    await expect(page).toHaveURL(/\/settings\/security$/);
    await expect(
      toastWith(page, looseText("Your authenticator app was replaced.")).first(),
    ).toBeVisible();
  });

  /** auth.verifyTwoStep answering RATE_LIMITED (60 s); returns the bodies it was sent. */
  async function routeVerifyRateLimited(page: Page): Promise<unknown[]> {
    const bodies: unknown[] = [];
    await page.route("**/api/v1/auth/two-step/verify", (route) => {
      bodies.push(route.request().postDataJSON());
      return route.fulfill(
        json(429, {
          defined: true,
          code: "RATE_LIMITED",
          status: 429,
          message: "Too many requests",
          data: { retryAfterSeconds: 60 },
        }),
      );
    });
    return bodies;
  }

  /** P-F-214's notice for 60 s: "Too many attempts. Try again in 1 minute." */
  async function expectOneMinuteNotice(page: Page, project: string): Promise<void> {
    const notice = page
      .locator("main")
      .getByRole("status")
      .filter({ hasText: /Too many attempts/ });
    await expect(notice).toBeVisible();
    // ar-XB keeps its own plural forms and may localise the digit.
    await expect(notice).toHaveText(
      project === "chromium"
        ? looseText("Too many attempts. Try again in 1 minute.")
        : new RegExp(
            String.raw`^${marks}Too many attempts\. Try again in ${marks}[1١]${marks} minutes?\.${marks}$`,
          ),
    );
  }

  test("TP-4.46 (b): sign-in two-step in recovery mode with auth.verifyTwoStep answering RATE_LIMITED (60 s) shows the rate-limit notice and not 'You can still use a recovery code.'", async ({
    page,
    request,
  }, testInfo) => {
    const { email } = await createUser(request);
    const bodies = await routeVerifyRateLimited(page);
    await routedSignInToTwoStep(page, email);
    await page.locator("main").getByText(catalogText("Use a recovery code instead")).click();
    await page.locator("main").getByLabel(catalogText("Recovery code")).fill("7KQ2-M3XD-4TRA");

    await verifyButton(page).click();

    await expectOneMinuteNotice(page, testInfo.project.name);
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toMatchObject({ recoveryCode: "7KQ2-M3XD-4TRA" });
    expect(bodies[0]).not.toHaveProperty("code");
    await expect(page.locator("main").getByText(looseText(LIMIT_RECOVERY))).toHaveCount(0);
  });

  test("TP-4.46x: sign-in two-step with a 6-digit code answering RATE_LIMITED (60 s) shows the rate-limit notice and 'You can still use a recovery code.'", async ({
    page,
    request,
  }, testInfo) => {
    // A-104 m-2 / A-103 (3): the hint's other branch, so (b)'s absence can't pass by accident.
    const { email } = await createUser(request);
    const bodies = await routeVerifyRateLimited(page);
    await routedSignInToTwoStep(page, email);
    await codeField(page).fill("123456");

    await verifyButton(page).click();

    await expectOneMinuteNotice(page, testInfo.project.name);
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toMatchObject({ code: "123456" });
    await expect(page.locator("main").getByText(looseText(LIMIT_RECOVERY))).toBeVisible();
  });

  /** Holds the POST to `path` until the test releases it, then lets it reach the server. */
  async function holdPost(
    page: Page,
    path: string,
  ): Promise<{ arrived: Promise<void>; release: () => void }> {
    const arrived = deferred();
    const gate = deferred();
    await page.route(`**${path}`, async (route) => {
      if (route.request().method() !== "POST") {
        await route.fallback();
        return;
      }
      arrived.resolve();
      await gate.promise;
      await route.continue();
    });
    return { arrived: arrived.promise, release: gate.resolve };
  }

  /** Clicks a point on the overlay, outside a centred dialog. */
  const clickOutside = (page: Page) => page.mouse.click(5, 5);

  test("TP-4.46 (c), TP-4.46x: Turn off with me.twoStepDisable held: Escape (and, x, a click outside) leaves the dialog open with Cancel disabled; the response then closes it and two-step is off", async ({
    page,
    request,
  }) => {
    // TP-4.46x: F-164 (A-104) names the overlay along with Escape.
    await signedUpUser(page, request, "Busy Turn Off Person");
    const { auth } = await enableTwoStep(page, { acknowledge: true });
    await expect(page.locator("main h1")).toHaveText(looseText("Sign-in & security"));
    const held = await holdPost(page, "/api/v1/me/two-step/disable");
    await twoStepSection(page)
      .getByRole("button", { name: catalogText("Turn off") })
      .click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toBeVisible();
    const cancel = dialog.getByRole("button", { name: catalogText("Cancel") });
    await expect(cancel).toBeEnabled();
    await dialog.getByLabel(catalogText("Code")).fill(await auth.nextCode());
    const disabled = page.waitForResponse(isPost("/api/v1/me/two-step/disable"));
    await dialog.getByRole("button", { name: catalogText("Turn off") }).click();
    await held.arrived;
    await expect(cancel).toBeDisabled();

    await page.keyboard.press("Escape");

    await expect(dialog).toBeVisible();
    await expect(cancel).toBeDisabled();
    await clickOutside(page);
    await expect(dialog).toBeVisible();
    await expect(cancel).toBeDisabled();

    held.release();
    expect((await disabled).status()).toBe(200);
    await expect(dialog).toHaveCount(0);
    await expect(toastWith(page, looseText("Two-step verification is off.")).first()).toBeVisible();
    await expect(twoStepSection(page).getByText(catalogText("Off"))).toBeVisible();
  });

  test("TP-4.46 (d), TP-4.46x: a step-up dialog with me.confirm held: Escape (and, x, a click outside) leaves it open with Cancel disabled; the response then closes it and Create new codes resumes", async ({
    page,
    request,
  }) => {
    // TP-4.46x: F-166 (A-104) names the overlay along with Escape.
    const { email } = await signedUpUser(page, request, "Busy Step Up Person");
    const { auth } = await enableTwoStep(page, { acknowledge: true });
    await unconfirmSessions(request, email);
    await page.goto("/settings/security");
    await expect(page.locator("main h1")).toHaveText(looseText("Sign-in & security"));
    const held = await holdPost(page, "/api/v1/me/confirm");
    await twoStepSection(page)
      .getByRole("button", { name: catalogText("Create new codes") })
      .click();
    const dialog = confirmDialog(page);
    await expect(dialog).toBeVisible();
    const cancel = dialog.getByRole("button", { name: catalogText("Cancel") });
    await expect(cancel).toBeEnabled();
    await dialog.getByLabel(catalogText(STEP_UP_CODE)).fill(await auth.nextCode());
    const confirmed = page.waitForResponse(isPost("/api/v1/me/confirm"));
    const fresh = page.waitForResponse(
      (r) => isPost("/api/v1/me/two-step/recovery-codes")(r) && r.status() === 200,
    );
    await dialog.getByRole("button", { name: catalogText("Confirm") }).click();
    await held.arrived;
    await expect(cancel).toBeDisabled();

    await page.keyboard.press("Escape");

    await expect(dialog).toBeVisible();
    await expect(cancel).toBeDisabled();
    await clickOutside(page);
    await expect(dialog).toBeVisible();
    await expect(cancel).toBeDisabled();

    held.release();
    expect((await confirmed).status()).toBe(200);
    await expect(dialog).toHaveCount(0);
    const { recoveryCodes } = (await (await fresh).json()) as { recoveryCodes: string[] };
    const codesDialog = page.getByRole("dialog").filter({ hasText: NEW_CODES_DONE });
    await expect(codesDialog).toBeVisible();
    await expect(codesDialog.getByText(recoveryCodes[0] ?? "-")).toBeVisible();
  });

  test("TP-4.46x: the regenerated-codes dialog with me.acknowledgeRecoveryCodes held: Escape and a click outside leave it open; the response then closes it", async ({
    page,
    request,
  }) => {
    // F-164 (A-104): the codes Dialog doesn't close while codesBusy(); TP-4.46 covers the others.
    await signedUpUser(page, request, "Busy Codes Person");
    await enableTwoStep(page, { acknowledge: true });
    await expect(page.locator("main h1")).toHaveText(looseText("Sign-in & security"));
    await twoStepSection(page)
      .getByRole("button", { name: catalogText("Create new codes") })
      .click();
    const codesDialog = page.getByRole("dialog").filter({ hasText: NEW_CODES_DONE });
    await expect(codesDialog).toBeVisible();
    await codesDialog
      .getByRole("checkbox", { name: catalogText("I've saved my recovery codes") })
      .check();
    const held = await holdPost(page, "/api/v1/me/two-step/acknowledge-codes");
    const ack = page.waitForResponse(isPost("/api/v1/me/two-step/acknowledge-codes"));
    await codesDialog.getByRole("button", { name: catalogText("Done") }).click();
    await held.arrived;

    await page.keyboard.press("Escape");

    await expect(codesDialog).toBeVisible();
    await clickOutside(page);
    await expect(codesDialog).toBeVisible();

    held.release();
    expect((await ack).status()).toBe(200);
    await expect(codesDialog).toHaveCount(0);
    expect(here(page)).toBe("/settings/security");
  });
});

test.describe("TP-4.47x: replacing the authenticator after two-step was turned off elsewhere (A-105)", () => {
  test("TP-4.47x: replace mode, me.twoStepReplaceConfirm answering TWO_STEP_NOT_ENABLED → /settings/security in place of the page, with no toast", async ({
    page,
    request,
  }) => {
    const { email } = await signedUpUser(page, request, "Replace Off Person");
    const { auth } = await enableTwoStep(page, { acknowledge: true });
    await unconfirmSessions(request, email);
    await page.goto("/settings/security");
    await expect(page.locator("main h1")).toHaveText(looseText("Sign-in & security"));
    await twoStepSection(page)
      .getByRole("button", { name: catalogText("Replace authenticator app") })
      .click();
    const dialog = confirmDialog(page);
    await dialog.getByLabel(catalogText(STEP_UP_CODE)).fill(await auth.nextCode());
    await dialog.getByRole("button", { name: catalogText("Confirm") }).click();
    const main = page.locator("main");
    await expect(main.locator("h1")).toHaveText(looseText("Replace authenticator app"));
    const confirms: number[] = [];
    await page.route("**/api/v1/me/two-step/replace/confirm", (route) => {
      confirms.push(1);
      return route.fulfill(
        json(409, {
          defined: true,
          code: "TWO_STEP_NOT_ENABLED",
          status: 409,
          message: "Two-step not enabled",
        }),
      );
    });
    const historyLength = await page.evaluate(() => history.length);

    await main.getByLabel(catalogText("Code")).fill("123456");
    await main.getByRole("button", { name: catalogText("Verify") }).click();

    await expect(page).toHaveURL(/\/settings\/security$/);
    await expect(main.locator("h1")).toHaveText(looseText("Sign-in & security"));
    await expect(twoStepSection(page)).toBeVisible();
    expect(confirms).toHaveLength(1);
    // navigate({ replace: true }): no history entry added.
    expect(await page.evaluate(() => history.length)).toBe(historyLength);
    await expect(toastWith(page, looseText("Your authenticator app was replaced."))).toHaveCount(0);
    // Kobalte renders each toast as an <li role="status">: none at all.
    await expect(page.locator("li[role='status']")).toHaveCount(0);
  });
});

test.describe("TP-4.49: S-4 QA's gaps (A-107, A-541, A-542)", () => {
  const activeTag = (page: Page) => page.evaluate(() => document.activeElement?.tagName ?? null);

  /** Runs axe while `toast` shows; the toast must still show afterwards, so the scan saw it. */
  async function expectNoViolationsWith(page: Page, toast: Locator): Promise<void> {
    await expect(toast).toBeVisible();
    const results = await new AxeBuilder({ page }).analyze();
    await expect(toast).toBeVisible();
    expect(results.violations.map((v) => `${v.id}: ${String(v.nodes.length)}`)).toEqual([]);
  }

  /** Opens the section's Turn off dialog; returns the dialog and its opening button. */
  async function openTurnOff(page: Page): Promise<{ dialog: Locator; opener: Locator }> {
    const opener = twoStepSection(page).getByRole("button", { name: catalogText("Turn off") });
    await opener.click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toBeVisible();
    return { dialog, opener };
  }

  const createNewCodes = (page: Page) =>
    twoStepSection(page).getByRole("button", { name: catalogText("Create new codes") });

  /** Signs in by API with each recovery code in turn (as another device), using them up. */
  async function useRecoveryCodes(
    request: Parameters<typeof createInvitation>[0],
    email: string,
    codes: string[],
  ): Promise<void> {
    for (const recoveryCode of codes) {
      const signIn = await request.post("/api/v1/auth/sign-in", {
        headers: WEB_CLIENT,
        data: { email, password: E2E_PASSWORD, tokenDelivery: "body" },
      });
      expect(signIn.status(), await signIn.text()).toBe(200);
      const { challengeToken } = (await signIn.json()) as { challengeToken: string };
      const verify = await request.post("/api/v1/auth/two-step/verify", {
        headers: WEB_CLIENT,
        data: { challengeToken, recoveryCode, tokenDelivery: "body" },
      });
      expect(verify.status(), await verify.text()).toBe(200);
    }
  }

  /** Signs out, signs in with the password, then with `recoveryCode` on the two-step page. */
  async function signInWithRecoveryCode(
    page: Page,
    email: string,
    recoveryCode: string,
  ): Promise<void> {
    await signInToTwoStep(page, email);
    await page.locator("main").getByText(catalogText("Use a recovery code instead")).click();
    await page.locator("main").getByLabel(catalogText("Recovery code")).fill(recoveryCode);
    await verifyButton(page).click();
    await expect(page).toHaveURL(/\/$/);
  }

  /** The on-screen toast (an `li` of the toaster's list) whose message is `text`. */
  const toastItem = (page: Page, text: RegExp) =>
    page.locator("ol > li").filter({ has: page.getByText(text) });

  // ---- Q-1, A-541: axe with a toast ----

  test("TP-4.33x (QA Q-1, A-541): axe with the toast 'Two-step verification is off.' showing finds no violations", async ({
    page,
    request,
  }) => {
    await signedUpUser(page, request, "Axe Off Person");
    const { auth } = await enableTwoStep(page, { acknowledge: true });
    const { dialog } = await openTurnOff(page);
    await dialog.getByLabel(catalogText("Code")).fill(await auth.nextCode());
    await dialog.getByRole("button", { name: catalogText("Turn off") }).click();
    await expect(dialog).toBeHidden();

    await expectNoViolationsWith(
      page,
      toastWith(page, looseText("Two-step verification is off.")).first(),
    );
  });

  test("TP-4.32x (QA Q-1, A-541): axe with the 'Two-step verification is on.' toast showing (after Done) finds no violations", async ({
    page,
    request,
  }) => {
    await signedUpUser(page, request, "Axe On Person");
    await enableTwoStep(page, { acknowledge: true });

    await expectNoViolationsWith(page, toastWith(page, looseText(TWO_STEP_ON)).first());
  });

  // ---- (a) focus after the dialogs ----

  test("TP-4.49 (a): Turn off → Escape: focus on Turn off; (x) Turn off → Cancel: the same; Turn off → success: focus on the two-step <h2>; never BODY", async ({
    page,
    request,
  }) => {
    await signedUpUser(page, request, "Turn Off Focus Person");
    const { auth } = await enableTwoStep(page, { acknowledge: true });

    const first = await openTurnOff(page);
    await page.keyboard.press("Escape");
    await expect(first.dialog).toBeHidden();
    await expect(first.opener).toBeFocused();

    const second = await openTurnOff(page);
    await second.dialog.getByRole("button", { name: catalogText("Cancel") }).click();
    await expect(second.dialog).toBeHidden();
    await expect(second.opener).toBeFocused();

    const third = await openTurnOff(page);
    await third.dialog.getByLabel(catalogText("Code")).fill(await auth.nextCode());
    await third.dialog.getByRole("button", { name: catalogText("Turn off") }).click();
    await expect(third.dialog).toBeHidden();
    await expect(third.opener).toHaveCount(0);
    await expect(
      twoStepSection(page).getByRole("heading", {
        level: 2,
        name: catalogText("Two-step verification"),
      }),
    ).toBeFocused();
    expect(await activeTag(page)).not.toBe("BODY");
  });

  test("TP-4.49 (a): Create new codes → Done: focus back on Create new codes, never BODY", async ({
    page,
    request,
  }) => {
    await signedUpUser(page, request, "Codes Focus Person");
    await enableTwoStep(page, { acknowledge: true });
    await expect(page.locator("main h1")).toHaveText(looseText("Sign-in & security"));
    await createNewCodes(page).click();
    const codesDialog = page.getByRole("dialog").filter({ hasText: NEW_CODES_DONE });
    await expect(codesDialog).toBeVisible();
    await codesDialog
      .getByRole("checkbox", { name: catalogText("I've saved my recovery codes") })
      .check();
    const ack = page.waitForResponse(isPost("/api/v1/me/two-step/acknowledge-codes"));

    await codesDialog.getByRole("button", { name: catalogText("Done") }).click();

    expect((await ack).status()).toBe(200);
    await expect(codesDialog).toHaveCount(0);
    await expect(createNewCodes(page)).toBeFocused();
    expect(await activeTag(page)).not.toBe("BODY");
  });

  test("TP-4.49 (a): a step-up opened from Create new codes → Cancel: focus back on Create new codes, never BODY", async ({
    page,
    request,
  }) => {
    const { email } = await signedUpUser(page, request, "Step Up Focus Person");
    await enableTwoStep(page, { acknowledge: true });
    await unconfirmSessions(request, email);
    await page.goto("/settings/security");
    await expect(page.locator("main h1")).toHaveText(looseText("Sign-in & security"));
    await createNewCodes(page).click();
    const dialog = confirmDialog(page);
    await expect(dialog).toBeVisible();

    await dialog.getByRole("button", { name: catalogText("Cancel") }).click();

    await expect(dialog).toHaveCount(0);
    await expect(createNewCodes(page)).toBeFocused();
    expect(await activeTag(page)).not.toBe("BODY");
  });

  // ---- (b) focus after the setup steps ----

  /**
   * Before a navigation: records the first `main h1` other than the current one (the arriving
   * page's) with its time, and every node removed from the document.
   */
  async function watchArrivingHeading(page: Page): Promise<void> {
    await page.evaluate(() => {
      const w = window as unknown as {
        arriving: { el: Element | null; at: number; removed: Node[] };
      };
      const before = document.querySelector("main h1");
      w.arriving = { el: null, at: 0, removed: [] };
      new MutationObserver((records) => {
        for (const r of records) for (const n of r.removedNodes) w.arriving.removed.push(n);
        const h1 = document.querySelector("main h1");
        if (w.arriving.el === null && h1 !== null && h1 !== before) {
          w.arriving.el = h1;
          w.arriving.at = performance.now();
        }
      }).observe(document.body, { childList: true, subtree: true });
    });
  }

  /** 500 ms after the arriving <h1> appeared: is it still the page's, connected, never removed? */
  async function arrivingHeadingAt500(
    page: Page,
  ): Promise<{ same: boolean; connected: boolean; removed: boolean }> {
    await page.waitForFunction(() => {
      const w = window as unknown as { arriving: { el: Element | null; at: number } };
      return w.arriving.el !== null && performance.now() - w.arriving.at >= 500;
    });
    return page.evaluate(() => {
      const w = window as unknown as { arriving: { el: Element | null; removed: Node[] } };
      const it = w.arriving.el;
      return {
        same: it !== null && it === document.querySelector("main h1"),
        connected: it?.isConnected ?? false,
        removed: it !== null && w.arriving.removed.some((n) => n === it || n.contains(it)),
      };
    });
  }

  test("TP-4.49 (b): setup: Verify and turn on → focus on the codes step's <h2> 'Save your recovery codes'; Done → focus on the Sign-in & security <h1>", async ({
    page,
    request,
  }) => {
    await signedUpUser(page, request, "Setup Focus Person");
    await page.goto("/settings/security");
    await expect(page.locator("main h1")).toHaveText(looseText("Sign-in & security"));
    const setup = page.waitForResponse(isPost("/api/v1/me/two-step/setup"));
    await twoStepSection(page)
      .getByRole("button", { name: catalogText("Turn on") })
      .click();
    const { secret } = (await (await setup).json()) as { secret: string };
    const main = page.locator("main");
    const auth = TestAuthenticator.fromKey(secret);
    await main.getByLabel(catalogText("Code")).fill(await auth.nextCode());

    await main.getByRole("button", { name: catalogText("Verify and turn on") }).click();

    const codesHeading = main.getByRole("heading", {
      level: 2,
      name: catalogText("Save your recovery codes"),
    });
    await expect(codesHeading).toBeFocused();

    await page.getByRole("checkbox", { name: catalogText("I've saved my recovery codes") }).check();
    await watchArrivingHeading(page);
    await page.getByRole("button", { name: catalogText("Done") }).click();

    await expect(page).toHaveURL(/\/settings\/security$/);
    const h1 = main.locator("h1");
    await expect(h1).toHaveText(looseText("Sign-in & security"));
    await expect(h1).toBeFocused();
    // N-4 (A-545): the page's own Suspense boundaries keep the arriving <h1> mounted; a swap that
    // keepFocus rescues still fails here.
    expect(await arrivingHeadingAt500(page)).toEqual({
      same: true,
      connected: true,
      removed: false,
    });
  });

  // ---- (c) the J-5 prompt after a recovery-code sign-in ----

  test("TP-4.49 (c): a recovery sign-in with 3 codes left: a persistent toast 'You used a recovery code. 2 codes left.' with Create new codes, which lands on /settings/security with the codes dialog open and no search in the URL", async ({
    page,
    request,
  }) => {
    await page.clock.install();
    const { email } = await signedUpUser(page, request, "Three Left Person");
    const { codes } = await enableTwoStep(page, { acknowledge: true });
    await useRecoveryCodes(request, email, codes.slice(0, 7));
    const regenerated: number[] = [];
    page.on("response", (r) => {
      if (isPost("/api/v1/me/two-step/recovery-codes")(r)) regenerated.push(r.status());
    });

    await signInWithRecoveryCode(page, email, codes[7] ?? "");

    const toast = toastItem(page, looseText("You used a recovery code. 2 codes left."));
    await expect(toast).toBeVisible();
    const action = toast.getByRole("button", { name: catalogText("Create new codes") });
    await expect(action).toBeVisible();
    // Persistent: still there well past the 6 s of a normal toast.
    await page.clock.runFor(20_000);
    await expect(toast).toBeVisible();

    await action.click();

    const codesDialog = page.getByRole("dialog").filter({ hasText: NEW_CODES_DONE });
    await expect(codesDialog).toBeVisible();
    await expect(page).toHaveURL((u) => u.pathname === "/settings/security" && u.search === "");
    expect(regenerated).toEqual([200]);
  });

  test("TP-4.49 (c) (A-111): the toast's Create new codes while already on /settings/security opens the codes dialog too", async ({
    page,
    request,
  }) => {
    const { email } = await signedUpUser(page, request, "Already There Person");
    const { codes } = await enableTwoStep(page, { acknowledge: true });
    await useRecoveryCodes(request, email, codes.slice(0, 7));
    await signInWithRecoveryCode(page, email, codes[7] ?? "");
    const toast = toastItem(page, looseText("You used a recovery code. 2 codes left."));
    await expect(toast).toBeVisible();
    // A client-side navigation keeps the persistent toast.
    await page.evaluate(() => {
      history.pushState({}, "", "/settings/security");
      dispatchEvent(new PopStateEvent("popstate", { state: history.state as unknown }));
    });
    await expect(page.locator("main h1")).toHaveText(looseText("Sign-in & security"));
    await expect(toast).toBeVisible();
    const regenerated: number[] = [];
    page.on("response", (r) => {
      if (isPost("/api/v1/me/two-step/recovery-codes")(r)) regenerated.push(r.status());
    });

    await toast.getByRole("button", { name: catalogText("Create new codes") }).click();

    const codesDialog = page.getByRole("dialog").filter({ hasText: NEW_CODES_DONE });
    await expect(codesDialog).toBeVisible();
    await expect(page).toHaveURL((u) => u.pathname === "/settings/security" && u.search === "");
    expect(regenerated).toEqual([200]);
  });

  test("TP-4.49 (c): a recovery sign-in with 9 codes left: 'You used a recovery code. 8 codes left.' with no action; (x) gone after its 6 s", async ({
    page,
    request,
  }) => {
    await page.clock.install();
    const { email } = await signedUpUser(page, request, "Nine Left Person");
    const { codes } = await enableTwoStep(page, { acknowledge: true });
    await useRecoveryCodes(request, email, codes.slice(0, 1));

    await signInWithRecoveryCode(page, email, codes[1] ?? "");

    const toast = toastItem(page, looseText("You used a recovery code. 8 codes left."));
    await expect(toast).toBeVisible();
    await expect(toast.getByRole("button")).toHaveCount(0);
    await page.mouse.move(0, 0);
    await page.clock.runFor(20_000);
    await expect(toast).toHaveCount(0);
  });

  // ---- (d) the count in S-10 ----

  test("TP-4.49 (d): S-10 for a user with 8 codes shows '8 recovery codes left' below 'On'", async ({
    page,
    request,
  }) => {
    const { email } = await signedUpUser(page, request, "Eight Left Person");
    const { codes } = await enableTwoStep(page, { acknowledge: true });
    await useRecoveryCodes(request, email, codes.slice(0, 2));

    await page.goto("/settings/security");

    const section = twoStepSection(page);
    const count = section.getByText(looseText("8 recovery codes left"));
    await expect(count).toBeVisible();
    const on = section.getByText(catalogText("On"), { exact: true });
    await expect(on).toBeVisible();
    const a = await on.boundingBox();
    const b = await count.boundingBox();
    expect((a?.y ?? 0) + (a?.height ?? 0)).toBeLessThanOrEqual((b?.y ?? 0) + 0.5);
  });

  test("TP-4.49x (d): S-10 with me.get answering recoveryCodesLeft 1 shows '1 recovery code left'", async ({
    page,
    request,
  }) => {
    await signedUpUser(page, request, "One Left Person");
    await enableTwoStep(page, { acknowledge: true });
    await page.route("**/api/v1/me", async (route) => {
      if (route.request().method() !== "GET") {
        await route.fallback();
        return;
      }
      const response = await route.fetch();
      const body = (await response.json()) as { twoStep: { recoveryCodesLeft: number } };
      body.twoStep.recoveryCodesLeft = 1;
      await route.fulfill({ response, json: body });
    });

    await page.goto("/settings/security");

    await expect(twoStepSection(page).getByText(looseText("1 recovery code left"))).toBeVisible();
  });

  // ---- (e) the step-up's code field ----

  test("TP-4.49 (e): the step-up dialog's code field is labelled 'Code from your authenticator app'; (x) recovery mode keeps 'Recovery code'", async ({
    page,
    request,
  }) => {
    const { email } = await signedUpUser(page, request, "Step Up Label Person");
    await enableTwoStep(page, { acknowledge: true });
    await unconfirmSessions(request, email);
    await page.goto("/settings/security");
    await expect(page.locator("main h1")).toHaveText(looseText("Sign-in & security"));

    await createNewCodes(page).click();

    const dialog = confirmDialog(page);
    await expect(dialog.getByLabel(catalogText(STEP_UP_CODE))).toBeVisible();
    await expect(dialog.getByLabel(catalogText("Code"))).toHaveCount(0);
    await dialog.getByText(catalogText("Use a recovery code instead")).click();
    await expect(dialog.getByLabel(catalogText("Recovery code"))).toBeVisible();
  });

  // ---- (f) an expired setup ----

  /** Opens the setup page from Sign-in & security; returns when the code field shows. */
  async function openSetup(page: Page): Promise<{ secret: string }> {
    await page.goto("/settings/security");
    await expect(page.locator("main h1")).toHaveText(looseText("Sign-in & security"));
    const setup = page.waitForResponse(isPost("/api/v1/me/two-step/setup"));
    await twoStepSection(page)
      .getByRole("button", { name: catalogText("Turn on") })
      .click();
    const { secret } = (await (await setup).json()) as { secret: string };
    await expect(page.locator("main").getByLabel(catalogText("Code"))).toBeVisible();
    return { secret };
  }

  /** Every me.twoStepEnable request the page sends from now on. */
  function enableRequests(page: Page): string[] {
    const sent: string[] = [];
    page.on("request", (r) => {
      if (r.method() === "POST" && new URL(r.url()).pathname === "/api/v1/me/two-step/enable") {
        sent.push(r.url());
      }
    });
    return sent;
  }

  test("TP-4.49 (f) (A-111): setup, then page.clock advanced 15 minutes, then Verify and turn on: 'Setup timed out. Start again.', no me.twoStepEnable request and no dialog", async ({
    page,
    request,
  }) => {
    await page.clock.install();
    await signedUpUser(page, request, "Expired Clock Person");
    await openSetup(page);
    const enables = enableRequests(page);
    await page.clock.fastForward("15:00");

    const main = page.locator("main");
    await main.getByLabel(catalogText("Code")).fill("123456");
    await main.getByRole("button", { name: catalogText("Verify and turn on") }).click();

    await expect(main.getByText(looseText("Setup timed out. Start again."))).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(enables).toEqual([]);
  });

  test("TP-4.49 (f2) (A-111): the browser clock 20 minutes ahead before arriving at setup (expiresAt already past by Date.now), a code at once: me.twoStepEnable is sent and two-step turns on", async ({
    page,
    request,
  }) => {
    await page.clock.install();
    await signedUpUser(page, request, "Fast Clock Person");
    await page.clock.setSystemTime(new Date(Date.now() + 20 * 60_000));
    const { secret } = await openSetup(page);
    const enables = enableRequests(page);
    const enable = page.waitForResponse(isPost("/api/v1/me/two-step/enable"));

    const main = page.locator("main");
    await main
      .getByLabel(catalogText("Code"))
      .fill(await TestAuthenticator.fromKey(secret).nextCode());
    await main.getByRole("button", { name: catalogText("Verify and turn on") }).click();

    const answer = await enable;
    expect(answer.status(), await answer.text()).toBe(200);
    expect(enables).toHaveLength(1);
    await expect(
      main.getByRole("heading", { level: 2, name: catalogText("Save your recovery codes") }),
    ).toBeVisible();
    await expect(main.getByText(looseText("Setup timed out. Start again."))).toHaveCount(0);
  });

  // ---- (h) no URL regenerates codes ----

  test("TP-4.49 (h) (A-111): opening /settings/security?newCodes=1 directly sends no me.regenerateRecoveryCodes and opens no dialog", async ({
    page,
    request,
  }) => {
    await signedUpUser(page, request, "Url Codes Person");
    await enableTwoStep(page, { acknowledge: true });
    const regenerations: string[] = [];
    page.on("request", (r) => {
      if (
        r.method() === "POST" &&
        new URL(r.url()).pathname === "/api/v1/me/two-step/recovery-codes"
      ) {
        regenerations.push(r.url());
      }
    });

    await page.goto("/settings/security?newCodes=1");

    await expect(page.locator("main h1")).toHaveText(looseText("Sign-in & security"));
    await expect(createNewCodes(page)).toBeVisible();
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(regenerations).toEqual([]);
  });

  test("TP-4.32x: the step-up lapses during a setup the server finds expired: Verify and turn on asks for the password first; after Confirm the expired state 'Setup timed out. Start again.' shows", async ({
    page,
    request,
  }) => {
    // The server answers CONFIRMATION_REQUIRED before TWO_STEP_SETUP_EXPIRED (TP-4.6x in
    // server-int); the retry after the step-up is routed to 410. The client's own clock check (f)
    // doesn't fire: the secret's expiresAt is still ahead.
    const { email } = await signedUpUser(page, request, "Lapsed Setup Person");
    await page.goto("/settings/security");
    await expect(page.locator("main h1")).toHaveText(looseText("Sign-in & security"));
    await twoStepSection(page)
      .getByRole("button", { name: catalogText("Turn on") })
      .click();
    const main = page.locator("main");
    await expect(main.locator("h1")).toHaveText(looseText("Turn on two-step verification"));
    await expect(main.getByLabel(catalogText("Code"))).toBeVisible();
    await unconfirmSessions(request, email);
    const order: string[] = [];
    page.on("response", (r) => {
      if (isPost("/api/v1/me/two-step/enable")(r)) order.push(`enable ${String(r.status())}`);
      if (isPost("/api/v1/me/confirm")(r)) order.push(`confirm ${String(r.status())}`);
    });
    let enables = 0;
    await page.route("**/api/v1/me/two-step/enable", async (route) => {
      enables += 1;
      if (enables === 1) {
        await route.continue();
        return;
      }
      await route.fulfill(
        json(410, {
          defined: true,
          code: "TWO_STEP_SETUP_EXPIRED",
          status: 410,
          message: "Two-step setup expired",
        }),
      );
    });

    await main.getByLabel(catalogText("Code")).fill("123456");
    await main.getByRole("button", { name: catalogText("Verify and turn on") }).click();

    const dialog = confirmDialog(page);
    await expect(dialog).toBeVisible();
    await expect(main.getByText(looseText("Setup timed out. Start again."))).toHaveCount(0);
    await dialog.getByLabel(catalogText("Password")).fill(E2E_PASSWORD);
    await dialog.getByRole("button", { name: catalogText("Confirm") }).click();

    await expect(dialog).toHaveCount(0);
    await expect(main.getByText(looseText("Setup timed out. Start again."))).toBeVisible();
    await expect(main.getByRole("button", { name: catalogText("Start again") })).toBeVisible();
    expect(order).toEqual(["enable 403", "confirm 200", "enable 410"]);
  });
});

test.describe("TP-4.49 (g): the rate-limit notice and recovery mode (A-107)", () => {
  /** auth.verifyTwoStep answering RATE_LIMITED (60 s). */
  async function routeRateLimited(page: Page): Promise<void> {
    await page.route("**/api/v1/auth/two-step/verify", (route) =>
      route.fulfill(
        json(429, {
          defined: true,
          code: "RATE_LIMITED",
          status: 429,
          message: "Too many requests",
          data: { retryAfterSeconds: 60 },
        }),
      ),
    );
  }

  test("TP-4.49 (g): a 6-digit code answered RATE_LIMITED, then Use a recovery code instead: neither the rate-limit notice nor 'You can still use a recovery code.'; switching back shows both again", async ({
    page,
    request,
  }) => {
    const { email } = await createUser(request);
    await routeRateLimited(page);
    await routedSignInToTwoStep(page, email);
    await codeField(page).fill("123456");
    await verifyButton(page).click();
    const main = page.locator("main");
    const notice = main.getByRole("status").filter({ hasText: /Too many attempts/ });
    const hint = main.getByText(looseText("You can still use a recovery code."));
    await expect(notice).toBeVisible();
    await expect(hint).toBeVisible();

    await main.getByText(catalogText("Use a recovery code instead")).click();

    await expect(main.getByLabel(catalogText("Recovery code"))).toBeVisible();
    await expect(notice).toHaveCount(0);
    await expect(hint).toHaveCount(0);

    await main.getByText(catalogText("Use a code from your app")).click();

    await expect(codeField(page)).toBeVisible();
    await expect(notice).toBeVisible();
    await expect(hint).toBeVisible();
  });
});
