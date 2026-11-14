# Budmon

A personal budgeting / money-monitoring application. What it does and for whom is in [`docs/product/project-brief.md`](docs/product/project-brief.md) and [`docs/product/spec-summary.md`](docs/product/spec-summary.md).

## How work is done here

Every feature goes through the design-and-build pipeline described in [`docs/design/README.md`](docs/design/README.md):

- `/project-brief`: the analyst and the user write the project brief and spec summary.
- `/design-module <module>`: the planner writes the HLD, then the LLD; the plan-reviewer checks each one; the user approves each one.
- `/build-module <module>`: slice by slice, the test-architect writes tests from the LLD, the software-engineer writes code until they pass, then the code-reviewer and qa check the result.

Rules that apply to everyone, including the main conversation:

- No code without an approved LLD. If behaviour isn't defined, the planner amends the LLD; nobody else decides it.
- Tests belong to the test-architect, and application code to the software-engineer. Neither edits the other's files.
- Only the user approves design documents and merges PRs.

## Project conventions

<!-- To be filled in after the codebase review: stack, folder layout, module layering, naming,
     error handling, money representation, how to run the app, the tests and the type-checker. -->
