// S-4 two-step verification in the browser (identity LLD §8.1, F-156, F-164, F-165, F-166; HLD J-5,
// J-7, J-15, J-21; A-99 to A-104): TP-4.30 to TP-4.33, TP-4.39, TP-4.43, TP-4.44, TP-4.46, plus
// extra cases ending in "x".
// IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
//
// Each test signs up its own user and turns two-step on from Sign-in & security's Turn on (§10.1);
// codes come from TestAuthenticator, which may wait for the next 30-second step, hence the longer
// timeout. TP-4.39's sign-in page cases route the first factor instead (no real two-step needed).
import { readFile } from "node:fs/promises";
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
    await expect(dialog.getByLabel(catalogText("Code"))).toBeVisible();
    await expect(dialog.getByLabel(catalogText("Password"))).toHaveCount(0);
    await expect(dialog.getByRole("button", { name: catalogText("Verify") })).toHaveCount(0);
    const code = await auth.nextCode();
    const fresh = page.waitForResponse(
      (r) => isPost("/api/v1/me/two-step/recovery-codes")(r) && r.status() === 200,
    );
    await dialog.getByLabel(catalogText("Code")).fill(code);
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
    await expect(dialog.getByLabel(catalogText("Code"))).toBeFocused();
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
    await dialog.getByLabel(catalogText("Code")).fill(await auth.nextCode());
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
    await dialog.getByLabel(catalogText("Code")).fill(await auth.nextCode());
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
