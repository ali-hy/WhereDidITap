# Round 2: the user's answers to the round 1 questions

Captured 2026-10-04, as relayed by the main conversation. The user's own words are quoted; everything else is the relay's summary. Do not edit.

---

**Q1 (who is it for):** not answered yet; re-asked in round 2.

**Q2 (budgets):** "budgetting here is expected to be based on a user preference, and the user can build a complex system of 'budgets'. a budget for items under the food category, and a budget for items with a subscription tag, and a budget for the whole month's salary. maybe an amount and maybe a percentage."
- Overlap (one transaction counting toward several budgets, e.g. food + subscription): yes, intended.
- Percentage of what: "up to the user to decide".
- Combining conditions in one budget (e.g. food AND NOT tagged groceries): yes.
- Nesting: "yup. so if the salary budget means I expect to pay 80% of my salary each month. then the food budget can be 30% of that 80% (making around 24 percent of the whole thing)".
- Periods: "custom". Rollover of unspent money: asked, not answered.
- Result: budgets is a core module in the MVP.

**Q3 (MVP and order):** "mvp will have to reach stage B" (the MVP includes Gmail capture and review, not just the manual core). Mobile: "We'll start with a native android app and try to cover more as we go."

**Q4 (sharing):** The user asked whether per-account sharing and household groups are mutually exclusive, and described a household sharing a cash account, "house money". When someone takes cash, they log a transfer from "house money" to their own personal cash account, or add a transaction for groceries. Someone who has moved out can get a view-only role. So the model is per-account sharing. Roles per shared account:
1. admin: any change to the account; creates entries and edits anyone's entries, including other admins'. Usually the creator, who can make others admins.
2. member: can create entries (transactions/transfers) and edit only their own.
3. viewer: view only. What different viewers can see may differ; "develop that more a little bit later".

**Q5 (currency):** Each account has its own currency. The backend fetches exchange rates daily for now, more often later. "transfers can definitely get a little bit more complicated cuz there can be transfer fees or the transfer fee might not align with the actual exchange rate at that time". On which banks come first: "this exercise will happen on every user's device, so it should be completely flexible, really". In other words, there's no hard-coded bank list; each user builds templates for their own banks.

**Q6 (unreviewed captures):** They count in balances but are flagged as needing review. "we want to have some level of analysis that doesn't require any interference, but then we go ahead and refine the actual data more as the user reviews more things." During review the user builds associations: sender names to payees, and payee to default purpose. Users can filter expenses by reviewed/approved or not. On auto-confirm: "review is important to confirm the details that aren't available from the template. i suppose this can depend on the payee more than anything." New payees are never auto-approved. For known payees it depends on whether the payee is single-purpose (can be auto-approved) or multi-purpose. That classification can be changed later, "cuz sometimes stuff change".

**Q7 (AI and privacy):** "We'll start with a, and move onto b, and allow users to use a service of their choice that THEY are hosting, later". So: a third-party LLM service first, then a Budmon-hosted model, then an endpoint the user hosts. Raw message retention: "not stored after processing. they're processed, the templates are made, the info is extracted, and only keep the templates and the extracted data. this will be an important part of our privacy policy." There's a setting, not pushed at users, to opt in to collection of raw messages (and emails) to help improve the app.
