# Platform decisions (2026-10-05)

Decided by the user in conversation, as input for the `platform` HLD. The planner records them as decisions and fills in the details.

| Topic | Decision | Notes |
| ----- | -------- | ----- |
| Database | PostgreSQL, not MongoDB/NoSQL | Domain is relational and needs transactions (splits, transfers, balances). Flexible parts (templates, extracted fields, budget rule conditions) go in `jsonb`. |
| Backend runtime | Node.js + TypeScript | I/O-bound workload suits Node. |
| HTTP framework | Fastify (replacing Express), confirmed after an Express comparison | Over Express: built-in pino logging, plugin encapsulation per module, `app.inject()` for integration tests without a network port, better typing; speed is not the reason. Over Hono: mature Node ecosystem (rate limiting, helmet, CORS, cookies), built-in pino logging, mature OpenTelemetry instrumentation. Hono's edge/Bun portability isn't needed. |
| API style | oRPC ("I'm sold on oRPC"), contract-first, publishing an OpenAPI document (replacing the tRPC stub) | Native Android (Kotlin) gets a client generated from OpenAPI; the web app uses oRPC's TypeScript client. Chosen over ts-rest: actively developed, Standard Schema / zod 4 support. |
| Background work | Separate worker process(es) from the same codebase; job queue pg-boss (confirmed: "pg-boss it is") | pg-boss stores jobs in Postgres: no extra infrastructure, and jobs can be enqueued in the same database transaction as the data change. Revisit BullMQ (Redis) only if job volume outgrows Postgres; keep the queue behind a small interface. Listeners and syncing (Gmail, SMS ingestion, FX rates, reminders, notifications) run in workers. |
| Gmail | Push via Gmail `watch` + Google Cloud Pub/Sub, not polling | User: "that's awesome!" |
| Gmail tokens | Encrypted at rest with a managed key; only the capture worker can decrypt | User will review this closely. |
| Money | 64-bit integers in minor units, plus each currency's decimal places | |
| Performance | Indexes designed per query; budget progress maintained incrementally; connection pooler in front of Postgres; table partitioning only if ever needed | User: "indexes will be very important here". |
| API servers | Stateless, so more can be added | |
| Observability | OpenTelemetry instrumentation; structured logs with pino; Sentry (free plan to start) for errors on backend, web and Android, and Grafana Cloud's free tier for traces, metrics and logs (confirmed: "we'll go with this") | Hard rule, user: "yes, totally, very important": logs, traces and error reports never contain amounts, payees, message content or tokens. Keep metric labels low-cardinality (free tier: 10k active series). |
| Scale target | Design for public scale, launch invite-only | |

## Answers to the platform HLD v0.3 open questions (2026-10-05)

| Question | Answer (user's words where useful) |
| -------- | ---------------------------------- |
| Web app framework (D-7) | "can we make the webapp a solid or vanilla ts web app instead? since sometimes the app will show big tables and performance will be crucial" → SolidJS (vanilla TS rejected: it would mean hand-building a component, state and routing layer; table performance comes from virtualisation, which Solid supports). |
| Q-1 Backups | Accepted: daily, 14-day retention, 7 days point-in-time recovery. |
| Q-2 Capture-only key | Accepted as proposed. |
| Q-3 Alerts | Accepted ("awesom"). |
| Q-4 Hosting | "hosting during the first stage where it's invite only will probably run on hetzner or on a locally run and managed not so expensive server" — hosting, environments and costs are to be designed for the invite-only stage. |
| Q-5 FX provider | "we'll have to find something that works and not for too much money" — research cheap/free options that cover currencies like EGP and historical rates. |
| Q-6 Domain | "let's try getting budmon.ai or budmon.com and we can have the backend be a subdomain or just a subpath like /api/v<x>_<y>/" |
| Q-7 Language | "english first, accessible and calm only in very high-level documents. however technical talk its good for hld's that involve protocols, technologies, algorithms or any such things, and is definitely the preferred language for lld's" (recorded as a documentation-style rule in the planner's instructions; the app's own UI tone is still open, P8). |
| Q-9 Staging | "sounds good, I guess, but let's find a cheaper option cuz that sounds like too much. when discussing deployment and running costs and environments please concern yourself with the invite-only stage" |
| Q-11 Gmail publishing status | Recommendation accepted: (b) "In production" without verification, confirmed by a spike before `sources` is designed; (a) as fallback. |
| Q-12 Production pooler | "none at launch" |
| Q-13 Release step | Accepted; "let's get to it when we have something to release". |
| Q-14 Hotfixes | (a) built from the last release. |
| Q-8, Q-10 | Not answered; recommendations stand as assumptions. |

## Answers to the platform HLD v0.5 open questions (2026-10-05)

| Question | Answer (user's words where useful) |
| -------- | ---------------------------------- |
| Q-15 Capture-only decryption | Asked for the recommended way: "I don't mind using one or two more servers to avoid this, if that's what's needed". Also asked whether running the capture worker on Google Cloud is the better option. |
| Q-16 API path | "alright, sounds good, major versions only for the api" → `/api/v1`. |
| Q-17 App UI conventions | Accepted (English first, accessible, calm non-judgemental tone), plus: "we should definitely have something from the very start for languages" (i18n from day one). Asked "is accessibility a big requirement here?" (open). |
| RTL rules | "if you use css you must use the *-inline-start and *-inline-end properties, and if you use tailwind you must use the *s and *e properties like ms, ps, me, pe and such. except for a few exceptions. arrow icons (and only some other icons) should be flipped in rtl languages as well using -scale-1 and such transformations. I might be missing some things so please review this list of items that need to be covered for rtl. we will have to test this in an rtl language, but we'll leave this for after the mvp is completed" |
| FX storage | "we can have our own logic for handling the storage of only the relevant historical rates if possible, because that might allow us to use a cheaper service. we can also use a certain standard exchange that we store daily like currency-to-usd as much as possible" |
| Q-19 Staging | "for the invite-only stage we will have only one environment no staging." |
| Q-20 Domain | "we want a cheap domain that would be well recognized. .com is good. we could look at .io as well. but I think .com is our best bet" → budmon.com (fallback .io). |
| Q-18 FX budget | Not answered directly; see FX storage. |

## Answers to the platform HLD v0.6 open questions (2026-10-05)

| Question | Answer (user's words where useful) |
| -------- | ---------------------------------- |
| Rollout stages (new) | "before inviting people I will initially be testing on my own, and during that period I don't expect to need too much security or privacy" — a personal (owner-only) stage comes before the invite-only stage. |
| Q-15 Capture isolation | "alright, we'll do it on its own hetzner server right before I start inviting people" |
| Encryption at rest / manual unlock | "I want to understand this in more detail later. is it okay to leave it to a later stage of the mvp? initially the work will all be for me personally, and then before I start inviting people, I'll introduce the encryption and all the other privacy and security items" |
| Q-21 Accessibility | "sure thing, yes pay attention to it, just note that it's not a showstopper, that's all." |
| Pooler | "we can take this into consideration later when we start thinking about making the application go public" |
| RTL list | "this is basically an exhaustive list"; lint guards and the pseudo-RTL test: "yes please." |

## Staging the infrastructure (2026-10-05)

User: "before inviting people I will initially be testing on my own, and during that period I don't expect to need too much security or privacy. however we will be building the codebase and logic for that, but the infrastructure will be only for me. so what i'm saying is: the codebase/logic is planned for two stages: invite-only and public and the infrastructure is planned for 3: just me, invite-only, and public."

| Topic | Answer |
| ----- | ------ |
| Capture isolation (Q-15 part 1) | Dedicated Hetzner capture VM: "we'll do it on its own hetzner server right before I start inviting people". |
| Encryption at rest + manual unlock (Q-15 part 2, D-40) | "I want to understand this in more detail later. is it okay to leave it to a later stage of the mvp? initially the work will all be for me personally, and then before I start inviting people, I'll introduce the encryption and all the other privacy and security items" → deferred to the invite-only infrastructure stage; to be explained to the user in more detail before then. |
| Accessibility (Q-21) | Baseline accepted: "yes pay attention to it, just note that it's not a showstopper". |
| Connection pooler | "we can take this into consideration later when we start thinking about making the application go public". |
| RTL list | "this is basically an exhaustive list"; lint guards and the pseudo-RTL test from day one: "yes please". |

## Stage 0 runs on the owner's laptop (2026-10-07)

Hetzner's cheap tier became unavailable (whole CX/CAX line marked unavailable since early September 2026; stock intermittent). User: "for the first version, we're not going to use a vps. I'm scratching that for now. first version, the just me, it can just run on my laptop".

| Topic | Answer |
| ----- | ------ |
| Stage 0 host | The owner's laptop. OS: **Windows**. |
| Phone access | Recommended accepted: Tailscale for phone ↔ laptop access away from home (LAN at home); offline entry covers the laptop being off. |
| Off-site backups in stage 0 | Declined: "except for the off-site backup, I don't care enough about it right now". |
| Domain | Not needed until the first server (Google OAuth allows localhost redirects). |
| HLD | "just go ahead and update the hld with the planner agent". |

## Delegated approvals and build go-ahead (2026-10-07)

- "once it's done... auto approve the lld and start building right away, I don't mind that" — the revised platform HLD (v1.1) and LLD are approved on the user's behalf once the plan-reviewer passes them; open questions take their recommended defaults (FX before 2024-03-02: "no rate", extendable by amendment; the extra release approval click: deferred with the stage-1 deploy chain).
- "yeah work on feat/platform, that's good." — the platform build uses branch `feat/platform` with its own PR.
- "once you're done with the platform keep going with the workflow till you're done with the platform module as well as the identity module." — after platform, design and build `identity` the same way (planner → plan-reviewer → approval on the user's behalf → build), on `feat/identity`.

## Auto-approval of design documents (2026-10-07)

User: "auto approve the hlds as well just keep going man. I want you to skip the human in the loop (me) and just keep going". From now on, HLDs and LLDs that pass plan review are approved on the owner's behalf by the main conversation, and the pipeline continues (platform build, then identity design and build) without waiting for the owner. Open questions take the recommended option and are flagged "needs user confirmation" in the PR.

## Owner confirmations (2026-10-09)

User, replying to the list of build-time amendments needing confirmation: "These sound good". Confirmed:

- A-227 to A-230: worker-capture is restricted to its own pg-boss queues by grants and row-level security (it can only send general work to queues flagged `sendableFromCapture`).
- A-188: client IP addresses are never logged; the rate limiter stores only an HMAC of the subject.
- A-191: the rate-limit text users see ("Too many attempts. Try again in # minute(s).") is client-side; the server's "Too many requests" is a developer message.
