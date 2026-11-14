---
module: <module-name>
doc: lld
status: draft # draft | in-review | approved
version: 0.1
hld_version: <approved HLD version this LLD implements>
author: planner
approved_by:
approved_on:
---

# <Module name>: Low-Level Design

Implements [HLD](./hld.md) v<x.y>.

## Changelog

| Version | Date | Change |
| ------- | ---- | ------ |
| 0.1     |      | Initial draft |

## Amendments
<!-- Added by the planner during implementation, when the approved LLD didn't define a case.
     Kind: "planner decision" or "needs user confirmation". -->

| ID | Question (raised by) | Resolution | Sections changed | HLD change | Kind |
| -- | -------------------- | ---------- | ---------------- | ---------- | ---- |

## 1. Deviations from the HLD
<!-- "None", or each deviation with its reason. Each one must be accepted by the reviewer. -->

## 2. File plan

| File | Create / modify | Responsibility |
| ---- | --------------- | -------------- |

## 3. Database

### 3.1 Table definitions
<!-- Exact definitions in the project's ORM: types, nullability, defaults, unique and check
     constraints, indexes, foreign keys with onDelete. -->

### 3.2 Changes to existing tables

### 3.3 Migration and seed data

## 4. Function catalog
<!-- Every function, method, handler and frontend component/hook the module introduces or changes.
     Signatures must be concrete enough to write tests against before the code exists. -->

### F-1: `<name>`
- **File:**
- **Layer:** router / service / repo / validator / component / hook / …
- **Signature:**
- **Behaviour:** <!-- preconditions, result per kind of input, side effects, transaction boundary -->
- **Errors:** <!-- each error and when -->
- **Calls:** <!-- F-n or existing code; mark which are injected (fakeable in unit tests) -->

### 4.x Dependency graph

```mermaid
flowchart TD
```

## 5. API contract
<!-- Repeat per endpoint/procedure. -->

### <METHOD /path> or <procedure name>
- **Transport:** REST / tRPC query / tRPC mutation / …
- **Handler:** F-n
- **Auth:**
- **Request schema:**
- **Response:**
- **Errors:**

| Error key | Status | When |
| --------- | ------ | ---- |

## 6. Error catalog

| Class | Key | Status | Thrown by (F-n) | When |
| ----- | --- | ------ | --------------- | ---- |

## 7. Integrations
<!-- Payloads, auth, retries/backoff, idempotency, timeouts, schedules. "None" if not applicable. -->

## 8. Frontend
<!-- Routes, component tree, state and data fetching, form fields and validation messages,
     and how each UX state and feedback behaviour from HLD §4 is implemented.
     "None" if not applicable. -->

## 9. Slices
<!-- Build order. One story/journey per slice, end to end (data → logic → API → UI),
     covering its happy path and unhappy scenarios. S-0 may hold shared foundations. -->

### S-1: <story title> (US-n)
- **Depends on:** none
- **Functions:** F-n, …
- **Scenarios:**

| Scenario | Happy / unhappy | Expected | Tests |
| -------- | --------------- | -------- | ----- |

- **Acceptance criteria:**
- **Status:** <!-- not started | tests written | implemented | reviewed | QA passed -->

## 10. Test plan

### 10.1 Tooling
<!-- Only if not already set up in the repo: framework, test location, `test` script,
     fixtures/factories, and how integration tests get a database and reset it. -->

### 10.2 Cases

| ID | Slice | Type (unit / integration / e2e) | Target (F-n / endpoint / screen) | Setup | Input / action | Expected |
| -- | ----- | ------------------------------- | -------------------------------- | ----- | -------------- | -------- |

## 11. Open questions
<!-- Must be empty before approval. -->
