# Handover: Budmon build session → new session on `ali-hy/WhereDidITap`

Written 2026-10-08 by the outgoing session. The repo was renamed from `ali-hy/Budmon` to `ali-hy/WhereDidITap`. Pushes to the old name started failing on 2026-10-07 at 15:09 UTC, so everything after that point exists only in the old session's container until it is pushed (see "Before you start").

## Before you start: check the work actually arrived

The old session's container held unpushed commits on two branches:

| Branch | Last pushed commit | Local head when written | Unpushed |
| ------ | ------------------ | ----------------------- | -------- |
| `feat/platform` | `2c90950` | `2a4a93d` plus the commit adding this file | 51 |
| `claude/planner-agent-setup-arpvpf` (design branch) | `74c27f0` | `a16b96a` | 6 |

Run `git log --oneline -3 origin/feat/platform` and `git log --oneline -3 origin/claude/planner-agent-setup-arpvpf`. If the heads aren't `2a4a93d`-or-later and `a16b96a`, the push never happened. In that case, stop and ask the owner. Don't redo the work from these notes.

## How the project works

Read `CLAUDE.md` and `docs/design/README.md` first. In short:

- **Agents:** `.claude/agents/` defines analyst, planner, plan-reviewer, test-architect, software-engineer, code-reviewer and qa.
- **Skills:** `.claude/skills/` has `/project-brief`, `/design-module` and `/build-module`.
- **Rules:**
  - No code without an approved LLD.
  - Tests belong to the test-architect, and code to the software-engineer.
  - Behaviour the LLD doesn't define is decided by the planner as an `A-n` amendment.
- **Approvals are delegated.** On 2026-10-07 the owner told the main conversation to approve HLDs and LLDs itself and keep going ("auto approve the hlds as well just keep going man… skip the human in the loop"). It's recorded in `docs/product/notes/2026-10-05-platform-decisions.md`. Open product questions take the recommended option and are flagged *needs user confirmation*. Only the owner merges PRs.
- **Scope the owner asked for:** build the `platform` module on `feat/platform`, then design and build `identity` on `feat/identity`.

## Where things stand

### Platform (branch `feat/platform`, draft PR #1, base `master`)

- **Design:**
  - HLD v1.3, approved.
  - LLD v0.24, approved, with amendments A-1 to A-91. Each LLD change is mirrored in `lld-brief.md`.
- **Slices:**

| Slice | State |
| ----- | ----- |
| S-0 Repository, lint, CI skeleton | Done: approved by code review (4 rounds) and passed QA |
| S-1 `@budmon/shared` money, time, IDs | Done: approved by code review (3 rounds) and passed QA, then A-46 to A-48 added and verified (`money/` branch coverage 100%) |
| S-2 Config, database, dev stack, server bundle | **In progress.** Code review approved round 3. QA failed on 3 defects; the fixes (A-80 to A-91) are partly in. See below. |
| S-3 to S-16 | Not started |

- **S-2's exact state at handover:**
  - **Integration:** `pnpm test:int` passes 82/82 (Postgres 18 via Testcontainers).
  - **Unit:** `pnpm test` passes 798/799. The one failure is a real code bug: `SMTP_URL=smtps://:465` must report "must have a host" (A-82, TP-2.22), but WHATWG `new URL` throws first, so the code reports "must be an smtp:// or smtps:// URL". Detect the empty-host shape and report the right problem.
  - **LLD v0.24 (A-89 to A-91) isn't implemented or tested yet:**
    - `runCommand(command, fn, stderr)` in F-26's file, used by `dev.ts`, `devMigrate.ts` and `runDbResetCli`;
    - `devMigrateEnv` returns a new object (frozen-argument test);
    - TP-2.29 (e)/(f) and TP-2.39 (c).
  - **Then:** a code-review round on the S-2 QA fixes (from `f67a5ae`), and QA again. QA's earlier report and the gaps it raised are covered by A-80 to A-88.

### Identity (design branch `claude/planner-agent-setup-arpvpf`)

- **Design:** HLD v0.6, approved; v0.6 is a delegated D-3 change, flagged for confirmation. LLD v0.6 is approved with its brief, after 4 plan-review rounds. Its platform requests PA-1 to PA-12 all landed as platform amendments (A-1 to A-6, A-22 to A-26, A-33).
- **Build:** not started. It goes on `feat/identity`, branched from `feat/platform` once platform is far enough along. Identity's S-0 needs platform S-4/S-6 wiring (A-26). The identity design docs live only on the design branch, so merge or cherry-pick them across.

## Needs the owner's confirmation (list these in the PRs)

- **Platform:**
  - A-2: Mailpit for stage-0 email.
  - A-4: Google's callback query string is an exception to the log rule.
- **Identity:**
  - 90-day absolute session limit;
  - share invitations count against the invite allowance;
  - the owner can reset another user's 2FA;
  - exact-email-only user lookup;
  - every security email is sent;
  - LD-9: reset links open in the phone's browser in the MVP;
  - DV-9 / HLD v0.6: concurrent refreshes re-issue tokens instead of signing the user out.
- **Data:** `iso4217.json` names come from CLDR (A-69/A-78).

## Lessons from the old session

- **Docker is shared by every agent in the container.** Run Testcontainers suites one agent at a time. Never `docker rm -f` containers you didn't create: an agent did, killed other runs, and the bridge network broke until dockerd was restarted. dockerd isn't started by default; start it with `dockerd > <scratchpad>/dockerd.log 2>&1 &`.
- **Test IDs:** the test-architect's own extra cases use an `x` suffix (e.g. `TP-2.41x`). When the planner adds LLD test IDs, tell the test-architect to renumber its extras past the LLD's highest ID.
- **One agent per file set.** Agents commit only their own files. The main conversation commits LLD changes after the planner reports.
- **Node:** the container has Node 22; the repo requires 24 (`engines`, `.nvmrc`). CI runs 24. Nothing has been checked locally on 24.
- **No Android SDK, Windows or real Google/SMTP here.** Manual checks (TP-M.*) are for the owner's laptop and phone.

## Next steps, in order

1. Confirm both branches arrived, then re-point the draft PR if needed. PR #1 was opened as `ali-hy/WhereDidITap#1`; subscribe to it.
2. Finish S-2:
   - the engineer fixes the `smtps://:465` bug and implements A-89/A-90;
   - the test-architect adds A-89 to A-91's tests;
   - then `pnpm check`, `tools/ci/test/clean-clone-check.sh` and `tools/ci/test/dev-smoke.sh`;
   - then code review, then QA.
3. Continue `/build-module platform` from S-3 (observability), slice by slice.
4. After platform: `/build-module identity` on `feat/identity`.
