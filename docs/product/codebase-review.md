---
doc: codebase-review
version: 0.1
updated: 2026-10-05
reviewed-commit: d28078e (branch claude/planner-agent-setup-arpvpf)
spec-version: spec-summary 0.7
---

# Budmon: Codebase Review against the Spec

This is the evaluation of the existing code against [`spec-summary.md`](./spec-summary.md) v0.7. The spec's section 7, *Current state of the codebase*, will link here. It reports facts with `file:line` references, plus a one-line **keep / rework / replace** verdict per piece as input for the planner. It doesn't propose designs.

All paths are relative to the repo root. `server/src/...` is abbreviated to `src/...` where unambiguous.

## Summary

The repo holds an early **backend skeleton only**: Express 5 + Drizzle ORM (Postgres) + zod, with a half-started tRPC setup. There's no web app, no Android app, no tests and no migrations. Only two areas have any code: a basic email/password **auth** (register, login, refresh) and an **accounts** schema and repository. **The server doesn't start**, because it imports a file that has never existed (`src/router/index.ts:4` imports `../trpc.js`). Several queries that exist are invalid SQL or never execute. Much of what exists conflicts with decided spec rules: sign-up is open rather than invite-only, there are no account roles, money is stored in 32-bit integers, and there are serious security issues, including an unauthenticated endpoint that returns every user's password hash.

| Module | Exists | Reusable | Conflicts | Notes |
| ------ | ------ | -------- | --------- | ----- |
| `identity` | Partial: `users` table, register/login/refresh over REST, JWT middleware, `refreshTokens` table | Low. The patterns are reusable (bcrypt, zod validators, error class); the flows aren't | Many | Open sign-up vs IDN-BR-3; refresh token 7 days vs about a month (XC-18); refresh token usable as access token; tokens stored in plain text; emails case-sensitive vs IDN-BR-1; collects date of birth (not in spec); no invitations, profile, reset, 2FA, Google, sessions list, export or deletion. |
| `admin` | No (only an unauthenticated `GET /users` that lists all users) | None | Yes | `GET /users` leaks all users and their password hashes to anyone (`src/users/usersRouter.ts:7-10`); there's no product-owner role, user status, cap, ban or audit log. |
| `accounts` | Partial: `accounts` + `accountOwners` tables, `AccountsRepo` | Low | Many | No role column vs ACC-BR-2; balances are `integer` with no unit vs XC-1; no type, archiving, opening date, institution or identifiers; both read queries are invalid SQL; `createAccount` never inserts owners. No router or service. |
| `classification` | No | n/a | n/a | Nothing for purposes or tags. |
| `payees` | No | n/a | n/a | |
| `transactions` | No | n/a | n/a | No transaction table, so `accounts.currentBalance` has nothing to derive from. |
| `notifications` | No | n/a | n/a | No push or email integration. |
| `budgets` | No | n/a | n/a | |
| `reports` | No | n/a | n/a | |
| `debts` | No | n/a | n/a | |
| `sources` | No | n/a | n/a | No Gmail OAuth or SMS. |
| `capture` | No | n/a | n/a | |
| `review` | No | n/a | n/a | |
| Cross-cutting: currencies (XC-1 to XC-3) | Partial: `currencies` table, unused `CURRENCY` enum | Low | Yes | No per-currency decimals (XC-1); `code` nullable and not unique; no exchange rates (XC-3); the enum includes withdrawn currencies. |
| Cross-cutting: platform and tooling | Express app, env validation, error handler, pagination helper, compose file | Medium. Error class, env schema and pagination type are worth keeping once fixed | Some | Doesn't start; `build` script ignores tsconfig and fails; no tests; stale `.env.example`; stale committed `server/dist`; no migrations. |

### Headline findings

1. **The server can't start.** `src/router/index.ts:4` imports `../trpc.js`, which isn't in the repo and never was in git history. Type-check: 1 error. Runtime: `ERR_MODULE_NOT_FOUND`.
2. **An unauthenticated endpoint returns every user, including `passwordHash`**: `GET /users` (`src/users/usersRouter.ts:7-10`).
3. **A refresh token works as an access token.** Both are signed with the same secret and the same `{ email }` payload (`src/auth/authService.ts:129-161`), and the middleware accepts any valid JWT (`src/auth/authMiddleware.ts:45-47`, `93`). That means a 7-day bearer credential.
4. **Error responses leak internals.** Any non-`BudmonError` is spread into the 500 JSON (`src/errors/index.ts:43-51`). For Drizzle errors this includes the SQL and its **parameters**, for example a new user's email and password hash on a duplicate-key race. Validation failures come back as **500**, not 400.
5. **Sign-up is open**, conflicting with invite-only IDN-BR-3 and IDN-US-1 (`src/auth/authRouter.ts:33-41`).
6. **Accounts have no roles** (`src/db/schemas/account.ts:16-27`), conflicting with ACC-BR-2 and ACC-BR-3, and balances are 32-bit `integer` with no defined unit (`account.ts:9-10`), conflicting with XC-1.
7. **Several data-access paths are broken.** Both `AccountsRepo` reads generate invalid SQL (`src/accounts/accountsRepo.ts:34`, `46-51`). `createAccount` never executes its owner insert (`accountsRepo.ts:66-70`). Refresh-token reuse detection generates invalid SQL and silently does nothing (`src/auth/authService.ts:88-97`). The refresh-token insert isn't awaited (`authService.ts:152-158`).
8. **There's no test, migration or client code.** `npm test` exits 1 (`server/package.json:11`). The schema is only `drizzle-kit push`ed (`package.json:12`), and no `drizzle/` folder exists. The web and Android apps don't exist yet.

## 1. Inventory

### 1.1 Repository contents

| Path | What it is | Notes |
| ---- | ---------- | ----- |
| `server/` | The only application code: a Node/TypeScript backend | 19 source files under `server/src/`. |
| `server/dist/` | Compiled output (8 files), **tracked in git** | Committed in `09c717d`, before `dist/` was added to the root `.gitignore` in `3b70a37` (`.gitignore:2`). It's **stale**: it contains `dist/validation/env.js`, which has no counterpart in `src/`, and an older `index.js` that logs the whole `ENV` (`server/dist/index.js:14`). |
| `compose.yaml` | Postgres for development | `postgres:latest` (unpinned, line 3), password in plain text (line 6, development only), host port 9001 (line 9). |
| `code-bites.md` | A quick start that duplicates `compose.yaml` as a `docker run` command | |
| `README.md` | Empty | |
| `.prettierrc` | `tabWidth: 2` only | No ESLint config. |
| `.zed/settings.json` | Editor setting | |
| `.claude/`, `docs/` | Agent definitions, the pipeline, product docs | Not application code. |

Git history shows a `shared/` package (validators) that was removed in `3b70a37`, and earlier `src/services/` files that were replaced by the per-feature folders. There's no web app, Android app or shared client package.

### 1.2 Stack and versions (`server/package.json`, resolved from `server/pnpm-lock.yaml`)

| Concern | Package | Version |
| ------- | ------- | ------- |
| Runtime | Node | Not pinned (no `engines` field). Checked with Node 22.22.0; `@types/node` is ^24.10.1. |
| Package manager | pnpm | Lockfile v9; installed cleanly with `pnpm install --frozen-lockfile` (pnpm 10.28.0). |
| HTTP | express | 5.2.1 |
| RPC | @trpc/server | 11.9.0 (installed; the only use is the broken import) |
| ORM | drizzle-orm / drizzle-kit / drizzle-zod | 0.45.1 / 0.31.8 / 0.8.3 |
| DB driver | pg | 8.16.3 |
| Validation | zod | 4.1.13 |
| Auth | jsonwebtoken / bcrypt | 9.0.3 / 6.0.0 (the native binding loads; checked) |
| Logging | morgan | 1.10.1 |
| Config | dotenv | 17.2.3 |
| TS tooling | typescript / tsx | 5.9.3 / 4.21.0 |

Unused dependencies: `@rollup/plugin-typescript`, `rollup`, `tslib` and `@types/mssql` (`package.json:18`, `26`, `27`, `22`). `@types/jsonwebtoken` is in `dependencies` rather than `devDependencies` (`package.json:33`). The lockfile also resolves `@prisma/client`, `better-sqlite3` and `kysely` as auto-installed optional peers of `drizzle-orm` (`pnpm-lock.yaml:25`). They're leftovers of a Prisma setup that also shows in `server/.gitignore:6` and `server/.env.example:1-6`.

### 1.3 Build, run and test setup

| Item | Finding |
| ---- | ------- |
| `dev` script | `tsx watch ... src/index.ts` (`package.json:8`). |
| `start` script | `tsx ./src/index.ts`, running TypeScript directly (`package.json:9`). |
| `build` script | `tsc ./src/index.ts` (`package.json:10`). Passing a file on the command line makes `tsc` **ignore `tsconfig.json`**: it emits `.js` files next to the sources, without `skipLibCheck` or `esModuleInterop`. Checked with `--noEmit`: **129 errors** (124 in `node_modules`, 5 in `src`). |
| `test` script | `echo "Error: no test specified" && exit 1` (`package.json:11`). No test framework or test files. |
| `db:push` script | `drizzle-kit push` (`package.json:12`). There's no `generate`/`migrate` script, and the configured `out: "./drizzle"` folder doesn't exist (`drizzle.config.ts:5`), so there's no migration history. |
| `tsconfig.json` | Strict, with `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`, `module: nodenext` (lines 10-42). `rootDir: "."` (line 5) with `drizzle.config.ts` included (line 44) means an output layout of `dist/src/...`, which doesn't match `main: dist/index.js` (`package.json:6`). `jsx: react-jsx` (line 37) is irrelevant on the server. |
| `drizzle.config.ts` | Postgres dialect; the schema glob is `./src/db/schemas/*` (line 6); `DATABASE_URL!` uses a non-null assertion (line 9). |
| `server/.env.example` | **Stale and wrong for this code.** It has Prisma comments (lines 1-6), a SQL Server URL (line 8), `PORT=1000` (line 9, a privileged port on Linux), and `BETTER_AUTH_*` variables (lines 10-11) that nothing reads. It's **missing `JWT_SECRET`**, which `src/env.ts:8` requires. |
| `src/env.ts` | The zod schema requires `DATABASE_URL`, `PORT` and `JWT_SECRET` with at least 8 characters (lines 5-9). If validation fails it only `console.warn`s and **carries on with the raw `process.env`** (lines 12-18), so the server can start without a JWT secret. |

### 1.4 Does it run?

| Check | Result |
| ----- | ------ |
| `pnpm install --frozen-lockfile` | OK; the lockfile was unchanged. |
| `npx tsc --noEmit -p .` (using tsconfig) | **1 error**: `src/router/index.ts(4,24): TS2307 Cannot find module '../trpc.js'`. Everything else type-checks. |
| `npm run build` equivalent | Fails with 129 errors (see 1.3). |
| Start (`tsx src/index.ts` with dummy env) | **Crashes immediately** with `ERR_MODULE_NOT_FOUND .../src/trpc.js`. `trpc.ts` doesn't appear anywhere in git history (`git log --all -- server/src/trpc.ts` is empty). |
| Database | **Not run.** The Docker daemon wasn't running and nothing listened on port 9001 or 5432. Instead, SQL was checked offline with Drizzle's `.toSQL()` and validators with `safeParse` (results in section 3). |
| Tests | None exist. |

After checking, the installed `node_modules` was removed. No tracked file was changed.

## 2. Per-module findings

### 2.1 `identity` (IDN)

**What exists**

| Piece | Location |
| ----- | -------- |
| `users` table: `id` (int identity), `name` (required), `dob` (date, optional), `email` (unique, required), `passwordHash` | `src/db/schemas/users.ts:6-12` |
| `refreshTokens` table: `id`, `userId` (FK), `token` (varchar) | `src/db/schemas/refreshTokens.ts:5-9` |
| REST endpoints `POST /auth/register`, `POST /auth/login`, `POST /auth/refresh`, `GET /auth/test-auth` | `src/auth/authRouter.ts:12-53`, mounted at `src/router/index.ts:8` |
| `AuthService`: register (bcrypt cost 10), login, refresh with rotation, JWT creation | `src/auth/authService.ts:38-161` |
| `identifyUser` middleware (optional bearer token sets `req.user`) and `authGuard()` | `src/auth/authMiddleware.ts:22-63`, `65-109` |
| Validators: password policy, registration (derived from the table via drizzle-zod), login, refresh, JWT payload | `src/auth/authValidators.ts:5-30` |
| Errors: `UnauthorizedError` 401, `InvalidCredentialsError` 400, `UserAlreadyExists` 400 | `src/auth/authErrors.ts:3-23` |
| `UserRepo`: `createUser` (unused), `getUserById`, `getUserByEmail`, `getUsersPaginated` (unused) | `src/users/userRepo.ts:20-47` |

**Story coverage**

| Story / rule | Status | Evidence |
| ------------ | ------ | -------- |
| IDN-US-1 invite-only sign-up, base currency, time zone | **Conflicts** | Registration is open to anyone (`authRouter.ts:33-41`). There's no invitation entity, and no base-currency or time-zone column (`users.ts:6-12`). |
| IDN-US-2 sessions about a month; see and sign out sessions | **Conflicts / missing** | Refresh token expires after 7 days (`authService.ts:148`) vs about a month (XC-18). Sessions have no device, created or last-used fields (`refreshTokens.ts:5-9`). There's no logout or session-list endpoint. |
| IDN-US-3 profile and preferences | Missing | No endpoints; no language, time-zone or base-currency columns. |
| IDN-US-4 password reset | Missing | No email integration. |
| IDN-US-5 find a user by exact email | Missing, and **conflicting** | `GET /users` returns the whole user list (`src/users/usersRouter.ts:7-10`), against IDN-BR-2 ("no directory browsing"). |
| IDN-US-6 export | Missing | |
| IDN-US-7 deletion with a 7-day grace period | Missing | No status or deletion-timestamp column. Foreign keys have no `onDelete` behaviour (`refreshTokens.ts:7`, `account.ts:19-24`). |
| IDN-US-8 2FA | Missing | |
| IDN-US-9 invitations | Missing | |
| IDN-BR-1 one user per email; Google linking | **Partial / conflicts** | `email` is unique but **case-sensitive** (`users.ts:10`), and login matches exactly (`authService.ts:63`), so `A@x.com` and `a@x.com` can be two users. No Google identity column. |
| IDN-BR-2 no partial search | Conflicts (see IDN-US-5) | |
| IDN-BR-3 invite-only | **Conflicts** | Open `/auth/register`. |
| Data not in the spec | Note | `dob` is collected at sign-up (`users.ts:9`; accepted by `registrationSchema`, `authValidators.ts:11-17`). The spec's profile (IDN-US-3) doesn't include a date of birth. |

**Defects in the existing identity code** (verified unless marked as reasoning)

| # | Finding | Evidence |
| - | ------- | -------- |
| I-1 | A refresh token is accepted as an access token. Both are `jwt.sign({ email }, ENV.JWT_SECRET)` with only the expiry differing, and `identifyUser`/`authGuard` accept any token that verifies. So the 7-day refresh token is a valid bearer credential. | `authService.ts:129-139`, `141-150`; `authMiddleware.ts:45-47`, `93` |
| I-2 | Refresh tokens are stored in plain text, with no expiry column. | `refreshTokens.ts:8` |
| I-3 | The refresh-token insert isn't awaited. `login` returns before the row exists, so an immediate refresh can fail, and an insert error becomes an unhandled rejection, which ends the Node process by default. | `authService.ts:152-158` |
| I-4 | Reuse detection (on an unknown refresh token, delete all of the user's tokens) generates invalid SQL, `... where "refreshTokens"."userId" = "userId"."id"` (a subquery alias that isn't in the FROM). The resulting error is swallowed by the outer `catch` (`119-126`), so detection never happens. | `authService.ts:87-100` (SQL checked with `.toSQL()`) |
| I-5 | Two tokens for the same email in the same second are byte-identical: no `jti`, and `iat` has second resolution (checked). Two rows then hold the same token, and deleting by token value removes both. | `authService.ts:141-150`, `102-105` |
| I-6 | Tokens identify users by **email**, not by id (no `sub`). A future email change would invalidate or mis-attribute tokens, and every request costs a lookup by email. | `authValidators.ts:28-30`; `authMiddleware.ts:48-51` |
| I-7 | The password rule's message promises "uppercase, lowercase, number, special", but the regex only requires one letter, one digit and one of `@$!%*#?&`. It also **rejects** any other character: spaces, `-`, `^`, non-ASCII letters. So `password1!` passes, while `Correct horse battery 1!` and `Pässwörd1!` fail (checked). | `authValidators.ts:5-9` |
| I-8 | Registration doesn't validate the email format or require a non-empty name. `{name:"", email:"not-an-email"}` passes (checked). | `authValidators.ts:11-17` (drizzle-zod from `users.ts`) |
| I-9 | Check-then-insert race on registration: a concurrent duplicate hits the unique constraint and becomes a 500 that leaks the query and its parameters, including the bcrypt hash (see X-3). | `authService.ts:42-51` |
| I-10 | Login reveals whether an account exists. An unknown email returns before any bcrypt work (a timing difference), and register says "A user with this email exists". Wrong credentials return **400**, not 401. | `authService.ts:57-69`; `authErrors.ts:9-23` |
| I-11 | `authGuard` duplicates `identifyUser`'s token parsing, never sets `req.user`, and has an unused `(...args: never[])` signature. | `authMiddleware.ts:65-109` |
| I-12 | `identifyUser` queries the DB directly instead of through `UserRepo`; `authGuard` uses `UserRepo`. The layering is inconsistent. | `authMiddleware.ts:48-51` vs `98-100` |
| I-13 | A debug endpoint, `GET /auth/test-auth`, is exposed. | `authRouter.ts:12-21` |
| I-14 | No rate limiting or lockout on login, register or refresh. No CORS configuration. | `src/index.ts:8-22` (reasoning: nothing is registered) |

**Verdict:** keep bcrypt hashing, the zod-validator pattern and the error types as patterns. **Replace** the token and session design (I-1 to I-6 and XC-18 make it incompatible). **Rework** the `users` table, which needs invitation linkage, status, profile preferences, Google identity, 2FA and case-insensitive email. Drop or justify `dob`.

### 2.2 `admin` (ADM)

| Story / rule | Status | Evidence |
| ------------ | ------ | -------- |
| ADM-US-1 list users (account details only) | **Conflicts** | `GET /users` lists every column of every user, **including `passwordHash`**, with **no authentication** (`src/users/usersRouter.ts:7-10`). |
| Product-owner role (ADM-BR-1) | Missing | No role or flag on `users`. |
| ADM-US-2 invitations, ADM-US-3 cap, ADM-US-4 delete/ban, ADM-US-5 allowance, ADM-US-7 feature switches, ADM-US-8 sole-admin handover, ADM-US-6 Google tester reminder | Missing | |
| ADM-BR-3 audit log | Missing | |
| Other | Defect | `POST /users` has an empty handler that never responds, so requests hang (`usersRouter.ts:12-14`). |

`UserRepo.getUsersPaginated` (`src/users/userRepo.ts:32-47`) is the only piece that resembles a user list, and it relies on the buggy pagination helper (X-8).

**Verdict:** replace `usersRouter`. Keep the paginated-list shape as an idea once the pagination helper is fixed.

### 2.3 `accounts` (ACC)

**What exists**

| Piece | Location |
| ----- | -------- |
| `accounts`: `id`, `name` varchar(256), `initialBalance` integer, `currentBalance` integer, `currencyId` FK to `currencies` | `src/db/schemas/account.ts:6-14` |
| `accountOwners`: `(accountId, ownerId)` composite PK, both FKs | `account.ts:16-27` |
| Drizzle relations for both | `account.ts:29-45` |
| `AccountsRepo`: `getAccountsByUserId`, `getAccountById`, `createAccount`, an empty `updateAccount` | `src/accounts/accountsRepo.ts:25-73` |
| Router or service | **None.** No endpoint exposes accounts. |

**Story and rule coverage**

| Story / rule | Status | Evidence |
| ------------ | ------ | -------- |
| ACC-US-1 type, opening date, institution, identifiers; creator becomes admin | **Partial / conflicts** | No `type`, opening-balance date, institution or identifiers columns (`account.ts:6-14`). `createAccount` takes a list of "owners" with no role (`accountsRepo.ts:54-71`). |
| ACC-BR-2 admin/member/viewer roles; ACC-BR-3 at least one admin | **Conflicts** | `accountOwners` has **no role column** (`account.ts:16-27`). Every owner is equal, so the rules can't be expressed. |
| ACC-BR-1 exactly one currency | Exists | `currencyId` is not null (`account.ts:11-13`). |
| XC-1 exact amounts with per-currency decimals | **Conflicts** | Balances are Postgres `integer` (32-bit, max 2,147,483,647) with no documented unit (`account.ts:9-10`). If they're minor units at 2 decimals, the ceiling is about 21.5 million, which is too low for high-denomination currencies (for example IDR or VND). If they're major units, fractions are lost. The `currencies` table has no decimals column (`currencies.ts:3-7`). |
| ACC-BR-6 balances never edited directly; XC-4 balance from transactions | **Conflicts as built** | `currentBalance` is a plain writable column, and nothing derives it from transactions, which don't exist. `updateAccount` takes a full row (`accountsRepo.ts:73`). Whether a stored balance is acceptable is a design choice; today nothing enforces ACC-BR-6. |
| ACC-US-2 list with balances and total | **Broken** | `getAccountsByUserId` generates `... from "accountOwners" left join "accounts" ... group by "users"."id"`. `users` isn't in the FROM, so Postgres rejects it (checked with `.toSQL()`, `accountsRepo.ts:28-38`). The left join from the owners table means rows can be all-null, which is why the return type is wrapped in `TableRecord` with every field nullable (`src/types/TableRecord.ts:3-5`). |
| (no story) get one account | **Broken** | `getAccountById` joins `users` on `accountOwners.accountId = users.id` (wrong column, `accountsRepo.ts:51`). It groups by `accounts.id` while selecting non-aggregated columns of the joined tables, which Postgres rejects, and it **selects `users.passwordHash`** (checked with `.toSQL()`). |
| (no story) create | **Broken** | The `accountOwners` insert is built but **never awaited or executed**. Drizzle queries are lazy, so no owner row is ever written (`accountsRepo.ts:66-70`). The two inserts aren't in a transaction either. |
| ACC-US-3 archive; ACC-BR-9 frozen; ACC-US-4/5/6 invitations, roles, leaving; ACC-US-7 created by / changed by; ACC-US-9 correction; ACC-BR-5, 7, 8 | Missing | No columns or code. |
| Singleton | Defect | `AccountsRepo.getInstance()` never stores `_instance`, so every call creates a new repo (`accountsRepo.ts:12-16`; checked: `getInstance() !== getInstance()`). |
| Schema nit | Note | `.primaryKey()` is declared twice on `accounts.id` (`account.ts:7`). Foreign keys have no `onDelete` behaviour (`account.ts:12-13`, `19-24`). `accountOwnersTable` and every relation are **missing from the Drizzle `schema` object** (`src/db/index.ts:9-16`), so the relational query API (`db.query...with`) can't use them. |

**Verdict:** **replace** the repository: none of its queries work. **Rework** the schema: keep the idea of a membership join table and the one-currency FK, but it needs roles, type, status (archived or frozen), opening date, identifiers, audit columns and a money representation that satisfies XC-1.

### 2.4 Cross-cutting: currencies and exchange rates (XC-1 to XC-3, ACC-BR-1)

| Finding | Evidence |
| ------- | -------- |
| The `currencies` table has `id`, `code` varchar(3) and `name`, both **nullable**, `code` **not unique**, and no minor-unit or decimals column, so XC-1 ("each currency is shown with its own number of decimals") can't be met. No seed data. | `src/db/schemas/currencies.ts:3-7` |
| The `CURRENCY` TypeScript **numeric** enum (USD=0, CAD=1, ...) is **unused** anywhere in `src`. Its values depend on declaration order, and it includes currencies withdrawn from ISO 4217: EEK (line 35), HRK (45), LTL (64), LVL (65), VEF (113), ZMK (119) and ZWL (120). It's a second, conflicting source of truth next to the table. | `src/enums/currency.ts:1-121` |
| Exchange rates (XC-3, daily market rates) and a per-user base currency (XC-2): nothing exists. | |

**Verdict:** replace the enum. Rework the table (it needs unique code and decimals).

### 2.5 `classification`, `payees`, `transactions`, `notifications`, `budgets`, `reports`, `debts`, `sources`, `capture`, `review`

**Nothing exists** for any of these modules: no tables, repositories, services, routes or integrations (Gmail OAuth, FCM, transactional email, exchange-rate provider, LLM). In particular:

- No transaction, split or transfer tables, so `accounts.currentBalance` can't be derived from anything (XC-4, ACC-BR-6).
- No background job or scheduler infrastructure, which `notifications`, the daily rates (XC-3), the deletion grace period (XC-16) and `sources` will need.
- No email sending, which IDN-US-4, IDN-US-9, ADM-US-4 and XC-27 will need.

Nothing conflicts here; these modules start from scratch.

## 3. Cross-cutting findings

### 3.1 Security

| # | Finding | Evidence |
| - | ------- | -------- |
| X-1 | Unauthenticated `GET /users` returns every user with `passwordHash`. | `src/users/usersRouter.ts:7-10` |
| X-2 | Refresh token is usable as an access token (I-1); tokens stored in plain text (I-2). | see 2.1 |
| X-3 | **Error leakage.** For any non-`BudmonError`, the handler does `res.status(500).json({ ...err })` (`src/errors/index.ts:43-51`). Checked: a Drizzle 0.45 `DrizzleQueryError` serialises to `{"query":"insert into \"users\" ...","params":["a","a@b.c","$2b$10$..."]}`, so SQL and parameter values reach the client. A `ZodError` serialises its full issue list, including the regex patterns. The handler also `console.log`s every error with its parameters (`errors/index.ts:37`). | `src/errors/index.ts:31-56` |
| X-4 | Validation failures return **500**. `loginSchema.parse(req.body)` and the others run outside `try` (`authRouter.ts:24`, `34`, `44`). Express 5 forwards the rejection to the handler, which treats `ZodError` as an unknown 500. `ValidationError` exists but is never used (`errors/index.ts:29`). | |
| X-5 | Invalid env only warns, so the app can run with `JWT_SECRET` undefined, and `jwt.sign` would then throw at runtime. The minimum secret length is 8 characters. | `src/env.ts:8`, `14-18` |
| X-6 | No rate limiting, CORS policy, security headers, or request-size policy beyond the Express default. | `src/index.ts:8-22` (reasoning) |
| X-7 | Login timing and register responses reveal whether an email is registered (I-10). | |

### 3.2 Correctness bugs (beyond those in section 2)

| # | Finding | Evidence |
| - | ------- | -------- |
| X-8 | The pagination helper is wrong in three ways. `totalPages` uses `Math.floor`, so 25 items at 10 per page gives 2 pages and page 3 is unreachable. `page` has no minimum, so page 0 gives offset −10. `hasPrev` is false for any page beyond `totalPages`. `pageSize` has no maximum (1e9 accepted). All checked. | `src/utils/pagination.ts:9-10`, `29-39` |
| X-9 | Unawaited or never-executed Drizzle calls (`authService.ts:152-158`; `accountsRepo.ts:66-70`). | see I-3 and 2.3 |
| X-10 | The Drizzle `schema` key has a typo (`refresTokens`), and `accountOwners` and all `relations(...)` are omitted. | `src/db/index.ts:13`, `9-16` |
| X-11 | `POST /users` hangs (it never responds). | `src/users/usersRouter.ts:12-14` |

### 3.3 Missing pieces

- `src/trpc.ts` (imported by `src/router/index.ts:4`). The `appRouter = router({})` it would create is never mounted or exported (`router/index.ts:16`), so tRPC is **not wired into Express** even in intent.
- Migrations (`drizzle/` folder, generate and migrate scripts).
- Test framework, test database setup and test scripts.
- A correct `.env.example` (`JWT_SECRET`, a Postgres URL matching `compose.yaml`).
- README and run instructions (`README.md` is empty; `code-bites.md` covers only the DB).
- Timestamps (`createdAt`/`updatedAt`) on every table; soft-delete or status columns.

### 3.4 Dead code and housekeeping

| Item | Evidence |
| ---- | -------- |
| Stale compiled output tracked in git | `server/dist/**` (8 files; see 1.1) |
| Unused enum | `src/enums/currency.ts` |
| Unused methods | `UserRepo.createUser` (`userRepo.ts:20-22`; `AuthService` inserts directly at `authService.ts:48`); `UserRepo.getUsersPaginated` (`userRepo.ts:32-47`); `AccountsRepo.updateAccount` (empty, `accountsRepo.ts:73`) |
| Unused class | `ValidationError` (`errors/index.ts:29`) |
| Unused imports and variables | `assert` (`accountsRepo.ts:6`, `env.ts:1`); `appRouter` (`router/index.ts:16`) |
| Unused dependencies | see 1.2 |
| Debug endpoints | `GET /` "Hello World!" (`router/index.ts:11-13`); `GET /auth/test-auth` (`authRouter.ts:12-21`) |
| Prisma, SQL Server and better-auth leftovers | `server/.env.example:1-11`, `server/.gitignore:6`, lockfile peers |

### 3.5 Things that affect the design

- **Two API styles are half-present**: REST routers on Express (`/auth`, `/users`) and an empty, unmounted tRPC router with a missing `trpc.ts`. The choice between them is still open, and the planner will have to make it. The Android client is native (XC-19), which bears on that choice.
- **Primary keys are 32-bit `integer` identity columns** everywhere (`users.ts:7`, `account.ts:7`, `currencies.ts:4`, `refreshTokens.ts:6`). They're sequential and guessable when exposed in URLs. **Offline creation on Android (TXN-US-10, XC-22)** needs client-generated identifiers or a mapping, which these keys don't support.
- **No migration history.** Since only `drizzle-kit push` has been used, the planner can freely redefine the schema **if no database with real data exists** (see the user decision below).
- **Identifier style**: tables and columns are camelCase in Postgres (`"accountOwners"`, `"passwordHash"`), so they need quoting in raw SQL.
- **Users are identified by email in tokens** (I-6), which matters for Google linking (IDN-BR-1) and any future email change.

## 4. Conventions: keep or replace

### 4.1 Observed conventions with verdicts

| Convention | Where | Verdict | Reason |
| ---------- | ----- | ------- | ------ |
| One folder per feature (`auth/`, `users/`, `accounts/`) with `<feature>Router.ts`, `<feature>Service.ts`, `<feature>Repo.ts`, `<feature>Validators.ts`, `<feature>Errors.ts` | `src/auth/*`, `src/users/*`, `src/accounts/*` | **Keep** | Matches the spec's module breakdown and is easy to extend per module. |
| Layering router → service → repo | `authRouter.ts` → `AuthService` → `UserRepo` | **Keep, enforce** | It's violated in three places: `usersRouter.ts:8` (router to DB), `authService.ts:48`, `57-63`, `81-105` (service to DB), `authMiddleware.ts:48-51` (middleware to DB). |
| Classes with a static `getInstance()` singleton; the constructor takes `db` | `authService.ts:26-36`, `userRepo.ts:9-18`, `accountsRepo.ts:11-23` | **Rework** | Injecting `db` helps testing, but `AuthService` hard-wires `UserRepo.getInstance()` (`authService.ts:28`), `AccountsRepo` never caches, and it can't share a DB transaction across repos. |
| Domain errors extend `BudmonError(key, status, message?, details?)` with `toSerializable()` and a central Express error handler | `src/errors/index.ts:3-27`, `31-56`; `src/auth/authErrors.ts` | **Keep the class; rework the handler** | A stable `key` per error fits the LLD's error catalog. The handler leaks internals (X-3) and maps validation to 500 (X-4). |
| zod for all input, including env; drizzle-zod to derive insert schemas | `authValidators.ts`, `env.ts`, `pagination.ts` | **Keep zod; review drizzle-zod use** | Deriving request schemas from tables couples the API to the DB, which is how `dob` leaked into sign-up and why email isn't validated (I-8). |
| Drizzle tables named `<thing>Table`, one file per table under `src/db/schemas/`, relations next to them | `src/db/schemas/*` | **Keep** | Consistent, and matches the `drizzle.config.ts` glob. |
| ESM, `nodenext`, `.js` suffix on relative imports, strict TS (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`) | `tsconfig.json`, all imports | **Keep** | Type-checks cleanly apart from the missing file. |
| Express 5 (async errors reach the error handler without wrappers) | `package.json:38` | **Keep** (if REST or a hybrid is chosen) | Already relied on in `authRouter.ts`. |
| pnpm with a committed lockfile | `server/pnpm-lock.yaml` | **Keep** | Installs reproducibly. |
| Prettier with only `tabWidth: 2`; inconsistent semicolons and no linter | `.prettierrc`; for example `authValidators.ts` has no semicolons, while `authService.ts` uses them | **Rework** | Needs a full formatter and linter config to be enforceable. |
| Integer identity primary keys | all schemas | **Planner to decide** | See 3.5 (offline creation, guessable ids). |
| `drizzle-kit push` without migrations | `package.json:12` | **Replace** | Can't evolve a database that holds data. |
| `TableRecord<T>` (every column nullable) | `src/types/TableRecord.ts` | **Replace** | Only exists to paper over a wrong left join. |
| Pagination helper (`page`/`pageSize` → `limit`/`offset` + `Paginated<T>`) | `src/utils/pagination.ts` | **Rework** | The shape is useful; the math is wrong (X-8). |

### 4.2 Proposed text for CLAUDE.md "Project conventions"

A proposal for the user to accept or edit. It records what the code already does where that's worth keeping, and leaves the open choices open. The analyst hasn't edited `CLAUDE.md`.

> - **Backend:** Node + TypeScript (ESM, `module: nodenext`, strict mode with `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`). Relative imports end in `.js`. Package manager: pnpm, lockfile committed.
> - **Layout:** `server/src/<module>/` per spec module, containing `<module>Router.ts`, `<module>Service.ts`, `<module>Repo.ts`, `<module>Validators.ts`, `<module>Errors.ts`. Tables live in `server/src/db/schemas/<table>.ts` as `<name>Table`, with their relations alongside, and every table and relation is registered in `src/db/index.ts`.
> - **Layering:** router → service → repo. Only repos touch `db`. Routers and middleware never query the database.
> - **Validation:** every external input (request bodies, params, env, third-party payloads) is parsed with zod at the boundary. Request schemas are written for the API, not derived wholesale from tables.
> - **Errors:** domain errors extend `BudmonError` with a stable `key` and HTTP status. Unknown errors return a generic 500 with no internals. Validation errors return 400.
> - **Database:** Postgres via Drizzle; schema changes go through generated migrations committed under `server/drizzle/`.
> - **Money:** *(to be fixed by the planner in the first LLD)* one representation for amounts that satisfies XC-1, used everywhere.
> - **API style:** *(to be fixed by the planner in the `identity` HLD: REST, tRPC, or both)*.
> - **Build output** (`dist/`) is never committed.
> - **Formatting:** Prettier (2 spaces) plus a linter, run before commit.

## 5. Verdicts at a glance (input for the planner)

| Piece | Verdict | One-line reason |
| ----- | ------- | --------------- |
| `src/index.ts` app bootstrap | Keep (rework) | Fine shape; needs CORS, security and the API-style decision. |
| `src/router/index.ts` | Rework | Broken import; tRPC router unmounted. |
| `src/env.ts` | Keep (rework) | Good pattern; must fail fast instead of warning. |
| `src/errors/index.ts` | Keep class, rework handler | Leaks internals; validation returns 500. |
| `src/auth/*` | Replace the flows, keep the patterns | Token design is unsafe and conflicts with XC-18 and IDN-BR-3. |
| `src/users/usersRouter.ts` | Replace | Leaks password hashes; hangs on POST. |
| `src/users/userRepo.ts` | Rework | Usable lookups; email case-sensitivity; unused methods. |
| `src/accounts/accountsRepo.ts` | Replace | Every query is broken. |
| `src/db/schemas/users.ts` | Rework | Lacks most IDN and ADM fields; `dob` not in spec. |
| `src/db/schemas/account.ts` | Rework | No roles, type or status; integer money. |
| `src/db/schemas/refreshTokens.ts` | Replace | Plain-text tokens, no expiry or session metadata. |
| `src/db/schemas/currencies.ts` | Rework | Needs unique code and decimals. |
| `src/enums/currency.ts` | Replace | Unused; numeric; outdated codes. |
| `src/utils/pagination.ts` | Rework | Off-by-one and negative offsets. |
| `src/types/TableRecord.ts` | Replace | A workaround for a wrong join. |
| `server/dist/` | Remove from git | Stale; ignored by `.gitignore` but tracked. |
| `server/.env.example` | Replace | Wrong database, wrong variables, missing `JWT_SECRET`. |
| `package.json` scripts | Rework | `build` ignores tsconfig; no test or migrate scripts. |
| `compose.yaml` | Keep (rework) | Works as a dev DB; pin the image version. |

## 6. For the user to decide

1. **Is there any database with data worth keeping?** The schema has only been `push`ed, with no migrations. If no real data exists, the planner can redefine tables freely; otherwise a migration path is needed. *(Recommendation: treat it as disposable unless you say otherwise.)*
2. **Start `identity` fresh, or adapt `src/auth`?** Given I-1 to I-6, adapting saves little beyond patterns. *(Recommendation: keep the patterns, replace the flows; the planner records this in the HLD.)*
3. **Date of birth:** the code collects it, and the spec doesn't mention it. Keep it (and say why), or drop it? *(Recommendation: drop it; collecting less fits the brief's privacy stance.)*
4. **Housekeeping before building:** removing the tracked `server/dist/`, the debug endpoints and the stale `.env.example` is outside any module. Should it happen as a separate clean-up PR, or inside `identity`'s slice S-0? *(Recommendation: inside `identity` S-0, so it goes through review like everything else.)*
5. **API style (REST vs tRPC):** this is the planner's design decision, but if you have a preference (you started tRPC), tell the planner before the `identity` HLD.
