# Round 3: the user's answers to the round 3 questions (2 to 7)

Captured 2026-10-04, as relayed by the main conversation. The user's own words are quoted; everything else is the relay's summary. Do not edit. Q1 was answered separately ("small invited group first, with the goal of hopefully maybe making it public in the future") and is cited as R2-Q1.

---

**R3-Q2 (SMS and AI in the MVP):** (b). SMS capture is in the MVP; AI-assisted capture comes right after the MVP. On templates: "the gmail tempaltes won't be built by hand by the user from scratch. the user will be selecting a part of the text to show what part includes the data, and then select which field this selection is supposed to represent. we will get to how this part of the ui is built later on". In other words, a template is made by highlighting parts of a real message and labelling each selection with the field it represents (amount, payee, date and so on). The exact UI is left to design.

**R3-Q3 (what a percentage budget is a percentage of):** All three: (i) a parent budget's amount, (ii) the actual matching income in the period, (iii) an amount the user enters. For (ii), the expected amount is used until the money actually arrives.

**R3-Q4 (nested budgets):** Adding up: (a), each budget counts only the transactions matching its own conditions, "and the user can define the different accounts used in the calculation" (a budget specifies which accounts it draws from). Exceeding a budget: alerts only; nothing is ever blocked. Rollover: (r3), optional per budget, for both unspent and overspent amounts, but out of the MVP (future work).

**R3-Q5 (shared-account vocabulary):** (a), the account has its own set of purposes, tags and payee aliases, managed by its admins. "it will initially probably be based on the creating admin's set, and they can easily use parts of the other person's set if the other person has that stuff as publicly shared and visible". So the account's set starts as a copy of the creating admin's set, and admins can copy items from another member's set when that member has marked them as shared or visible. Mapping between personal and shared items (for example a personal "Food" and the account's "Food"): not explicitly answered.

**R3-Q6 (transfers between currencies):** Fee: (c), both a separate fee line and the gap from the market rate shown as an implied cost. Conversion: (x), the rate on the transaction's date for reports and budgets, and today's rate for net worth.

**R3-Q7 (offline on Android):** (b), offline entry of new transactions only, in the MVP. Full offline entry and review (a) may come later.
