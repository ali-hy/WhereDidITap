# Round 4: the user's answers to the round 4 questions

Captured 2026-10-04, as relayed by the main conversation. The user's own words are quoted; everything else is the relay's summary. Do not edit.

---

**R4-Q1 (sign-in):** Both email + password and Sign in with Google. Two-step verification: (y), optional via an authenticator app, "but the refresh token stays valid for a long time like a month or something". So sessions are long-lived, with a refresh token lasting about a month.

**R4-Q2 (invitations):** Any user can invite. Invitations expire after 7 days. Inviting someone to a shared account also invites them to Budmon ("I love your recommendation"). There's a hard cap on users, below Google's testing-mode limit on test users. New requirement: "we'll have a permission/user management dashboard for me in the first phase of the project", and "I'll be able to manage users through my portal however I like". The user acknowledged ("ouch- okay") that each tester's Google address may need adding to the Google project by hand.

**R4-Q3 (deleting a Budmon account):** A 7-day grace period during which deletion can be undone, then everything is erased. Export (CSV + JSON) is in the MVP. Shared accounts where the person is the only admin must be handed over first, and their entries stay as "deleted user": "sounds good".

**R4-Q4 (account types):** Credit cards are their own type, with the balance shown as "amount owed". Paying a card off from a bank account is a transfer. Statement cycles and due-date reminders come later. Loans and mortgages as account types come later ("love the suggested approach").

**R4-Q5 (shared-account roles):** Balance corrections (adjustment entries) are for admins only. Not answered: whether another admin can demote or remove the creator; confirmation that members' "edit own entries" includes deleting them (A13); confirmation that viewers see the whole account for now (A15).

**R4-Q6 (purposes):** "b and c might come later after the mvp". The analyst reads this as: purposes are flat in the MVP, and nesting (two levels or unlimited) comes later. The user still needs to confirm this reading. Tip: a tag, "however it still only applies to part of the money paid", so a tip is its own split line tagged "tip". Default purpose list: the analyst drafts it and the user will edit it. Not answered: separate income and expense purpose lists (A7).

**R4-Q7 (personal vs shared purposes):** "in most scenarios, things are unlinked by default. budget rules will define this stuff, such as which accounts it takes into place. but for now, by default budget rules will take into consideration all accounts. linking transactions just seems like it would add too much confusion now, so we will leave that idea for later."
