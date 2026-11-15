---
module: identity
doc: lld-brief
summarises: lld.md v0.26
---

# Identity: LLD brief

A human-readable summary of [the LLD](./lld.md) for review and approval. The LLD is the contract the agents build from; this brief is what the owner reads. If the two ever disagree, the LLD wins and the brief is out of date.

**What's new in v0.7 to v0.12:** the design was written against an early draft of the platform; since then the platform was built, with about 500 fixes and clarifications. v0.7 checked every place identity relies on the platform against the platform as it was actually built, and corrected the names, files and test helpers it uses. The plan reviewer then asked for changes, which v0.8 to v0.10 make: mostly the build order (each slice now adds only what it builds), how the automatic browser tests get the situations they need, a few platform tests that must change once identity is plugged in, and (v0.9) who switches the web app's language after sign-in, what a browser with an outdated "signed in here" marker sees, and how the Android app recovers when the server can't be reached. Most of what identity does for you is unchanged, but four things are small visible changes: items 8b, 11 and 12, and one wording effect in item 7. **v0.11 records your answers of 2026-11-14** to every item that needed your confirmation. One thing changed: sessions have no absolute time limit any more (item 1). Everything else you confirmed as recommended, so items 1, 8b, 9 to 12 and 18 now read as decided. The plan reviewer accepted the session-lifetime change and asked for fixes, which **v0.12** makes: how a renewal locks the database, a sturdier test for long-lived sessions, and an hourly clean-up of old sign-in tokens (item 1). **This version is approved** (2026-11-14), after passing plan re-review. **v0.13** adds six small clarifications from the start of the build (amendments A-1 to A-6). They pin down details the tests needed: how an email-sending error is built, how a cookie's lifetime is rounded, which files hold shared types, how the database helpers are laid out, exactly what the email job logs, and exactly which users the development seed creates. The seed creates two users, an owner and a member invited by the owner, both with the development password and a confirmed email address; it doesn't create invitation records. None of the six changes anything you'd see in the product. **v0.14** adds three more (A-7 to A-9) for the Android app's sign-in storage: how the encryption can be tested without a real phone's secure key store, the exact shape of the stored sign-in data, and when the app attaches your sign-in token to a request. One small safety rule is new: the app sends the token only to the Budmon server it was built for, never to another address. If the stored data can't be decrypted (for example after a phone restore), the app wipes it and asks you to sign in again, as before.

**During the build (v0.13 to v0.26):** details settled while building S-0, as amendments A-1 to A-36. A-1 to A-22 are planner decisions that need no input; A-23 to A-26 are items 19 to 21 below. The ones worth knowing: platform tests now check the platform's own tables by name instead of assuming they're the only ones (A-10, platform A-512); and security emails say what happened in one sentence each, with the authenticator email worded as in the design ("Your two-step verification app was changed", A-11); each security email shows the exact time of the event it reports, and "already uses Budmon" messages name the address you typed (A-16, A-17); lists that page through users and invitations no longer skip rows created at the same moment (A-15).

## 1. What this builds

When identity is done, Budmon has real users:

- **Getting in:**
  - You create the first (owner) account with one command on the laptop.
  - Everyone else joins from an emailed invitation, with a password or with Google.
  - People sign in on the web and on Android and stay signed in as long as they use the device at least once every 30 days; there's no fixed limit after which they must sign in again.
  - Two-step verification with an authenticator app is optional, with ten recovery codes.
  - Forgotten passwords are reset by email.
- **Settings:**
  - Name, base currency, time zone, language and appearance (System, Light or Dark).
  - Sign-in methods: password, Google, two-step, and the list of signed-in devices.
  - Inviting people within an allowance.
  - Exporting all your data as a ZIP of CSV and JSON.
  - Deleting your account with a 7-day undo.
- **For other modules:** the "who is calling" check on every request, a way to look up a user by exact email, attribution names, and hooks that let each module take part in data export and account erasure.
- **For the admin portal (built next):** ready-made operations for the owner: list users and invitations, set the user cap and allowances, delete or ban users, and reset someone's two-step verification. The portal's screens and audit log are `admin`'s.

Deliberately left out: changing your email address, passkeys, other sign-in providers, a "recent security activity" screen (events are recorded, not shown), copyable invitation links, and (until there's a domain) opening invitation links straight in the Android app.

## 2. Needs your attention

| # | Item | Why it matters | LLD ref |
| - | ---- | -------------- | ------- |
| 1 | **Your answers (2026-11-14). Changed: no absolute session limit.** The design had proposed asking everyone to sign in again 90 days after signing in, however often they use Budmon. You chose instead that a device used at least once a month is never asked again. A session still ends after 30 days without use, and the sign-in check behind each request still renews every 15 minutes. The LLD drops the 90-day limit entirely (its database column, its setting and its checks), and the tests now prove a session renewed every 29 days still works after 100 days. **Storage:** each renewal stores one small row (about one per 15 minutes of use, about 1,000 a month for heavy web use); an hourly clean-up deletes the old ones after 90 days, so a device keeps about 3,000 (up to about 8,600 if it's in use around the clock). Someone replaying a token older than that is simply refused, without the alert a newer stolen token triggers. **Against the usual standard:** the security standard Budmon follows (OWASP ASVS) asks apps with sensitive data to make people sign in again every 12 hours, or after 30 minutes unused; Budmon's 30 days is far looser, by your choice. **The trade-off you accepted:** if someone steals a device's sign-in and keeps using it, no time limit ends it. What ends it: Budmon notices as soon as your own device renews too, and ends that session on both devices with an email to you; you can see and sign out any device in the devices list; and resetting or changing your password signs out the other devices. **Confirmed as recommended:** sharing invitations count against the inviter's allowance; you can turn off someone's two-step verification (they're emailed and signed out everywhere); finding users by exact email only (no invite links yet); all security notices are emailed. | Decided. | HLD D-2, D-10, D-25, D-20, D-19; F-1, F-23 to F-25, TP-3.8 |
| 2 | **New table `known_devices`** (DV-2), for a fairer sign-in limit. A stranger hammering your email address can block password sign-in only from devices that have never signed in before. Your own phone and laptop keep working. | It's the answer to "limit guessing without letting someone lock you out". | §1 LD-1, §3.1 |
| 3 | **Cookies on `http://localhost` aren't `__Secure-` prefixed** (DV-3). They're still `Secure` and `HttpOnly`. The choice is made by the address the browser used, and each kind of cookie is accepted only where it belongs. | It removes a browser-compatibility risk on the laptop. A spike test still checks that the browsers keep the cookies. | §1 DV-3, TP-0.30 |
| 4 | **The capture worker can read the whole `users` row**, including email and name; it still can't see any password, session or code (DV-4). | The platform only supports table-level grants. Column-level grants would be a platform change. | §3.2 |
| 5 | **Lifetimes are constants in code**, not settings (DV-1). | Changing "30 days" means a small code change, not an environment variable. | F-1 |
| 6 | **A few extra error cases** beyond the HLD's list (DV-5): for example "your Budmon account is connected to a different Google account", "the owner can't delete their own account", and "your account is already being deleted" (cancelling is refused once the 7 days are up). | They make edge cases explicit; wording is in §8.1. | §6 |
| 7 | **Re-checked against the platform as built (v0.7).** The main corrections: identity plugs into the platform's real "plug-in points" (the job list, the handler list, the table permissions, the seed list, the public-procedure list, the router and the containers); email settings come ready-parsed from the platform's configuration; Google's PKCE step reuses the platform's helper; the bootstrap command follows the platform's command rules (usage errors before any settings are read, exit 78 for bad settings); web texts follow the platform's lint rules (`{appName}` for the product name, page titles from each page's heading, error message names like `error.invalidCredentials`); the Android app wires into the platform's network client and screen host. **One visible effect:** when a form field fails one of identity's own checks (for example an unsupported language or time zone), the web shows the platform's generic "Enter a valid value." under that field rather than a specific message, because the platform's form helper words only its five standard checks. Otherwise nothing you'd see changes. | Identity's build can start from today's platform without guessing. | §1.1, changelog v0.7 |
| 8 | **Platform requests.** All twelve earlier requests (PA-1 to PA-12) are built into the platform. v0.7 adds three small ones: **PA-13**, landed as platform amendment **A-509** (docs only): the automatic browser-test stack lets a module add its settings and test helpers, so identity's tests can use a fake Google, a test mailbox and their own pretend network addresses. **PA-15**, landed as **A-510** (docs only): once identity's home page takes over `/`, the platform's placeholder page moves to a test-only address so two platform browser tests keep working. v0.8 adds **PA-16**, landed as **A-511** (docs only): about ten of the platform's own tests check the platform with no module plugged in (for example "the seed list has exactly one entry", or "a deletion replay with no erasure handler stops"); each now says what it expects once identity is plugged in, from the identity slice that changes it. **PA-14** is a platform gap identity fixes in its sign-up slice (S-1), with no design change: the platform's design says the server image includes each module's data files, but the built image doesn't yet copy them (identity is the first module with one, the list of common passwords). | All small; the code for them is written in identity's first slices. | §1.1 |
| 8b | **A browser that has never signed in doesn't ask the server about a session** (HLD D-24 amended in v0.7, planner decision). The web app keeps a small "has signed in here" marker in the browser. Without it, the sign-in page shows at once. Before, every first visit made two failing requests, which browsers log as errors, and the built platform's checks require a first visit with none. The marker only decides whether to ask; the server still decides whether you're signed in. If the marker is missing while you are signed in (for example after clearing site storage), you just sign in again. | Decided: confirmed by you, 2026-11-14. | HLD D-24, F-152, TP-1.38 |
| 9 | **Reset links open in the phone's browser for the MVP** (LD-9). Your delegated decision Q-1 (a), confirmed by you on 2026-11-14. | Decided. The Android app doesn't open reset links itself. | §1 LD-9 |
| 10 | **Two tabs refreshing at once never sign you out** (DV-9). The reviewer's option (a), taken under your delegation. The approved HLD's D-3 was amended to match, as HLD v0.6 (a one-line change). Confirmed by you on 2026-11-14. Theft detection is unchanged. | Decided. | §1 DV-9, F-25, HLD v0.6 |
| 11 | **Invitation links open in the Android app only from stage 1** (LD-11, new in v0.7). The HLD already said "from stage 1"; v0.7 makes it explicit that this build doesn't add it, because the platform has no stage-1 app build yet and the laptop has no domain to verify. On the phone you paste the link (or open it in the browser). | Decided: confirmed by you, 2026-11-14. It's tracked as a stage-1 gate item (HLD §12). | §1 LD-11, F-219 |
| 12 | **The Android app stays usable offline after a restart** (new in v0.7). If the phone starts without a connection, you stay signed in (offline entries keep working) and your profile loads once you're back online. If the stored sign-in has already expired, the app goes straight to the sign-in screen. If the phone is online but Budmon can't be reached (the laptop asleep, or Tailscale off on the phone), screens that need your profile say "Budmon is temporarily unavailable. Try again in a few minutes." with a **Try again** button, rather than "You're offline"; the app also retries by itself when you come back to it and every so often (15 seconds at first, slowing to every 5 minutes). Nothing about you is stored on the phone beyond the encrypted sign-in tokens. | Decided: confirmed by you, 2026-11-14. | F-207, TP-3.49 |
| 13 | **Google sign-in errors land on the sign-in page.** When Google returns to Budmon with an unknown or expired request, you land on `/sign-in` with "Google sign-in didn't complete. Try again." (as the HLD says). Errors on a known request return to the page that started it. | What you'll see when something goes wrong mid-way. | F-82 |
| 14 | **Admin can record its audit entry in the same step** as each owner action (delete, ban, reset two-step, and so on), and the user-cap email reaches you even when the inviter's account is gone. | Fits the admin portal built next. | F-125, F-32 |
| 15 | **Other recorded deviations:** no separate "event fan-out" job (DV-6); Edge checked by you rather than automatically (DV-7); the module's files are flat in one folder so the platform's checks cover them (DV-8). | Low impact; listed for completeness. | §1 |
| 16 | **Manual checks only you can do** (TP-M.1 to TP-M.6): signing in on the laptop and phone, real Google sign-in (web from the laptop; Android), a real authenticator app, the bootstrap command on Windows, Mailpit emails, and sign-in in Edge. The Android tests themselves run in GitHub's `android` job, because the build environment has no Android SDK. | The build environment has no Windows, Android SDK, real Google or real SMTP. | §10.1 |
| 16b | **Signing out on the web needs the server.** If the sign-out request fails (no connection, server down), you stay signed in and see an error, rather than the page pretending you're signed out while the session stays valid. The web app can't remove its sign-in cookies by itself (they're hidden from page scripts on purpose). | Safer for a shared computer; you just try again. Planner decision. | F-152 |
| 17 | **Before the first invitation (stage-1 gate):** register the Google sign-in client and Android client IDs, choose the email provider, and set the `budmon.com` redirect. On the laptop now: answer `budmon-local install`'s Google prompts and set the client secret with `budmon-local secret set main/api/GOOGLE_SIGNIN_CLIENT_SECRET`. | Configuration only; no code change. | §7.1, §7.2 |
| 18 | **Approval of this re-baseline.** The plan reviewer had asked whether your standing delegation covered approving the re-baseline, since it slightly changed an approved decision (8b) and added items 11 and 12. Answered: you reviewed 8b, 11 and 12 yourself and accepted them (2026-11-14). v0.12 passed plan re-review and was approved on 2026-11-14. | Only you approve design documents. | Plan review Q-1 |
| 19 | **The name: wDit (A-23, A-26; your decision of 2026-11-15).** Screens don't say the name ("Sign in", "You've been invited", "Welcome, Mona."); the header shows it. Emails, browser tabs and the privacy notice say "wDit": the emails keep the wording you approved before, with wDit where they said Budmon ("Mona invited you to wDit", "Reset your wDit password"), and the sender shows as "wDit". Authenticator apps show "wDit". The long form "Where did I tap" isn't used here. The header wordmark and the icons wait for the guide's updated brand section. Internal names (code, cookies, servers, the web address) stay "Budmon" until the separate rename. | Decided by you; the brand details are pending the guide. | §7.2, A-26 |
| 20 | **Appearance setting (A-24).** System (the default), Light or Dark, saved on your account with language and currency, under **Profile & preferences**. Each device remembers the last value, so the sign-in page already looks right. It arrives with the profile slice (S-7); until then the app follows the phone or computer. | Your decision UX-D4 and UX-D5. | A-24 |
| 21 | **A new first slice for the look (S-0b, A-25).** Before the sign-up screens, one slice builds the shared look from your guide: colours in both modes, fonts, buttons, fields, the empty state and the error page (which settles the old "Try again" styling question). The sign-up screens then use these pieces. On Android, Arabic words inside an English screen (a shop name, say) will use the phone's own Arabic font, not the bundled one, until Arabic testing starts; Arabic screens use the bundled font (you accepted this for now, 2026-11-15). | Keeps the look reviewable on its own. | A-25 |

## 3. Data

Fifteen new tables, all owned by identity. "Credential" tables are never readable by the capture worker; the platform's schema step refuses it if someone tries.

| Table | What it holds | On delete of the user |
| ----- | ------------- | --------------------- |
| `users` | Email (lower-cased, unique), name, language, time zone, base currency, status (active or pending deletion, and who asked), owner flag, invite allowance, who invited them, last active (hourly). | The row is deleted at erasure; everything below goes with it. |
| `password_credentials` ★ | The Argon2id password hash. | Deleted. |
| `google_identities` ★ | The linked Google account's ID and email. | Deleted. |
| `two_step_credentials` ★, `recovery_codes` ★ | The encrypted authenticator secret; recovery codes as keyed hashes only. | Deleted. |
| `sessions` ★, `session_refresh_tokens` ★ | One row per signed-in device; the device's refresh tokens from the last 90 days (hashed), so a stolen old one is recognised. Older ones are deleted hourly. | Deleted. |
| `known_devices` ★ | Devices that have signed in before (hashed tokens), for the sign-in limit. A device stays known after you sign out. | Deleted. |
| `auth_challenges` ★ | Short-lived steps: a pending two-step sign-in, a Google round trip, a sign-up ticket. | Deleted; also purged hourly. |
| `password_resets` ★ | Reset links (hashed). | Deleted. |
| `invitations` ★ | Invitations: email, inviter, status (pending, accepted, revoked, expired), hashed token. | Accepted ones go with the user; ended ones are purged after 90 days. |
| `email_bans` | Banned addresses (kept until you lift the ban). | Not tied to a user. |
| `identity_settings` | The user cap (default 90). | — |
| `security_events` | Security history per user (no IP addresses), kept 90 days. | Deleted. |
| `data_exports` | Export requests and where the file is. | Deleted, and the files are removed from storage. |

Nothing that grants access is stored in a usable form. Passwords are hashed; tokens are hashed; recovery codes are keyed hashes; the authenticator secret is encrypted.

**How the tables reach the laptop:** like the platform's, they arrive in the first release's single database migration, generated on the release branch. The identity branch itself carries no migration files (the platform's rule), and the generated SQL needs no hand edits.

## 4. API and screens

**API** (all under `/api/v1`, about 50 procedures):

- **Signing in** (`/auth/…`):
  - sign-in options;
  - sign in, two-step verify, refresh, sign out;
  - Google start/complete (web), Google nonce/token (Android);
  - password-reset request, check and confirm.
- **Your account** (`/me/…`):
  - your profile and preferences;
  - "confirm it's you";
  - connect/disconnect Google;
  - change/add password;
  - two-step setup, enable, disable, new codes, replace authenticator;
  - signed-in devices and signing them out.
- **Invitations** (`/invitations/…`): list, allowance, send, resend, cancel; preview and accept (public).
- **Others:** look up a user by exact email; data exports (list, request, download link); account deletion (check, request, cancel).
- **One route outside the API description:** Google's return address. It only ever redirects back into the app.
- **Test-only helper addresses** (`/api/v1/__test/…`) exist only in the automatic browser-test stack, never on the laptop.

**Screens** (web and Android): sign in; two-step code; forgot password and new password; invitation landing, account set-up and invitation problems; Android's "paste your invitation link"; settings home; profile and preferences; sign-in and security (password, Google, two-step, devices); two-step setup with QR code and recovery codes; invite people; your data (export); delete account; the "account will be deleted" banner; the "confirm it's you" dialog; the first-run home ("Welcome to Budmon, {name}."); and a public privacy notice at `/privacy` (its full text is in the LLD, §8.3). Every screen has its empty, loading, error and long-content states, every message is listed word for word in the LLD, and every web page's browser-tab title follows its heading.

## 5. Functions at a glance

| Area | Functions | Responsibility | Worth a look |
| ---- | --------- | -------------- | ------------ |
| Foundations | F-1 to F-39 (about 36) | Constants, token and cookie helpers, metrics, repositories, session creation, the per-request sign-in check, limits, email sending and templates, jobs, wiring into the platform. | **F-24** the per-request check (cookies only from the web app; bearer only from Android). **F-32** invitation and reset links are created inside the email job, so the link never sits anywhere else. **F-34** how identity plugs into the platform's containers. **F-39** password hashing with a cap on parallel work. |
| Sign-up and bootstrap | F-40 to F-47 | Invitation preview and acceptance; the owner bootstrap command and its laptop wrapper. | **F-41** the user cap is re-checked when someone accepts. **F-46/F-47** the owner link is printed only to your terminal and never reaches logs. |
| Sign-in, sessions, step-up | F-50 to F-59, F-25, F-130 | Password sign-in, two-step at sign-in, refresh, devices list, "confirm it's you", hourly clean-up. | **F-25** the refresh rules that catch a stolen refresh token without signing out honest users. **F-50** the limits that stop guessing without letting a stranger lock you out. |
| Two-step | F-60 to F-68 | Authenticator codes, recovery codes, setup, turning off, new codes, new phone. | **F-62** authenticator codes are limited per person, recovery codes aren't, so a password thief can't lock you out. |
| Passwords | F-70 to F-74 | Reset by email, change, add. | **F-72** a reset still asks for the two-step code and signs out every other device. |
| Google | F-80 to F-88 | Web round trip, Android sign-in, linking, confirming. | **F-86** automatic linking only for Google-verified emails, and only after two-step. |
| Profile, invitations, lookup | F-90, F-95 to F-106 | Preferences, invitations with allowance and cap, exact-email lookup, names for other modules. | **F-95** the exact order of refusal reasons. |
| Export and deletion | F-110 to F-119 | ZIP export; deletion with grace, erasure across modules, replay after a restore. | **F-118** erasure writes its log record first and is safe to repeat. |
| Owner services | F-125 | Operations for the admin portal. | **Ban** closes the account at once and erases it within minutes. |
| Web and Android | F-150 to F-174, F-200 to F-220 | Screens, silent session renewal, error wording, encrypted token storage on Android, Credential Manager. | **F-150/F-203** single-flight renewal on both apps. **F-205** unsynced offline entries never sync into another person's account. |

## 6. Build plan

| Slice | Delivers | How you'd see it working | Depends on |
| ----- | -------- | ------------------------ | ---------- |
| S-0 | Foundations and wiring into the platform (no screens or API calls yet) | Tests pass; the platform's own tests pass, with the changes A-511 describes; the email job sends through a test mailbox | The platform as built (v1.29), plus the docs-only v1.30 and v1.31 |
| S-0b | The look from your UX guide (colours, fonts, buttons, fields, light and dark, the error page) and the new name | Platform pages in both modes; the header says "wDit"; emails use the new name | S-0 |
| S-1 | Sign-up from an invitation with a password, the web app's start-up and Android's session state | An invitation link creates an account on web and Android; a first visit shows the sign-in page without errors | S-0 |
| S-2 | Owner bootstrap | `budmon-local bootstrap-owner` prints a link that makes you the owner | S-1 |
| S-3 | Sign-in, sessions, "confirm it's you" | You stay signed in; the devices list works; sign-out works | S-1 |
| S-4 | Two-step verification | Your authenticator app's codes are asked for at sign-in | S-3 |
| S-5 | Password reset and changes | "Forgot password?" emails a working link | S-4 |
| S-6 | Google Sign-In | "Continue with Google" works on the laptop's browser and on Android | S-4 |
| S-7 | Profile and preferences | Language and appearance change instantly; base currency asks first | S-3 |
| S-8 | Invitations | You invite someone; they receive the email (Mailpit) and join | S-3 |
| R-1 | Checkpoint (no new code): the release rehearsal's three identity steps | The rehearsal's owner, email and Google steps run and leak nothing | S-2, S-5, S-6, S-8 |
| S-9 | Finding a user | Exact-email lookup for sharing | S-3 |
| S-10 | Data export | A ZIP with CSV and JSON downloads, named `budmon-export-<date>.zip` | S-3 |
| S-11 | Account deletion | Delete, undo within 7 days, full erasure after | S-8, S-10 |
| S-12 | Owner services | Ready for the admin portal | S-11 |

Every slice lists its tests by part (server, web, Android, manual), and every slice with an Android part is done only when GitHub's `android` job is green. The plug-in points grow with the slices: a slice adds only the jobs, procedures and hooks it actually builds, so each slice can start and pass its tests on its own. The release-rehearsal cases wait for checkpoint R-1, the first point where all three identity steps can pass; before it, no rehearsal is run with identity.

## 7. Testing

About 230 test cases:

| Type | Count | What |
| ---- | ----- | ---- |
| Integration | ~140 | Real Postgres, in-process HTTP, the jobs, a fake Google with real signed tokens, and an in-memory mailbox |
| Unit | ~35 | Server and web |
| Android | 13 | Run in GitHub's `android` job |
| End-to-end | ~38 | Playwright in Chromium (and right-to-left), with a fake Google, a test mailbox and test-only helpers for situations a fresh test can't reach (an old session that needs "confirm it's you", a full Budmon, deletion blockers); three cases in the release rehearsal, at checkpoint R-1 |
| Manual | 6 | The owner, on the laptop and phone |

What the tests cover:

- **Every error and every boundary:** an invitation expiring at exactly 7 days; a session at exactly 30 days without use, one renewed every 29 days that still works after 100 days; and old tokens cleaned up at exactly 90 days; both 60-second windows of the refresh rules, including the "thief redeems an old token while your device is in use" case.
- **Authorization across users:** you can't see or cancel someone else's sessions, invitations or exports.
- **Privacy "canary" tests:** fake emails, passwords and tokens go through every flow, and the logs, traces, error reports and job records must never contain them.
- **The credential-table rule:** the capture worker's database role is refused on every credential table.
- **Erasure:** a guard test fails if any future table references users without being erased.
- **The platform still works:** the platform's whole test suite runs with identity present. About fifteen platform tests that assumed "no module plugged in" change as platform amendments A-511 and A-512 state (A-512, from S-0: tests that expected only the platform's four tables now check those by name), each in the identity slice that affects it; every other platform test runs unchanged.
- **The release rehearsal:** the three identity steps (owner bootstrap, emails, Google) run inside the platform's rehearsal, from checkpoint R-1 (after S-8), because the email step needs invitations (S-8) and resets (S-5), and the Google step runs only after it. Before the first release there are no committed migrations, so QA runs it locally with a throwaway one (the platform's procedure), and the "broken on purpose" rehearsal runs on the pull request exercise it too.

Not covered automatically: real Google, real SMTP, Android on a device, Windows and Edge. These are the manual cases TP-M.1 to TP-M.6.

## 8. Risks

- **Google on the laptop:** until there's a domain, web Google sign-in works only in a browser on the laptop itself; the phone's browser shows a note. The Android app's Google sign-in isn't affected.
- **Mailpit in stage 0:** emails stay on the laptop (readable at `http://127.0.0.1:8025`). Fine while you're the only user.
- **Platform alignment:** identity is now aligned with the platform as built (v1.29) and its docs-only amendments A-509 to A-511 (v1.30, v1.31), which identity's slices build. A later platform change to a name identity uses needs an identity amendment.
- **Two technical checks happen early in the build:** that the server can set several sign-in cookies in one answer through the API framework (TP-0.33), and that browsers keep `Secure` cookies on `http://localhost` (TP-0.30). If either fails, the planner decides the fix as an amendment before later slices start.
- **Later modules must join erasure and export:** every module that stores user data registers how it's erased and exported. The guard test catches the ones that forget.
- **Sessions in use never expire on their own** (your choice, item 1): a stolen sign-in that keeps being used is ended by theft detection, the devices list or a password change, not by a time limit.
- **Lost authenticator and lost codes:** only you, as owner, can help (by turning two-step off for that user). The user is emailed when you do.
