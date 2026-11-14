# Proposed text for CLAUDE.md, "Project conventions"

Status: proposal for the user's approval (platform HLD D-34, A-13). It is not written into
`CLAUDE.md`. If approved, copy the section below under "Project conventions".

---

## Project conventions

### Repository

- A pnpm workspace: `apps/server`, `apps/web`, `apps/android`, `packages/*` (`config`, `shared`,
  `contract`, `test-support`), `infra/`, `tools/*`. Node 24 and pnpm 10 are pinned; run `pnpm check`
  before every push.
- Text files use LF. `.gitattributes` enforces it; keep `core.autocrlf false` on Windows.
- Branches: `feat/<module>` for module work; `release/<version>` and `hotfix/<version>` for
  releases. **Migration files under `apps/server/drizzle/` change only on `release/*` and
  `hotfix/*` branches** (D-12); CI fails any other branch that touches them.

### Database

- Development and test databases are built from the Drizzle schema. The only way to rebuild one is
  **`pnpm db:reset`** (guarded). Never run `drizzle-kit push` or edit a database by hand.
- Money is stored as integer minor units in `bigint` columns, never `mode: "number"`.

### Server code

- Layers: router, then service, then repo. Routers and services never import `drizzle-orm`, `pg` or
  a repo directly (lint enforces it).
- Log only through the platform logger; `pino` is imported only under
  `apps/server/src/platform/observability/`. No `console` outside `main/` and `tools/`.
- Never use `parseFloat` or `Number()` on money; use the `@budmon/shared` money helpers. A lint
  disable needs a written reason (`-- <reason>`).
- Sensitive values never reach logs, spans, metrics, error reports or job outputs.

### Web (SolidJS)

- The web app is a SolidJS single-page app.
- **i18n:** every user-visible string goes through `@formatjs/intl` with a default message and an
  ID; no literal strings in JSX.
- **RTL:** use logical Tailwind and CSS utilities (`ms-*`, `ps-*`, `start-*`, `text-start`, and so
  on), never physical ones (`ml-*`, `left-*`, `text-left`). Exceptions carry an `rtl-exempt:
  <reason>` comment.
- **Accessibility:** the blocking lint rules (alt text, labels, ARIA validity, no positive
  `tabindex`) must pass; axe results in Playwright are reported, not blocking.
- Icons come only from `apps/web/src/ui/icons/registry.ts`.

### Process

- Tests belong to the test-architect and application code to the software-engineer; neither edits
  the other's files. Behaviour the LLD does not define goes to the planner as an amendment.
