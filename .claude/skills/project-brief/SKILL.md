---
name: project-brief
description: Create or update Budmon's project brief and spec summary with the analyst agent, through rounds of questions to the user. Optionally pass the user's notes or a path to their requirements. Usage: /project-brief [notes or path]
disable-model-invocation: true
---

# Project brief and spec summary

You (the main conversation) run an interview between the user and the **analyst** agent. The analyst can't talk to the user directly, so you relay.

1. Invoke the **analyst** with whatever the user has given: `$ARGUMENTS`, earlier messages in this conversation, or files they've pointed to. Ask it to create or update `docs/product/project-brief.md` and `docs/product/spec-summary.md`.
2. Relay the analyst's questions to the user, as they are. Use AskUserQuestion when a question has clear options (include the analyst's recommendation as the first option); ask open questions in plain text. Don't answer them yourself.
3. Resume the **same** analyst (SendMessage) with the user's answers. Repeat until the analyst reports no `[NEEDS INPUT]` markers left.
4. Optionally invoke the **plan-reviewer** on the spec summary, to check it's complete and consistent enough to design modules from. Send its findings back to the analyst, and its questions to the user.
5. Commit the documents. Tell the user: the module list, the build order, the MVP cut, and that `/design-module <module>` is the next step for the first module.

The user can stop at any round and come back later. The documents keep the state, including the `[NEEDS INPUT]` markers.
