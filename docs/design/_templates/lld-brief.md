---
module: <module-name>
doc: lld-brief
summarises: lld.md v<x.y>
---

# <Module name>: LLD brief

A human-readable summary of [the LLD](./lld.md) for review and approval. The LLD is the contract the agents build from; this brief is what the owner reads. If the two ever disagree, the LLD wins and the brief is out of date.

## 1. What this builds
<!-- A few short paragraphs: what exists when this module is done, and what's deliberately left out. -->

## 2. Needs your attention
<!-- Everything a human should decide on or check, each with a one-line reason:
     deviations from the HLD, decisions the planner made that the HLD left open, assumptions,
     amendments marked "needs user confirmation", open questions, manual steps for the owner. -->

| # | Item | Why it matters | LLD ref |
| - | ---- | -------------- | ------- |

## 3. Data
<!-- Tables in plain terms: what each holds, who owns it, what happens on delete. Notable constraints. -->

## 4. API and screens
<!-- Endpoints grouped by purpose (method + path + one line each). Screens and their states, if any. -->

## 5. Functions at a glance
<!-- The function catalog summarised by area, never listed in full.
     Per area: what it's responsible for, how many functions (F-a..F-b), and the few that matter most
     (money, security, privacy, data loss) with one line each. -->

| Area | Functions | Responsibility | Worth a look |
| ---- | --------- | -------------- | ------------ |

## 6. Build plan
<!-- One row per slice: what it delivers, and how you'd see it working. -->

| Slice | Delivers | How you'd see it working | Depends on |
| ----- | -------- | ------------------------ | ---------- |

## 7. Testing
<!-- Counts by type, what's covered, what's manual, and anything notable that isn't covered. -->

## 8. Risks
<!-- The few that matter, in plain terms. -->
