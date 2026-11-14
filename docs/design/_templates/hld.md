---
module: <module-name>
doc: hld
status: draft # draft | in-review | approved
version: 0.1
author: planner
approved_by:
approved_on:
---

# <Module name>: High-Level Design

## Changelog

| Version | Date | Change |
| ------- | ---- | ------ |
| 0.1     |      | Initial draft |

## 1. Context and requirements

### 1.1 Requirements
<!-- The module's requirements from docs/product/spec-summary.md, citing its IDs. -->

### 1.2 Goals

### 1.3 Non-goals

## 2. Actors and stories
<!-- US-n: "As a <actor>, I want <action> so that <outcome>." Cite the spec summary's IDs.
     Each story becomes a slice in the LLD. -->

## 3. Data model

### 3.1 Tables

| Table | New / changed | Purpose | Key columns | Relationships |
| ----- | ------------- | ------- | ----------- | ------------- |

### 3.2 Entity-relationship diagram

```mermaid
erDiagram
```

### 3.3 Data lifecycle
<!-- What happens on delete (cascade / soft delete / blocked)? History, audit, retention. -->

## 4. User experience

### 4.1 User journeys
<!-- One per story (US-n), step by step from the user's point of view: where they start, what
     they see, what they do, and how they know it worked. Include the first-time (no data)
     experience. For each journey, list what can go wrong and what the user experiences. -->

### 4.2 Screens

| Screen | Purpose | Information hierarchy (first → last) | Primary action | Other actions |
| ------ | ------- | ------------------------------------ | -------------- | ------------- |

<!-- A low-fidelity wireframe (ASCII is fine) for each key screen. -->

### 4.3 Navigation

```mermaid
flowchart LR
```

### 4.4 States

| Screen | Empty | Loading | Error | Partial / a lot of data |
| ------ | ----- | ------- | ----- | ----------------------- |

### 4.5 Interaction and feedback
<!-- Success/failure feedback, confirmations, undo, validation display,
     what updates immediately versus after the server responds. -->

### 4.6 Effort on frequent tasks
<!-- Steps for the most common actions, defaults, remembered choices. -->

### 4.7 Presentation of data
<!-- Money (currency, decimals, negatives, colouring), dates, progress. -->

### 4.8 Platform and accessibility
<!-- Target devices and screen sizes, responsive behaviour, keyboard, screen reader, contrast. -->

### 4.9 Wording
<!-- Key labels, button names, empty-state messages and error messages. -->

## 5. Interfaces, protocols and integrations
<!-- tRPC vs REST, real-time (WebSocket/SSE), background jobs, webhooks, file import/export,
     notifications, third-party APIs. Justify each choice and describe its failure modes. -->

## 6. Key flows

```mermaid
sequenceDiagram
```

## 7. Cross-cutting concerns

### 7.1 Authorization
### 7.2 Money and currency
### 7.3 Consistency and transactions
### 7.4 Time and time zones
### 7.5 Privacy and security
### 7.6 Scale, performance and observability

## 8. Decisions

### D-1: <title>
- **Options considered:**
- **Decision:**
- **Rationale:**

## 9. Risks

## 10. Assumptions

## 11. Open questions

## 12. Out of scope / future work
