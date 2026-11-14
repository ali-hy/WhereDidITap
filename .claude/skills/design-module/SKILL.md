---
name: design-module
description: Design a Budmon module from the spec summary. The planner writes the HLD (or, once the HLD is approved, the LLD), the plan-reviewer checks it, the planner revises until it passes, and the document goes to the user for approval. Usage: /design-module <module>
disable-model-invocation: true
---

# Design a module: `$ARGUMENTS`

You (the main conversation) orchestrate this. The agents do the work; you pass results between them and bring the user in for questions and approval.

## 0. Which document?

- If `docs/design/$ARGUMENTS/hld.md` doesn't exist, or isn't approved, work on the **HLD**.
- If the HLD is `approved` and the LLD doesn't exist or isn't approved, work on the **LLD**.
- If both are approved, say so and suggest `/build-module $ARGUMENTS`.
- Check that `docs/product/spec-summary.md` lists the module. If it doesn't, stop: the analyst is the next step.

## 1. Draft

Invoke the **planner** to write (or continue) the document. If it returns questions that block the design, ask the user (AskUserQuestion works well for questions with options), then resume the planner with the answers.

## 2. Plan review loop

1. Invoke the **plan-reviewer** on the draft.
2. If the verdict is `revise`, resume the **planner** with the blocking findings and suggestions, and have it revise. Then re-run the plan-reviewer.
3. Repeat until the verdict is `ready-for-user`. Stop and ask the user if this takes more than **3 rounds**.

## 3. Hand to the user

Set the document's status to `in-review` and commit it. Then give the user:

- the document link and a short summary of its key decisions (for an HLD: tables, screens, protocols/integrations). For an LLD, point the user to `lld-brief.md`, which is the version meant for them to review; the full `lld.md` is the agents' contract,
- the plan-reviewer's *questions for the user* and the planner's open questions,
- what's needed: answers, then approval.

When the user answers, have the planner revise, and run the plan-reviewer again if anything substantial changed. When the user approves, have the planner record the approval, then commit. After an HLD is approved, offer to start the LLD.
