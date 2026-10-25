# Design documents

Budmon is built by a pipeline of agents (`.claude/agents/`), run through three commands:

```
/project-brief    analyst ⇄ user ─► docs/product/project-brief.md + spec-summary.md
                                    (modules, stories, business rules, build order)

/design-module    planner: HLD ─► plan-reviewer ⇄ planner ─► user approves
                  planner: LLD ─► plan-reviewer ⇄ planner ─► user approves

/build-module     for each slice (one story/journey, happy + unhappy scenarios):
                    test-architect: tests from the LLD (failing)
                    software-engineer: code until the tests pass ──► questions go to the planner
                    code-reviewer ⇄ fixes                              (LLD amended; HLD too
                    qa (real app / browser) ⇄ fixes                     if it conflicts)
                  then a whole-module review + QA ─► PR ready ─► user merges
```

## Documents

- **Project brief** (`docs/product/project-brief.md`): the problem, users, goals and scope.
- **Spec summary** (`docs/product/spec-summary.md`): every module with its stories (`<MODULE>-US-n`) and business rules, plus cross-cutting requirements and the build order. Each module is designed from this.
- **HLD** (`<module>/hld.md`): the big decisions, i.e. tables, user experience (journeys, screens, states), protocols and integrations.
- **LLD** (`<module>/lld.md`): the implementation contract: exact schemas, a **function catalog** (every function's file, signature, behaviour, errors and dependencies), API contract, **slices** (the build order, one story each) and the test plan. The test architect writes tests from it before any code exists, so it has to be exact.
- **LLD brief** (`<module>/lld-brief.md`): a short, human-readable summary of the LLD for the owner to review and approve: what it builds, what needs a decision, data, API, a summary of the function catalog, the build plan, testing and risks. It's kept in sync with every LLD change; if they disagree, the LLD wins.

## Status and approval

Each design document has a `status` in its front matter: `draft` → `in-review` (passed plan review) → `approved`. Only a person approves a document. An LLD may not be started until its HLD is `approved`, and building may not start until the LLD is `approved`. Revising an approved document after review bumps its version and sends it back to `draft`.

The exception is **amendments during implementation**. When an agent hits a case the LLD doesn't define, the planner defines it in place: an `A-n` row in the LLD's *Amendments* table, plus an HLD update if the answer conflicts with the HLD. Approval stands, and the build carries on. Amendments are listed in the PR description for the user to review, with those marked *needs user confirmation* first.

Templates (including `lld-brief.md`) are in [`_templates/`](./_templates) and [`../product/_templates/`](../product/_templates).

## Index

| Module | HLD | LLD |
| ------ | --- | --- |
| `platform` | [hld.md](./platform/hld.md) (approved, v1.3) | [lld.md](./platform/lld.md) (approved, v1.28); [brief](./platform/lld-brief.md) |
