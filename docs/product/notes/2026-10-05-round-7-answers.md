# Round 7: the user's answers to the round 7 questions

Captured 2026-10-05, as relayed by the main conversation. The user's own words are quoted; everything else is the relay's summary. Do not edit. Not answered: confirmation that a ban takes effect immediately (A38). The 40% auto-confirmed and under-1% duplicates targets weren't changed.

---

**R7-Q1 (auto-confirmation):** On by default.

**R7-Q2 (split lines on another account):** (a). The total is the sum of all lines (card 100 + cash tip 10 = 110). On a captured transaction, the lines on the bank's account must still add up to the bank's amount, and lines on other accounts come on top. In the MVP, lines on another account must be in the same currency.

**R7-Q3 (frozen accounts):** Messages are held, unrecorded, until the account is unfrozen: "orrrr we can always do some sort of event sourcing by going back to when the account was frozen and reading all the messages from then".

**R7-Q4 (non-goals and constraints):** "I understand that this is good for scope definition and to avoid scope creep, but for now I won't add one. I wanna see how good and useful this could be". So there's no "never" list for now. Constraints: "not yet".

**R7-Q5 (success targets):**
- At least 90% of card/online payments captured without typing (changed from 80%).
- Median review time under 5 seconds: "yes, this is important, reviews need to be fast otherwise what's the point?"
- At least 80% of captures confirmed without edits (changed from 90%).
- Own balances matching the bank for 3 months in a row: "oh yes, that would be awesome".
- At least 40% auto-confirmed after 3 months, and under 1% duplicates: unchanged.

**R7-Q6 (apps tried):** "I tried an app called home bank, and another app called money wallet or something. homebank is only a desktop app which is frustrating and inconvenient with no automation either, I have seen 'stay wise' which had the automation, but it was only automation, and provided insights accordingly, and did not support any data entry for cash and such which can be important, but it seems that stay wise has disappeared"

**R7-Q7 (budgets):** The set of period kinds is accepted: monthly from a chosen day, weekly, every N days/weeks/months, and one-off date ranges. Alerts at 80% and 100% by default. On shared accounts: "we can have budgets that count certain user's transactions and we can have budgets that count all, again, configurable. but default counts all". Sharing a budget with the account's members comes later, after the MVP.
