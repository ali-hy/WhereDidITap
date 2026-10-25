---
doc: project-brief
version: 0.8
updated: 2026-10-05
---

# Budmon: Project Brief

Sources: the user's initial description ([`notes/2026-10-04-initial-idea.md`](./notes/2026-10-04-initial-idea.md)) and their round 2 answers ([`notes/2026-10-04-round-2-answers.md`](./notes/2026-10-04-round-2-answers.md), cited below as R2-Qn).

## Changelog

| Version | Date | Change |
| ------- | ---- | ------ |
| 0.1     | 2026-10-04 | Initial draft (interview round 1) |
| 0.2     | 2026-10-04 | Round 2 answers folded in. The MVP now includes Gmail capture and review (R2-Q3). Budgets are a core MVP feature with a flexible, nested, overlapping model (R2-Q2). Native Android comes first (R2-Q3). Sharing is per account with admin, member and viewer roles (R2-Q4). Accounts are multi-currency, with daily exchange rates (R2-Q5). Raw messages aren't kept after processing (R2-Q7). AI rolls out in three stages: a third-party service, then Budmon-hosted, then the user's own endpoint (R2-Q7). |
| 0.3     | 2026-10-04 | Audience decided (R2-Q1): the first version is for a small invited group, built so that going public later stays possible. Going public is a hoped-for goal, not a commitment. Gmail stays in Google's testing mode for now. Public launch requirements moved to Later. |
| 0.4     | 2026-10-04 | Round 3 answers folded in. SMS capture is in the MVP, and AI-assisted capture comes right after it (R3-Q2). Templates are made by highlighting and labelling parts of a real message (R3-Q2). Budget percentage bases (R3-Q3). Budgets count only their own conditions and chosen accounts, alert only, and get rollover later (R3-Q4). Shared accounts have their own vocabulary (R3-Q5). Transfer fees plus implied cost, and rate-by-date conversion (R3-Q6). Offline entry of new transactions on Android (R3-Q7). |
| 0.5     | 2026-10-04 | Round 4 answers folded in. Sign-in by email + password and by Google, optional two-step verification, sessions lasting about a month (R4-Q1). Any user can invite, invitations expire after 7 days, and the number of users is capped. A product-owner admin portal is added to the MVP (R4-Q2). Deleting a Budmon account has a 7-day grace period; export is in the MVP (R4-Q3). Credit cards are their own account type (R4-Q4). Balance corrections are for admins only (R4-Q5). Purposes are flat in the MVP (the analyst's reading, to be confirmed) and tips are split lines (R4-Q6). Personal and shared vocabularies stay unlinked; budgets cover all accounts by default (R4-Q7). |
| 0.6     | 2026-10-04 | Round 5 answers folded in. The admin portal shows account details only, with no financial data; the owner can delete, ban (by email) and invite users, and set per-user invite allowances and feature switches (R5-Q1). Budget rules match purposes by name (R5-Q2). Purposes have two levels in the MVP, with unlimited nesting later (R5-Q3). Only amount, account and date are required; future-dated entries are allowed; receipts later (R5-Q4). Google sign-in links automatically to an existing account with the same email (R5-Q5). |
| 0.7     | 2026-10-05 | Round 6 answers folded in. Owner deletion uses the 7-day window; a sole admin's shared accounts pass to the longest-standing member, or the owner picks a new admin or freezes the account (R6-Q1). Budget rules on a parent purpose include its children (R6-Q2). Notifications are Android push and in-app, with quiet hours and at most one data-entry reminder a day (R6-Q3). Default purposes accepted for now (R6-Q4). Portal defaults: 3 invites, feature switches on by default (R6-Q5). Payee suggestions (R6-Q6). A split line can use a different account; refunds count when they arrive; one-tap tip (R6-Q7). |
| 0.8     | 2026-10-05 | Round 7 answers folded in. Success targets set, and fast review made a core principle (R7-Q5). No "never" list for now (R7-Q4). No constraints yet (R7-Q4). Alternatives written up from the apps you've tried (R7-Q6). |

## 1. The problem

Managing a budget means recording every payment, transfer, cash withdrawal and refund. That much data entry is frustrating. People either spend long sessions catching up on it or stop doing it altogether, and then the budget no longer reflects reality.

Most of the information they would type in already exists. Banks, payment gateways and vendors send an email or SMS for nearly every card or online payment. That information is spread across inboxes and phones, though, and often comes as several messages about the same payment (one from the bank, one from the vendor, a few minutes apart). Each message uses a different name for the same merchant ("AMZN Mktp", "Amazon.eg", "Amazon"). Cash is the opposite case: once withdrawn, it leaves no trail at all unless the person records it.

Some things that matter to people are also badly served by typical budgeting tools:

- money lent or borrowed, and when it's due back;
- refunds linked back to the original purchase;
- mixed purchases that belong to different purposes;
- the cost of optional extras such as tips, which matters especially outside the US;
- money shared within a household, such as a common "house money" cash pot (R2-Q4);
- budgets that reflect how a person actually thinks: overlapping, nested, and set as amounts or percentages (R2-Q2).

**How people cope today:** manual entry in a budgeting app or spreadsheet, catching up in occasional bulk sessions, or giving up. The tools you have tried and dropped are in section 7 (R7-Q6).

## 2. Target users

**Primary:** an individual who wants an accurate picture of their own money but won't keep up with manual entry. They pay mostly by card and online, receive bank and vendor notifications by email and/or SMS, and also handle some cash. They care about privacy and want control over what the app reads and what is kept.

**Product owner (operator):** you. You run Budmon for the invited group and manage users and permissions through your own admin portal (decided, R4-Q2).

**Secondary:** the people they share money with. Housemates or family members share accounts such as "house money" (R2-Q4). Someone who has moved out keeps view-only access. Friends lend or borrow money and may also use Budmon.

**Geography:** not limited to one country or set of banks. Templates are built per user for whatever banks they use, so the product must not depend on a hard-coded bank list (R2-Q5).

**Audience (decided, R2-Q1):** "small invited group first, with the goal of hopefully maybe making it public in the future". The first version is invite-only, for the user and people they invite. It's built so that opening it to the public later stays possible, but going public is a hoped-for future goal, not a commitment.

## 3. The product in one paragraph

Budmon is a personal and household budgeting app that removes most of the data entry from budgeting. It runs on a backend with a web app and a native Android app first; other platforms, including desktop, come later. It covers the essentials:

- accounts in any currency, shared within a household through roles;
- transactions with payees, purposes, tags and splits;
- transfers (including across currencies, with fees), refunds, and debts;
- flexible budgets that can overlap, nest, and be set as amounts or percentages.

On top of that, it reads the user's transaction notifications from email (Gmail first) and SMS, and turns them into transactions straight away. Bank messages are the source of truth and vendor messages add detail. Captured transactions count immediately, flagged until the user reviews them. Each review teaches Budmon (which sender names belong to which payee, and which purpose a payee usually means), so over time payees the user trusts are confirmed automatically. The user decides which messages may be read and whether AI is used. Raw messages are never kept after processing. Reminders cover what automation can't see, such as cash.

## 4. Goals and success measures

Goals the user has stated:

1. **Make data entry cheap.** Captured data is useful straight away, without any action from the user, and review refines it (R2-Q6).
2. **Respect privacy and boundaries.** Every automated feature has a manual alternative. AI is opt-in. Raw messages aren't stored after processing, and that is a headline commitment of the privacy policy (R2-Q7).
3. **Cover the essential budgeting features**, including budgets as complex as the user wants (R2-Q2).
4. **Review must be fast.** This is a core product principle: "reviews need to be fast otherwise what's the point?" (R7-Q5).

Success measures (decided, R7-Q5):

| Measure | Target |
| ------- | --------------- |
| Share of card/online transactions captured without manual entry, for connected sources | At least 90% |
| Median time to review one captured transaction | Under 5 seconds (a core principle) |
| Captured transactions confirmed without any edit (extraction accuracy) | At least 80% |
| Share of captured transactions auto-confirmed (single-purpose known payees) after 3 months of use | At least 40% (proposed; kept unchanged by the user) |
| Duplicate transactions created from multiple messages about one payment | Under 1% (proposed; kept unchanged by the user) |
| Personal: "I've used it for my own money and my balances match my bank" | 3 months in a row ("oh yes, that would be awesome") |

## 5. Scope

### 5.1 In the first version (decided: the MVP reaches "stage B", R2-Q3)

- Platforms: backend, web app and a **native Android app** (R2-Q3).
- Audience: a small invited group; sign-up is by invitation only (R2-Q1).
- Users, sign-in (email + password, and Google), optional two-step verification, profile and preferences (R4-Q1).
- Any user can invite people; there's a hard cap on the number of users (R4-Q2).
- A product-owner admin portal (decided, R4-Q2 and R5-Q1). It shows account details only, never financial data. From it the owner can invite, delete and ban users (a ban is by email and also deletes the user), set each user's invite allowance (a number, or unlimited up to the cap), switch features on or off per user, and set the user cap.
- Purposes with two levels, for example Food > Sweets (decided, R5-Q3).
- Export of all of a user's data (CSV + JSON), and account deletion with a 7-day grace period (R4-Q3).
- Accounts of type bank, online wallet, cash, credit card and other, each in its own currency (R2-Q5, R4-Q4).
- Shared accounts with admin, member and viewer roles (R2-Q4). Sharing being in the first version is inferred from the household example (assumption A11).
- Purposes and tags, payees and payee aliases, and single-purpose/multi-purpose payees (R2-Q6).
- Transactions, splits, transfers, cross-currency transfers with fees and the actual rate applied (R2-Q5), refunds, and tips.
- Debts recorded against people who aren't Budmon users.
- Budgets: conditions combining purposes and tags (including exclusions), fixed amounts or percentages, nesting, overlap, and custom periods (R2-Q2).
- Reports.
- Reminders: Android push and in-app, with quiet hours set by the user and at most one data-entry reminder a day (R6-Q3).
- Gmail capture: scan scope, manual sender setup, templates built per user, merging, payee resolution, a review queue, a reviewed/unreviewed filter, and auto-confirmation for known single-purpose payees (R2-Q6).
- SMS capture on Android, with the same scope rules and templates as Gmail (decided, R3-Q2).
- Templates are made by highlighting parts of a real message and labelling each selection with the field it holds (decided, R3-Q2). There is no AI in the first version.
- Offline entry of new transactions on Android, synced when back online (decided, R3-Q7).

### 5.2 Later

- Credit-card statement cycles and due-date reminders; loans and mortgages as account types (R4-Q4).
- Unlimited nesting of purposes (R5-Q3). Receipt photos on transactions (R5-Q4). Linking purposes or tags across personal and shared vocabularies (R4-Q7).
- **Right after the MVP:** AI-assisted capture through a third-party LLM service: sender suggestions, proposed templates and extraction (decided, R3-Q2).
- Budget rollover of unspent and overspent amounts, optional per budget (decided as future work, R3-Q4).
- Full offline use on Android, including review (R3-Q7: "may come later").
- Going public (a hoped-for goal, not a commitment; R2-Q1): open sign-up, Google's restricted-scope verification and annual security assessment for Gmail access, Play Store compliance for SMS access, and public-grade support and operations.
- iOS and other platforms ("try to cover more as we go", R2-Q3). A desktop (Electron) app based on the web app.
- AI hosted by Budmon, then AI through an endpoint the user hosts (R2-Q7).
- Exchange rates updated more often than daily (R2-Q5).
- Finer control over what each viewer of a shared account can see (R2-Q4: "develop that more a little bit later").
- Loans between Budmon users with an acceptance flow.
- Subscription detection.
- Email providers other than Gmail.

### 5.3 Never (explicit non-goals)

None for now (decided, R7-Q4): "I understand that this is good for scope definition and to avoid scope creep, but for now I won't add one. I wanna see how good and useful this could be".

Scope is still bounded by sections 5.1 and 5.2. Two things are **commitments**, not non-goals, and stay in force:

- Budmon doesn't read messages outside the user's scan scope (XC-11).
- Raw message or email content isn't kept after processing, unless the user has opted in to donate it (decided, R2-Q7).

## 6. Constraints

- **Platforms (decided):** backend, web app and native Android first; more platforms and Electron later.
- **Architecture (stated preference):** the backend is mainly a monolith, with services split out only if needed. The design itself belongs to the planner.
- **Privacy (decided):**
  - Every automation has a manual alternative, and AI is opt-in.
  - Only in-scope messages are read.
  - Raw messages are discarded after processing; only templates and extracted data are kept (R2-Q7).
  - An opt-in, not-promoted setting lets users donate raw messages to improve the app (R2-Q7).
- **AI provider rollout (decided, R2-Q7):** a third-party LLM service first, then a Budmon-hosted model, then an endpoint the user hosts.
- **Exchange rates (decided, R2-Q5):** fetched by the backend daily, more often later.
- **Third-party access rules:**
  - Gmail read access is a Google "restricted scope". While Budmon is invite-only, it stays in Google's testing mode, with no verification or annual security assessment for now (decided, R2-Q1). Testing mode allows only a limited number of named test users, and their access has to be renewed periodically. **Operational step (acknowledged, R4-Q2):** each tester's Google address may have to be added to Budmon's Google project by hand. The user cap stays below the test-user limit (decided, R4-Q2). A public launch would require verification and an annual third-party security assessment, which is later work.
  - Google Play restricts apps that request SMS permissions. While the app is invite-only, it can be given to the group directly rather than through the Play Store. Store compliance is later work.
- **Budget, timeline, hosting, regulations:** none yet (decided, R7-Q4: "not yet"). There's no deadline, no hosting or AI spending limit, and no specific regulation identified. Revisit before any public launch.

## 7. Alternatives

Apps the user has tried or seen (R7-Q6):

| App | What it offered | Why it fell short |
| --- | --------------- | ----------------- |
| HomeBank | Manual budgeting. | Desktop only, "frustrating and inconvenient", no automation. |
| A "Money Wallet"-type mobile app (name uncertain) | Manual budgeting on mobile. | Tried and dropped; no specific reason given. |
| Stay Wise | Automation, and insights based on it. | "it was only automation": no manual entry for cash and the like, which matters. Apparently discontinued. |

What Budmon does differently:

- **Automation and manual entry together**, on mobile and web. Card and online payments are captured, and cash and anything else can be entered quickly by hand, including offline on Android. This is the gap between HomeBank (manual only, desktop) and Stay Wise (automation only).
- It captures transactions from notifications people already receive, for any bank, instead of relying on bank-API aggregators.
- Captured data is useful immediately, and review refines it. Review is fast (under 5 seconds).
- Raw messages aren't kept. The user controls exactly what's read and whether AI is involved.
- Budgets can overlap, nest and be set as percentages.
- Household sharing works through account roles.
- Debts, refunds and splits are first-class.

## 8. Risks

| Risk | Why it matters | Mitigation to consider |
| ---- | -------------- | ---------------------- |
| Gmail testing-mode limits | Testing mode caps the number of named test users, and users may need to re-authorise periodically. Going public would need verification plus a yearly security assessment (cost and time). | Decided: invite-only in testing mode for now (R2-Q1), with a hard user cap below the limit (R4-Q2). Add testers to the Google project by hand (an operational step; the admin portal should remind the owner). Make reconnection easy. Treat verification as a prerequisite of any public launch. |
| Google Play SMS permission policy | Apps that read SMS must qualify for an exception or may be rejected from the store. | Not blocking while invite-only: the app can be given to the group directly. Before any public launch, check eligibility or use a notification-listener or share-into-app fallback. |
| Unreviewed data counts straight away | A wrong captured amount distorts balances and budgets until it's reviewed. | Clear "needs review" flags, filters, and a review nudge; bank message is the source of truth. |
| Auto-confirmation errors | A single-purpose payee that starts selling other things gets mis-classified silently. | New payees are never auto-confirmed; the user can switch a payee back to multi-purpose at any time (R2-Q6); auto-confirmed items stay identifiable. |
| No raw-message retention | Changing a template can't be re-applied to past messages from stored data, and users can't see the original text in Budmon. | Keep a reference to the message (for example the Gmail message ID) so it can be re-fetched from the source or opened there (assumption A12). |
| Budget model complexity | Overlapping, nested and percentage budgets with custom periods are much bigger than "a limit per category". | Semantics settled in R3-Q3 and R3-Q4; rollover deferred; the planner may slice the module. |
| Third-party AI and privacy | Message content leaves Budmon when the user opts into AI. | Opt-in only, in-scope messages only, provider disclosed; Budmon-hosted model and user-hosted endpoint later (R2-Q7). |
| Built-for-public drift | Building for a public launch that may never happen adds cost now; ignoring it makes going public expensive later. | Keep choices compatible with going public (no hard-wired single-tenant shortcuts), but don't build public-only features (open sign-up, verification) yet. |
| Offline entry and sync | Even entry-only offline support means syncing, resolving conflicts and handling duplicates against captures that arrived in the meantime. | Limited to new transactions (R3-Q7); offline entries go through the same duplicate check as captures (CAP-US-6). |
| Scope size | Every MVP module is substantial, and the MVP includes Gmail and SMS capture. | Strict build order; Stage C items stay out. |

## 9. Assumptions

Inferred, not stated. Each is to be confirmed. The full list is in section 8 of the spec summary.

- A1. "Purpose" means what most apps call a category; each transaction or split line has exactly one purpose.
- A3. Budmon records money; it never moves money at a bank.
- A4. "System one models" means small, specialised models as an alternative to LLMs. The "templates only" path must work with no AI.
- A11. Shared accounts are in the first version (inferred from the household example in R2-Q4).
- A12. Budmon keeps a reference to each source message (an ID, not its content), so the user can open the original in Gmail or on the phone.
