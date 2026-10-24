---
name: build-module
description: Run the Budmon build pipeline for a module whose LLD is approved, one slice (story) at a time. For each slice, the test-architect writes the tests, the software-engineer implements until they pass, then code-reviewer and qa check it. A final whole-module review and QA follow. Use when the user asks to build or implement a designed module. Usage: /build-module <module>
disable-model-invocation: true
---

# Build a module: `$ARGUMENTS`

You (the main conversation) orchestrate this pipeline. The agents do the work; you pass results between them, keep the slice statuses in the LLD up to date, and keep the user informed. Resume an agent with SendMessage when it should keep its context (e.g. the engineer fixing its own slice).

## 0. Preconditions

- `docs/design/$ARGUMENTS/lld.md` exists and has `status: approved`. If it doesn't, stop. Tell the user what's missing; `/design-module` is the next step, not this pipeline.
- Work on the branch `feat/$ARGUMENTS`; create it from the default branch if it doesn't exist.

## 1. For each slice, in the LLD's order (S-0, S-1, …)

1. **Tests:** invoke the **test-architect** for the slice. It writes and commits the tests, which fail because the code doesn't exist yet. Set the slice's status to `tests written`.
2. **Implementation:** invoke the **software-engineer** for the slice. It implements until the full suite passes, commits and pushes, and opens or updates the draft PR. Set the status to `implemented`.
   - If the engineer reports a test it believes is wrong, send that to the **test-architect**. It fixes the test, or explains why the code is wrong. Then resume the engineer.
3. **Review:** invoke the **code-reviewer** with scope `S-n`. If the verdict is `changes-required`:
   - design gaps → **planner** (implementation-time amendment); if it changes test cases → **test-architect**,
   - blocking findings tagged *tests* → **test-architect**,
   - blocking findings tagged *code* → **software-engineer**,
   - then re-run the code-reviewer. Repeat until `approve`. Set the status to `reviewed`.
4. **QA:** invoke **qa** with scope `S-n`. If the verdict is `fail`:
   - design gaps → planner; failures → software-engineer; missing automated coverage → test-architect (a new test that reproduces the failure, written *before* the fix),
   - then re-run the code-reviewer on the new commits, and re-run qa. Repeat until `pass`. Set the status to `QA passed`.
5. Commit the LLD status update and tell the user in two or three lines: the slice is done, the test counts, and any amendments.

## 2. Whole module

1. Invoke the **code-reviewer** with scope `module`, then **qa** with scope `module`. Route findings as above until both pass.
2. Make sure the PR description is complete: the slices, the test results, and every amendment (*needs user confirmation* first). Then mark the PR ready for review.

## Stop and ask the user when

- any loop has gone **3 rounds** without converging,
- the planner flags an amendment as *needs user confirmation* and it affects the HLD's big decisions (tables, screens, protocols/integrations, money or authorization rules),
- an agent reports it is blocked (for example, no database available, or the app won't start),
- the test-architect and software-engineer disagree about a test and the LLD doesn't settle it, even after the planner has looked at it.

## Done

Report to the user: the PR link, the final review and QA verdicts, the test results, and every amendment to the LLD/HLD (with the ones needing confirmation first). The user reviews and merges the PR; no agent merges.
