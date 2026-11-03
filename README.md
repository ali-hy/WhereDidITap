# Budmon

A personal budgeting and money-monitoring application. What it does and for whom is in
[the project brief](docs/product/project-brief.md) and
[the spec summary](docs/product/spec-summary.md). How work is done is in
[CLAUDE.md](CLAUDE.md) and [docs/design/README.md](docs/design/README.md).

## Prerequisites

- Docker with Compose v2, for the development stack (Postgres and Mailpit) and for the
  integration tests.
- Node 24 (see `.nvmrc`).
- pnpm 10, through Corepack: `corepack enable` picks up the version pinned in `package.json`.
- JDK and Android Studio, for the Android app (from S-13).

## First run

```sh
pnpm install
pnpm dev
```

`pnpm dev` does everything needed on a fresh clone:

1. creates `.env` from `.env.example` (an existing `.env` is never overwritten);
2. starts Postgres and Mailpit with Docker Compose (project `budmon-dev`, `infra/compose.yaml`);
3. creates `.data/dev-secrets/` with random development secrets;
4. creates and pushes the `budmon` database, the first time only;
5. starts the api and the worker.

Ctrl-C stops the api and the worker; the containers keep running (`docker compose -p budmon-dev
-f infra/compose.yaml down` stops them). Mailpit's inbox is at <http://127.0.0.1:8025>, and its
SMTP port is 1025 (both listen on the loopback address only).

## Configuration

Development configuration lives in `.env` at the repository root, created from `.env.example`
(which lists every variable). Variables ending in `_FILE` name a file whose content is the value;
relative paths are resolved from the repository root. Never commit `.env` or `.data/`; both are
ignored by git. Run the server through `pnpm dev`: running `apps/server/src/main/api.ts` directly
isn't supported.

## Database commands

| Command                   | What it does                                                               |
| ------------------------- | -------------------------------------------------------------------------- |
| `pnpm db:reset`           | Drops and rebuilds the development database from the schema, then seeds it |
| `pnpm db:reset --no-seed` | The same without seeding                                                   |
| `pnpm db:seed`            | Runs the seeders on the existing development database                      |
| `pnpm db:migrate`         | Applies the committed migrations (there are none until the first release)  |

`db:reset` and `db:seed` refuse to run against anything but a local development or test database.
Migration files exist only on `release/*` and `hotfix/*` branches; development databases are
built from the schema directly.

Release migrations (on a `release/*` or `hotfix/*` branch):

| Command                                     | What it does                                                                                                        |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `pnpm db:release-migration <version>`       | Generates `apps/server/drizzle/NNNN_<version>.sql`, answering create-or-rename prompts with create and listing them |
| `pnpm db:pending-report`                    | Prints the SQL a release would generate now, without writing to the repository                                      |
| `pnpm db:check-migrations`                  | Check (i): the migrations rebuild exactly the schema, and nothing is pending (Docker)                               |
| `pnpm db:check-risky <files…>`              | Flags risky statements; a `-- reviewed: <reason>` line above a statement accepts it                                 |
| `pnpm --filter @budmon/server test:upgrade` | Check (iv): migrates the previous release's database to this one (skipped before the first release)                 |

CI runs checks (i), (iii) and (iv) on `release/*` and `hotfix/*` pull requests and puts the pending
report in other pull requests' job summary. Tags are pushed by `tag.yml` (`tools/ci/tagRelease.sh`).

## Tests

| Command              | What it runs                                                   |
| -------------------- | -------------------------------------------------------------- |
| `pnpm test`          | Every unit test project                                        |
| `pnpm test:int`      | Integration tests against Postgres in Docker                   |
| `pnpm test:coverage` | The shared library's tests with the 100 % branch gate on money |
| `pnpm check`         | Format check, lint, type-check and all of the above            |

## Layout

| Path              | Contents                                                         |
| ----------------- | ---------------------------------------------------------------- |
| `apps/server`     | Fastify and oRPC API server and workers (added by later slices)  |
| `apps/web`        | SolidJS single-page app (added by later slices)                  |
| `apps/android`    | Android app (added by later slices)                              |
| `packages/config` | Shared TypeScript, ESLint and Prettier configuration             |
| `packages/*`      | `shared`, `contract` and `test-support` libraries (later slices) |
| `infra/`          | Compose files, the laptop stack and runbooks (later slices)      |
| `tools/ci`        | CI scripts, such as the migration-file check                     |
| `docs/`           | Product documents and the design documents (HLD and LLD)         |

## Commands

| Command          | What it does                                                     |
| ---------------- | ---------------------------------------------------------------- |
| `pnpm install`   | Installs the workspace                                           |
| `pnpm check`     | Format check, lint, type-check, unit tests and integration tests |
| `pnpm test`      | Every Vitest project except `server-int`                         |
| `pnpm test:int`  | The `server-int` project (needs a database)                      |
| `pnpm lint`      | ESLint                                                           |
| `pnpm format`    | Prettier, writing changes (`pnpm format:check` only checks)      |
| `pnpm typecheck` | `tsc` over the workspace                                         |

## Environments

Stage 0 runs the whole stack on the owner's laptop; stage 1 and 2 move it to hosted
infrastructure without code changes. The stage model, and the environments for development and CI
are described in the
[platform HLD](docs/design/platform/hld.md). The stage-0 laptop installation and its operation
(`infra/local/budmon-local`) are in the
[stage-0 runbook](infra/runbooks/stage0-laptop.md).
