---
module: identity
doc: hld
status: approved # draft | in-review | approved
version: 0.7
author: planner
approved_by: the user (project owner), delegated auto-approval
approved_on: 2026-10-07
---

# Identity: High-Level Design

Who a Budmon user is, how they get in (invitation, password, Google, two-step verification), how they stay in (sessions), their preferences, and their control over their own data (export, deletion). It also gives every other module the authenticated principal, user lookups, and the extension points that deletion and export need.

Sources: [spec summary](../../product/spec-summary.md) v0.10 §4.1 (`IDN`), §3 (XC-n), §4.13 (`ADM`, identity's dependants), §5 to §8; the user's answers in [round 4](../../product/notes/2026-10-04-round-4-answers.md) (R4), [round 5](../../product/notes/2026-10-04-round-5-answers.md) (R5), [round 6](../../product/notes/2026-10-05-round-6-answers.md) (R6), [platform decisions](../../product/notes/2026-10-05-platform-decisions.md) (PD); the [codebase review](../../product/codebase-review.md) (CR); the approved [platform HLD](../platform/hld.md) v1.3 (cited as **P-D-n**, **P-§n**) and [platform LLD](../platform/lld.md) v1.30, as built on `feat/platform` (cited as **P-F-n**; v0.7 re-checked every citation against it).

## Changelog

| Version | Date | Change |
| ------- | ---------- | ------ |
| 0.1     | 2026-10-07 | Initial draft |
| 0.2     | 2026-10-07 | Plan review round 1 (REVISE). **P-1:** refresh tokens of a session kept as a family in the new `session_refresh_tokens` table until the session is purged; any superseded token other than the benign predecessor revokes the session; the predecessor is benign only while the current token has never been presented (no time window; also covers S-2); exactly one access token per session, replaced at every rotation; a refresh token presented through the other channel is refused (D-3, D-4, §3, F-2, §9). **P-2:** Google is offered on every app origin; the callback origin registered with Google and the app origins that may start a flow and receive a hand-off are separate settings; `auth.methods` reads the request's `Origin` header and reports when Google works only in a browser on the laptop (D-6, §5.3, J-4, PA-3). **P-3:** the callback's `code`/`state` query string is a stated exception with mitigations, and a platform amendment (§5.3, D-6, PA-4). **P-4:** an automatic Google link is held in the pending sign-in and committed, recorded and emailed only when sign-in completes, after the second factor (D-7, J-4, F-1, F-3). **P-5:** an unverified Google email gets one generic response whether or not it matches a user (D-7, J-4, §4.9). **P-6:** one per-user second-factor limiter (10 / 15 min, 30 / day) across sign-in, reset, step-up and turning two-step off; a reset link dies after 5 wrong codes (D-8, D-13, D-18). **P-7:** recovery codes are shown once and never again; leaving without confirming leaves a prompt to create new ones (J-7). **P-8:** the bootstrap command mints its own token, prints the link and sends no email; it's refused while an owner or an unexpired bootstrap invitation exists, unless `--replace` (J-16, D-21). **P-9:** `expired` is a stored invitation status, set by the purge job and on access in the same transaction; the pending-email index, allowance, cap and lifecycle agree (§3.1, §3.3, D-10). **P-10:** Google hand-over defined: a sign-up ticket bound to the invitation carries verified claims into `invitations.accept`; link and confirm run through authenticated `me.google*` procedures bound to the session, and confirm requires the linked Google account; return paths after a redirect (D-6, D-7, D-9, F-3, F-4, F-5). **P-11:** journeys J-17 to J-21 (change password, add a password, connect and disconnect Google, replace the authenticator); session revocation rules per action (D-3); missing states for S-3/S-4, S-7, S-8, S-11, S-15, S-16, S-17; Android invitation-link screen S-17 with wireframe and errors; when one-tap appears. **P-12:** owner services specified as contracts with effects, including `listInvitations`, owner invitations, and bans that close the account at once (§5.2). **P-13:** PA-2 adds Mailpit's quiet logging and the rehearsal's email path; new secrets classified under platform D-20 (the recovery-code key ring is data-bound and carried over); the callback exception added (§5.6). **Owner decisions** (delegated; recorded as "recommended default — needs user confirmation"): 90-day absolute session lifetime (D-2), sharing invitations count against the allowance (D-10), the owner may reset a user's two-step verification (D-25), user lookup by exact email only for the MVP (D-20), security notices are account email (D-19). §11 is now empty. **Suggestions applied:** S-1 (D-4), S-2 (D-3), S-3 (§7.3), S-4 (D-13), S-5 (D-8, D-19), S-6 (J-7, J-21), S-7 (D-15), S-8 (§5.4), S-9 (D-13), S-10 (§7.1), S-11 (A-10), S-12 (D-5), S-13 (§5.2), S-14 (§3.1), S-15 (§4.9), S-16 (D-16), S-17 (PA-1), S-18 (v0.1's PA-4 dropped), S-19 (PA-5), S-20 (§5.2), S-21 (§9). None declined. |
| 0.3     | 2026-10-07 | Plan review round 2 (REVISE). **P-1:** the bootstrap command gets a platform entry point and stays out of Docker logs. New PA-6: an explicit `identity:bootstrap-owner` row in platform F-93 with config kind `api` (whose `PUBLIC_ORIGIN` builds the link; worker-general's `PUBLIC_ORIGIN` from PA-2 holds the same value for email links), and a `budmon-local bootstrap-owner` wrapper that runs it with `docker compose exec -T` in the running `api` container, whose output the logging driver doesn't capture. The token goes to stdout only, never through the logger (D-21, J-16, §5.6). **P-2:** the shared per-user limiter now covers TOTP codes only. Recovery codes are exempt (60-bit, unguessable; per-IP and per-challenge limits apply), so someone who knows the password can't lock the user out; a test is required (D-8, D-18, J-5). **P-3:** the binding cookie is scoped to `Path=/api/v1`, so `me.google*` link and confirm flows receive it (§5.3, F-3, §7.5). **Suggestions:** S-1 a superseded token that was never presented gets `REFRESH_INVALID` without revocation, and clients still serialise refreshes (D-3, F-2); S-2 `parent_id` on refresh tokens (§3.1, D-3); S-3 the idle-device predecessor-theft case added to §9; S-4 state rows moved from §4.2 to §4.4; S-5 a ban can't be cancelled, and the ban's single email comes from `identity.erase-user` (§5.2, D-15); S-6 `invitations.accept` with a Google ticket re-checks the ban list and that the `sub` is unlinked (F-5, §5.3). None declined. |
| 0.4     | 2026-10-07 | Plan review round 3. **P-1:** the race tolerance for never-presented superseded tokens is now time-bound. Only the benign path creates such a token. Presented within 60 seconds of that supersession, it gets `REFRESH_INVALID` without revocation (the out-of-order-response race). Presented later, it revokes the session, records the security event and emails the user, as in v0.2. So a thief who redeems the predecessor is detected as soon as the legitimate device refreshes again. The Android app-killed case is unaffected: that device presents the predecessor and takes the benign path. D-3, F-2 and §9 updated; the LLD race test covers both sides of the window. **S-1:** the per-email sign-in limit as a way to block a user's password sign-in is noted, and the counting scheme is left to the LLD (D-18). **S-2:** J-16 tells the owner to use `--replace` if the link may have been seen elsewhere. |
| 0.5     | 2026-10-07 | Final plan-review check. **P-1:** the no-revocation tolerance is keyed to the race's signature. It applies only when the benign path discarded the token within 60 s of its issue **and** the token is presented within 60 s of being discarded. Any other discarded token revokes the session, records the event and emails the user. So an active device whose access token dies when a thief redeems the predecessor is detected on its immediate refresh. D-3, F-2 and §9 updated; the LLD test adds "predecessor redeemed long after issue, device active". |
| 0.5     | 2026-10-07 | **Approved** under the owner's standing auto-approval ("auto approve the hlds as well just keep going man", 2026-10-07) after plan review: rounds 1–3 plus a final focused check, whose last finding (refresh tolerance keyed on issue time) is applied exactly as the reviewer specified. The five recommended defaults remain flagged "needs user confirmation". No content change. |
| 0.6     | 2026-10-07 | Amended during the LLD's design (identity LLD v0.5, DV-9; plan review round 2, Q-1 (a) under the owner's standing delegation): D-3's in-window discarded token now gets a new token while the current token is its unused sibling, instead of always `REFRESH_INVALID`, so concurrent refreshes never sign the user out. The decision line and the F-2 sequence diagram's matching branch are updated ("new tokens if the current token is its unused sibling, else 401 without revocation"); detection of theft unchanged. Status stays `approved` (delegated amendment); **needs user confirmation**. |
| 0.7     | 2026-11-03 | **Re-baseline of platform citations** (identity LLD v0.7). One decision gains a clause: **D-24** — a browser that has never signed in skips the boot probe (a `localStorage` marker), because the built platform requires a first page load with no console errors (platform A-466) and the probe's two 401s would be logged as errors (planner decision; no product change). Sources now cite platform HLD v1.3 and platform LLD v1.30 as built; §5.6 records that PA-1 to PA-6 landed as platform A-1 to A-6; the §9 risk about unapplied platform amendments is replaced by the drift risk; "P-F-2" (a platform HLD flow, not a platform LLD function) is cited as the platform HLD's flow F-2. The recommended defaults (D-2, D-10, D-19, D-20, D-25) and D-3's v0.6 amendment stay flagged "needs user confirmation". Status stays `approved` under the owner's standing delegation (2026-10-07); this is a re-baseline revision. |

## 1. Context and requirements

### 1.1 Requirements

| Requirement | What identity must do |
| ----------- | --------------------- |
| IDN-US-1, IDN-BR-3 | Create a user only from a valid, unused, unexpired invitation, with email + password or Google; collect base currency, time zone (and language); hand off to the first-run empty state. Nothing may hard-wire invite-only (IDN-US-10 later). |
| IDN-US-2, XC-18 | Long-lived sessions on web and Android (about a month without signing in again); list and sign out sessions. |
| IDN-US-3 | Edit name, base currency, time zone, language; a time-zone change never moves stored dates. |
| IDN-US-4 | Password reset by emailed link; the link expires; other sessions are signed out. |
| IDN-US-5, IDN-BR-2 | Find another user by exact email only; no partial search, no directory. |
| IDN-US-6, XC-17 | Export everything the user owns as CSV and JSON, at any time. |
| IDN-US-7, XC-16 | Delete the user: confirmation, 7-day undo, sources disconnected immediately, sole-admin shared accounts handed over first, then full erasure; entries on shared accounts stay as "deleted user". |
| IDN-US-8, XC-18, A26 | Optional two-step verification with an authenticator app (TOTP); recovery codes on enrolment. |
| IDN-US-9 | Any user invites by email within their allowance; 7-day expiry; revocable; shared-account invitations (ACC-US-4) also invite to Budmon; the user cap (ADM-US-3) and email bans (ADM-BR-4) are enforced. |
| IDN-BR-1, A32, R5-Q5 | One user per email; Google sign-in with a password account's email links automatically **only when Google reports the email verified**; the sign-in Google account is independent of connected Gmail inboxes. |
| XC-27 | Email only for account matters: invitations, password reset, deletion notices (and the security notices this HLD adds, D-19). |
| `admin` (ADM-US-1 to 5, ADM-BR-1, 2, 4) | Identity holds the data admin manages and enforces: user status and last activity, the product-owner flag, invite allowances, the user cap, email bans; it offers service operations for admin's portal (D-21). |
| Platform obligations | `identity` provides the `AuthHook` and principal (P-F-54), the users table that `idempotency_records` references (P-§3.1), the `ErasureHandler` (P-F-146), the locale column (P-D-37), sign-in rate limits (P-D-22), the credential-table rule (P-D-19), the privacy notice content (P-D-29 gate item 15), and replaces the web `HomePlaceholder` (P-F-216). |
| CR §2.1, spec §7 | Replace the old auth flows (I-1 to I-14) while keeping the patterns; date of birth isn't collected. |

### 1.2 Goals

- Signing in is quick on both apps (one screen; one or two taps with Google or a password manager) and happens rarely (sessions last about a month).
- Credentials are safe by construction: nothing that grants access is stored in a usable form; every credential table is out of `budmon_capture`'s reach; no token ever appears in a URL path or query (except Google's single-use authorization code on its callback, a stated exception, §5.1), a log, a job payload or a telemetry event.
- Every sign-in path and every recovery path respects two-step verification when it's on.
- Deletion is real (erasure across every module, replayable after a restore) and reversible for 7 days.
- Other modules get one small, stable surface: the principal, a users reader, and registration points for deletion, export and account-share invitations.

### 1.3 Non-goals

- Open sign-up (IDN-US-10, Later). The design keeps it possible: the invitation check is one step in sign-up, and `email_verified_at` exists for a future verification flow.
- Changing the email address of a user (not in the spec's profile list; future work, §12).
- Passkeys / WebAuthn, SMS or email one-time codes as a second factor, "remember this device" for two-step verification.
- Sign-in providers other than Google.
- The admin portal's screens, owner-only procedures, audit log and feature switches (`admin`); the shared-account handover rules themselves (`accounts`, ADM-US-8).
- Notification preferences (`notifications`) and source management (`sources`).
- A user-visible security activity log (the events are recorded, D-19; showing them is future work).
- Storing IP addresses or locations of sessions.

## 2. Actors and stories

Actors: **invited person** (has an invitation, no user yet), **user**, **product owner** (a user with the owner flag, ADM-BR-1), **other modules** (system actors calling identity's services), **worker-general** (emails, exports, erasure).

| ID | Spec | Story |
| -- | ---- | ----- |
| US-1 | IDN-US-1, IDN-BR-3 | As an invited person, I want to create my Budmon user from my invitation with a password, choosing my base currency, time zone and language, so I can start. |
| US-2 | IDN-US-2, XC-18 | As a user, I want to sign in with email and password and stay signed in on web and Android for about a month, and to see and sign out my sessions, so I don't log in every time and stay in control. |
| US-3 | IDN-US-1, IDN-US-2, IDN-BR-1, R5-Q5 | As an invited person or user, I want to sign up and sign in with Google, with my existing password account linked automatically when Google confirms the email, so I can use the account I already have. |
| US-4 | IDN-US-8, A26 | As a user, I want to turn on two-step verification with an authenticator app and get recovery codes, so my data is safer. |
| US-5 | IDN-US-4 | As a user with a password, I want to reset a forgotten password by email, so I can get back in. |
| US-6 | IDN-US-3 | As a user, I want to edit my name, base currency, time zone and language, so totals and dates make sense to me. |
| US-7 | IDN-US-9, ADM-US-3, ADM-US-5, ADM-BR-4 | As a user, I want to invite someone by email within my allowance, see my invitations and revoke them, so they can join the group. |
| US-8 | IDN-US-5, IDN-BR-2 | As a user (through `accounts`' sharing screen), I want to find another user by their exact email, so I can share an account or lend to them. |
| US-9 | IDN-US-6, XC-17 | As a user, I want to export all my data as CSV and JSON, so I own my data. |
| US-10 | IDN-US-7, XC-16 | As a user, I want to delete my Budmon user with a 7-day undo, so I can leave completely. |
| US-11 | ADM-BR-1, P-D-29 (stage 0) | As the product owner, I want to create the first (owner) user from the command line on a fresh installation, so Budmon can be used before any invitation exists. |

Business rules carried through: IDN-BR-1 (D-7), IDN-BR-2 (D-20), IDN-BR-3 (D-10), ADM-BR-2 (D-10), ADM-BR-4 (D-7, D-10), PLT-BR-1 (§7.5), P-D-19's credential-table rule (§3.1, D-22).

## 3. Data model

### 3.1 Tables

All tables follow the platform conventions (P-§3.1): snake_case, UUIDv7 keys, `timestamptz` instants, `created_at`/`updated_at`, explicit `onDelete`. **Credential tables** (marked ★) hold anything that grants access or proves identity; they're never granted to `budmon_capture` (P-D-19) and never appear in exports.

| Table | New / changed | Purpose | Key columns | Relationships |
| ----- | ------------- | ------- | ----------- | ------------- |
| `users` | New (replaces the removed `users`) | The Budmon user: profile, preferences, lifecycle, and what `admin` manages. Readable by `budmon_capture` (time zone, locale, status). | `id`; `email` (normalised: trimmed, lower-cased; unique); `email_verified_at`; `display_name`; `locale` (BCP 47, P-D-37); `time_zone` (IANA); `base_currency` (ISO 4217); `status` (`active`, `pending_deletion`); `deletion_requested_at`, `deletion_scheduled_for`, `deletion_requested_by` (`self`, `owner`, `ban`); `is_product_owner` (at most one `true`, partial unique index); `invite_allowance` (integer ≥ 0, `null` = unlimited; default 3, R6-Q5); `invited_by_user_id`; `last_active_at` (hour precision). | `base_currency` → `currencies.code` (`restrict`); `invited_by_user_id` → `users.id` (`set null`). Referenced by every module's user-owned rows. |
| `password_credentials` ★ | New | The password hash, separate from `users` so the capture role never sees it. | `user_id` (PK); `password_hash` (Argon2id PHC string, D-5); `updated_at`. | `user_id` → `users` (`cascade`). |
| `google_identities` ★ | New | The linked Google account for sign-in (not Gmail capture, R5-Q5). | `id`; `user_id` (unique: one per user); `google_sub` (unique); `email_at_link`; `linked_at`; `last_used_at`. | `user_id` → `users` (`cascade`). |
| `two_step_credentials` ★ | New | TOTP enrolment (D-8). | `user_id` (PK); `secret_envelope` (`bytea`, sealed with the `api-secrets` key, P-F-114, AAD = table + user + purpose); `pending_secret_envelope` (a new secret during setup or authenticator replacement, J-21); `state` (`pending`, `enabled`); `pending_expires_at`; `last_used_step` (replay guard); `enabled_at`. | `user_id` → `users` (`cascade`). |
| `recovery_codes` ★ | New | One-time recovery codes (D-8). | `id`; `user_id`; `code_hmac` (HMAC-SHA-256); `used_at`; `created_at`. | `user_id` → `users` (`cascade`). |
| `sessions` ★ | New | One signed-in device (D-1 to D-4). | `id`; `user_id`; `delivery` (`cookie`, `bearer`); `client_kind`; `device_label`; `auth_method` (`password`, `google`, `reset`, `sign_up`); `access_token_hash` (unique; exactly one live access token per session), `access_expires_at`; `current_refresh_id`; `idle_expires_at`, `absolute_expires_at`; `confirmed_at` (last step-up, D-9); `last_used_at`; `revoked_at`, `revoke_reason`. | `user_id` → `users` (`cascade`). |
| `session_refresh_tokens` ★ | New | Every refresh token a session has ever issued (its family), so any superseded token can be recognised (D-3). | `id`; `session_id`; `parent_id` (the token it was issued from; null for the first); `token_hash` (unique); `generation` (1, 2, …; informational); `issued_at`; `first_presented_at` (null until the client uses it); `superseded_at`. Kept until the session row is purged. | `session_id` → `sessions` (`cascade`). |
| `auth_challenges` ★ | New | Short-lived, single-use state between steps (D-6 to D-9): `two_step` (pending sign-in, possibly carrying a pending Google link), `google_web` (state, PKCE, nonce, then hand-off), `google_nonce` (Android), `google_signup` (sign-up ticket with verified claims, bound to one invitation). | `id`; `kind`; `token_hash` (unique); `secondary_hash` (hand-off token); `binding_hash` (web binding cookie); `user_id` and `session_id` (nullable; set for `link`/`confirm` intents); `invitation_id` (nullable); `data` (`jsonb`: intent, app origin, return path, PKCE verifier, nonce, delivery, pending link, verified Google claims); `attempts`; `expires_at` (5 to 30 minutes by kind); `consumed_at`. | `user_id` → `users` (`cascade`); `invitation_id` → `invitations` (`cascade`). |
| `invitations` ★ (token) | New | Invitations to Budmon (D-10). | `id`; `email` (normalised); `inviter_user_id` (nullable: owner bootstrap); `origin` (`direct`, `account_share`, `bootstrap`); `status` (`pending`, `accepted`, `revoked`, `expired`; stored, D-10); `token_hash` (nullable until the token is issued); `token_issued_at`; `expires_at`; `send_count`, `last_sent_at`, `send_failed_at`; `accepted_user_id`, `accepted_at`; `revoked_at`, `revoked_by_user_id`. Partial unique index on `email` where `status = 'pending'`. | `inviter_user_id`, `revoked_by_user_id` → `users` (`set null`); `accepted_user_id` → `users` (`cascade`: the row holds that user's email). |
| `password_resets` ★ | New | Reset (and "set a password") requests (D-13). | `id`; `user_id`; `token_hash` (nullable until issued); `expires_at`; `failed_codes` (wrong second-factor codes, ≤ 5); `used_at`, `invalidated_at`; `created_at`. | `user_id` → `users` (`cascade`). |
| `email_bans` | New | Banned addresses (ADM-BR-4); written through `admin`, enforced here. | `email` (normalised, PK); `banned_at`; `banned_by_user_id`. | `banned_by_user_id` → `users` (`set null`). |
| `identity_settings` | New | Instance-wide settings identity enforces; one row. | `id` (fixed `1`, check constraint); `user_cap` (default 90, A-2). | None. |
| `security_events` | New | Security audit trail per user (D-19). | `id`; `user_id`; `kind` (enum); `session_id` (nullable, no FK); `client_kind`; `created_at`. No IPs, no user agents, no free text. | `user_id` → `users` (`cascade`). |
| `data_exports` | New | Export requests and their files (D-16). | `id`; `user_id`; `status` (`queued`, `running`, `ready`, `failed`, `expired`); `object_key`; `byte_size`; `requested_at`, `completed_at`, `expires_at`; `failure_key`. | `user_id` → `users` (`cascade`). The object lives in the platform's `exports` bucket. |
| `idempotency_records` | Changed (platform table) | Adds the foreign key the platform deferred to identity (platform LLD §3.1). | `user_id`. | `user_id` → `users` (`cascade`). |

Notes:

- **Why credentials aren't columns on `users`:** `budmon_capture` must read `users` (time zones, locales, status) and must never read credentials (P-D-19). Separate tables make the grant list simple and testable.
- **Tokens are stored only as hashes.** Session, refresh, invitation, reset, challenge, hand-off and sign-up-ticket tokens are 256-bit random values stored as SHA-256 (D-4); recovery codes as HMAC-SHA-256 (D-8); passwords as Argon2id (D-5); the TOTP secret sealed (D-8).
- **No IP addresses** are stored anywhere in identity (rate limiting uses the platform's HMAC'd counters).

### 3.2 Entity-relationship diagram

```mermaid
erDiagram
  currencies ||--o{ users : "base currency"
  users ||--o| password_credentials : "may have"
  users ||--o| google_identities : "may link"
  users ||--o| two_step_credentials : "may enrol"
  users ||--o{ recovery_codes : "has"
  users ||--o{ sessions : "signs in on"
  sessions ||--o{ session_refresh_tokens : "refresh family"
  users ||--o{ auth_challenges : "pending steps"
  users ||--o{ password_resets : "requests"
  users ||--o{ invitations : "sends (inviter)"
  users |o--o| invitations : "accepted as"
  users ||--o{ security_events : "has"
  users ||--o{ data_exports : "requests"
  users ||--o{ idempotency_records : "owns (platform)"
  users |o--o{ users : "invited by"
  users {
    uuid id PK
    text email UK "normalised"
    timestamptz email_verified_at
    text display_name
    text locale "BCP 47"
    text time_zone "IANA"
    char3 base_currency FK
    text status "active | pending_deletion"
    timestamptz deletion_scheduled_for
    boolean is_product_owner "at most one true"
    int invite_allowance "null = unlimited"
  }
  sessions {
    uuid id PK
    uuid user_id FK
    text delivery "cookie | bearer"
    bytea access_token_hash UK "one live access token"
    uuid current_refresh_id
    timestamptz idle_expires_at
    timestamptz absolute_expires_at
    timestamptz confirmed_at
    timestamptz revoked_at
  }
  session_refresh_tokens {
    uuid id PK
    uuid session_id FK
    bytea token_hash UK
    uuid parent_id "issued from"
    int generation
    timestamptz first_presented_at
    timestamptz superseded_at
  }
  invitations {
    uuid id PK
    text email "unique while pending"
    uuid inviter_user_id FK
    text status "pending | accepted | revoked | expired"
    bytea token_hash
    timestamptz expires_at
  }
  email_bans {
    text email PK
  }
  identity_settings {
    smallint id PK "always 1"
    int user_cap
  }
```

### 3.3 Data lifecycle

| Data | Lifecycle |
| ---- | --------- |
| `users` | Hard-deleted at erasure (D-15), cascading to every identity table and to every module table that references users with `cascade`. Modules that keep shared-account entries "attributed to deleted user" use `set null` on author columns and show "Deleted user" (their LLDs, XC-16). |
| `sessions`, `session_refresh_tokens` | A session and its whole refresh family are kept until 30 days after the session ended (revoked or expired), so a replayed token is recognised and refused, then deleted by the purge job. At most 20 live sessions per user; creating a 21st revokes the least recently used. |
| `auth_challenges` | Deleted 1 hour after expiry or consumption by an hourly purge job. Verified Google claims in `data` (sub, email, name) exist for at most 30 minutes. |
| `password_resets` | Deleted 24 hours after expiry, use or invalidation. |
| `invitations` | A pending invitation becomes `expired` when the hourly purge job finds `expires_at` passed, or earlier when it's touched (preview, accept, or a new invitation to the same email) in the same transaction (D-10). Accepted invitations are deleted with the accepted user (`cascade`; they contain that user's email). Revoked and expired invitations are deleted 90 days after they ended (personal data of a non-user; long enough for `admin`'s list, ADM-US-2). Pending invitations sent by a user whose deletion is requested are revoked at once. |
| `email_bans` | Kept until the owner lifts the ban (the purpose requires keeping the address; stated in the privacy notice). |
| `recovery_codes` | Replaced as a set on regeneration; all deleted when two-step verification is turned off. |
| `two_step_credentials` | `pending` rows expire after 15 minutes; deleted when turned off. |
| `security_events` | Deleted 90 days after creation, and with the user. |
| `data_exports` | Row marked `expired` after 7 days (the platform purge job deletes the object at the same age, P-§3.3) and deleted 30 days later; objects and rows deleted at erasure. |
| Erasure | Always preceded by an erasure-log record (P-D-30) so it can be replayed after a restore. |

## 4. User experience

### 4.0 UX conventions this module establishes

`docs/design/ux-guidelines.md` doesn't exist yet; the platform delegated proposing it to identity (P-§4). Identity's screens follow these conventions, and they're proposed as the content of that file once this HLD is approved (A-9):

- Tone: calm, plain, never blaming (P8, accepted). Second person ("your password"), sentence case, verbs on buttons ("Send invitation", not "OK").
- One primary action per screen (filled button); secondary actions are outlined or text buttons; destructive primaries use the error colour **and** a destructive verb ("Delete my account").
- Forms: labels above fields, never placeholders as labels; errors under the field with an icon (P-C-3); validation on submit and on leaving a field once the rule is known; focus goes to the first invalid field.
- Password managers and autofill are first-class: correct `autocomplete` values on web, autofill hints on Android.
- Confirmations only for destructive or hard-to-reverse actions; everything reversible is just done, with a toast.
- Signed-out screens are a centred single column (max 420 px) on web and full-screen on Android.

### 4.1 User journeys

**J-1 First-time sign-up from an invitation, with a password (US-1).**
1. The invited person gets an email: subject "{Inviter} invited you to Budmon", body with who invited them, a one-line description of Budmon, the button **Accept invitation**, and "This invitation expires on {date}". (Account-share invitations add a line from `accounts`, e.g. "…to share the account House money".)
2. The link opens `https://<origin>/invite#t=<token>` (the token is in the fragment, D-11). The web app removes the fragment from the address bar and shows **Join Budmon**: "{Inviter} invited {email} to Budmon." with **Continue with Google** and **Use a password**.
3. **Use a password** → **Set up your account**: email (shown, not editable), Your name, Password (with a show/hide toggle and the rule "At least 12 characters"), Base currency (preselected from the browser locale's region, e.g. EGP for `en-EG`, else USD; searchable list "EGP — Egyptian pound"), Time zone (preselected from the device, searchable), Language (English; more later). A note: "Base currency is used for totals across accounts. You can change these later in Settings." A link to the privacy notice. Primary **Create account**.
4. On success the user is signed in and lands on the home screen's first-run empty state (owned by `accounts`): "Welcome to Budmon, {name}. Add your first account to start." with **Add account**.
- *Goes wrong:*
  - Link expired, revoked or already used: **This invitation can't be used** with the reason ("It expired on 3 Oct." / "It was cancelled." / "It has already been used. If that was you, sign in.") and "Ask {inviter} to send a new one." plus **Sign in**.
  - Token missing or malformed: "This link isn't complete. Open it again from the email, or copy the whole link."
  - Budmon is full (the owner lowered the cap below the current count): "Budmon can't take new people right now. {Inviter} and the administrator have been told." (both are emailed, ADM-US-3).
  - The address was banned after the invitation was sent: "This invitation can't be used." (no reason given).
  - Already signed in as someone else in this browser: "You're signed in as {email}. Sign out to accept this invitation." with **Sign out and continue**.
  - Weak or common password: inline "Use at least 12 characters." / "This password is too common. Try a longer phrase."
  - Server error after submit: the platform's J-1 wording. Retrying is safe: if the account was in fact created, the retry shows "Your account is ready. Sign in to continue." (D-10).

**J-2 Sign-up with Google (US-3).** Steps 1 and 2 as J-1, then **Continue with Google**: web goes to Google's account chooser and back to `/auth/google` (D-6), which returns to **Set up your account** for the same invitation; Android shows the Credential Manager sheet. Budmon now holds a sign-up ticket for 30 minutes (D-6). **Set up your account** has the name prefilled from Google, no password field, and the line "You'll sign in with Google as {google email}." (shown only when it differs from the invited email). **Create account** → home first-run state.
- *Goes wrong:* the user cancels at Google: back on **Join Budmon** with "Google sign-in was cancelled." That Google account already belongs to another Budmon user: "This Google account is already used by another Budmon account. Use a different Google account or a password." Google is unreachable: "Couldn't reach Google. Try again, or use a password." The Google address is banned: "This Google account can't be used with Budmon." The flow failed or timed out (state, nonce or hand-off invalid): "Google sign-in didn't complete. Try again." The 30-minute ticket expired before **Create account**: "Your Google sign-in timed out. Continue with Google again." (back to **Join Budmon**).

**J-3 Sign in with email and password (US-2).**
1. Signed-out users opening Budmon land on **Sign in**: Budmon wordmark, "Sign in to Budmon", **Continue with Google**, a divider "or", Email, Password, **Sign in**, links "Forgot password?" and, below, "Budmon is invite-only. Got an invitation? Open the link in the email." On Android the same screen also offers **I have an invitation link** (paste, D-23).
2. Correct credentials and no two-step verification → home (or the screen they were trying to open on web). On Android the app offers to save the password to the user's password manager (Credential Manager).
3. Android one-tap: when this device has signed in to Budmon with Google before (remembered on the device), opening S-1 shows Credential Manager's sheet with that Google account at once (`GetGoogleIdOption`, authorised accounts only, auto-select off); dismissing it leaves S-1 as is and it isn't shown again until the app is next opened. Otherwise Google appears only when **Continue with Google** is tapped (`GetSignInWithGoogleOption`).
4. With two-step verification → J-5.
- *Goes wrong:* wrong email or password: "Email or password is incorrect." (never which one; D-18); too many attempts: the platform's J-3 ("Too many attempts. Try again in {n} minutes."); account closed by the owner: "This Budmon account has been closed."; the user has no password (Google-only): the same "Email or password is incorrect." plus, under the form, the standing hint "Signed up with Google? Use Continue with Google."; offline (Android): "You're offline. Connect to sign in." (offline entry needs a previously signed-in user, D-23).

**J-4 Sign in with Google (US-3).** **Continue with Google** → Google → home.
- If the Google account is linked: signed in (after J-5 when two-step is on).
- If not linked but Google says the email is **verified** and it matches a Budmon user: the link is prepared; when two-step is on, J-5 follows and the link is made only after the code is accepted (D-7). Once signed in, the user sees a toast "Google sign-in is now connected to your account." and gets an email (D-7, D-19).
- If Google doesn't report the email verified, whether or not it matches anyone: "Google hasn't confirmed this email address. Sign in with your password, or use your invitation." (D-7: no hint whether a Budmon account exists).
- Verified, no match: "There's no Budmon account for {google email}. Budmon is invite-only: ask someone who uses Budmon to invite you."
- *Goes wrong:* as J-2. In stage 0 the web button is offered on every app origin; when Google can only return to the laptop (`localhost` callback, D-6), the button carries the note "Works only in a browser on the computer running Budmon." On a phone's browser in stage 0 that path ends at an unreachable `localhost` page, which the note warns about; the Android app's Google sign-in isn't affected.

**J-5 Two-step verification at sign-in (US-4).** After the first factor: **Two-step verification**: "Enter the 6-digit code from your authenticator app." One code field (numeric keyboard, one-time-code autofill), **Verify**, link "Use a recovery code instead" (switches the field to "Recovery code", format `XXXX-XXXX-XXXX`), link "Back to sign in". Success → home. Using a recovery code shows afterwards: "You used a recovery code. {n} left." and, when 3 or fewer remain, **Create new codes** (goes to J-7's regeneration).
- *Goes wrong:* wrong code: "That code didn't work. Check your app and try again." After 5 wrong codes the step ends: "Too many attempts. Sign in again." and the user is emailed "Someone tried to sign in to Budmon and didn't pass two-step verification" (D-8, D-19). Past the per-user limit for authenticator codes (10 per 15 minutes, 30 per day, across every place codes are asked, D-8): the platform's J-3 wording plus "You can still use a recovery code." (recovery codes aren't affected). The step times out after 5 minutes: "This sign-in timed out. Sign in again." Lost phone and codes: the screen's help link "Lost access to your authenticator?" explains: "Use one of your recovery codes. If you don't have them, contact the Budmon administrator, who can turn two-step verification off for you." (D-25).

**J-6 Staying signed in (US-2).** The user opens Budmon days later and is simply in. Sessions renew silently; a session ends after 30 days without use or 90 days after sign-in (D-2). When it ends: web shows **Sign in** with "Your session ended. Sign in again." and returns to the same page afterwards; Android shows the same, and unsynced offline entries are kept and sync after signing in (P-F-255).
- *Goes wrong:* refresh-token reuse is detected (a stolen token): that session is ended everywhere it's used, the user sees "For your security, you've been signed out. Sign in again.", and gets an email "We signed you out of Budmon on {device}" (D-3).

**J-7 Turning on two-step verification (US-4).** Settings → **Sign-in & security** → Two-step verification: "Off" with **Turn on**.
1. **Confirm it's you** (D-9) if not confirmed in the last 10 minutes.
2. **Scan this code**: a QR code, "Can't scan? Enter this key instead:" the key in groups of 4 with **Copy**, and the steps "1. Open your authenticator app (for example Google Authenticator, Microsoft Authenticator, 1Password). 2. Add an account and scan the code. 3. Enter the 6-digit code it shows." Field + **Verify and turn on**. On Android, the screen also offers **Open in authenticator app** (an `otpauth://` intent) because the phone can't scan its own screen.
3. **Save your recovery codes**: "If you lose your phone, each of these codes lets you sign in once. Keep them somewhere safe, like a password manager." Ten codes, **Copy all**, **Download** (web: a `.txt` file; Android: share sheet), and the checkbox "I've saved my recovery codes", which enables **Done**.
4. Back on Sign-in & security: "Two-step verification: On", toast "Two-step verification is on. Your other devices have been signed out and will ask for a code next time.", email "Two-step verification was turned on". Other sessions are revoked when two-step is turned on (D-3); this one stays.
- Recovery codes are shown **only once**, at step 3; Budmon keeps only their hashes and can't show them again (D-8). If the user leaves step 3 without ticking the box, two-step is still on and the codes still work, and S-10 shows a banner "You may not have saved your recovery codes." with **Create new codes** (which replaces them, below).
- Turning it off: **Turn off** → confirm dialog "Turn off two-step verification? Your account will be protected by your password only." with a code field (a TOTP or recovery code, required in the request itself, counted by the per-user second-factor limit) and **Turn off**. No sessions are revoked. Email sent.
- Regenerating codes: **Create new codes** → confirm with a TOTP code **or a recovery code** (the user who just used one may have no phone) → step 3 again with ten new codes; "Your old codes no longer work." Email sent.
- Moving to a new phone: J-21.
- *Goes wrong:* wrong code at step 2: "That code didn't work. Check that your phone's time is set automatically." The 15-minute setup window expires: "Setup timed out. Start again." (the pending secret is discarded; **Start again** returns to step 2 with a new QR code, after a step-up if that has also expired).

**J-8 Forgot password (US-5).**
1. **Sign in** → "Forgot password?" → **Reset your password**: Email, **Send reset link**.
2. Always: **Check your email**: "If {email} has a Budmon account, we've sent a link to reset the password. It expires in 30 minutes." with "Didn't get it? Check spam, or send it again." (resend available after 60 seconds).
3. The email: "Reset your Budmon password" with **Choose a new password**; for Google-only users, "Set a password for Budmon" (D-13).
4. The link opens `/reset-password#t=<token>` → **Choose a new password**: New password, **Save password**; if two-step is on, also "Code from your authenticator app" (or a recovery code).
5. Success: signed in on this device, toast "Password changed. You've been signed out everywhere else.", email "Your Budmon password was changed". Any other reset links still outstanding stop working (D-13).
- *Goes wrong:* expired or used link: "This link has expired. Request a new one." with **Request new link**; wrong second factor: J-5's messages, and after 5 wrong codes the link stops working ("Too many wrong codes. Request a new link."); closed account: the email is never sent (the page still says "If … has an account"); rate limit: the platform's J-3.

**J-9 Editing profile and preferences (US-6).** Settings → **Profile & preferences**: Name, Email (read-only, with "Contact the administrator to change your email." A-1), Base currency, Time zone, Language. Each change is saved with **Save changes** (one form); toast "Saved." Changing the base currency asks first: "Change base currency to {code}? Totals and budgets will be shown in {code}. Your accounts keep their own currencies." Changing the time zone shows inline, before saving: "Dates of existing transactions won't change. 'Today' will follow {zone}." Changing the language updates the interface immediately after saving, without a reload.
- *Goes wrong:* validation (empty name, unknown zone) inline; server error: platform J-1.

**J-10 Sessions (US-2).** Settings → **Sign-in & security** → **Where you're signed in**: a list, this device first, each row with device label ("Chrome on Windows", "Android · Pixel 8"), "Signed in {date}", "Last active {relative time}", and **Sign out** (not on this device's row). **Sign out of all other devices** at the bottom (no confirmation; toast "Signed out of {n} other devices."). The account menu has **Sign out** for this device.
- On Android, signing out with unsynced offline entries asks: "{n} entries haven't synced yet. If you sign out now, they stay on this phone and sync the next time you sign in." with **Sync now** (when online), **Sign out anyway**, **Cancel** (D-23).

**J-11 Inviting someone (US-7).** Settings → **Invite people**: "You can invite {n} more people." (or "You can invite as many people as Budmon has room for." when unlimited), field Email, **Send invitation**; below, **Your invitations**: email, status chip (Pending, expires {date} / Accepted / Expired / Cancelled), actions **Resend** and **Cancel invitation** on pending ones.
- Success: the row appears as Pending, toast "Invitation sent to {email}."
- *Goes wrong:* allowance used up: the form is replaced by "You've used all your invitations. The administrator can give you more."; invitations switched off for this user (ADM-US-7): "Sending invitations isn't available for your account."; cap reached: "Budmon is full right now, so no new invitations can be sent."; already an active user: "{email} already uses Budmon."; a pending, unexpired invitation exists: "{email} already has a pending invitation." (with **Resend** when it's the user's own; an expired one doesn't block, D-10); banned, or a user whose deletion is pending: "This address can't be invited."; invalid email: inline "Enter an email address like name@example.com."; resent too often: "You can resend this invitation again tomorrow." Email delivery failing doesn't fail the request: the row shows "Sending…" and then "Couldn't send. Try again." with **Resend** if the worker gives up (D-12).

**J-12 Finding a user (US-8).** Inside `accounts`' sharing dialog (its UX): the user types an exact email (no invite links in the MVP, D-20); identity answers with one of three results, which `accounts` words: an active user ("Mona Adel uses Budmon"); no user ("No Budmon user with this email. We'll invite them to Budmon too."); or unavailable, for an address that's banned or belongs to a user whose deletion is pending ("This person can't be added right now."). The same three cases govern invitations (J-11), so the two never disagree. No suggestions while typing.

**J-13 Exporting data (US-9).** Settings → **Your data** → **Export your data**: "Get a copy of everything you've put into Budmon: accounts, transactions, budgets and settings, as a ZIP file with CSV and JSON." **Request export** (after **Confirm it's you**). Status row: "Preparing your export…" → "Ready. Available until {date}." with **Download** (and an email "Your Budmon export is ready"). Older exports listed with their expiry.
- *Goes wrong:* one export already running: the button is replaced by the running status; more than 3 requests in a day: "You can request another export tomorrow."; export fails: "We couldn't prepare your export. Try again." with **Try again**; download link expired: tapping **Download** fetches a fresh link (presigned URLs last 15 minutes, P-D-35).

**J-14 Deleting the account (US-10).**
1. Settings → **Your data** → **Delete account** → **Delete your Budmon account**: what happens, in order: "Your Gmail and SMS connections stop immediately. After 7 days, everything you own in Budmon is erased: accounts, transactions, budgets, settings. Entries you added to shared accounts stay, shown as 'Deleted user'. You can cancel within 7 days." Then **Download your data first** (link to J-13).
2. Blocking section if the user is the only admin of a shared account with other people: "Before you can delete your account, hand over these shared accounts:" list with **Manage** on each (to `accounts`). **Delete my account** stays disabled until the list is empty.
3. **Confirm it's you**, then the checkbox "I understand my data will be erased after 7 days" enables **Delete my account** (destructive style).
4. The user is signed out everywhere; the sign-in screen shows "Your account will be deleted on {date}. Sign in to cancel or download your data." Email: "Your Budmon account will be deleted on {date}" with how to cancel.
5. Signing in during the grace period works; every screen shows a banner "Your account will be deleted on {date}." with **Keep my account**. Connecting sources is blocked (D-15). **Keep my account** → toast "Your account won't be deleted. Reconnect your Gmail and SMS in Sources." and an email.
6. After 7 days: erasure; final email "Your Budmon account has been deleted."
- *Goes wrong:* the request fails: platform J-1; deletion was requested by the owner, or the address was banned (ADM-US-4): sign-in (password or Google) shows "This Budmon account has been closed." from that moment, and there's no **Keep my account** (only the owner can undo a deletion; a ban erases at once, §5.2).

**J-15 Confirm it's you (step-up, D-9).** A dialog (web) or sheet (Android) in front of sensitive actions: "Confirm it's you" with, depending on the user: "Code from your authenticator app" (when two-step is on; "Use a recovery code instead" link); otherwise Password; otherwise (Google-only, no two-step) **Continue with Google**. **Confirm**. Valid for 10 minutes for further sensitive actions on this device.
- With a password or code, the dialog closes and the action that opened it continues by itself (the client retries the request that returned `CONFIRMATION_REQUIRED`).
- With Google on the **web**, the page goes to Google and comes back to the same screen (the return path is kept in the flow, D-6) with the toast "Confirmed. You can continue now."; the user taps the action again (nothing is resumed automatically after leaving the page). On **Android** Credential Manager opens over the app and the action continues by itself.
- *Goes wrong:* wrong password or code: inline, as in J-3/J-5; the Google account chosen isn't the one connected to Budmon: "Choose the Google account connected to Budmon ({google email})."; rate limit: platform J-3.

**J-16 Owner bootstrap (US-11).** On a fresh installation the owner runs `budmon-local bootstrap-owner --email <address>` on the laptop (it executes the CLI command inside the running `api` container, D-21). It prints "Owner invitation created. Open this link within 7 days: https://<origin>/invite#t=…". **No email is sent** (D-21). The owner opens the link on the laptop (or copies it to the phone) and follows J-1 or J-2; the resulting user has the owner flag and unlimited invitations.
- *Goes wrong:* an owner already exists: "An owner already exists." (exit 1). An unexpired bootstrap invitation exists: "An owner invitation is already waiting (expires {date}). Run again with --replace to cancel it and create a new link." `--replace` revokes the old one and prints a new link. Use `--replace` too whenever the printed link may have been seen or copied elsewhere (a shared screen, a synced clipboard) before the owner used it. Invalid email: "Enter a valid email address."

**J-17 Changing the password (US-2).** S-10 → Password → **Change password** → **Confirm it's you** (if needed) → **Change password** form: New password (show/hide, "At least 12 characters"), the checkbox "Sign out of all other devices" (ticked by default), **Save password**. Success: toast "Password changed." (plus "You've been signed out of other devices." when ticked), email "Your Budmon password was changed", outstanding reset links stop working.
- *Goes wrong:* weak or common password: inline (`PASSWORD_TOO_WEAK`); same as the current password: "Choose a password you haven't used here just now."; step-up expired mid-way: the dialog reopens.

**J-18 Adding a password (Google-only users, US-3).** S-10 → Password: "No password. You sign in with Google." → **Add a password** → **Confirm it's you** (Google, or a code when two-step is on) → **Add a password** form: New password, **Save password**. Success: toast "Password added. You can now sign in with your email and password too.", email. No sessions are revoked. (When signed out, the same user can get a password through "Forgot password?", J-8.)
- *Goes wrong:* as J-17.

**J-19 Connecting Google (US-3).** S-10 → Google: "Not connected" → **Connect Google** → **Confirm it's you** → Google (web redirect back to S-10; Android sheet). Success: "Connected as {google email}", toast "Google sign-in connected.", email.
- *Goes wrong:* that Google account is already linked to another Budmon user: "This Google account is already used by another Budmon account."; banned address: "This Google account can't be used with Budmon."; cancelled: "Google sign-in was cancelled."

**J-20 Disconnecting Google (US-3).** S-10 → Google → **Disconnect** → **Confirm it's you** → confirm dialog "Disconnect Google? You'll sign in with your email and password." **Disconnect**. Success: toast, email. No sessions are revoked.
- *Goes wrong:* no password: **Disconnect** is replaced by "Add a password first, so you can still sign in." with **Add a password** (J-18).

**J-21 Moving the authenticator to a new phone (US-4).** S-10 → Two-step → **Replace authenticator app** → **Confirm it's you** with a code from the old app **or a recovery code** → J-7 step 2 with a new QR code → the code from the new app replaces the old secret (the old app's codes stop working). Recovery codes don't change. Email "Your two-step verification app was changed". No sessions are revoked.
- *Goes wrong:* as J-7 step 2; the old phone is lost and no recovery codes are left: J-5's help text (the administrator can reset two-step verification, D-25).

### 4.2 Screens

| Screen | Purpose | Information hierarchy (first → last) | Primary action | Other actions |
| ------ | ------- | ------------------------------------ | -------------- | ------------- |
| S-1 Sign in | Get a returning user in. | Title → Google button → email + password → "Forgot password?" → invite-only note | **Sign in** | Continue with Google; Forgot password?; I have an invitation link (Android) |
| S-2 Two-step verification | Second factor at sign-in, reset, or step-up. | Instruction → code field → recovery-code switch | **Verify** | Use a recovery code; Back to sign in |
| S-3 Reset your password / Check your email | Request a reset link. | Instruction → email → (after) confirmation and expiry | **Send reset link** | Back to sign in; Send again |
| S-4 Choose a new password | Set a password from a link. | Instruction → new password → second factor (if on) | **Save password** | Request new link (on error) |
| S-5 Join Budmon (invitation landing) | Show who invited whom; choose a method. | Inviter and invited email → method choice → expiry | **Continue with Google** / **Use a password** (equal weight) | Sign in |
| S-6 Set up your account | Collect what a new user needs. | Email (read-only) → name → password (if chosen) → base currency → time zone → language → privacy notice link | **Create account** | Back |
| S-7 Invitation problem | Explain why an invitation can't be used. | Reason → what to do | **Sign in** | (none) |
| S-8 Settings home | Entry to identity's settings (and other modules'). | Profile summary (name, email) → sections: Profile & preferences, Sign-in & security, Invite people, Your data → (other modules' sections) | (navigation) | Sign out |
| S-9 Profile & preferences | Edit profile and preferences. | Name → email (read-only) → base currency → time zone → language | **Save changes** | (none) |
| S-10 Sign-in & security | Methods, two-step, sessions. | Password (change / add) → Google (connected as … / connect / disconnect) → two-step (on/off, recovery codes left, unsaved-codes banner) → where you're signed in (list) | Per section: **Change password** / **Add a password** (J-17, J-18), **Connect Google** / **Disconnect** (J-19, J-20), **Turn on** / **Turn off**, **Create new codes**, **Replace authenticator app** (J-7, J-21) | Sign out (per session); Sign out of all other devices |
| S-11 Two-step setup | Enrol TOTP. | Step indicator → QR + key → code → recovery codes | **Verify and turn on**, then **Done** | Copy key; Open in authenticator app (Android); Copy all; Download |
| S-12 Invite people | Send and manage invitations. | Allowance → email field → invitation list | **Send invitation** | Resend; Cancel invitation |
| S-13 Your data | Export and deletion. | Export (status, download) → delete account entry | **Request export** | Download; Delete account |
| S-14 Delete account | Explain, check preconditions, confirm. | Consequences → export link → blockers → confirmation | **Delete my account** (destructive) | Download your data first; Manage (per blocker) |
| S-15 Pending-deletion banner | Make the grace period visible everywhere. | Date → action | **Keep my account** | (none) |
| S-16 Confirm it's you | Step-up. | Why → one factor | **Confirm** | Use a recovery code instead; Cancel |
| S-17 Open an invitation (Android) | Start sign-up from a pasted link where App Links aren't available (D-23). | Instruction → link field → what happens next | **Continue** | Paste (from clipboard); Back to sign in |

Wireframes (web shown; Android uses the same order full-screen, with Material 3 components).

S-1 Sign in:

```
+------------------------------------------+
|                 Budmon                   |
|            Sign in to Budmon             |
|                                          |
|  [ G  Continue with Google            ]  |
|  ------------------ or ----------------  |
|  Email                                   |
|  [ mona@example.com                   ]  |
|  Password                     [Show]     |
|  [ ••••••••••••                       ]  |
|                        Forgot password?  |
|  [            Sign in                 ]  |
|                                          |
|  Budmon is invite-only. Got an           |
|  invitation? Open the link in the email. |
|  (Android: [I have an invitation link])  |
+------------------------------------------+
```

S-5 Join Budmon and S-6 Set up your account:

```
+------------------------------------------+   +------------------------------------------+
|              Join Budmon                 |   |          Set up your account             |
|                                          |   |  Email                                   |
|  Ahmed Samir invited                     |   |  mona@example.com                        |
|  mona@example.com to Budmon.             |   |  Your name                               |
|                                          |   |  [ Mona Adel                          ]  |
|  [ G  Continue with Google            ]  |   |  Password                    [Show]      |
|  [    Use a password                  ]  |   |  [                                    ]  |
|                                          |   |  At least 12 characters.                 |
|  This invitation expires on 14 Oct.      |   |  Base currency                           |
|  Already have an account? Sign in        |   |  [ EGP — Egyptian pound            v ]   |
+------------------------------------------+   |  Time zone                               |
                                               |  [ Africa/Cairo (GMT+3)            v ]   |
                                               |  Language                                |
                                               |  [ English                         v ]   |
                                               |  Base currency is used for totals.       |
                                               |  You can change these later.             |
                                               |  By continuing you agree to the          |
                                               |  privacy notice.                         |
                                               |  [         Create account             ]  |
                                               +------------------------------------------+
```

S-2 Two-step verification:

```
+------------------------------------------+
|        Two-step verification             |
|  Enter the 6-digit code from your        |
|  authenticator app.                      |
|  Code                                    |
|  [ 123 456                            ]  |
|  [             Verify                 ]  |
|  Use a recovery code instead             |
|  Back to sign in                         |
+------------------------------------------+
```

S-10 Sign-in & security:

```
+------------------------------------------------------------+
| Settings > Sign-in & security                              |
|------------------------------------------------------------|
| Password                                                   |
|   Last changed 12 Sep                    [Change password] |
| Google                                                     |
|   Connected as mona.adel@gmail.com            [Disconnect] |
| Two-step verification                                      |
|   On · 8 recovery codes left      [Create new codes] [Off] |
|------------------------------------------------------------|
| Where you're signed in                                     |
|   Chrome on Windows · This device                          |
|     Signed in 2 Oct · Active now                           |
|   Android · Pixel 8                            [Sign out]  |
|     Signed in 20 Sep · Last active 3 hours ago             |
|                           [Sign out of all other devices]  |
+------------------------------------------------------------+
```

S-11 Two-step setup (steps 2 and 3):

```
+------------------------------------------+   +------------------------------------------+
| Turn on two-step verification   Step 1/2 |   | Save your recovery codes        Step 2/2 |
|                                          |   | Each code lets you sign in once if you   |
|   [ QR CODE ]                            |   | lose your phone. Keep them safe.         |
|                                          |   |   7KQ2-M9XD-4TRA    P3WF-8JZN-2HCV       |
| Can't scan? Enter this key instead:      |   |   ...  (10 codes, monospace, LTR)        |
|   JBSW Y3DP EHPK 3PXP     [Copy]         |   | [Copy all]  [Download]                   |
| 1. Open your authenticator app ...       |   | [x] I've saved my recovery codes         |
| Code  [ ______ ]                         |   | [               Done                 ]   |
| [      Verify and turn on            ]   |   +------------------------------------------+
+------------------------------------------+
```

S-12 Invite people:

```
+------------------------------------------------------------+
| Settings > Invite people                                   |
| You can invite 2 more people.                              |
| Email                                                      |
| [ karim@example.com                    ] [Send invitation] |
|------------------------------------------------------------|
| Your invitations                                           |
|  karim@example.com   (Pending · expires 14 Oct)            |
|                                   [Resend] [Cancel invite] |
|  sara@example.com    (Accepted)                            |
|  omar@example.com    (Expired)                             |
+------------------------------------------------------------+
```

S-14 Delete account:

```
+------------------------------------------------------------+
| Delete your Budmon account                                 |
| - Gmail and SMS connections stop immediately.              |
| - After 7 days, everything you own is erased.              |
| - Your entries on shared accounts stay, as "Deleted user". |
| - You can cancel within 7 days.                            |
| Download your data first                                   |
|------------------------------------------------------------|
| (!) Before you can delete your account, hand over:         |
|     House money (shared with 2 people)          [Manage]   |
|------------------------------------------------------------|
| [ ] I understand my data will be erased after 7 days       |
| [ Delete my account ]  (disabled while blockers remain)    |
+------------------------------------------------------------+
```

S-15 banner: `(i) Your account will be deleted on 14 Oct.  [Keep my account]` at the top of every signed-in screen, `role="status"`.

S-17 Open an invitation (Android):

```
+----------------------------------+
| <-  Open your invitation         |
|                                  |
| Paste the link from your         |
| invitation email.                |
| Invitation link                  |
| [ https://budmon.com/invite#t= ] |
|                         [Paste]  |
| (error text appears here)        |
|                                  |
| [          Continue           ]  |
|                                  |
| Already have an account?         |
| Back to sign in                  |
+----------------------------------+
```

S-17 accepts only a link whose origin is the app's configured API base URL and whose path is `/invite` with a `t` fragment (or the bare token); it calls `invitations.preview` and continues to S-5 in the app. Errors: not a Budmon invitation link ("This isn't a Budmon invitation link. Copy the whole link from the email."); a link for another Budmon server, for example the laptop's tailnet address in a stage-1 app ("This link is for a different Budmon server."); otherwise S-7's reasons.

### 4.3 Navigation

The app shell (home, accounts, transactions) is designed by later modules; identity adds the signed-out area, the Settings area and its sections, and the account menu. On web the Settings entry is in the account menu (avatar initials, top end); on Android it's the profile/"More" destination of the bottom bar.

```mermaid
flowchart LR
  subgraph Out[Signed out]
    SI[S-1 Sign in] --> TS[S-2 Two-step]
    SI --> FP[S-3 Reset your password]
    EmailR([Reset email]) --> NP[S-4 Choose a new password]
    EmailI([Invitation email]) --> JB[S-5 Join Budmon]
    SI -- Android: I have an invitation link --> PL[S-17 Open an invitation] --> JB
    JB --> SU[S-6 Set up your account]
    JB -- bad link --> IP[S-7 Invitation problem]
    JB -- Google --> G((Google)) --> SU
    SI -- Google --> G2((Google)) --> TS
  end
  TS --> Home[Home: first-run empty state / last page]
  SI --> Home
  SU --> Home
  NP --> Home
  Home -- account menu --> ST[S-8 Settings]
  ST --> PP[S-9 Profile & preferences]
  ST --> SS[S-10 Sign-in & security]
  SS --> TSS[S-11 Two-step setup]
  ST --> IV[S-12 Invite people]
  ST --> YD[S-13 Your data]
  YD --> DA[S-14 Delete account]
  SS & TSS & YD & DA -. sensitive action .-> CI[S-16 Confirm it's you]
  Home -- Sign out --> SI
```

Web routes (decided here, detailed in the LLD): `/sign-in`, `/sign-in/two-step`, `/forgot-password`, `/reset-password`, `/invite`, `/auth/google` (hand-off landing, D-6), `/settings`, `/settings/profile`, `/settings/security`, `/settings/security/two-step`, `/settings/invitations`, `/settings/data`, `/settings/data/delete`. Signed-in routes redirect to `/sign-in?next=<route path>` when there's no session; `next` accepts only same-origin route paths (no open redirect).

### 4.4 States

| Screen | Empty | Loading | Error | Partial / a lot of data |
| ------ | ----- | ------- | ----- | ----------------------- |
| S-1 Sign in | Fields empty; email remembered from the last sign-in on this device (web: password manager; Android: last email in app storage). | **Sign in** shows a spinner and the form is read-only. Web boot: a blank page with the wordmark while the session is checked (≤ 1 request + 1 refresh); a browser that has never signed in skips the check and shows this screen at once (D-24). | Inline / form-level messages (J-3); unavailable: platform J-7. | Very long emails: the field scrolls; no truncation in error messages (email is bidi-isolated, P-D-38). |
| S-2 Two-step | Field empty, focused. | **Verify** spinner. | J-5 messages; timeout → S-1 with message. | Recovery codes left shown after use. |
| S-3 Reset your password / Check your email | Email field empty (prefilled from S-1 if typed there). | **Send reset link** spinner. | Rate limit: platform J-3; network: platform J-7. "Send it again" is disabled with a countdown for 60 seconds. | Long emails wrap in the confirmation text (isolated). |
| S-4 Choose a new password | Fields empty; second-factor field shown only when two-step is on (known from `auth.previewReset`). | "Checking your link…" while the token is previewed; **Save password** spinner. | Link invalid/expired/used or dead after 5 wrong codes: the form is replaced by the message and **Request new link**. | (Not applicable.) |
| S-5/S-6 Invitation | (Not applicable.) | "Checking your invitation…" skeleton while the token is previewed. | S-7 reasons; Google failures (J-2). | Long inviter names wrap; long currency/zone lists are searchable comboboxes (Kobalte, keyboard accessible). |
| S-7 Invitation problem | (Not applicable.) | (Not applicable: shown after the preview.) | One message per reason (J-1, §4.9); a preview that can't be loaded at all shows platform J-1/J-7 with **Try again**. | Long inviter names wrap. |
| S-8 Settings home | Not applicable (always has the identity sections). | Profile summary skeleton. | Profile load fails: platform S-2 fallback. | Other modules' sections appended below identity's; a pending-deletion banner (S-15) above. |
| S-9 Profile | Not applicable (all fields always have values). | Skeleton rows; **Save changes** spinner. | Inline field errors; load failure → P-S-2 fallback. | Long names wrap; zone list ~ 400 entries, searchable, grouped by region. |
| S-10 Security | Google: "Not connected" with **Connect Google**; password: "No password. You sign in with Google." with **Add a password**; two-step: "Off". | Section skeletons. | Section-level error with **Try again**. | 20 sessions max (D-2); list shows all, this device first, then by last activity. |
| S-11 Two-step setup | (Not applicable.) | QR area skeleton while the secret is created; **Verify and turn on** spinner. | Wrong code: inline; 15-minute window expired: "Setup timed out. Start again." with **Start again**; step-up expired before start: S-16 opens. | Recovery codes in two columns (one on narrow screens), monospace. |
| S-12 Invite people | "You haven't invited anyone yet. Invite someone you share money with, like a partner or housemate." | List skeleton. | Inline / form-level (J-11). | Unlimited allowance text; long lists paginate 20 at a time ("Show more"). |
| S-13 Your data | "No exports yet." | "Preparing your export…" with an indeterminate progress indicator and text (not colour only). | "We couldn't prepare your export." | Older exports listed until they expire (at most 3 a day × 7 days). Size shown ("4.2 MB"). |
| S-14 Delete account | No blockers: the blocker section is hidden. | Blocker list loading: **Delete my account** stays disabled with "Checking shared accounts…". | Blocker check fails: "Couldn't check your shared accounts. Try again." (deletion stays disabled). | Many blockers: all listed, each with **Manage**. |
| S-15 Pending-deletion banner | Hidden when the user is active. | **Keep my account** spinner. | Cancel fails: toast with platform J-1 wording; banner stays. | (Not applicable.) |
| S-16 Confirm it's you | Field empty, focused. | **Confirm** spinner; Google: the page leaves for Google (web) or the sheet opens (Android). | Wrong password/code inline; wrong Google account (`GOOGLE_ACCOUNT_MISMATCH`); rate limit: platform J-3. | (Not applicable.) |
| S-17 Open an invitation (Android) | Field empty; **Paste** enabled when the clipboard has text. | **Continue** spinner while previewing. | Inline errors (S-17 notes); offline: "You're offline. Connect to open your invitation." | Very long pasted text is trimmed to the first URL found. |

### 4.5 Interaction and feedback

- **Server-confirmed, not optimistic.** Every identity mutation waits for the server; the triggering button shows progress. Security actions are never optimistic.
- **Toasts** for completed settings changes ("Saved.", "Invitation sent to …", "Signed out of 2 other devices."); `role="status"`.
- **Confirmations** only for: changing base currency (J-9), turning off two-step verification, disconnecting Google, signing out with unsynced Android entries, deleting the account. **Undo:** account deletion (7 days), invitation cancellation (send a new one). Revoking a session isn't undoable (the user signs in again).
- **Step-up** (S-16) appears before: changing or adding a password, connecting or disconnecting Google, turning two-step on, creating new recovery codes, replacing the authenticator app, requesting an export, deleting the account (D-9). Turning two-step off always asks for a code, even right after a step-up.
- **Validation:** email format and password length are checked as the user leaves the field; "common password" and all server rules on submit; errors inline under the field (P-J-2). The password field never clears itself on error; the code fields clear and refocus after a wrong code.
- **Session expiry** is handled silently: on `UNAUTHENTICATED`, the client refreshes once (single-flight per browser through the Web Locks API, per app through a mutex on Android) and retries; only when refresh fails does the sign-in screen appear, keeping unsaved form input on web where the route allows it.
- **Emails as feedback:** security-relevant changes always produce an email (D-19), so a user learns about changes they didn't make.
- **What updates when:** profile changes update the app shell (name, language) after the server confirms; a language change re-renders without reload (P-D-37); base currency and time zone changes invalidate cached queries of other modules (TanStack Query invalidation / Android repository refresh).

### 4.6 Effort on frequent tasks

| Task | Steps |
| ---- | ----- |
| Open the app when already signed in (the common case) | 0: sessions last about a month and renew silently (D-2). |
| Sign in with a saved password (web) | 2: autofill, **Sign in** (+1 code with two-step). |
| Sign in on Android with Google | 2: **Continue with Google**, pick the account (Credential Manager one-tap when only one) (+1 code with two-step). |
| Two-step code | Typed on a numeric keyboard, pasted, or filled by a password manager that stores TOTP (`autocomplete="one-time-code"` on web; the matching autofill hint on Android). |
| Invite someone | 2 after opening Settings > Invite people: type email, **Send invitation**. |
| Sign-up from an invitation | 3 screens (landing, set up, home); every field except name and password is preselected. |

Remembered choices: last signed-in email per device; the last used sign-in method is highlighted on S-1 ("Last used" badge on the Google button or the email form).

### 4.7 Presentation of data

- **Money:** identity shows none. Currency choices are shown as "EGP — Egyptian pound" (code, then localised name from `Intl.DisplayNames`/ICU), from the platform's `currencies` table (active currencies only).
- **Dates and times:** invitation expiry, deletion date and export expiry as absolute dates in the user's locale and time zone ("14 Oct", with the year when it isn't the current year; deletion shows date and time: "14 Oct at 15:20"); session activity as relative times under 7 days ("3 hours ago"), else a date (P-§4.7). Before sign-up (no profile yet), the device's zone and locale are used.
- **Time zones:** "Africa/Cairo (GMT+3)", with the current offset computed for today.
- **Device labels:** derived server-side from the client kind and a coarse parse of the user agent ("Chrome on Windows", "Firefox on Linux", "Android · Pixel 8" from a model name the app sends); never the raw user agent.
- **Codes and keys:** recovery codes and the TOTP key in a monospace font, grouped, always LTR and isolated (P-D-38); emails always isolated.

### 4.8 Platform and accessibility

- **Web:** responsive from 360 px; signed-out screens are a centred column (max 420 px); settings use a two-column layout (section list at the inline start, content at the inline end) from 960 px and a single column below. All logical properties (P-D-38).
- **Android:** phones first; Material 3; Credential Manager for Google and for saving/offering passwords; edge-to-edge with insets; `FLAG_SECURE` on the two-step setup and recovery-code screens (prevents screenshots and the recent-apps thumbnail from capturing secrets).
- **Keyboard and screen readers (D-39 baseline):** every action reachable by keyboard; focus moves to the page heading on navigation and to the first invalid field or error summary on submit; the QR code has the text alternative "QR code for your authenticator app. Use the key below if you can't scan."; code fields are single inputs (not one box per digit), labelled, with `inputmode="numeric"`; status changes (export ready, invitation sent) are announced via the live region; the step indicator is text ("Step 1 of 2"). TalkBack labels on every icon button (Show password: "Show password").
- **Colour:** status chips use text plus an icon; the destructive button also says "Delete"; contrast ≥ 4.5:1.
- **Session security on shared computers:** not specifically handled (no "remember me" switch); users sign out from the account menu (A-6).

### 4.9 Wording

| Where | Text |
| ----- | ---- |
| Sign-in title / button | "Sign in to Budmon" / "Sign in" |
| Google button | "Continue with Google" |
| Invite-only note | "Budmon is invite-only. Got an invitation? Open the link in the email." |
| Wrong credentials (`INVALID_CREDENTIALS`) | "Email or password is incorrect." |
| Closed account (`ACCOUNT_CLOSED`) | "This Budmon account has been closed." |
| Google verified email, no match (`GOOGLE_ACCOUNT_UNKNOWN`) | "There's no Budmon account for {email}. Budmon is invite-only: ask someone who uses Budmon to invite you." |
| Google email unverified, matching or not (`GOOGLE_EMAIL_UNVERIFIED`) | "Google hasn't confirmed this email address. Sign in with your password, or use your invitation." |
| Google flow failed (`GOOGLE_SIGNIN_FAILED`: state, nonce, hand-off or token invalid or expired) | "Google sign-in didn't complete. Try again." |
| Google address banned (`GOOGLE_ACCOUNT_NOT_ALLOWED`) | "This Google account can't be used with Budmon." |
| Wrong Google account at step-up (`GOOGLE_ACCOUNT_MISMATCH`) | "Choose the Google account connected to Budmon ({email})." |
| Sign-up ticket expired (`SIGNUP_TICKET_INVALID`) | "Your Google sign-in timed out. Continue with Google again." |
| Google only from the laptop (stage 0) | "Works only in a browser on the computer running Budmon." |
| Google already used (`GOOGLE_ACCOUNT_IN_USE`) | "This Google account is already used by another Budmon account." |
| Google unreachable (`GOOGLE_UNAVAILABLE`) | "Couldn't reach Google. Try again, or use your password." |
| Google cancelled | "Google sign-in was cancelled." |
| Two-step prompt | "Enter the 6-digit code from your authenticator app." |
| Wrong code (`TWO_STEP_CODE_INVALID`) | "That code didn't work. Check your app and try again." |
| Two-step attempts / timeout (`TWO_STEP_CHALLENGE_EXPIRED`) | "Too many attempts. Sign in again." / "This sign-in timed out. Sign in again." |
| Recovery code used | "You used a recovery code. {n, plural, one {# code left} other {# codes left}}." |
| Session ended | "Your session ended. Sign in again." |
| Reuse detected | "For your security, you've been signed out. Sign in again." |
| Password rule | "At least 12 characters." / "This password is too common. Try a longer phrase." (`PASSWORD_TOO_WEAK`) |
| Reset sent | "If {email} has a Budmon account, we've sent a link to reset the password. It expires in 30 minutes." |
| Reset link bad (`RESET_LINK_INVALID`) / too many codes | "This link has expired. Request a new one." / "Too many wrong codes. Request a new link." |
| Second-factor limit (`RATE_LIMITED` on the per-user limiter) | Platform J-3 wording. |
| Unsaved recovery codes banner | "You may not have saved your recovery codes." Button "Create new codes" |
| Android invitation link | "This isn't a Budmon invitation link. Copy the whole link from the email." / "This link is for a different Budmon server." |
| Lookup unavailable | "This person can't be added right now." (`accounts` wording) |
| Invitation problems (`INVITATION_EXPIRED`, `_REVOKED`, `_USED`, `_INVALID`) | "It expired on {date}." / "It was cancelled." / "It has already been used. If that was you, sign in." / "This link isn't complete. Open it again from the email, or copy the whole link." |
| Cap reached (`USER_CAP_REACHED`) | Invite: "Budmon is full right now, so no new invitations can be sent." Accept: "Budmon can't take new people right now. {Inviter} and the administrator have been told." |
| Allowance (`INVITE_ALLOWANCE_EXHAUSTED`) | "You've used all your invitations. The administrator can give you more." |
| Invitations disabled (`INVITATIONS_DISABLED`) | "Sending invitations isn't available for your account." |
| Already a user (`ALREADY_A_USER`) / pending (`INVITATION_PENDING`) / banned (`EMAIL_NOT_INVITABLE`) | "{email} already uses Budmon." / "{email} already has a pending invitation." / "This address can't be invited." |
| Invite empty state | "You haven't invited anyone yet. Invite someone you share money with, like a partner or housemate." |
| Step-up title | "Confirm it's you" |
| Step-up needed (`CONFIRMATION_REQUIRED`) | (no text; the client opens S-16) |
| Base currency confirm | "Change base currency to {code}? Totals and budgets will be shown in {code}. Your accounts keep their own currencies." |
| Time zone hint | "Dates of existing transactions won't change. 'Today' will follow {zone}." |
| Export intro | "Get a copy of everything you've put into Budmon: accounts, transactions, budgets and settings, as a ZIP file with CSV and JSON." |
| Export busy (`EXPORT_IN_PROGRESS`) / limit (`EXPORT_LIMIT_REACHED`) | "Preparing your export…" / "You can request another export tomorrow." |
| Delete blockers (`SOLE_ADMIN_HANDOVER_REQUIRED`) | "Before you can delete your account, hand over these shared accounts:" |
| Delete confirm | Checkbox "I understand my data will be erased after 7 days"; button "Delete my account" |
| Pending banner | "Your account will be deleted on {date}." Button "Keep my account" |
| Email subjects | "{Inviter} invited you to Budmon"; "Reset your Budmon password"; "Set a password for Budmon"; "Your Budmon password was changed"; "Two-step verification was turned on" / "…turned off"; "New recovery codes were created"; "A recovery code was used to sign in"; "Someone tried to sign in to Budmon and didn't pass two-step verification"; "Your two-step verification app was changed"; "Two-step verification was turned off by the administrator"; "A password was added to your Budmon account"; "Google sign-in was connected to your Budmon account" / "…disconnected"; "We signed you out of Budmon on {device}"; "Your Budmon export is ready"; "Your Budmon account will be deleted on {date}"; "Your Budmon account won't be deleted"; "Your Budmon account has been deleted"; "Your Budmon account has been closed" (owner deletion or ban); "{Name} couldn't join Budmon" (to inviter, cap) |

All strings live in the client catalogs and, for emails, the server catalog (P-F-160), English first.

## 5. Interfaces, protocols and integrations

### 5.1 Client ↔ API

- **Transport:** the platform's oRPC contract under `/api/v1` (P-D-4, P-§5.2). Procedure groups: `auth.*` (sign-in, two-step, refresh, sign-out, Google start/complete/android/nonce for sign-in and sign-up, password reset), `me.*` (profile, preferences, password, `me.google*` link and step-up flows, step-up confirm, two-step management, sessions), `invitations.*` (mine, create, resend, revoke, preview, accept), `users.lookupByEmail`, `exports.*`, `deletion.*`. Everything carrying an email, password, code or token is a `POST` with a JSON body (P-D-24).
- **Public procedures** (added to `PUBLIC_PROCEDURES`, P-F-53): `auth.methods`, `auth.signIn`, `auth.verifyTwoStep`, `auth.refresh`, `auth.googleStart`, `auth.googleComplete`, `auth.googleNonce`, `auth.googleAndroid` (intents `sign_in` and `sign_up` only), `auth.requestPasswordReset`, `auth.previewReset`, `auth.resetPassword`, `invitations.preview`, `invitations.accept`. The `link` and `confirm` Google intents exist only on authenticated `me.google*` procedures (D-6). Everything else is `authedProcedure`; owner operations for `admin` are services, not procedures, here (§5.2, D-21).
- **One non-contract route:** `GET /api/v1/auth/google/callback` (Google's redirect target), a plain Fastify route like the platform's health routes, excluded from OpenAPI, which only ever answers with a `303` to an allowlisted app origin (D-6). It's tested directly: unknown or consumed `state` → `303` to `/sign-in?error=google_failed`; it never sets a session cookie.
- **The one URL with credentials in its query (stated exception to P-D-24 rule 4):** Google's redirect necessarily carries `code` and `state` in the callback's query string. Mitigations: the code is single-use, bound to the PKCE verifier and the client secret, and exchanged within seconds; `state` is single-use and only maps to a challenge; Caddy, Tailscale Serve and telemetry already drop query strings (P-D-24 layers on request logs, spans and Sentry URLs); `Referrer-Policy: no-referrer`; the `303` replaces the history entry's target so the code isn't revisited; the page that receives the hand-off reads it from the fragment and clears it (D-11). Recorded as platform amendment PA-4.
- **Idempotency (P-D-13):** authenticated creates (`invitations.create`, `exports.request`) take an `Idempotency-Key`. Public creates (sign-up, which has no user to scope a key to) are made retry-safe by the invitation's state instead (D-10). Sign-in, refresh and step-up aren't "creates" in the D-13 sense.
- **Token transport (D-4):** sign-in-type procedures take `tokenDelivery: "cookie" | "body"`. The web app always uses `cookie` (tokens are set as `HttpOnly` cookies and never reach JavaScript); Android uses `body` and sends `Authorization: Bearer <access token>`.
- **Errors** (new keys, statuses fixed in the LLD): `INVALID_CREDENTIALS` 401, `ACCOUNT_CLOSED` 403, `TWO_STEP_REQUIRED` (returned as a result, not an error, D-8), `TWO_STEP_CODE_INVALID` 400, `TWO_STEP_CHALLENGE_EXPIRED` 401, `REFRESH_INVALID` 401, `CONFIRMATION_REQUIRED` 403, `PASSWORD_TOO_WEAK` 400, `RESET_LINK_INVALID` 400, `GOOGLE_SIGNIN_FAILED` 400, `GOOGLE_UNAVAILABLE` 503, `GOOGLE_EMAIL_UNVERIFIED` 400, `GOOGLE_ACCOUNT_UNKNOWN` 404, `GOOGLE_ACCOUNT_IN_USE` 409, `GOOGLE_ACCOUNT_NOT_ALLOWED` 403, `GOOGLE_ACCOUNT_MISMATCH` 400, `SIGNUP_TICKET_INVALID` 400, `INVITATION_INVALID` 400, `INVITATION_EXPIRED` 410, `INVITATION_REVOKED` 410, `INVITATION_USED` 409, `USER_CAP_REACHED` 409, `INVITE_ALLOWANCE_EXHAUSTED` 409, `INVITATIONS_DISABLED` 403, `ALREADY_A_USER` 409, `INVITATION_PENDING` 409, `EMAIL_NOT_INVITABLE` 409, `RESEND_LIMIT_REACHED` 429, `EXPORT_IN_PROGRESS` 409, `EXPORT_LIMIT_REACHED` 429, `SOLE_ADMIN_HANDOVER_REQUIRED` 409, `DELETION_NOT_PENDING` 409, `PASSWORD_REQUIRED` 409 (disconnecting Google without a password). All through `BudmonError` (P-D-21).
- **Real-time:** none. Export status is polled every 5 seconds while the S-13 screen is open and an export is `queued` or `running`; the email covers the rest.

### 5.2 What identity exposes to other modules (D-20)

| Surface | Kind | Contents |
| ------- | ---- | -------- |
| `AuthHook` (P-F-54) | Platform hook implementation | Resolves `Authorization: Bearer` (Android) or the access cookie (web, only with an `X-Budmon-Client: web/…` header) to a `Principal { userId, isOwner, sessionId }`, or `null`. `sessionId` is PA-1 (§5.6), landed as platform A-1. |
| `requireConfirmed(ctx, maxAgeSeconds = 600)` | Helper | Throws `CONFIRMATION_REQUIRED` unless the session was stepped-up recently (D-9). Other modules may use it for their own sensitive actions (for example `sources` disconnecting everything). |
| `UsersReader` | Service interface | `getProfile(userId)` (display name, email, locale, time zone, base currency, status), `getDisplayNames(userIds)` (for attribution, ACC-US-7; returns "Deleted user" markers for missing IDs), `isActive(userId)`. Read-only, usable in API and both workers (`users` is readable by `budmon_capture`). |
| `UserDirectory.findByExactEmail(email, requesterId)` | Service | IDN-US-5, exact email only (D-20): exact normalised match; returns `{ kind: "user", userId, displayName }` for an active user, `{ kind: "unavailable" }` for a banned address or a user whose deletion is pending, `{ kind: "none" }` otherwise; the same classification that invitations use (J-11, J-12). Rate-limited per requester (`users.lookupByEmail` is its procedure). Used by `accounts` and `debts`. |
| `InvitationService.inviteForAccountShare({ inviterId, email, context })` | Service | For ACC-US-4. If no pending, unexpired invitation exists for the email: creates one with `origin = account_share`, applying every D-10 rule (including the inviter's allowance, D-10) and sends an email that includes `accounts`' context line. If one exists (from anyone): creates nothing, charges no allowance, sends nothing (that email has no account line; `accounts` may show its own in-app notice after sign-up), and returns the existing invitation's ID. Returns `{ invitationId, created: boolean }`; `accounts` stores the ID against its pending share. |
| Events (pg-boss jobs fanned out to registered handlers, like P-D-15's `fx.rates-added`) | Jobs | `identity.user-created { userId, invitationId }` (accounts converts pending shares); `identity.preferences-changed { userId, fields }` (base currency, time zone, locale; budgets, reports, notifications); `identity.deletion-requested { userId, requestedBy }` (sources disconnects and revokes grants; notifications stops sending); `identity.deletion-cancelled { userId }`; `identity.invitation-ended { invitationId, reason: expired \| revoked }` (accounts drops pending shares). Payloads are IDs and enums only (P-D-10). |
| Registries (composition root, P-D-31) | Ports | `DeletionPrecheck` (`accounts` lists shared accounts where the user is the only admin with other people); `ErasureParticipant` (each module erases or re-attributes its rows for a user; ordered; idempotent); `ExportParticipant` (each module streams its sections as JSON and CSV); `InvitePolicy` (`admin` implements the "sending invitations" switch, ADM-US-7; default: allowed); `InvitationContextProvider` (`accounts` adds the "to share House money" line). Defaults are no-ops so identity ships and tests alone. |
| Owner services for `admin` (D-21) | Services | Contracts below. `admin` wraps them in `ownerProcedure`s and records its own audit log; every one takes the owner's principal and runs in one transaction. |

**Owner services (contracts; effects in one transaction unless stated):**

| Service | Input | Effects | Errors |
| ------- | ----- | ------- | ------ |
| `listUsers` | cursor, optional status filter | Keyset page (P-D-32) of users: id, display name, email, status, deletion date and who requested it, created, last active, inviter, invite allowance, two-step on/off, sign-in methods. Connected-source counts come from `sources` in `admin`'s query, not here. | — |
| `listInvitations` | cursor, optional status and inviter filters | Keyset page of all invitations (pending, accepted, expired, revoked) with email, inviter's display name and ID, origin, created, expires, accepted/revoked dates, send failures. Expired pending rows are reported as `expired` (and flipped, D-10). | — |
| `invite` | email | The same as `invitations.create` with the owner as inviter (unlimited allowance, cap still applies, R5-Q1). `admin` calls `invitations.create` itself; no separate service. | as `invitations.create` |
| `revokeInvitation` | invitation ID | Any pending invitation → `revoked` (by the owner); `identity.invitation-ended`. | `NOT_FOUND`; `CONFLICT` if not pending |
| `setUserCap` | integer ≥ 1 | Updates `identity_settings.user_cap` (settings row locked). Lowering it below current counts is allowed; it only blocks new invitations and acceptances (§7.3). | `VALIDATION_FAILED` |
| `setInviteAllowance` | user ID, integer ≥ 0 or `null` | Sets `users.invite_allowance`. Existing invitations are untouched. | `NOT_FOUND` |
| `requestDeletionByOwner` | user ID | As D-15's owner-initiated deletion: `pending_deletion`, `requested_by = owner`, scheduled in 7 days; all sessions revoked; the user's pending invitations revoked; `identity.deletion-requested`; email "Your Budmon account has been closed". Sign-in refused from now on. | `NOT_FOUND`; `CONFLICT` for the owner themselves |
| `cancelDeletionByOwner` | user ID | A pending deletion requested by the user or the owner → `active`; `identity.deletion-cancelled`; email. A ban can't be cancelled (lift the ban; the erasure goes ahead). | `NOT_FOUND`; `DELETION_NOT_PENDING`; `CONFLICT` when `requested_by = ban` |
| `banEmail` | email | Inserts into `email_bans`. If a user has that email: `pending_deletion`, `requested_by = ban`, `scheduled_for = now`; all sessions revoked; their pending invitations revoked; any pending invitation **to** that email revoked; `identity.deletion-requested`; `identity.erase-user` enqueued at once. The user gets **one** email, "Your Budmon account has been closed", sent by the erasure job as its final email (D-15 step 5, worded for `requested_by = ban`) rather than as a separate email job that the erasure could overtake. From commit, password and Google sign-in, refresh and reset are refused (status and ban list both checked), satisfying A38's "blocked at once"; erasure follows within minutes (D-15). | `CONFLICT` for the owner's own email |
| `liftBan` | email | Deletes the `email_bans` row. Doesn't restore an erased user. | `NOT_FOUND` |
| `resetTwoStepByOwner` | user ID | Deletes the user's two-step credential and recovery codes; revokes all their sessions; security event; email "Two-step verification was turned off by the administrator" (D-25). | `NOT_FOUND`; `CONFLICT` if two-step is off |

### 5.3 Google Sign-In (D-6)

- **OAuth client:** a separate **"Budmon sign-in" Web application client** in the same Google Cloud project as Gmail capture, with scopes `openid email profile` only; plus an **Android OAuth client** (package `com.budmon.app` + signing-certificate SHA-1, one per signing key) whose ID appears as `azp` in Android ID tokens. The sign-in client's secret lives only in the API's secret file. Basic sign-in scopes are exempt from testing mode's test-user list and 7-day expiry ([Google Cloud Console Help](https://support.google.com/cloud/answer/15549945)), so sign-in works for every invitee even while Gmail stays in testing mode.
- **Two origin settings (PA-3):** `GOOGLE_SIGNIN_CALLBACK_ORIGIN`, the single origin registered with Google as `<origin>/api/v1/auth/google/callback`; and `GOOGLE_SIGNIN_APP_ORIGINS`, the web-app origins allowed to start a flow and to receive the hand-off. Stage 0: callback `http://localhost:8080`; app origins `https://<laptop>.<tailnet>.ts.net` and `http://localhost:8080`. Stage 1: both `https://budmon.com`.
- **`auth.methods`** reads the request's `Origin` header (browsers send it on same-origin `POST`s; a missing or unlisted origin means "no Google on the web") and returns `{ password: true, google: "available" | "this_computer_only" | "unavailable" }`. `this_computer_only` is returned when the callback origin is `http://localhost:*` and the app origin differs from it; the web app then shows the stage-0 note (J-4). Android ignores it (no redirect).
- **Web flow:** OpenID Connect authorization code flow with PKCE (S256), `state`, `nonce`, `prompt=select_account`, run **server-side**; no Google JavaScript on Budmon's pages. `auth.googleStart` (intents `sign_in`, `sign_up` + invitation token) or `me.googleStart` (intents `link`, `confirm`; authenticated; the challenge records `user_id` and `session_id`) creates the challenge with the requesting app origin (from `Origin`, must be listed) and a return path (a same-origin route path, validated); the callback exchanges the code, verifies the ID token, stores the claims and a hand-off hash in the challenge, and answers `303` to `<app origin>/auth/google#h=<hand-off>`; the SPA calls `auth.googleComplete` (or `me.googleComplete` for `link`/`confirm`, which must come from the same session) with the hand-off; the binding cookie set at start must match. On stage 0's split, the start and completion happen on the tailnet origin and only the callback is on `localhost`, so the binding cookie (scoped to the app origin) works; on a phone's browser the callback is unreachable (J-4's note).
- **Outcomes of completion:** `sign_in` → session, or `two_step_required` (with any pending automatic link held in the two-step challenge, D-7), or an error key. `sign_up` → after re-checking the invitation, a **sign-up ticket**: a new `google_signup` challenge (30 minutes, bound to that invitation, holding the verified claims) whose token is returned in the response body; `invitations.accept` takes `{ token, method: { kind: "google", ticket } }`, checks the ticket's invitation equals the token's, re-checks in the same transaction that the ticket's Google email isn't banned (`GOOGLE_ACCOUNT_NOT_ALLOWED`) and its `sub` isn't linked to any user (`GOOGLE_ACCOUNT_IN_USE`), and consumes both. `link` → the Google identity is linked (D-7 rule 5). `confirm` → `sessions.confirmed_at = now` if the claims' `sub` equals the user's linked `sub`, else `GOOGLE_ACCOUNT_MISMATCH`. The SPA then navigates to the stored return path (D-9).
- **Android:** Credential Manager `GetSignInWithGoogleOption` (button) or `GetGoogleIdOption` (one-tap on S-1, J-3), with `serverClientId` = the sign-in web client ID and a nonce from `auth.googleNonce` (or `me.googleNonce` for `link`/`confirm`, recording the session); the app posts the ID token to `auth.googleAndroid` (`sign_in`, `sign_up` + invitation token: the sign-up ticket comes back in the body the same way) or `me.googleAndroid` (`link`, `confirm`, same session required).
- **Verification (both):** signature against Google's JWKS (cached per its `Cache-Control`), `iss ∈ {https://accounts.google.com, accounts.google.com}`, `aud` = sign-in web client ID, `azp` = the web client (web) or one of the configured Android client IDs (Android), `exp`/`iat` with 60 s skew, `nonce` equal to the stored, unconsumed nonce; for `confirm`, `iat` within the last 5 minutes. Claims used: `sub`, `email`, `email_verified`, `name`.
- **Failure modes:** Google's token endpoint or JWKS unreachable (timeout 10 s): `GOOGLE_UNAVAILABLE`; password sign-in is unaffected. A cached JWKS keeps verification working through short outages. Code reuse, an unknown or consumed `state`, a mismatched nonce, a missing or wrong binding cookie, or an expired hand-off: `GOOGLE_SIGNIN_FAILED` and a restart. Google revoking the app or the user removing access: nothing to do (Budmon keeps no Google tokens; ID tokens are used once and discarded).
- **Stage 0 / stage 1:** stage 0 as above; whether Google accepts a `ts.net` callback (which would make phone browsers work too) is checked in the Gmail spike (P-Q-11) and, if so, is configuration only. From stage 1: `https://budmon.com/api/v1/auth/google/callback`, one origin.

### 5.4 Email (D-12)

- **Protocol:** SMTP submission (port 587 with STARTTLS required, or 465 implicit TLS), through one `EmailSender` adapter (nodemailer) in **worker-general**. Every email is a pg-boss job `identity.email-send { kind, refId }` enqueued in the same transaction as the change that causes it; the handler loads what it needs by ID, renders the template in the recipient's locale (the inviter's locale for invitations), and sends. Tokens are generated inside that job (D-10, D-13), so they never sit in a job payload or in the database in plain form.
- **Templates:** plain-text and minimal HTML parts, server catalog strings (P-F-160), no images or tracking pixels, no links other than Budmon's own origin. `From: Budmon <no-reply@…>`; `Reply-To` unset.
- **Stage 0 (laptop):** SMTP to a **Mailpit** container in the laptop's Compose stack, with its web inbox published on `127.0.0.1:8025` only (PA-2). Nothing leaves the laptop; the owner reads emails on the laptop. The owner may instead point the same settings at any SMTP relay (for example Gmail's SMTP with an app password) to receive emails on the phone; that's configuration only.
- **Stage 1:** a transactional email provider over SMTP, with SPF, DKIM and DMARC on `budmon.com`, chosen at the stage-1 gate (A-8). The move is configuration only (P-D-29's stage rule).
- **Failure modes:** SMTP down or rejecting: the job retries with backoff (about 30 minutes in total) and then dead-letters; the owning row shows the failure where the user can act (invitation "Couldn't send", reset page's "send it again"). Permanent rejections (5xx) aren't retried. Nothing user-visible depends on the email being delivered synchronously.
- **At-least-once delivery (accepted):** if the job sends successfully but crashes before completing, the retry issues a **new** token and sends a second email; the first link then no longer works. This is rare, harmless (the newest email works) and accepted rather than adding a send-state machine. The final "account deleted" email is the exception: it's sent inside the erasure job, not through this job (D-15).
- **Mailpit logging (stage 0):** Mailpit runs with `--quiet` and the container's Docker logging driver set to `none`, so no sender or recipient address reaches Docker's logs (PLT-BR-1; P-D-24's canary scan, PA-2).

### 5.5 Background jobs (worker-general)

| Job | Trigger | What it does |
| --- | ------- | ------------ |
| `identity.email-send` | Enqueued by services | D-12. |
| `identity.export-build` | `exports.request` | Streams every `ExportParticipant`'s sections into a ZIP in the `exports` bucket; marks `ready` and enqueues the "export ready" email (D-16). |
| `identity.erasure-sweep` | Every 15 minutes, and at worker start (the laptop may have been off, like P-D-15's gap check) | Finds users whose `deletion_scheduled_for` has passed and enqueues `identity.erase-user` for each. |
| `identity.erase-user` | Sweep, or immediately for bans (`admin`) | D-15's erasure pipeline. Idempotent. The platform's `ErasureHandler` for replay (P-F-151) runs the same pipeline with notifications off (no final email after a restore, D-15). |
| `identity.purge` | Hourly | Flips pending invitations past `expires_at` to `expired` (emitting `identity.invitation-ended`); deletes expired challenges, resets, sessions with their refresh families (30 days after end), old invitations, security events and export rows (§3.3). |
| `identity.event-fanout` | Enqueued with domain changes | Delivers `identity.*` events to registered module handlers (§5.2). |

### 5.6 Changes required in the platform (platform amendments)

Identity depends on these small changes to approved platform artefacts. They were routed to the platform LLD as amendments and **all landed** (v0.7: PA-1 to PA-6 are platform A-1 to A-6, built on `feat/platform`; the LLD's later requests are in identity LLD §1.1). None changes a platform decision; A-2 and A-4 amended platform HLD v1.3 and need user confirmation as platform items.

| ID | Change | Why |
| -- | ------ | --- |
| PA-1 (landed as platform A-1) | `Principal` gains `sessionId: string` (P-F-53/54's type); the amendment also updates the platform's test fixtures and helpers that build `{ userId, isOwner }`. | Sign-out, "this device", step-up and session-scoped checks need the session. |
| PA-2 (landed as platform A-2) | **Email in stage 0.** (a) The stage-0 laptop Compose stack gains a `mailpit` service (internal SMTP on the main-side network; web inbox published on `127.0.0.1:8025` only), started with `--quiet` and with Docker logging driver `none`, so no address reaches Docker logs. (b) worker-general's configuration gains `SMTP_URL` (non-secret: host, port, TLS mode, user), `SMTP_PASSWORD_FILE` (secret, optional for Mailpit), `EMAIL_FROM`, and `PUBLIC_ORIGIN` (for links in emails; set from the same `site.env` value as the API's `PUBLIC_ORIGIN`, which the bootstrap command uses, PA-6); `budmon-local install` prompts for them with Mailpit defaults. (c) The stage-0-shaped release rehearsal (P-D-41) includes Mailpit and adds the email canary path: a password reset and an invitation for the canary email address are sent, Mailpit's API confirms delivery, and the canary scan over Docker logs and telemetry must find neither the address nor the token. | D-12; PLT-BR-1. |
| PA-3 (landed as platform A-3) | **New configuration and secrets**, each classified under P-D-20's rotation rules. API: `GOOGLE_SIGNIN_CLIENT_ID`, `GOOGLE_SIGNIN_ANDROID_CLIENT_IDS`, `GOOGLE_SIGNIN_CALLBACK_ORIGIN`, `GOOGLE_SIGNIN_APP_ORIGINS` (non-secret); `GOOGLE_SIGNIN_CLIENT_SECRET_FILE` (secret, API file; *rotated by replacement*: a new secret issued in Google Cloud, so it's fresh at the stage-1 gate like every non-data secret); `RECOVERY_CODE_HMAC_KEYS_FILE` (secret, API file, a key ring `{ current, keys }` like `api-secrets`; **data-bound**: stored recovery codes depend on it, so it **carries over at the stage-1 gate** and is rotated by adding a new current key while old keys stay in the ring until no code uses them; never deleted while codes reference it). worker-general: `SMTP_PASSWORD_FILE` (secret, *rotated by replacement*; fresh in stage 1 with the new provider). Android build: `budmon.googleServerClientId`. | D-6, D-8, D-12. |
| PA-4 (landed as platform A-4) | **Exception to P-D-24 rule 4** ("no sensitive values in URLs") for exactly one route, `GET /api/v1/auth/google/callback?code&state`, recorded in the platform HLD with §5.1's mitigations; the stage-0 checklist confirms Caddy's and Tailscale Serve's access logs (if enabled) record no query strings. The contract test for rule 4 covers contract procedures only and is unaffected; the callback is a non-contract route with its own tests (§5.1). | D-6, P-3 of the review. |
| PA-5 (landed as platform A-5) | **Egress** recorded for stage 1's firewall work (P-D-29): the API to `oauth2.googleapis.com` and `www.googleapis.com` (token exchange and JWKS) over HTTPS; worker-general to the chosen email provider's SMTP host on 587 or 465. | D-6, D-12. |
| PA-6 (landed as platform A-6) | **Owner bootstrap entry point.** (a) Platform F-93 (`main/cli.ts`) gains an explicit `identity:bootstrap-owner` row with config kind `api` (database as `budmon_app`, `PUBLIC_ORIGIN` for the link). Its handler is identity's, its options are `--email <address>` and `--replace`, and it exits 0 on success, 1 on refusal and 64 on usage errors. (b) `budmon-local` gains `bootstrap-owner --email <address> [--replace]`, which runs `docker compose exec -T api node dist/main/cli.js identity:bootstrap-owner …` in the running `api` container of the current release. `exec` output isn't captured by Docker's logging driver, so the printed token never reaches the json-file logs. `budmon-local` refuses if the stack isn't running. (c) The stage-0 rehearsal runs the wrapper once and asserts that the canary scan of Docker logs finds no token. | D-21, J-16; the first user can't exist without it. |

Already planned by the platform and only fulfilled here: the `idempotency_records` foreign key, the `ErasureHandler`, the locale column, replacing `HomePlaceholder`, and `OutboxRepository.kick()` after sign-in.

## 6. Key flows

**F-1 Sign-in completion with two-step verification (password shown; a Google sign-in enters at "first factor passed" with a possible pending link, D-7).**

```mermaid
sequenceDiagram
  participant C as Client
  participant API as API (auth service)
  participant DB as Postgres
  C->>API: auth.signIn {email, password, tokenDelivery}
  API->>API: rate limits (IP, HMAC(email))
  API->>DB: find user by normalised email + password_credentials
  API->>API: Argon2id verify (dummy verify if no user/no password)
  alt wrong / no user
    API-->>C: 401 INVALID_CREDENTIALS
  else closed (owner deletion or ban)
    API-->>C: 403 ACCOUNT_CLOSED
  else two-step enabled
    API->>DB: insert auth_challenge {kind two_step, user, delivery, pending Google link if any, attempts 0, 5 min}
    API-->>C: {result: "two_step_required"} + challenge (cookie, or body on Android)
    C->>API: auth.verifyTwoStep {code | recoveryCode}
    API->>API: per-user second-factor limiter (10/15 min, 30/day)
    API->>DB: lock challenge; check TOTP (±1 step, step > last_used_step) or recovery code
    alt wrong code
      API->>DB: attempts + 1 (5th: consume challenge, security event, enqueue "didn't pass" email)
      API-->>C: 400 TWO_STEP_CODE_INVALID (or 401 TWO_STEP_CHALLENGE_EXPIRED)
    else right code
      API->>DB: one tx: consume challenge, update last_used_step / used_at, commit pending Google link (if any) + its event + email, create session, sign-in event
      API-->>C: 200 + Set-Cookie access/refresh (or tokens in body)
    end
  else no two-step
    API->>DB: one tx: commit pending Google link (if any), create session, security event, rehash password if parameters changed
    API-->>C: 200 + tokens
  end
```

**F-2 Refresh with a stored token family (D-3).**

```mermaid
sequenceDiagram
  participant C as Client
  participant API as API
  participant DB as Postgres
  C->>API: auth.refresh (refresh cookie on Path=/api/v1/auth/refresh for cookie sessions; body for bearer sessions)
  API->>DB: SELECT token row by hash, its session FOR UPDATE
  alt no row, session revoked/expired, or presented via the other channel
    API-->>C: 401 REFRESH_INVALID (no revocation for a wrong channel or unknown token)
  else token is the session's current token
    API->>DB: mark it presented + superseded; insert generation n+1; replace the access token hash; idle_expires_at = min(now + 30 d, absolute)
    API-->>C: 200 new access + refresh tokens
  else token is the immediate predecessor AND the current token was never presented
    Note over API: benign: the client lost the previous response (two tabs, app killed)
    API->>DB: mark the unused current token superseded; insert generation n+1 (child of the presented one); replace the access token hash
    API-->>C: 200 new tokens
  else a never-presented token discarded by the benign path within 60 s of its issue, and presented within 60 s of being discarded
    alt the current token is its unused sibling
      API->>DB: discard the current token; issue a new one (child of the presented token); replace the access token hash
      API-->>C: 200 new tokens (out-of-order race, session carries on)
    else the branch has moved on
      API-->>C: 401 REFRESH_INVALID (no revocation)
    end
  else any other superseded token of the family (presented before, or discarded outside those windows)
    API->>DB: revoke session (reason reuse_detected), security event, enqueue email (one tx)
    API-->>C: 401 REFRESH_INVALID
  end
```

**F-3 Web Google flow with hand-off (D-6, D-7); sign-in and sign-up shown.**

```mermaid
sequenceDiagram
  participant B as Browser (SPA on app origin O)
  participant API as API
  participant DB as Postgres
  participant G as Google
  B->>API: auth.googleStart {intent sign_in | sign_up + invitation token, returnTo} (Origin: O, must be listed)
  API->>DB: insert challenge google_web {state hash, PKCE verifier, nonce, intent, O, returnTo, invitation, binding hash}
  API-->>B: {authorizationUrl} + Set-Cookie binding (HttpOnly, Secure, SameSite=Strict, Path=/api/v1, 10 min)
  B->>G: top-level navigation (client_id, redirect_uri = callback origin, scope openid email profile, state, nonce, code_challenge)
  G-->>B: 302 to callback origin /api/v1/auth/google/callback?code&state
  B->>API: GET callback (stated query exception, §5.1)
  API->>DB: find unconsumed challenge by state hash
  API->>G: token exchange (code, verifier, client secret)
  G-->>API: id_token
  API->>API: verify id_token (JWKS, iss, aud, azp, exp, nonce)
  API->>DB: store verified claims + hand-off hash
  API-->>B: 303 to O/auth/google#h=<hand-off>
  B->>API: auth.googleComplete {handoff} (same-origin fetch on O: binding cookie sent)
  API->>DB: check hand-off + binding, consume
  alt sign_in
    API->>API: resolve (D-7): linked sub / verified email match (pending link) / unverified / unknown / banned
    API-->>B: session, or two_step_required (pending link kept in the challenge, F-1), or error key; then SPA goes to returnTo
  else sign_up
    API->>DB: re-check invitation; insert google_signup challenge {invitation, claims, 30 min}
    API-->>B: {signUpTicket} → S-6 for the same invitation
  end
  Note over B,API: link and confirm: me.googleStart / me.googleComplete (authenticated, same session required); confirm requires sub = linked sub
```

**F-4 Android Google sign-in.**

```mermaid
sequenceDiagram
  participant A as Android app
  participant CM as Credential Manager
  participant API as API
  participant DB as Postgres
  A->>API: auth.googleNonce
  API->>DB: insert challenge {kind google_nonce, nonce hash, 10 min}
  API-->>A: {nonce}
  A->>CM: GetSignInWithGoogleOption(serverClientId, nonce)
  CM-->>A: Google ID token
  A->>API: auth.googleAndroid {idToken, intent sign_in | sign_up + invitationToken, tokenDelivery: body} (link/confirm: me.googleAndroid, same session)
  API->>API: verify (aud = web client, azp ∈ Android clients, nonce matches unconsumed challenge)
  API->>DB: consume nonce; same resolution as F-3
  API-->>A: tokens, or two_step_required, or {signUpTicket}, or an error key
```

**F-5 Invitation: create, send, accept (D-10).**

```mermaid
sequenceDiagram
  participant I as Inviter (client)
  participant API as API
  participant DB as Postgres
  participant W as worker-general
  participant M as SMTP
  participant N as Invitee (browser)
  I->>API: invitations.create {email} + Idempotency-Key
  API->>DB: BEGIN; lock identity_settings; flip any past-expiry pending row for this email to expired; check switch (InvitePolicy), ban / pending-deletion user, active user, pending invite, allowance, cap (users + pending + 1 ≤ cap)
  API->>DB: insert invitation {pending, token_hash null, expires now+7d}; enqueue identity.email-send {invitation, id}; COMMIT
  API-->>I: {id, createdAt}
  W->>DB: load invitation (still pending?)
  W->>W: token = randomToken(32)
  W->>DB: set token_hash = sha256(token), token_issued_at (replaces any earlier token)
  W->>M: send email with https://O/invite#t=token
  N->>API: invitations.preview {token}
  API-->>N: {invitedEmail, inviterName, expiresAt, state}
  N->>API: invitations.accept {token, name, method: password | google ticket, baseCurrency, timeZone, locale, tokenDelivery}
  API->>DB: BEGIN; lock invitation + identity_settings; flip to expired if past expires_at; re-check state, ban, cap (users + 1 ≤ cap); ticket bound to this invitation, its Google email not banned and its sub not linked to anyone (re-checked here: the ticket may be 30 min old)
  API->>DB: insert user (email verified now), credential (password hash or Google link), session; mark invitation accepted; consume ticket; enqueue identity.user-created; COMMIT
  API-->>N: session (cookies or body)
```

**F-6 Password reset (D-13).**

```mermaid
sequenceDiagram
  participant C as Client
  participant API as API
  participant DB as Postgres
  participant W as worker-general
  C->>API: auth.requestPasswordReset {email}
  API->>API: rate limits (IP, HMAC(email))
  API->>DB: if an active user exists: insert password_resets {expires now+30 min}; enqueue email-send (one tx)
  API-->>C: 200 (same response either way)
  W->>DB: generate token, store hash, send email with /reset-password#t=token
  C->>API: auth.resetPassword {token, newPassword, twoStepCode?, tokenDelivery}
  API->>DB: lock reset row; valid, unused, not invalidated, unexpired?
  API->>API: if two-step on: per-user second-factor limiter, then check the code
  alt wrong code
    API->>DB: failed_codes + 1 (5th: invalidate the link)
    API-->>C: 400 TWO_STEP_CODE_INVALID (or RESET_LINK_INVALID)
  else right code, or two-step off
    API->>DB: one tx: set password hash, mark used, invalidate the user's other outstanding reset links, revoke all sessions, create this session, security event, enqueue "password changed" email
    API-->>C: session
  end
```

**F-7 Deletion, grace period and erasure (D-15).**

```mermaid
sequenceDiagram
  participant U as User
  participant API as API
  participant DB as Postgres
  participant W as worker-general
  participant P as Module participants
  participant L as Erasure log (platform)
  U->>API: deletion.request (confirmed session)
  API->>P: DeletionPrecheck (sole-admin shared accounts?)
  alt blockers
    API-->>U: 409 SOLE_ADMIN_HANDOVER_REQUIRED {accounts}
  else none
    API->>DB: status pending_deletion, scheduled_for now+7d, revoke all sessions, revoke pending invitations, security event, enqueue deletion-requested fan-out + email (one tx)
    API-->>U: 200
  end
  Note over W,P: sources disconnects immediately (fan-out handler)
  W->>DB: erasure-sweep: due users
  W->>L: append {userId, erasedAt} (stop here if this fails)
  W->>P: ErasureParticipant(userId) for each module, in order (idempotent)
  W->>DB: cancel the user's queued/running exports (export jobs abort when they see it)
  W->>W: delete users/<userId>/ in the exports bucket
  W->>W: final email: best effort, 10 s timeout, never blocks erasure; skipped on replay after a restore
  W->>DB: DELETE users row (cascades)
```

## 7. Cross-cutting concerns

### 7.1 Authorization

- **Procedure bases:** public procedures are only those in §5.1's list; everything else requires a principal; owner operations are only reachable through `admin`'s `ownerProcedure`s.
- **Self only:** every `me.*`, `exports.*`, `deletion.*` and `invitations.*` procedure acts on `ctx.principal.userId`; IDs from input (a session to revoke, an invitation to cancel) must belong to the caller, otherwise `NOT_FOUND` (P-§7.1).
- **Owner flag:** `users.is_product_owner`; at most one (partial unique index); set only by the bootstrap command (D-21). The principal's `isOwner` comes from it.
- **Status checks on every request:** the auth hook rejects sessions that are revoked, expired, or belong to users who aren't `active` or self-`pending_deletion`; owner-initiated deletion and bans revoke all sessions in their own transaction, and sign-in, refresh and reset check the status and the ban list, so a closed account can't get back in before erasure ends.
- **Pending deletion:** the user can use Budmon (banner) but `sources` must refuse new connections (`UsersReader.isActive` is false for `pending_deletion`); stated as a requirement on `sources`.
- **Cross-user exposure:** only `users.lookupByEmail` (exact, rate-limited, display name only) and display names for attribution on shared accounts (through `accounts`' own checks). Inviters see their invitations' emails and states only.
- **Database roles:** `budmon_app` has DML on identity's tables. `budmon_capture` gets `SELECT` on `users` only (the column list in the LLD); never on ★ tables, `email_bans`, `identity_settings`, `security_events` or `data_exports` (P-D-19's rule). A grants test asserts it.
- **CSRF (web):** cookies are `SameSite=Strict`; cookie-authenticated requests must carry `X-Budmon-Client: web/…` (a non-simple header, so a cross-origin page can't send it without a preflight, which the API never answers, P-D-36); mutations are JSON `POST`s. **Login CSRF:** every public procedure that sets cookies (`auth.signIn`, `auth.verifyTwoStep`, `auth.googleComplete`, `auth.resetPassword`, `invitations.accept`, `auth.refresh`) also requires `X-Budmon-Client: web/…` and `Content-Type: application/json` when `tokenDelivery` is `cookie`, so a cross-site form post (`text/plain`, no custom header) can't sign a victim into an attacker's account.

### 7.2 Money and currency

- Identity stores only `base_currency` (ISO code, FK to `currencies`, active currencies only at selection time). Changing it emits `identity.preferences-changed`; modules that hold base-currency amounts (budgets, A18) decide what a change means for them. Flagged for `budgets` (§9).

### 7.3 Consistency and transactions

- **One transaction each:** sign-up (user + credential + invitation accepted + ticket consumed + session + event enqueue); sign-in completion (challenge consumed + pending Google link committed + session + security events and emails); refresh rotation (row locked `FOR UPDATE`); password reset (password + reset used + all sessions revoked + new session + email enqueue); deletion request (status + sessions + invitations + events); invitation create and accept (with `identity_settings` locked `FOR UPDATE` so cap checks serialise).
- **Cap counting** (ADM-BR-2, A27), under the settings-row lock: **creating** an invitation requires `count(users) + count(pending, unexpired invitations) + 1 ≤ user_cap`; **accepting** one requires `count(users) + 1 ≤ user_cap` (users of every status count; other pending invitations don't block an acceptance, so lowering the cap below the pending total doesn't refuse everyone while there's still room). Because pending invitations counted at creation, an acceptance fails only after the owner lowers the cap.
- **Single use:** challenges, hand-offs, resets and invitations are consumed by a conditional update (`… WHERE consumed_at IS NULL`) inside the transaction that uses them.
- **Erasure** is idempotent and ordered (D-15); a crash mid-way is resumed by the next sweep; the erasure-log record is written first.
- **Jobs** are enqueued in the same transaction as the change (the platform HLD's flow F-2; P-F-73), so no email or event is sent for a rolled-back change.

### 7.4 Time and time zones

- All expiries are instants (`timestamptz`) computed from the injectable `Clock` (P-D-16): access 15 min, refresh idle 30 days and absolute 90 days, two-step challenge 5 min, step-up validity 10 min, Google flow 10 min (claims ≤ 30 min for sign-up), reset 30 min, invitation 7 × 24 h, deletion grace 7 × 24 h, export 7 days.
- TOTP uses Unix time in 30-second steps, independent of zones; the server's clock is NTP-synced (Docker Desktop's VM in stage 0).
- `users.time_zone` is an IANA name validated against the runtime's zone database; it's the zone every module uses for "today" (XC-5). Changing it moves no stored date (IDN-US-3).
- Dates in emails are rendered in the recipient's zone and locale (invitations: the inviter's).

### 7.5 Privacy and security

- **PLT-BR-1:** identity logs only internal IDs, enum outcomes and error keys. Emails, names, passwords, codes, tokens, Google claims and user agents never appear in logs, traces, metrics, job payloads or Sentry. The privacy canary suite (P-D-24) gains an email and a token canary through sign-in, reset and invitation paths.
- **Secrets at rest:** passwords (Argon2id), tokens (SHA-256), recovery codes (HMAC), TOTP secrets (sealed, `api-secrets`). A database or backup leak yields no usable credential.
- **Account enumeration:** sign-in and reset responses don't reveal whether an email exists (generic messages, a dummy Argon2id verification for unknown emails, the same response shape). Google sign-in reveals nothing for unverified emails (one generic response, D-7); for a verified email it reveals whether that address is a user only to someone who controls the address. A reset request does slightly more work when the email exists (an insert and an enqueue, about a millisecond); this timing difference is accepted under the per-IP and per-email limits. Invitation creation and user lookup do reveal existence by exact email to signed-in users, which IDN-US-5 requires; they're rate-limited (D-18).
- **Tokens in links** are in URL fragments (D-11) and the SPA removes them from the address bar immediately; `Referrer-Policy: no-referrer` is already set (P-D-22). The Google callback's `code`/`state` query is the one exception (§5.1, PA-4).
- **Cookies:** `__Secure-` prefixed, `HttpOnly`, `Secure`, `SameSite=Strict`; access cookie `Path=/api/v1`; refresh cookie `Path=/api/v1/auth/refresh`; the two-step challenge cookie `Path=/api/v1/auth`; the Google binding cookie `Path=/api/v1`, because `link`/`confirm` complete under `/api/v1/me/…` (D-6). (Browsers treat `http://localhost` as a secure context; whether they also accept the `__Secure-` prefix there is checked in the LLD's spike on Chrome, Edge and Firefox, A-10, with unprefixed `Secure` cookie names on `localhost` as the fallback.)
- **Android storage:** tokens in DataStore, encrypted with an AES-GCM key held in the Android Keystore (non-exportable); excluded from backups (P-F-262 already covers DataStore files).
- **Session hygiene:** the revocation rules per action are in D-3's table; owner deletion, bans and the owner's two-step reset revoke everything.
- **Data minimisation:** no date of birth, no IP addresses, no raw user agents, no Google profile photo; Google claims kept only during the flow; `email_at_link` kept for display.
- **Privacy notice:** identity owns its content (P-D-29 gate item 15); it must state: what's collected (email, name, preferences, sign-in methods), that bans keep the email address, export and deletion rights with the 7-day grace and 14-day backup tail (P-D-30), and Google sign-in's data use. Drafted in the LLD as a static page linked from S-6.

### 7.6 Scale, performance and observability

- **Load:** stage 1 up to about 100 users (P-A-4). Per request, the auth hook does one indexed lookup (`sessions.access_token_hash` joined to `users`). `sessions.last_used_at` and `users.last_active_at` are written at refresh time (at most every 15 minutes per session), never per request.
- **Argon2id cost:** about 20 to 50 ms per hash at the platform's parameters (estimate, measured in the LLD); concurrent hashes in one API process are capped (4) so a burst of sign-ins can't exhaust memory; waiting requests queue (the rate limits keep the queue short).
- **Latency targets:** the platform's (P-§4.6), except sign-in, sign-up, reset and step-up (hashing), which target p95 under 600 ms excluding Google round trips.
- **Metrics** (low cardinality, P-D-25): `auth_sign_in_total{method, outcome}`, `auth_refresh_total{outcome}`, `auth_refresh_reuse_total`, `auth_two_step_total{kind, outcome}`, `identity_emails_total{kind, outcome}`, `identity_erasures_total{outcome}`, `identity_exports_total{outcome}`. No user IDs as labels.
- **Alerts** (from stage 1, P-D-25): dead-lettered `identity.erase-user` jobs (erasure is a legal-grade promise), any `auth_refresh_reuse_total` increase (informational), email failures above 10% over an hour.

## 8. Decisions

### D-1: Opaque, server-side sessions with separate access and refresh tokens
- **Options considered:** (a) stateless signed access tokens (JWT, verified without the database) plus a stored refresh token; (b) one opaque session token per device with sliding expiry; (c) opaque access and refresh tokens, both stored as hashes on a session row, the access token looked up on every request.
- **Decision:** (c). Tokens are 256-bit random values with type prefixes (`bma_` access, `bmr_` refresh) so secret scanners and humans can tell them apart; the database stores SHA-256 hashes; one session row per signed-in device.
- **Rationale:** the spec requires seeing and signing out sessions and an immediate effect for bans (A38) and owner deletion; (a) can't revoke before the access token expires and needs a signing key and a revocation list to do better; and every authenticated request already reads Postgres, so one indexed lookup costs well under a millisecond at this scale and keeps the API stateless (state is in Postgres). (b) would send the long-lived credential on every request; separating the frequently sent short-lived access token from the rarely sent refresh token limits what a leaked request header or log line could expose, and gives rotation and reuse detection something to work on. Cost: a database read per request (accepted) and two tokens for clients to manage. The old code's defects (I-1 refresh-as-access, I-2 plaintext storage, I-5 identical tokens, I-6 email as subject) can't occur by construction.

### D-2: Lifetimes: access 15 minutes; refresh 30 days idle, 90 days absolute (absolute limit: recommended default — needs user confirmation)
- **Options considered:** refresh idle 30 days with no absolute limit; idle 30 / absolute 90; idle 30 / absolute 180; fixed 30 days.
- **Decision:** access tokens expire after 15 minutes; each refresh extends the session to 30 days from now, capped by an absolute lifetime of 90 days from sign-in. The values are configuration with these defaults. The 90-day absolute limit was v0.1's Q-1 and is taken as the recommended default under the owner's delegation; it's flagged for the owner's confirmation in the PR.
- **Rationale:** "the refresh token stays valid for a long time like a month" (R4-Q1): an active user is never asked to sign in for 3 months, and an idle device signs out after a month. A fixed 30 days would ask daily users to sign in monthly; no absolute limit means a stolen-and-used refresh token lives forever. 90 days bounds that at the cost of a sign-in (and a two-step code) every quarter.

### D-3: Refresh rotation over a stored token family, reuse detection, and session revocation rules
- **Options considered:** no rotation; rotation with strict reuse detection; rotation with a time-based grace window for the previous token (v0.1); rotation with a usage-based rule for the immediate predecessor and the whole family stored.
- **Decision:**
  - Every refresh token a session issues is stored (hash, generation, first-presented time, superseded time) in `session_refresh_tokens` until the session is purged, 30 days after it ended. The session points at its current token. Each session has **exactly one** live access token: every rotation replaces its hash, so the previous access token stops working at once.
  - Presenting the **current** token rotates: it's marked presented and superseded, generation n+1 is issued with a new access token.
  - "Immediate predecessor" means the current token's `parent_id`; every new token records the token it was issued from, so the family is a tree and no rule depends on generation numbers.
  - Presenting the **immediate predecessor of the current token while the current token has never been presented** is benign (the client never received or never saved the last response: two tabs racing, a lost response, an Android app killed between the server's rotation and saving the token). The never-used current token is marked superseded and a new generation is issued from the presented one. There's no time limit, so the Android case works however long the app stays closed.
  - A superseded token that **was never presented** can only come from the benign path, which discards an unused current token. It's answered **without** revoking only when **both** hold: the benign path discarded it **within 60 seconds of its issue**, and it's presented **within 60 seconds of being discarded**. That's the signature of a concurrent duplicate or a fast retry, where one browser's responses arrive out of order. Then, if the current token is still its unused sibling, a new token is issued (the session carries on); otherwise the answer is `REFRESH_INVALID` without revocation (amended in v0.6, identity LLD DV-9). Any other discarded token revokes the session (`reuse_detected`), records a security event and emails the user. That includes one discarded long after its issue, which means someone redeemed the predecessor while this device held the current token.
  - Presenting **any other superseded token** of the family, one that was presented before (an older token, or the predecessor after the current one has been used), revokes the session (`reuse_detected`), records a security event and emails the user. Because the whole family is kept, a token any number of generations old is recognised.
  - A refresh token presented through the other channel (a cookie session's token in a body, or a bearer session's token as a cookie) is refused with `REFRESH_INVALID` and nothing is revoked (D-4).
  - Clients still serialise their own refreshes (Web Locks on web, a mutex on Android), so the race is rare. The LLD tests every side of the rule: two concurrent refreshes in one browser with responses applied in either order keep the session with no alert; a token discarded within 60 s of issue but presented after the window revokes and alerts; and a predecessor redeemed long after the current token's issue, while the device is active (its access token dies, it refreshes at once), revokes and alerts.
  - **Revocation by action:**

    | Action | Sessions revoked |
    | ------ | ---------------- |
    | Password reset (D-13) | All, then a new session for this device |
    | Password change (J-17) | All others when "Sign out of all other devices" is ticked (default) |
    | Adding a password, connecting or disconnecting Google, turning two-step off, new recovery codes, replacing the authenticator | None |
    | Turning two-step on (J-7) | All others (they must pass two-step next time) |
    | Refresh reuse detected | That session |
    | Deletion request (self or owner), ban, owner's two-step reset | All |
    | Sign out / sign out of other devices (J-10) | This one / all others |
- **Rationale:** rotation plus detection turns a stolen refresh token into a detected incident (OAuth 2.0 Security BCP). Keeping only the previous hash (v0.1) couldn't recognise older tokens, and a time window either logged out legitimate Android users or gave an attacker a live branch. The usage rule fixes both. If an attacker uses a stolen token first, the legitimate client's next refresh presents a token whose successor was used and the session is revoked. If the legitimate client refreshes first, the attacker's token is old and is recognised. If the legitimate client takes the benign path, the attacker's unused successor becomes superseded and is recognised later. Keying the tolerance to both windows matches the race's real signature: duplicates and fast retries happen within seconds of issue. A thief who redeems a predecessor at any other time is detected the moment the legitimate device refreshes, even an active device that refreshes immediately because its access token was replaced. The only undetected theft is redeeming the predecessor within a minute of the legitimate rotation. The Android app-killed case doesn't need the tolerance, because that device presents the predecessor and takes the benign path. The cost of storing the family is one small row per rotation (about 100 a month per active device).

### D-4: Web uses HttpOnly cookies; Android uses bearer tokens; the delivery is bound to the session
- **Options considered:** bearer tokens everywhere (web stores them in memory or storage); cookies everywhere; cookies on web and bearer tokens on Android. Token hashing: SHA-256; HMAC-SHA-256 with a server key (P-D-22's suggestion).
- **Decision:** cookies on web, bearer tokens on Android. The client states `tokenDelivery` at sign-in; the session records it; the auth hook and `auth.refresh` accept a cookie only for `cookie` sessions and a header or body token only for `bearer` sessions. Cookie details in §7.5; CSRF defence in §7.1. Tokens are 256-bit random values hashed with plain SHA-256.
- **Rationale:** HttpOnly cookies keep tokens out of reach of any script on the page that holds financial data, and the same-origin API (P-D-36) makes them simple. Android has no cookie jar worth trusting and needs the token for WorkManager sync, so bearer tokens there. Binding the delivery means a token taken from one channel can't be replayed through the other. SHA-256 is enough for 256-bit secrets (no guessing is feasible). Avoiding a key lets worker-general issue invitation and reset tokens without holding an API key, and key rotation can't invalidate them. **Trade-off accepted:** with an unkeyed hash, anyone who can write the database can create a working session by inserting `sha256(token)` for a token they chose. Anyone with that access can already read and change all the data, and `budmon_capture` has no grant on the session tables (D-22), so the key would protect nothing else.

### D-5: Passwords: Argon2id at the platform's parameters, length-based policy, no pepper
- **Options considered:** parameters: the platform's `hashSecret` (m = 19 MiB, t = 2, p = 1, OWASP's baseline); stronger (m = 64 MiB, t = 3). Policy: composition rules; length plus a common-password list (NIST SP 800-63B); a breached-password API (HIBP). Pepper: none; an HMAC pepper in the API secret file.
- **Decision:**
  - Hashing: the platform's `hashSecret`/`verifySecret` as they are. Parameters are read from each PHC string, and a successful sign-in rehashes when the platform's parameters change. Concurrent hashes per process are capped (§7.6). Unknown emails get a dummy verification for equal timing.
  - Policy: passwords are 12 to 128 characters (Unicode, NFC-normalised, any characters, no composition rules); not in a bundled list of the 100,000 most common passwords; and, when the email's local part has at least 4 characters, not containing it (case-insensitive).
  - No pepper.
- **Rationale:**
  - OWASP's baseline is adequate with rate limits and optional two-step. Heavier parameters cost memory on a laptop and a small server, and the PHC-based rehash makes raising them later a configuration change.
  - Length beats composition (CR I-7 shows how composition rules go wrong). The 4-character threshold stops short local parts ("al") from rejecting ordinary passwords. A bundled list avoids sending password-derived data to a third party.
  - A pepper protects only against a database-only leak, which Argon2id and encrypted backups already make expensive, and losing the pepper would lock everyone out.

### D-6: Google Sign-In: server-side code flow on the web with a hand-off; Credential Manager ID tokens on Android
- **Options considered (web):** (a) Google Identity Services JavaScript (button or One Tap) returning an ID token to the page; (b) a server-side OIDC authorization code flow with PKCE whose callback sets cookies directly; (c) the same code flow, with the callback handing the result back to the SPA through a single-use hand-off token on the app origin that started the flow. **(Android):** Credential Manager (`GetSignInWithGoogleOption` / `GetGoogleIdOption`) returning an ID token; an in-app browser running the web flow. **OAuth client:** reuse the Gmail capture client; a separate sign-in client.
- **Decision:** web **(c)**; Android **Credential Manager**; a **separate sign-in OAuth client** (scopes `openid email profile`) whose secret only the API holds; details in §5.3. Specifically:
  - **Origins:** one callback origin registered with Google, and a separate allowlist of app origins that may start a flow and receive a hand-off. Google is offered on every app origin. When the callback is on `localhost` and the app origin isn't, the button carries the stage-0 note (J-4). `auth.methods` decides from the request's `Origin` header.
  - **Intents:** `sign_in` and `sign_up` start from public procedures. `link` and `confirm` start only from authenticated `me.google*` procedures; the challenge records the user and session, completion must come from the same session, and `confirm` requires the returned `sub` to equal the user's linked `sub`.
  - **Sign-up continuation:** completion returns a **sign-up ticket**: a 30-minute, single-use challenge bound to that one invitation and holding the verified claims. `invitations.accept` takes it with the invitation token and consumes both in its transaction. Android gets the same ticket from `auth.googleAndroid`.
  - **Return path:** each web flow stores a validated same-origin return path; after completion the SPA navigates there (D-9 for step-up).
  - **The callback's query string** is the one stated exception to "no credentials in URLs" (§5.1, PA-4).
- **Rationale:**
  - (a) loads and runs Google's script inside the page that shows financial data and widens the CSP (script, frame and connect sources); (b) and (c) need no script.
  - (b) can't cope with stage 0, where Google can redirect only to `http://localhost` while the web app normally runs on the tailnet address (P-D-29): cookies set on `localhost` wouldn't reach it. (c) makes that split work on the laptop, which is why the button must be offered on the tailnet origin (v0.1 hid it there, defeating the purpose). The phone's browser can't reach the laptop's `localhost`, so the note says so. If Google accepts a `ts.net` callback (P-Q-11 spike), the limitation disappears through configuration.
  - Beyond stage 0, (c)'s binding cookie can be `SameSite=Strict`, because it's checked on a same-origin fetch rather than on the cross-site navigation. (c) also gives the SPA one place to handle sign-in, sign-up, linking, step-up and errors, so the hand-off isn't stage-0-only machinery.
  - Credential Manager is Android's current API (it replaces the deprecated Google Sign-In for Android and One Tap libraries) and needs no redirect, so it works in every stage.
  - A separate client keeps the API's secret unable to redeem Gmail-scoped codes and lets the sign-in consent show only basic scopes, which are exempt from testing mode's test-user list.

### D-7: Linking rules for Google sign-in (IDN-BR-1, A32, ADM-BR-4)
- **Options considered:** match only by Google `sub`; match by email and link automatically; link automatically only when `email_verified`; allow linking a Google account with a different email explicitly. When to commit an automatic link: at the Google step; after the whole sign-in completes.
- **Decision:**
  1. A Google `sub` already linked → that user (then two-step if on).
  2. Not linked, Google's email **verified** and equal to a user's email → an automatic link is **prepared**, not committed. It's held in the sign-in: in the `two_step` challenge when two-step is on, or in the completion transaction otherwise. The link, its security event and the email "Google sign-in was connected" are committed only in the transaction that completes the sign-in (F-1), i.e. after the second factor. A failed or abandoned second factor leaves no link.
  3. Not linked and `email_verified` false → `GOOGLE_EMAIL_UNVERIFIED` with one generic message, **whether or not the address matches a user**, so an unverified Google account can't be used to probe Budmon.
  4. Not linked, verified, no match → `GOOGLE_ACCOUNT_UNKNOWN` (invite-only), unless the flow is a sign-up. This reveals non-membership only to someone who controls that address.
  5. **Sign-up from an invitation with Google:** the Budmon email is always the invited email (the link proved it); the Google account is linked by `sub` whatever its email, with the difference shown to the user (J-2).
  6. **Connecting from Settings** (authenticated, step-up required, same session) links any Google account by `sub`; a `sub` already linked elsewhere → `GOOGLE_ACCOUNT_IN_USE`.
  7. A Google email on the ban list is refused in every path (`GOOGLE_ACCOUNT_NOT_ALLOWED`, ADM-BR-4).
  8. Disconnecting Google requires that the user has a password (`PASSWORD_REQUIRED`).
- **Rationale:**
  - `sub` is Google's stable identifier (emails can change).
  - Automatic linking is the user's decision (R5-Q5). Requiring `email_verified` stops someone registering an unverified address at Google to take over a Budmon account (A32).
  - Committing only after the second factor stops a holder of a same-email Google account from attaching it to a two-step-protected user without passing the factor.
  - The generic unverified response closes an enumeration path.
  - Because the invitation link already proves the invited address, forcing the Google email to match would only push people with a work invitation and a personal Google account to passwords. Explicit linking is safe behind a step-up.

### D-8: Two-step verification: TOTP with sealed secrets, replay protection, one per-user limiter, and HMAC'd recovery codes; it guards every sign-in path
- **Options considered:** factor: TOTP; WebAuthn; email codes. Recovery codes: Argon2id-hashed (P-D-22's suggestion), HMAC-SHA-256 with a server key. Scope: password sign-in only; every sign-in path. Limits: per challenge only; one per-user limiter across every place a code is checked.
- **Decision:**
  - **TOTP:** RFC 6238 with SHA-1, 6 digits and 30 s steps. It accepts the previous, current and next step and rejects any step at or before `last_used_step` (no replay). Secrets are 160-bit, sealed with the `api-secrets` cipher (P-F-114). Enrolment stays pending until a code is verified (15 minutes).
  - **Recovery codes:** ten codes of 12 base32 characters (60 bits, shown `XXXX-XXXX-XXXX`), each single-use. They're stored as HMAC-SHA-256 under a data-bound key ring in the API's secret file (PA-3), **shown once at creation and never again**. Creating new codes needs a TOTP **or** recovery code. **Replacing the authenticator** (J-21) needs either code and swaps the secret after a code from the new app; the recovery codes are kept.
  - **Where it applies:** after password sign-in, after Google sign-in, in password reset, for step-up when two-step is on, and in the request that turns two-step off. It isn't asked at refresh.
  - **Limits:**
    - Every **TOTP code** check in those places counts against **one per-user limiter: 10 per 15 minutes and 30 per day**.
    - **Recovery codes are exempt from that limiter.** They're limited per IP (30 per 10 minutes), per sign-in challenge (5 attempts) and per reset link (5), the same as everything else.
    - So someone who knows the password and exhausts the TOTP limiter can't lock the user out: the user can still sign in, step up and reset with a recovery code, and then change the password.
    - Test required: with the per-user TOTP limiter exhausted, a valid recovery code still completes sign-in, step-up and reset.
  - **Alerting the user:** when a pending sign-in ends after 5 wrong codes (the first factor was right), the user is emailed and a security event is recorded (D-19).
- **Rationale:**
  - TOTP is what the user chose (R4-Q1) and works offline with any authenticator app; SHA-1 and 6 digits are what every common app supports.
  - Guarding Google, reset and step-up too stops two-step from being bypassed through another door. A single per-user TOTP limiter means spreading guesses across sign-ins, reset links and IPs gains nothing: at 30 a day with three accepted steps, the chance of guessing a code is about 1 in 11,000 per day, and the user is emailed long before. Recovery codes need no per-user limit, since guessing one of ten 60-bit codes is infeasible at any rate the per-IP limits allow, and exempting them keeps the limiter from becoming a lockout tool against users with a leaked password.
  - Argon2id on ten codes would mean up to ten slow hashes per attempt. 60-bit random codes behind these limits and a server-held key are as strong in practice, and the key ring allows rotation.
  - Showing codes once is the only way to keep them unrecoverable from the database.
  - Sealing (rather than hashing) the TOTP secret is required because the server must compute codes. `api-secrets` protects against a database or backup leak, not against a compromised API (P-D-19).

### D-9: Step-up ("Confirm it's you") for sensitive actions
- **Options considered:** none; re-enter the password for each sensitive action; a session-level "recently confirmed" timestamp valid for 10 minutes.
- **Decision:**
  - **Mechanism:** the third option. `sessions.confirmed_at` is set at sign-in and by `me.confirm` (code or password) or `me.googleComplete`/`me.googleAndroid` with intent `confirm`. `requireConfirmed` accepts it for 10 minutes.
  - **Factor asked:** a TOTP or recovery code if two-step is on; otherwise the password; otherwise (Google-only, no two-step) a fresh Google ID token for the **linked** account (`iat` within 5 minutes).
  - **Actions:** change or add a password, connect or disconnect Google, turn two-step on, create new recovery codes, replace the authenticator, request an export, delete the account. Turning two-step off additionally needs a code in the request itself.
  - **Resuming the action:** after a password or code, the client retries the request that got `CONFIRMATION_REQUIRED`. After a web Google step-up the page comes back to the stored return path with "Confirmed. You can continue now." and the user repeats the action. On Android the action resumes by itself.
- **Rationale:**
  - Month-long sessions mean a stolen or unattended session is the realistic threat. Step-up keeps it from changing credentials, exfiltrating everything in one export, or deleting the account.
  - Asking for the strongest factor the user has is simplest to explain.
  - A fresh Google token for the linked account proves current control of that account, which is the most a Google-only user can offer (accepted).
  - The page can't resume an action after leaving for Google without keeping action state in browser storage, so the user taps once more; that's simpler and safer.
  - The 10-minute window avoids prompting twice during one settings visit.

### D-10: Invitations: email-bound, worker-issued tokens, stored expiry, allowance and cap enforced under a lock
- **Options considered:** token creation: in the API (returned to the inviter or stored sealed for the worker); in the worker at send time. Binding: to the invited email; to anyone holding the link. Expiry: derived from `expires_at`; stored as a status. Allowance accounting: every invitation ever sent; pending + accepted. Sharing invitations: counted against the allowance; free.
- **Decision:**
  - **Binding:** an invitation is addressed to one normalised email; the user it creates has that email, verified at acceptance (the link proves it).
  - **Tokens:** the API creates the row without a token. The `identity.email-send` job generates the token, stores its hash (replacing any earlier one) and sends the email. **Resend** (at most 3 a day per invitation) issues a new token and resets the expiry to 7 days; the old link stops working. The only other token issuer is the owner bootstrap command (D-21), which mints the token itself and sends no email, so the two never compete.
  - **Expiry is a stored status:** `expired` is set by the hourly purge job, and earlier in the same transaction whenever a past-expiry pending row is touched (preview, accept, `listInvitations`, or a new invitation to the same email). So the "one pending invitation per email" index never blocks a new invitation behind a dead one, and counting uses stored states plus `expires_at > now`. `identity.invitation-ended` is emitted on expiry and revocation.
  - **Allowance:** counts the inviter's invitations that are `pending` (unexpired) or `accepted`; revoked and expired ones don't count. `null` means unlimited (the owner, and anyone the owner sets so). **Sharing invitations (`origin = account_share`) count against the inviter's allowance** (v0.1's Q-2; recommended default — needs user confirmation). Reusing someone else's pending invitation for a share charges nothing (§5.2).
  - **Cap** (A27): §7.3's formulas, checked with `identity_settings` locked at creation and at acceptance. A failed acceptance emails the inviter and the owner.
  - **Refusals:** a banned email or a user whose deletion is pending (`EMAIL_NOT_INVITABLE`, generic wording); an active user (`ALREADY_A_USER`); an existing pending, unexpired invitation (offer resend to its own inviter); the switch is off (`InvitePolicy`); allowance; cap.
  - **No copyable links in the MVP;** the owner bootstrap command prints its link because it runs on the owner's own machine (D-21).
  - **Acceptance is retry-safe** without an idempotency key: the invitation's state decides. If it was accepted in the last 10 minutes, a repeat gets `INVITATION_USED` and the web app shows "Your account is ready. Sign in to continue."
- **Rationale:**
  - Generating the token in the worker means its plain value exists only in that job's memory and in the email. It's never in a job payload (P-D-10), never stored unhashed, and the inviter can't forward a working link that bypasses the email, which keeps the "verified email" property.
  - Storing `expired` keeps the unique index, the lists and the counts consistent without every query re-deriving it.
  - Counting pending and accepted invitations matches "how many people can this user bring in"; freeing revoked and expired ones avoids punishing mistakes.
  - Counting sharing invitations keeps one rule for "bringing a new person in"; the owner can raise allowances for households.
  - Serialising cap checks on one row is trivially cheap at this scale and makes ADM-BR-2 hold under concurrency.

### D-11: Tokens in emailed links go in the URL fragment
- **Options considered:** query parameter; path segment; fragment.
- **Decision:** `…/invite#t=<token>`, `…/reset-password#t=<token>`, `…/auth/google#h=<hand-off>`. The SPA reads the fragment, replaces the history entry without it, and sends the token in a `POST` body.
- **Rationale:** fragments are never sent to the server, so they can't land in Caddy's or Tailscale's logs, proxies or analytics, which is P-D-24's "no sensitive values in URLs" applied to links Budmon can't avoid. Cost: the link needs JavaScript, which the SPA requires anyway.

### D-12: Email through an SMTP adapter in worker-general; Mailpit on the laptop in stage 0; a transactional provider over SMTP from stage 1
- **Options considered:** provider HTTP APIs (Postmark, Resend, SES API); SMTP to any provider; in stage 0: no email (CLI-printed links only), Mailpit, the owner's own Gmail SMTP.
- **Decision:** one SMTP adapter (§5.4); emails sent only from worker-general jobs; stage 0 targets a Mailpit container on the laptop (PA-2), with any SMTP relay as an owner option; stage 1 uses a provider chosen at the gate with SPF/DKIM/DMARC on `budmon.com`.
- **Rationale:** SMTP is provider-neutral, so stage 0 → 1 is configuration only (P-D-29) and a provider can be changed without code; provider APIs add little at this volume (dozens of emails a month). Stage 0 has no domain, so real delivery would mean the owner's own mailbox credentials on the laptop; Mailpit needs no account, keeps tokens on the machine, and still exercises the whole path (it's what development uses, P-D-28). Sending from jobs keeps SMTP latency and outages out of requests.

### D-13: Password reset: anti-enumeration, 30-minute single-use links, two-step enforced, all sessions revoked; it doubles as "set a password"
- **Options considered:** reset by link vs. emailed code; whether to require two-step; whether to sign in after reset; what Google-only users get.
- **Decision:**
  - **The link:** a fragment token, worker-issued like D-10, valid 30 minutes and single use. At most 3 can be outstanding per user (newer ones don't invalidate older ones within their life). The request always returns the same response.
  - **Completing it:** when two-step is on, the second factor is required and counts against D-8's per-user limiter; after 5 wrong codes the link is invalidated. Success sets the password, revokes **all** sessions, **invalidates the user's other outstanding reset links**, signs the user in on this device, records an event and emails "password changed". A password change from Settings (J-17) also invalidates outstanding reset links.
  - **Google-only users** receive a "Set a password for Budmon" email through the same flow when signed out. Signed in, they add one directly in Settings behind a step-up (J-18). Both routes end in the same state.
  - **Closed accounts:** users whose deletion was requested by the owner or who are banned get no email.
- **Rationale:** IDN-US-4 asks for an expiring link and signing out other sessions. The identical response prevents enumeration; the small timing difference of the insert is accepted under the limits (§7.5). Requiring two-step closes the classic bypass, since email access alone shouldn't defeat a second factor, and the per-user limiter plus the 5-code cap stop a mailbox holder from guessing across many links and IPs. Invalidating other links after a change means an old email can't undo it. Signing in afterwards removes a pointless extra step.

### D-14: Email verification is implied by the invitation; `email_verified_at` is kept; changing email is out of the MVP
- **Options considered:** a separate verification email after sign-up; implicit verification through the invitation link.
- **Decision:** accepting an invitation sets `email_verified_at`; the owner bootstrap likewise. No separate verification flow exists in the MVP. Changing a user's email isn't supported (A-1).
- **Rationale:** in invite-only mode the invitation email already proves control of the address; a second email would add a step for nothing. The column keeps open sign-up (IDN-US-10) possible: it would add a verification email and nothing else.

### D-15: Deletion: 7-day grace with sign-in still possible, handover precheck, immediate source disconnection, and an ordered, replayable erasure
- **Options considered:** during grace: lock the user out completely (undo by an emailed link); allow sign-in to a restricted "pending" screen only (needs a platform-level allowlist of procedures); allow normal sign-in with a banner. Erasure mechanics: a database cascade only; registered module participants plus the cascade.
- **Decision:**
  - Self-deletion requires a step-up and no blockers from `DeletionPrecheck` (shared accounts where the user is the only admin and others remain, XC-16).
  - On request: `pending_deletion`, `deletion_scheduled_for = now + 7 days`, `deletion_requested_by = self`; all sessions revoked; pending invitations revoked; `identity.deletion-requested` fans out (sources disconnect and revoke Google grants immediately, IDN-US-7; notifications stop); email.
  - During the grace period the user can sign in normally; a banner offers **Keep my account**; new source connections are refused; exports work. Cancelling restores `active` (sources stay disconnected; the user reconnects).
  - **Owner-initiated deletion** (ADM-US-4, R6-Q1) sets `deletion_requested_by = owner`. Sign-in is refused (`ACCOUNT_CLOSED`), only the owner can cancel, and the precheck doesn't block (ADM-US-8's default applies at erasure, in `accounts`' participant).
  - **Bans** set `deletion_requested_by = ban` with `scheduled_for = now`, revoke everything in the ban's transaction and enqueue erasure immediately (§5.2 `banEmail`). Sign-in, refresh and reset are refused from that commit until erasure ends.
  - **Erasure** (`identity.erase-user`), in order:
    1. Append the erasure-log record (P-D-30); stop if it fails.
    2. Run every `ErasureParticipant` in registration order: accounts first (handover per ADM-US-8 and "deleted user" attribution), then the rest.
    3. Mark the user's queued or running exports `failed` (`erased`); an export job checks the user still exists before each write and aborts.
    4. Delete the user's export objects.
    5. Send the final email: best effort, synchronous with a 10-second timeout, after reading the address. For a ban it's the "account closed" notice instead of "account deleted". An SMTP failure is logged and counted, never blocks or retries erasure.
    6. Delete the `users` row (cascade).
  - Every step is idempotent. The platform's replay after a restore runs the same pipeline **with the final email off**, so a restored and re-erased user isn't emailed again.
- **Rationale:** the restricted-screen option needs every module's procedures to honour a new principal state (a platform change touching all modules) to protect data the user can delete anyway; locking the user out makes "change my mind" and "get my export" harder. Revoking sessions at request still signs out every device, which is the protective part. Participants are needed because some data must be re-attributed, not deleted (shared-account entries) and some lives outside Postgres (exports, Gmail grants).

### D-16: Data export: an asynchronous ZIP with JSON and CSV, built from module participants
- **Options considered:** synchronous download; asynchronous job; separate CSV and JSON requests; one archive.
- **Decision:** identity's own section of the export holds the profile and preferences, the sign-in methods (whether a password is set, the linked Google email, whether two-step is on; never hashes, secrets or codes), invitations sent (email, status, dates), sessions (device label, created, last active) and security events (kind, time). `exports.request` (step-up, `Idempotency-Key`) creates a `queued` row and a job; worker-general streams each `ExportParticipant`'s data into `budmon-export-<date>.zip` containing `data.json` (one document, sections per module, amounts as minor-unit integers with currency codes and decimals) and `csv/<module>-<entity>.csv` (UTF-8 with BOM, RFC 4180, amounts as decimal strings with the currency's decimals, dates ISO 8601), plus a `README.txt`. Kept 7 days (P-D-35); downloaded through 15-minute presigned URLs issued after an ownership check. One running export per user, at most 3 requests per day.
- **Rationale:** a full export can be large and slow, so a job keeps it out of requests; one archive satisfies "CSV and JSON" (XC-17) in one action. Participants keep each module the owner of its own format. Step-up matters because an export is the whole account in one file.

### D-17: Preferences on `users`, set at sign-up with sensible defaults
- **Options considered:** a separate preferences table; columns on `users`.
- **Decision:** `locale`, `time_zone`, `base_currency` and `display_name` are columns on `users`, required at sign-up and preselected (locale from the browser/device resolved against supported locales, P-F-312; zone from the device; currency from the locale's region, falling back to USD). Changes emit `identity.preferences-changed`.
- **Rationale:** they're few, always needed together, and read by workers (including `budmon_capture`) for "today" and formatting; a join would add nothing.

### D-18: Rate limits and throttling instead of account lockout
- **Options considered:** hard lockout after N failures; progressive throttling with shared counters.
- **Decision:** the platform's shared limiter (P-F-63) with these limits (fixed windows; exact numbers confirmed in the LLD):

  | Operation | Per IP | Per subject |
  | --------- | ------ | ----------- |
  | Sign-in (password) | 30 / 10 min | 10 / 15 min per HMAC(email) |
  | **Every second-factor check** (sign-in verify, reset with two-step, step-up with a code, turning two-step off, new codes, replacing the authenticator) | 30 / 10 min | TOTP codes: one shared per-user limiter, 10 / 15 min and 30 / day (D-8). Recovery codes: not per-user limited. Both: 5 per sign-in challenge and 5 per reset link |
  | Refresh | 120 / 10 min | 30 / 10 min per session |
  | Google start / nonce / complete / callback | 60 / 10 min | (none) |
  | Password reset request | 10 / hour | 3 / hour per HMAC(email) |
  | Reset confirm (password part), invitation preview and accept | 30 / 10 min | (none for the token, which is unguessable; the second factor is limited above) |
  | Step-up confirm with a password | 30 / 10 min | 10 / 15 min per user |
  | Invitation create / resend | (none) | 20 / day per user; resend 3 / day per invitation |
  | `users.lookupByEmail` | (none) | 30 / hour per user |
  | Export request | (none) | 3 / day per user |

  No account is ever locked; a limited subject waits for the window (the platform's J-3 wording). **Open for the LLD:** a pure per-email count lets anyone who knows an email keep that user's password sign-in throttled (about 10 requests every 15 minutes). The LLD decides the counting scheme, for example per (email, IP) with a higher per-email cap, or exempting devices that hold a recent signed-in marker. It must keep online guessing bounded per account without letting a stranger block the owner of that account.
- **Rationale:** hard lockout lets anyone lock a known user out by guessing badly; per-email throttling bounds online guessing to about 1,000 attempts a day against one account, which a 12-character, non-common password survives. On the laptop every request comes from the Docker gateway (P-D-29), so per-IP limits act as global limits there; the generous IP numbers keep that harmless for one user.

### D-19: Security events and security emails
- **Options considered:** no audit; logs only (30-day telemetry retention, no per-user view); a per-user table plus user-facing emails.
- **Decision:**
  - **Recorded:** `security_events` records, per user: sign-in succeeded (method); sign-in failed for an existing user (no detail); a sign-in abandoned after 5 wrong second-factor codes; two-step on, off, or reset by the owner; authenticator replaced; recovery codes regenerated; recovery code used; password changed or added; Google linked (auto or manual) or unlinked; session revoked (by whom); refresh reuse detected; deletion requested or cancelled; export requested; owner deletion and ban. Kept 90 days.
  - **Emailed:** every event listed in §4.9's subjects. **Security notices count as account matters under XC-27** (reviewer Q-2; recommended default — needs user confirmation), so all of them are sent.
  - The `admin` audit log (ADM-BR-3) is separate and `admin`'s.
- **Rationale:** emails are what lets a user notice a takeover; the table supports support questions ("did I turn that off?") and a future "recent activity" view without logging personal data. No IPs or user agents keeps it minimal.

### D-20: The surface identity offers other modules
- **Options considered:** other modules read identity's tables directly; identity offers services, events and registries.
- **Decision:**
  - **The surface (§5.2):** `Principal` via the auth hook (with PA-1), `requireConfirmed`, `UsersReader`, `UserDirectory`, `InvitationService.inviteForAccountShare`, the owner services, `identity.*` events, and the registries `DeletionPrecheck`, `ErasureParticipant`, `ExportParticipant`, `InvitePolicy`, `InvitationContextProvider`.
  - **Tables:** other modules never write identity's tables. Reading `users` directly is allowed only for `budmon_capture`'s needs in SQL joins (time zone, locale), which the `sources`/`capture` LLDs list.
  - **Finding a user (IDN-US-5)** is by **exact email only** in the MVP. The spec's "or invite link" is deferred, so every share and loan goes through an address that's verified at sign-up (reviewer Q-1; recommended default — needs user confirmation).
- **Rationale:** identity is built before every dependent module, so it can't call them; registries with no-op defaults invert the dependency (the platform's composition root, P-D-31) and let identity ship and be tested alone. Events through the queue keep cross-module side effects transactional (the platform HLD's flow F-2; P-F-73).

### D-21: The product owner is a flagged user created by a bootstrap command; identity holds the data `admin` manages
- **Options considered:** owner by configuration (an email in an environment variable); a flag on `users`, set once by a command. Ownership of cap, allowance and bans: `admin`'s tables read by identity through ports; identity's tables with services for `admin`.
- **Decision:**
  - **Owner flag and bootstrap:** `users.is_product_owner` is set only through the CLI command `identity:bootstrap-owner --email` (PA-6). The owner runs it as `budmon-local bootstrap-owner --email <address>` (development: `pnpm cli identity:bootstrap-owner`). The wrapper runs `docker compose exec -T api node dist/main/cli.js identity:bootstrap-owner …` **inside the running `api` container**, because `exec` output isn't captured by Docker's logging driver. A one-off `compose run` container would write the printed token into the json-file logs that the release rehearsal's canary scan reads. The command is registered in platform F-93 with config kind `api`, so the API's `PUBLIC_ORIGIN` builds the link. worker-general's `PUBLIC_ORIGIN` (PA-2) is set to the same value for email links; both come from the same `site.env` setting. The token is written to stdout only, never through the logger or Sentry. It's refused when an owner exists. It's also refused while an unexpired `bootstrap` invitation is pending, unless `--replace` is given, which revokes that invitation in the same transaction. It creates an invitation with `origin = bootstrap` and **mints the token itself**: the hash is stored and the link printed to the owner's terminal, and **no email job is enqueued**. That makes it the one documented exception to D-10's worker-issued tokens; it's safe because the link appears only on the owner's own machine. So at most one bootstrap invitation can be pending, and accepting it sets the flag (guarded by the partial unique index).
  - **Data `admin` manages:** the owner's allowance is `null` (unlimited, still within the cap). `identity_settings.user_cap`, `users.invite_allowance` and `email_bans` live in identity, which enforces them; `admin` changes them only through the owner services in §5.2 and records its audit log there. Feature switches stay `admin`'s, reached through `InvitePolicy`.
- **Rationale:** a configuration email would make the owner's powers depend on a deploy setting and an email match; a flag set once is explicit and testable. Identity must enforce cap, allowance and bans in its own transactions (D-10), so the data belongs next to that logic; `admin` is built right after and only adds screens and auditing.

### D-22: Credential data in dedicated tables (P-D-19's rule)
- **Options considered:** columns on `users` with column-level grants; dedicated tables.
- **Decision:** the ★ tables of §3.1; `budmon_capture` gets `SELECT` on `users` only. A grants test lists every identity table and asserts the capture role's privileges.
- **Rationale:** the platform's rule prefers dedicated tables; column grants are easy to break with a `SELECT *` or a new column.

### D-23: Android specifics: invitation links, Google, token storage, and the offline outbox across sign-outs
- **Options considered (invitations on Android):** web only; Android App Links; a paste-the-link entry.
- **Decision:**
  - Sign-up from an invitation works in the phone's browser (the web app is responsive) and in the app: **I have an invitation link** on S-1 accepts a pasted link; from stage 1 (with `budmon.com`) Android App Links open `/invite` links in the app.
  - Google via Credential Manager (D-6); passwords saved and offered through Credential Manager.
  - Tokens in Keystore-encrypted DataStore (§7.5).
  - The offline outbox (P-F-254) belongs to one user at a time: the app stores the user ID that owns it. Sign-out with pending entries asks (J-10) and keeps them; if a **different** user then signs in, the app asks "This phone has {n} unsynced entries from another Budmon user. Delete them to continue?" and doesn't sync them for the new user. After a sign-in by the owning user, the app calls `OutboxRepository.kick()`.
- **Rationale:** XC-20 wants everything on both apps; pasting covers stage 0, where App Links can't be verified without a domain. Tying the outbox to its owner prevents syncing one user's entries into another user's account without changing the platform's outbox schema.

### D-24: The web app learns its session state from the API, not from JavaScript-readable cookies
- **Options considered:** a non-HttpOnly "signed in" hint cookie; calling `me.get` at boot.
- **Decision:** at boot the SPA calls `me.get`; on `UNAUTHENTICATED` it tries one refresh, then shows sign-in. The result (profile, preferences, flags such as `pendingDeletion`, `twoStepEnabled`, `hasPassword`) seeds the app shell and the locale (replacing P-F-206's `navigator.language` default once signed in). **Amended in v0.7:** a browser that has never signed in skips that probe. The SPA keeps a `localStorage` marker, set when a session is delivered to this browser and removed at sign-out and when a session ends; without the marker it shows sign-in at once, with no request. The marker decides only whether to ask; the answer is still the API's.
- **Rationale:** one request at boot is cheap and keeps all session state server-side and HttpOnly; a hint cookie can disagree with the real session. The marker can disagree too, but only harmlessly: a missing marker with a live session costs one extra sign-in, and a stale marker costs the same probe as before. Without it, every first visit would make two failing requests (`me.get` and the refresh both answer 401), which browsers log as console errors, and the platform's checks require a first page load with none (platform A-466, its favicon and release-smoke tests).

### D-25: The product owner can turn off a user's two-step verification (recommended default — needs user confirmation)
- **Options considered:** (a) the owner may reset it, with an email and a security event; (b) no reset: a user who has lost the authenticator and every recovery code stays locked out and can only be deleted.
- **Decision:** (a), v0.1's Q-3. `resetTwoStepByOwner` (§5.2) deletes the user's two-step credential and recovery codes and revokes all their sessions, in one transaction. It records a security event and emails "Two-step verification was turned off by the administrator". The user then signs in with the remaining first factor and can turn two-step on again. `admin` records the action in its audit log.
- **Rationale:** in a small invited group the owner knows the people and can check identity outside Budmon. The email tells the user at once if someone talked the owner into it. Option (b) would turn a lost phone into a lost account.

## 9. Risks

| Risk | Impact | Mitigation |
| ---- | ------ | ---------- |
| Google refuses `*.ts.net` as a redirect origin (stage 0). | Web Google sign-in works from the laptop's browser (on the tailnet or `localhost` origin, D-6) but not from the phone's browser in stage 0. | Owner-only stage; the button carries a note; password and Android Google sign-in work; resolved at the stage-1 gate with `budmon.com`, or earlier by configuration if P-Q-11's spike shows Google accepts `ts.net`. |
| Email in stage 0 only reaches Mailpit on the laptop. | The owner can't open reset links on the phone. | Owner-only stage; any SMTP relay can be configured; reset links can be opened on the laptop. |
| A lost authenticator and lost recovery codes lock a user out. | The user can't sign in. | Recovery codes, low-code warnings, authenticator replacement (J-21), and the owner's reset with an email to the user (D-25). |
| The owner is talked into resetting someone's two-step verification. | An attacker who knows the password gets in. | The user is emailed at once; sessions are revoked; the owner is advised (in `admin`'s UI) to confirm identity outside Budmon first. |
| Automatic Google linking trusts Google's `email_verified`. | A compromised Google account (or a Workspace admin of that domain) can sign in to a matching Budmon account. | Same power as controlling the mailbox (reset links); two-step verification still applies; the user is emailed on linking. |
| Long sessions on shared or stolen devices. | Someone uses an unattended session for up to 90 days. | Step-up for sensitive actions; session list and remote sign-out; emails on security events; Android tokens in Keystore. |
| Deletion participants missing or failing in later modules. | Data survives erasure, or erasure stalls. | Participants are part of every module's LLD checklist (P-§3.1 convention); erasure dead-letters alert from stage 1; an erasure integration test enumerates tables referencing `users` and fails on any without a cascade or a participant. |
| Base currency changes and budgets (A18). | Budget amounts reinterpreted in a new currency. | Event emitted; the confirmation dialog warns; `budgets` must define the behaviour (flagged). |
| A thief holds the refresh token and the legitimate client never refreshes again (device lost, app uninstalled). | The thief's branch lives until the idle or absolute expiry. | Inherent to bearer refresh tokens; bounded by 30 days idle and 90 days absolute (D-2); the user sees the device in the session list and can sign it out; detection triggers as soon as both sides refresh (D-3). A related case: a thief holding the **immediate predecessor** can redeem it through the benign path. Unless that happens within 60 seconds of the legitimate rotation, the legitimate device's discarded token revokes the session and emails the user the next time it refreshes. An active device refreshes at once, because the thief's redemption replaced its access token (D-3). Residual risk: a redemption within a minute of the legitimate rotation goes undetected, bounded by D-2 and visible in the session list. |
| Mailpit or SMTP libraries log addresses. | PLT-BR-1 broken in stage 0. | Mailpit `--quiet` with logging driver `none`; the rehearsal's email canary path (PA-2). |
| A ban erases at once, so `accounts`' default handover (ADM-US-8: the longest-standing member becomes admin) runs before the owner can choose another admin or freeze the account. | The owner's override comes too late for banned users. | Flagged for the `admin` design: its ban screen should list the user's sole-admin shared accounts and take the owner's choice before calling `banEmail`, or `banEmail` should take per-account choices that `accounts`' participant applies. Identity passes `requestedBy = ban` to participants so they can tell. |
| Platform names drift again between this design and identity's build. | Identity's LLD names the wrong functions or paths. | Resolved for now: PA-1 to PA-6 landed as platform A-1 to A-6, and identity LLD v0.7 re-checked every citation against the built platform (platform LLD v1.30). A later platform change that touches a name identity uses needs an identity amendment. |

## 10. Assumptions

| ID | Assumption |
| -- | ---------- |
| A-1 | Changing a user's email isn't needed in the MVP (the spec's profile lists name, base currency, time zone and language only). The settings screen says to contact the administrator. |
| A-2 | The default user cap is 90 (below Google's 100 test users for Gmail's testing mode, spec §6); the owner changes it in `admin`. |
| A-3 | The display name is free text (1 to 80 characters); no avatar or photo. |
| A-4 | Invitation emails are written in the inviter's language. |
| A-5 | Only English ships at launch, so the language picker shows English (pseudo-locales in debug builds only, P-D-37). |
| A-6 | No "remember me" option; every session is long-lived. |
| A-7 | Android's minimum API 26 is supported by Credential Manager through Google Play services (the invited group uses Play-services phones). |
| A-8 | A transactional email provider for stage 1 is chosen at the stage-1 gate (candidates: Postmark, Amazon SES, Brevo, Resend), with free or low-cost tiers adequate for dozens of emails a month; terms to be checked then. |
| A-9 | The UX conventions in §4.0 become `docs/design/ux-guidelines.md` once this HLD is approved. |
| A-10 | The owner uses Chrome, Edge or Firefox on the laptop. They treat `http://localhost` as a secure context; whether they also accept `__Secure-` prefixed cookies there is checked in the LLD's spike, with unprefixed `Secure` cookie names as the `localhost` fallback (§7.5). |
| A-11 | Security events and the security emails in §4.9 are enough audit for users in the MVP (no in-app activity view). |

## 11. Open questions

None. v0.1's Q-1 to Q-3 and the reviewer's two questions were settled under the owner's delegation by taking the recommended options. Each is recorded as a decision marked "recommended default — needs user confirmation", so the PR lists it for the owner:

| Was | Now |
| --- | --- |
| Q-1 Total session lifetime | D-2: 90 days absolute |
| Q-2 Sharing invitations and the allowance | D-10: they count |
| Q-3 Owner resets two-step verification | D-25: yes, with an email and a security event |
| Reviewer Q-1 IDN-US-5's "invite link" | D-20: exact email only in the MVP; invite links later |
| Reviewer Q-2 Security notices under XC-27 | D-19: they're account matters; all are sent |

## 12. Out of scope / future work

- Open sign-up (IDN-US-10), with a verification email.
- Changing the email address (with verification of the new address and a notice to the old one).
- Passkeys (WebAuthn) as a sign-in method and second factor.
- A user-visible "recent security activity" list from `security_events`.
- New-device sign-in alerts; "remember this device" for two-step verification.
- More sign-in providers (Apple with iOS).
- Breached-password checks against an online service.
- Copyable invitation links, and finding a user through an invite link (IDN-US-5's second option, D-20).
- Server-rendered emails in more languages (catalogs only, no code change, P-D-37).
