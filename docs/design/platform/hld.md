---
module: platform
doc: hld
status: approved # draft | in-review | approved
version: 1.3
author: planner
approved_by: the user (project owner), delegated auto-approval
approved_on: 2026-10-07
---

# Platform: High-Level Design

The technical base every other Budmon module builds on: repository layout, the API contract and generated clients, worker processes and the job queue, configuration and secrets, credential encryption, data access, migrations and the money type, the error model, observability, the security baseline, file storage, test tooling, CI, local development, hosting and backups, and the clean-up of the current repo.

Sources: [spec summary](../../product/spec-summary.md) v0.10 §4.14 (`PLT`), §3 (XC-n), §5 to §7; the user's [platform decisions](../../product/notes/2026-10-05-platform-decisions.md) (cited as **PD**); the [codebase review](../../product/codebase-review.md) (cited as **CR**); the [project brief](../../product/project-brief.md).

## Changelog

| Version | Date       | Change |
| ------- | ---------- | ------ |
| 0.1     | 2026-10-05 | Initial draft |
| 0.2     | 2026-10-05 | Plan review round 1. **P-1:** D-14 now states the exact money wire mechanism (a shared codec: `z.number().int()` bounded to ±(2^53 − 1) with a JSON-schema override to `integer`/`int64`, explicit number↔bigint conversion in server routers and web data hooks, no `.transform()` in the contract); added to the first contract spike (§9). **P-2:** D-24 gains a "sensitive-data boundaries" list: sanitised job errors (pg-boss output) with a canary on `pgboss.job.output`; messages of non-`BudmonError` errors dropped on server and both clients; oRPC validation `cause` stripped; Postgres `log_error_verbosity = terse` and `log_min_error_statement = panic`; no sensitive values in paths or query strings (sensitive filters in POST bodies, encrypted cursors, D-32); outbound client spans without query strings and allowlisted third-party error fields; Fastify request logging disabled with a custom serialiser; an infrastructure logging checklist and a staging canary gate. **P-3:** D-19 decides where the OAuth code exchange happens (worker-capture, from a sealed authorization code; F-3 redrawn), rewords memory handling, places re-wrap jobs, adds confused-deputy egress rules and the residual trust boundary with IAM restrictions. **P-4:** D-15 defines FX date semantics (the rate of UTC day D, fetched after it closes), immutable stored days, provisional conversions, an `fx.rates-added` notification for recomputation, and per-item rounding; §3.3 contradiction removed. **P-5:** D-13 replaces client-supplied entity IDs with per-user idempotency keys and an `idempotency_records` table; replays are answered from the record. **P-6:** D-21 adds `data.outcome` (`not_applied` / `unknown`) to `INTERNAL`; J-1 and §4.9 wording depend on it; every create takes an idempotency key on web too. **P-7:** D-9/D-12/§7.1 give pg-boss its own role owning the `pgboss` schema (runtime DDL confined there, a documented exception to PLT-BR-5); queues created in the migrate step; one retention for finished jobs plus dead-letter queues; F-4 uses the `stately` policy. **P-8:** new D-35 object storage for exports and the erasure log (private buckets, signed URLs, lifecycle deletion, erasure coverage). **P-9:** D-25 treats token expiry as connection state and alerts on a bounded `capture_connections_stale` gauge. User questions Q-11 (Gmail publishing status) and Q-12 (production pooler) added; Q-4 costs re-estimated with levers. Suggestions applied: S-1 to S-10, S-12, S-13, S-14; S-11 resolved by using 400 instead of 426 (see D-33). **User requirement (migrations only between deployments):** D-12 redesigned: development and test databases are built directly from the Drizzle schema (guarded `db:reset`/`db:sync`, no migration files); one migration per release, generated on a `release/<version>` pull request by the software-engineer, hand-edited for data-preserving changes listed in each LLD's release migration notes, reviewed and gated by release-only CI checks (migrations reproduce the schema, upgrade test, destructive-statement check); staging and production apply only committed migrations; pg-boss schema, roles, reference data and queues handled by an environment-independent schema step. PLT-BR-5 restated (US-7, D-12); D-5, D-9, D-26, D-27, D-28, D-29, D-34, §3, §7.1, §9 and Q-9 updated; Q-13 added. |
| 0.3     | 2026-10-05 | Plan review round 2. **B-1 (a):** release pull requests target main, must be up to date with main, and the pipeline tags the merge commit only after re-running check (i) on it; deploys use that commit (D-12, D-27, D-29). **B-1 (b):** `hotfix/<version>` path from the last release tag, with its own migration, the release checks, and a merge-back exempt from the no-migrations rule; linear journal rule; marked pending Q-14. **B-1 (c):** prompts never answered interactively: development and feature-branch test databases are only built by pushing onto empty databases (`db:sync` removed), and `generate` runs under a pseudo-terminal driver answering "create" and listing ambiguities, with `generate --custom` as fallback (D-12, D-26, §9). **B-1 (d):** the test-architect owns the upgrade test and its raw-SQL fixtures written against the previous release's schema; the planner keeps each LLD's Release migration notes current through amendments. **B-1 (e):** pg-boss upgrades ship alone, with workers scaled to zero and the API in maintenance during the schema step. **B-2:** creates return a fixed `{ id, createdAt }`; the idempotency record stores only that and the status; replays go through output validation; Android resends the stored request bytes (D-13, §3, F-1). **B-3:** successful sync defined per source kind; Gmail safety-net sync at least every 6 hours counts; SMS staleness on the dashboard only (D-25, J-8, Q-3). Suggestions S-1 to S-8 applied: spec v0.10 references and FK wording; OIDC trust scoped to release/hotfix tags in a protected environment; dead-letter lifetime and discarded return values; wider risky-statement check and the no-`CONCURRENTLY` note; staging keeps separate worker identities (costs updated); OAuth state bound to a server-side row (F-3); request bytes resent from the outbox; `db:reset`-only rule in the proposed CLAUDE.md conventions. Q-14 (hotfixes) added. |
| 0.4     | 2026-10-05 | User answers to v0.3's questions ([platform decisions](../../product/notes/2026-10-05-platform-decisions.md)) and plan review round 3 suggestions. **Web (D-7):** SolidJS 1.9 SPA instead of React (vanilla TypeScript rejected with reasons); every web dependency re-chosen for Solid (TanStack Router/Query/Table/Virtual/Form for Solid, oRPC's TanStack Query integration, Kobalte with Ark UI as alternative, `@formatjs/intl`, `@sentry/solid`); large tables made an explicit requirement with targets and a Playwright performance test (§1.1, D-7, D-26); Android lists use Paging 3 (D-8). **Hosting (D-29) redesigned for the invite-only stage on Hetzner:** one CX33 production VM and one CX23 staging VM running Docker Compose (Caddy, api, two workers, Postgres with pgBackRest, Grafana Alloy); forced-command SSH deploys of GHCR images from protected GitHub environments; maintenance switch in Caddy without a code deploy and defined `/health/ready` behaviour (round 3 S-4); staging rebuild rule for hotfixes while staging is ahead (S-2); OpenTofu kept small with encrypted state; cost re-estimated at about €18 to €40 a month. **Dependent decisions:** D-18 no pooler at launch, pools sized against `max_connections`, PgBouncer removed from production and local compose (CI pooler suite kept); D-19 rebuilt without per-process cloud identities: Google Cloud KMS asymmetric key (API seals with the public key, only worker-capture can unwrap), local key for `api-secrets`, residual risk of a root compromise stated (Q-15); D-20 SOPS/age per-service secret files replace Secret Manager; D-24 Caddy/Postgres/Docker logging checklist, Alloy as the allowlisting collector, canary gate searches Grafana and Sentry; D-25 host, backup and certificate alerts added; D-30 pgBackRest with client-side encryption to Backblaze B2 (off-provider), 14-day time-based retention, quarterly restore drills on a temporary VM; D-35 S3-compatible buckets with scoped keys and presigned URLs; §5.1, §5.4, F-3, §7.5, §7.6 (scaling path) updated. **New D-36:** same-origin API under `/api/v1` (no CORS), minor version in `openapi.json` and a header rather than the path (differs from the user's `/api/v<x>_<y>/`, Q-16). **FX (D-15):** provider research table; Open Exchange Rates primary, `fawazahmed0/exchange-api` fallback (Q-18). **Accepted answers recorded:** backups, capture-key scope, alerts, Gmail "In production" with spike, no pooler, release step (command deferred), hotfixes from the last release; Q-8 and Q-10 become assumptions A-12 and A-13. **Round 3 suggestions:** S-1 merge-back check redefined (D-12); S-2, S-3, S-4 (D-29); S-5 list invalidation after creates (§4.5); S-6 staging deploys from release and hotfix tags (D-27, D-29). Open questions renumbered Q-15 to Q-20; P8 for the app UI kept as Q-17. |
| 0.5     | 2026-10-05 | Plan review of v0.4 (ready for the user) suggestions applied; status set to `in-review`. **S-1:** corrected the claim that a disk leak leaves credentials sealed: a disk copy or snapshot exposes the SOPS files and, with the age key on disk, worker-capture's KMS credential; production age key now kept only in tmpfs with `budmonctl unlock` after reboots, no automatic reboots, no production snapshots; D-19 threat table, §7.5, §9 and Q-15 updated. **S-2:** pgBackRest retention corrected to `repo1-retention-full=7` with weekly fulls (oldest backup 7 to 14 days, PITR at least 7 days), matching "within 14 days" (D-30, §3.3). **S-3:** readiness defined as the code's compatible schema window so rollbacks report ready; `db:migrate` verifies journal and hashes only, check (i) stays in CI (D-12, D-29). **S-4:** staging canary gate also scans unfiltered Docker and journald logs via a forced-command scan; alerts on any Alloy drop; Caddy's error logger filtered, credentials redacted (D-24, D-25). **S-5:** restore-drill isolation rules (D-30). **S-6:** service-account key org policy check with fallbacks; FCM credential and Pub/Sub subscriber scope listed; CI secret scan of repo and images (D-19, D-20). **S-7:** internal `data` network, `egress` network, worker-capture behind a hostname-allowlist egress proxy; Alloy's root exception stated (D-29). **S-8:** `@fastify/cors` removed (D-3); D-9 rationale updated for containers and secret files. **S-9:** Q-20 now blocks the Gmail spike and `sources`. **S-10:** library versions pinned as checked on npm; Ark UI status; TanStack Table v9 (D-7). **S-11:** statistical performance targets under CPU throttling on release candidates; placeholder rows keep scroll position and `aria-rowindex` (D-7, D-26). **S-12:** Hetzner price-rise count marked as reported (§9). No suggestion declined. |
| 0.6     | 2026-10-05 | User answers to v0.5's questions ([platform decisions](../../product/notes/2026-10-05-platform-decisions.md)). **No staging:** one production environment; staging VM, staging secrets and the staging-ahead hotfix rule removed; new **D-41 release rehearsal in CI** (production Compose stack from the release images, upgrade from the previous release's database, canary scan of unfiltered and filtered logs, rollback check) replaces the staging canary gate (D-12, D-24, D-26, D-27, D-29). **Capture isolation (D-19, pending Q-15):** worker-capture on a dedicated CX23 with no inbound internet traffic, private network to Postgres with a limited `budmon_capture` role, egress proxy plus host firewall; compared honestly with Google Cloud Run (workload identity but a public Postgres port, about €45 to €50 a month, cross-cloud latency); recommendation: dedicated Hetzner VM. **New D-40:** main VM's data on a LUKS-encrypted volume with manual `budmonctl unlock` after reboots (Clevis/Tang as fallback), pending Q-15; D-20 secrets per VM, keys never on plain disk. **New D-37 i18n** from day one, **D-38 RTL** rules (user's list reviewed and extended: document direction, bidi isolation, always-LTR data, tables, chart time axes mirror, keyboard, fonts, Android) with stylelint/ESLint guards and a pseudo-RTL Playwright run, **D-39 accessibility baseline** with a formal WCAG 2.2 AA audit before going public (pending Q-21). **API path** `/api/v1` accepted; **domain** `budmon.com` (fallback `.io`) (D-36). **FX (D-15):** cost driver is requests, not storage; one historical request per day plus on-demand backfills only for needed dates; Open Exchange Rates free plan suffices, $0. **Postgres** stated on the main VM, separate DB server in the scaling path. Costs re-estimated at about €19 to €22 a month. Open questions reduced to Q-15 and Q-21. |
| 0.7     | 2026-10-05 | Plan review of v0.6 (ready for the user) suggestions applied; status `in-review`. **S-1:** unlock from the owner's machine, one SSH session per VM, capture VM via `ProxyJump` with pinned host keys and no agent forwarding; the capture key never enters a process on the main VM (D-20). **S-2:** the capture VM's deploy channel carries only a tag; it resolves digests with its own token, verifies cosign signatures, takes its Compose file from a signed release image and accepts only newer or previous tags; separate `owner` account with `PermitOpen` for the jump (D-29). **S-3:** `budmon_capture` restated: reads and writes most financial data, never credentials; new platform rule that credential data lives only in tables it's never granted (D-19, §7.1). **S-4:** pg-boss in worker-capture runs as `budmon_capture` with send/fetch/complete/fail only, maintenance and scheduling off (D-9, §7.1). **S-5:** host nftables and `DOCKER-USER` rules instead of relying on Hetzner firewalls for the private network; private CA and `verify-full`; per-client proxy allowlists for worker-capture, Docker, apt and Alloy; DNS only for the proxy; NTP; proxy support per client library (D-19, D-29). **S-6:** boot safeguards (data subdirectory only inside the volume, `create_host_path: false`, no automatic `initdb`, pgBackRest system-identifier check); a locked VM is detected by the external check or missing heartbeat; backups pause while locked; swap off; Caddy's data directory on the encrypted volume; separate volume disk alert (D-40, D-25, J-8). **S-7:** restore drills onto a LUKS volume, destroyed afterwards (D-30). **S-8:** rehearsal runs worker-capture as `budmon_capture` over TLS on a private-network-shaped network with a fake Google endpoint returning canaries and Google-style errors; integration tests use production roles (D-41, D-26). **S-9:** backfills come from the quota-less fallback provider; dates not yet filled return "no rate" (D-15). **S-10:** leftover staging references removed (§3, §9). **S-11:** custom ESLint rule for physical Tailwind classes; custom Compose lint as the real string guard; `data-rtl-probe` convention for pseudo-RTL tests (D-37, D-38). Q-15's wording corrected for S-1, S-2, S-3 and S-6. No suggestion declined. |
| 0.8     | 2026-10-05 | User's infrastructure staging decision and answers to v0.6's open questions ([platform decisions](../../product/notes/2026-10-05-platform-decisions.md), "Answers to the platform HLD v0.6 open questions" and "Staging the infrastructure"). **D-29 restructured around three infrastructure stages over one invite-only codebase:** stage 0 (owner only: one CX23 running the whole Compose stack, worker-capture as its own container with its own secret file, no capture VM, no LUKS, no egress proxy, automatic security reboots), stage 1 (invite-only: v0.7's two-VM design) and stage 2 (public: the §7.6 path). New binding **stage rule**: stage 0 → 1 changes only infrastructure and configuration (no code, image or migration change), with the places in v0.7 that would have broken it fixed: worker-capture uses its own `capture-db` network with TLS `verify-full` and a `hostssl` rule from stage 0; proxy support wired unconditionally; Postgres image boot safeguards from the first release; secret files keyed by host role; the domain acquired before stage 0. A **kept-from-day-one** list (TLS, SOPS, pgBackRest to B2, D-24, worker-capture's separate container, the release rehearsal and release migrations, plus signed user-approved deploys, the host baseline and single-VM alerts). A **stage-1 gate** checklist (domain, dry run, capture VM, D-40 with an unlock run-through, egress proxy and firewall, cutover by restore as the first restore drill, rotation of every stage-0 secret and deletion of the stage-0 VM, Gmail publishing status from Q-11's spike, stage-1 monitoring, Android distribution and privacy notice). Costs per stage: about €9 to €12 (stage 0), €19 to €22 (stage 1), stage 2 as a rough order only. **Dependent changes:** §1.1, §1.2, §1.3, US-7, J-8, §5.1 (stage-0 diagram added), §5.3, §7.1, §7.5, §7.6 (stage 2), D-9, D-12, D-18 (pooler deferred to stage 2), D-19 (decided; per-stage threat table; KMS audit alerting at the gate), D-20 (secrets by host role; stage-0 age key on disk with `budmon-boot`), D-25 (alerts per stage), D-30 (drills: the cutover is the first), D-36 (domain timing), D-40 (decided for the gate; plain-terms explanation and unlock procedure), D-41 (always stage-1-shaped), §9 (stage risks), A-4. **Q-15 resolved** (dedicated capture VM and encryption at rest, both at the stage-1 gate). **Q-21 resolved:** accessibility checks (axe in Playwright, Android checks, contrast) report but never block; four static web lint rules still block (D-39, D-26, D-27). **RTL:** the user's confirmation recorded; guards stay blocking (D-38). Open questions: none. |
| 0.9     | 2026-10-05 | Plan review of v0.8 (verdict REVISE). **P-1 (the stage rule versus deploy files):** option (b), plus deploy bundles from the first release. The rule now freezes `apps/`, `packages/` and `images/` (Dockerfiles moved out of `infra/`, D-5) and allows no migration. Two signed **deploy bundle images** (`budmon-deploy-main`, `budmon-deploy-capture`) carry every host role's files for both stages plus a manifest of application image digests; a minimal cloud-init bootstrap behind the forced command verifies and extracts them, which is how each host gets its Compose file for a tag. A new **infrastructure-only release** (`vX.Y.Z-infra.N`: diff limited to `infra/`, previous application digests reused, only bundles built and signed, rehearsed, user-approved, no migration step) carries dry-run fixes. `egress-proxy`, `caddy` and `alloy` are upstream images pinned by digest inside the signed bundles (D-29 rules 1 to 5, D-27, D-41, §5.1). **P-2 (secrets across the stage boundary):** strict host-role separation, with no main-side container reading `capture/` in any stage, enforced in the rehearsal with per-role throwaway age keys; role passwords reach Postgres as SCRAM-SHA-256 verifiers held main-side and applied by the schema step, rotated with `budmonctl secrets rotate-role`. D-20 lists the rate-limit HMAC key (rotated, counters reset), the mailbox-lookup HMAC key (deliberately kept, with the reason) and the Postgres server TLS key, and gives a rotation rule for each key. Every gate command ships in the images from the first release and runs in CI. Sentry DSNs are public identifiers and aren't rotated (D-20, D-29 rule 3, D-41). **Suggestions applied:** S-1 cutover stops all application containers on stage 0 before the final WAL, lowers the DNS TTL first, and accepts a few minutes of HTTP-01 certificate delay under maintenance with only the owner affected (DNS-01 not needed); S-2 dry run with an empty database, throwaway secrets, a dry-run KMS key and service account, no production subscription; S-3 gate reordered (alert rules before the cutover; reboot-and-unlock run-through after it; now 12 items, references updated); S-4 fresh non-data secrets for stage-1 hosts from the start, data-bound ones rotated after the restore, list extended (TLS key, HMAC keys, registry token, SSH keys), Gmail reconnect recommended; S-5 pinned `db.budmon.internal` in the certificate and `extra_hosts`, `listen_addresses` and `pg_hba.conf` keeping worker-capture off Postgres over `egress`; S-6 a restore drill soon after the first stage-0 deploy (D-30, §9); S-7 a short stage-0 overlay run in the rehearsal while production is in stage 0 (D-41); S-8 leftovers (§9 restore wording, stage table, CI "steps" in D-27, D-5 per-host-role deploy files, §5.1 wording, J-8 reboot alert from stage 1); S-9 Android lint's accessibility category non-fatal (D-27, D-39); S-10 `NO_PROXY`/`no_grpc_proxy` for Alloy and the database in stage-1 worker-capture (D-19). None declined. **Q-1** (blocking accessibility lint rules) added to §11 for the user. |
| 0.10    | 2026-10-05 | Plan review of v0.9 (verdict READY-FOR-USER) suggestions applied; status stays `in-review`. **S-1:** every deploy, including an infrastructure-only one, runs the schema step before any container restarts. It applies no migration on an infrastructure-only release (same `migrate` digest, journal verified) but applies roles, grants and password verifiers, so a role-password rotation shipped that way works. Rule 3 (f) now says which gate commands live in the server image and which (`budmonctl`) in `infra/` (D-20, D-27, D-29 rules 3 and 5, deploy step 4, D-41). **S-2:** the bootstrap's trust anchors are stated and live in cloud-init: a certificate-identity regex over the release workflow and release, hotfix and infra tag refs; the GitHub OIDC issuer; a Sigstore trusted root pinned for offline verification, with online verification plus allowlisted Sigstore hosts as fallback. A signed bundle may replace the bootstrap and anchors after verification with the current anchors, so anchors change without a host rebuild (D-29 rule 4). **S-3:** hosts accept releases by a monotonic sequence number in the signed manifest, not by tag order; the capture side applies the same tag regex. **S-4:** hotfixes and infrastructure-only releases branch from the last deployed tag of any kind; no release while either kind of merge-back is pending (D-12, D-29 rule 5). **S-5:** secret sets per deployment (`infra/secrets/<deployment>/<host-role>/`, deployment `prod-s0`, `prod-s1` or `dryrun`, selected by `host.env`); the dry run gets its own set; gate item 7 creates `prod-s1` without touching `prod-s0`, so stage 0 stays deployable and the fallback works. Role passwords and the cursor key are fresh in `prod-s1` (verifiers applied on first deploy); only the `api-secrets` key carries over and is rotated in item 9, which deletes `prod-s0` after the cutover (D-20, gate items 2, 7, 8, 9). **S-6:** the rehearsal asserts no application container sees `HOST_ROLE`, `DEPLOYMENT`, `INFRA_STAGE` or `host.env` (D-41). **S-7:** the stage-0 VM runs with `HOST_ROLE=main,capture`: both bundles, two Compose projects joined only by `capture-db`, strict per-role mounts, and worker-capture's outbound network separate from Postgres (D-29 rule 4, networks, D-41). None declined. Q-1 stays open for the user. |
| 1.0     | 2026-10-05 | **Approved by the user** (project owner): "Yes go ahead make the planner agent start the lld". Q-1 (blocking accessibility lint rules) wasn't answered explicitly; the recommended option (a) is recorded as the decision (D-39, §11), and the user can change it. |
| 1.1     | 2026-10-07 | **Stage 0 moves to the owner's Windows laptop** (user decision, [platform decisions](../../product/notes/2026-10-05-platform-decisions.md), "Stage 0 runs on the owner's laptop (2026-10-07)": Hetzner's cheap tier unavailable; "for the first version, we're not going to use a vps … it can just run on my laptop"; Tailscale for phone access accepted; off-site backups in stage 0 declined; no domain until the first server). Status back to `draft` (revision of an approved document). **D-29 rewritten:** stage 0 = Docker Desktop (WSL2 backend) on Windows, with the repository and tooling inside WSL2, Windows rules (`.gitattributes`, WSL2-only scripts, `.wslconfig`, a Windows-side clone only for Android Studio), phone access through one Tailscale HTTPS address (`tailscale serve`, LAN path at home), the Android base URL as a build property, the Gmail OAuth redirect on `http://localhost`, behaviour while the laptop is off, releases installed with `budmon-local upgrade`, no off-site backups (accepted risk) with local pre-upgrade dumps, real Google Cloud KMS in stage 0. The stage rule is restated for the laptop → first-server move. All server-deployment machinery (bundles, bootstrap and trust anchors, forced-command SSH, OpenTofu, cloud-init, signing, the tag ruleset and approval chain, pgBackRest, Alloy, alerts) moves to stage 1. Stage 1 is provider-neutral (WireGuard tunnel, LUKS on any block device; candidates OVHcloud, Netcup, Hetzner; chosen at the gate), the gate is reordered (15 items, cutover by `pg_dump` from the laptop), and costs are re-estimated (stage 0 about €0 to €1; stage 1 about €15 to €27, est.). **Dependent changes:** D-15 (FX gap check), D-19 (stage-1 server and tunnel; stage-0 threats on the laptop), D-20 (stage-0 local secret files; SOPS from stage 1), D-25 (no alerting in stage 0; Sentry e-mail only), D-27 (stage-0 tagging; full pipeline from stage 1), D-28 (development inside WSL2; separate dev project), D-30 (no backups in stage 0; drills from the gate), D-36 (domain at the stage-1 gate; revises "before stage 0"), D-40 (provider-neutral block device), D-41 (stage-0-shaped rehearsal now, server shape from stage 1), §4 J-7/J-8, §5.1 (stage-0 diagram), §7.5, §7.6, §9 (laptop risks, capacity scarcity), A-11, new A-14 (laptop disk encryption), A-15 (laptop requirements), A-16 (localhost OAuth redirect). §11: Q-1 (FX before 2024-03-02) open; Q-2 (approval click on every release) deferred to stage 1. Docker Desktop's and Tailscale's free terms checked through web sources on 2026-10-07. **Q-1 (FX before 2024-03-02) resolved** as option (a), "no rate", extendable by amendment (user go-ahead relayed 2026-10-07); Q-2 stays deferred to stage 1. |
| 1.2     | 2026-10-07 | Plan review of v1.1 (round 1, REVISE; the HLD direction held). **P-2:** Android debug builds point at the development stack (`http://10.0.2.2:5173`, Vite proxying `/api` to the development API), never the laptop's production Caddy on 8080; production only through an explicit `stage0` build (D-29). **P-1, P-3 (HLD side):** stage-0 first install made resumable, with per-container ownership of secret directories, `site.env` prompts, `budmon-local secret set`, and the Google Cloud bootstrap after secrets exist; `budmon-local` copies each tag's `infra/local/` into `~/.budmon/releases/<tag>/` and runs every command from the running release's copy (D-29). **Suggestions:** S-1 one hotfix naming rule (branch `hotfix/vX.Y.Z-hotfix.N` = tag name, PR to `main` left open, tag on its head, the same PR merged back; D-12); S-2 `.wslconfig` mirrored networking left commented out, `adb` on Windows (D-29); S-3 stage 0 reports a stale Gmail connection as a Sentry event so the new-issue e-mail is the alert (D-25, a requirement on `sources`); S-4 rule 2 reworded: the cutover deploys a release with no application-code change, built by the stage-1 pipeline; S-5 rehearsal and laptop builds share inputs but aren't necessarily byte-identical (D-41); S-9 weekly Gmail reconnect from the laptop while the OAuth app is in testing mode (D-29). Status stays `draft`. |
| 1.3     | 2026-10-07 | Amended during implementation of platform: A-2 (D-29: the stage-0 `budmon-main` project gains a quiet, unlogged `mailpit` container for email) and A-4 (D-24 rule 4: one stated exception, Google's sign-in callback `code`/`state` query string, with mitigations), both requested by the approved identity HLD v0.5 §5.6 (PA-2, PA-4). Both need user confirmation. |
| 1.2     | 2026-10-07 | **Approved.** Approved on the owner's behalf by the main conversation, under the owner's direct instruction on 2026-10-07: "auto approve the hlds as well just keep going man. I want you to skip the human in the loop (me) and just keep going" (and earlier: "auto approve the lld and start building right away"). Plan review passed. No content change. |

## 1. Context and requirements

### 1.1 Requirements

Stories PLT-US-1 to PLT-US-15 and business rules PLT-BR-1 to PLT-BR-8 (spec §4.14), plus the cross-cutting requirements the platform has to make possible:

| Requirement | What the platform must provide |
| ----------- | ------------------------------ |
| XC-1, XC-2, XC-3, PLT-BR-3 | One exact money type (64-bit integer minor units plus the currency's decimals), currency reference data, daily market rates and a conversion function with defined date semantics. |
| XC-5, XC-6 | Conventions and helpers for instants, calendar dates and IANA time zones. |
| XC-9 to XC-16, PLT-BR-1, PLT-BR-2 | Credential encryption that only the capture worker can undo; observability, job storage and URLs that never carry amounts, payees, message content or tokens; hard deletion as the default so erasure (XC-16) is real; backups and logs whose retention is stated. |
| XC-17 | Background jobs and private file storage for exports (the export itself is `identity`'s). |
| XC-19 to XC-22 | A monorepo with backend, web app and native Android app; idempotent creates so Android's offline queue (XC-22, TXN-US-10) can retry safely. |
| XC-25 to XC-28 | Scheduled and queued work in workers (reminders, push and email delivery are `notifications`' and `identity`'s). |
| XC-29 to XC-31 | Gmail push ingestion path; best-effort availability (P9) with alerting. |
| User requirements (2026-10-05): languages from the start, RTL readiness, accessibility (D-37, D-38, D-39) | Message catalogs and locale-aware formatting everywhere; logical layout rules with lint and pseudo-RTL tests; an accessibility baseline with automated checks. |
| User requirement (2026-10-05, D-7) | The web app shows big tables with performance as a priority: virtualised rendering, server-side keyset pagination, stated targets. |
| IDN-BR-3, §6 (Gmail testing mode) | Nothing that hard-wires invite-only: the platform is designed for public scale (PD "Scale target") but deploys small. |
| User requirement (2026-10-05, D-29): "the codebase/logic is planned for two stages: invite-only and public and the infrastructure is planned for 3: just me, invite-only, and public" | Infrastructure stages 0 (owner only, on the owner's Windows laptop since 2026-10-07), 1 (invite-only, the first server deployment) and 2 (public) over one invite-only codebase; moving from the laptop to the first server changes no application code; a stage-1 gate checklist completed before the first invitation. |

### 1.2 Goals

- Every module is built the same way, in a predictable place, against a contract that the web and Android apps can't drift from.
- Privacy rules (PLT-BR-1, PLT-BR-2) are enforced by construction and by automated tests, not only by guidelines.
- A fresh checkout plus one documented command runs the whole stack; one command runs every check.
- Run at no cost on the owner's own laptop first (stage 0), then for an invited group (stage 1) with the move between them an infrastructure change only (D-29); scale out (more API instances, more workers, bigger database) without redesign.
- The repo starts from a sound base: the current broken and unsafe code is removed in the first slice (PLT-US-14).

### 1.3 Non-goals

- Any module's own features, tables or screens, including sign-in, sessions and tokens (`identity`).
- Redis, Kubernetes, microservices, GraphQL, a service mesh or a message broker other than pg-boss.
- WebSockets or server-sent events in the MVP (see §5.2).
- Postgres row-level security in the MVP (D-23).
- Exporting client-side (browser or Android) traces to Grafana in the MVP (D-24).
- A persisted offline read cache on Android (only new-entry offline support is in the MVP, XC-22).
- The public-scale deployment (infrastructure stage 2; §7.6 describes the path only), multi-region deployment, high availability, and an SLA (P9: best effort). Hosting, environments and costs are designed for infrastructure stages 0 (owner only) and 1 (invite-only) (user decision, D-29).
- An operations UI inside Budmon. The product owner's error and health views are Sentry and Grafana (spec P22: an in-app view comes later).
- A feature-flag service. Per-user feature switches are `admin`'s (ADM-US-7).

## 2. Actors and stories

Actors: **developer or agent** (builds Budmon), **product owner** (operates it), **end user** (sees the platform only through what it protects and how reliably the apps work), and **system actors**: the API process, worker-capture, worker-general, the CI pipeline.

The HLD keeps the spec's story IDs so traceability is one-to-one. Each becomes an LLD slice, except that **US-14 (clean-up) is delivered inside the first slice together with US-1** (decided, spec §7 item 4).

| ID | Spec | Story |
| -- | ---- | ----- |
| US-1 | PLT-US-1 | As a developer or agent, I want one repository holding backend, web app, Android app and the shared contract in a documented layout, so every module is built the same way. |
| US-2 | PLT-US-2 | As a developer or agent, I want to start the whole stack locally with one documented command, so anyone can run and test Budmon from a fresh checkout. |
| US-3 | PLT-US-3 | As a developer or agent, I want the API defined as a contract first, with OpenAPI published from it and clients generated from it, so the apps can't drift from the backend. |
| US-4 | PLT-US-4 | As a developer or agent, I want background work in separate worker processes through a job queue, so slow or scheduled work never slows the API and jobs aren't lost. |
| US-5 | PLT-US-5 | As a developer or agent, I want configuration validated when each process starts, so a misconfigured process fails immediately and clearly. |
| US-6 | PLT-US-6 | As an end user, I want the credentials Budmon holds for me encrypted and usable only by the part of Budmon that needs them, so a database or API leak doesn't expose my inbox. |
| US-7 | PLT-US-7 | As a developer or agent, I want deployed schemas (staging and production in the spec's wording; only production in every infrastructure stage, D-29) changed only through generated, reviewed, committed migrations, created once per release, while development and test databases are built directly from the schema, so the schema can evolve freely during development and safely once real data exists (user requirement, D-12). |
| US-8 | PLT-US-8 | As a developer or agent, I want one shared money type and helpers (including conversion at market rates), so every module stores, adds and displays amounts exactly. |
| US-9 | PLT-US-9 | As a client developer and end user, I want one error model across the API, so apps show the right message and nothing internal leaks. |
| US-10 | PLT-US-10 | As the product owner, I want errors from backend, web and Android in one place without users' financial data, so I can fix problems fast without breaking the privacy promise. |
| US-11 | PLT-US-11 | As the product owner, I want dashboards and alerts for the API and workers, including whether capture is working, so I notice when capture stops before users do. |
| US-12 | PLT-US-12 | As a developer or agent, I want automated checks on every change, so broken code doesn't reach the main branch. |
| US-13 | PLT-US-13 | As an end user, I want basic protection against abuse (rate limits, CORS, security headers, size limits), so my account can't be brute-forced and the API isn't trivially attacked. |
| US-14 | PLT-US-14 | As a developer or agent, I want the current repo cleaned up per the codebase review inside the first slice, so the first module starts from a sound base. |
| US-15 | PLT-US-15 | As an end user and product owner, I want my data backed up, so a server failure doesn't lose my financial history. |

Business rules carried through: PLT-BR-1 (D-24, §7.5), PLT-BR-2 (D-19), PLT-BR-3 (D-14), PLT-BR-4 (D-4, D-6), PLT-BR-5 (D-12; spec v0.10 wording, from the user's [platform feedback](../../product/notes/2026-10-05-platform-feedback.md)), PLT-BR-6 (D-9), PLT-BR-7 (D-25), PLT-BR-8 (D-21).

## 3. Data model

The platform owns little data: currency reference data and market rates (D-15), idempotency records (D-13), rate-limit counters (D-22), the queue's schema (D-9), the migrations journal in production (D-12), and two storage buckets (D-35). It **removes** the existing `users`, `accounts`, `accountOwners` and `refreshTokens` tables from the codebase: the database is disposable (spec §7 item 1) and `identity` and `accounts` design their own tables fresh (spec §7 item 2).

### 3.1 Tables and stores

| Table / store | New / changed | Purpose | Key columns | Relationships |
| ------------- | ------------- | ------- | ----------- | ------------- |
| `currencies` | Changed (replaces the current table and the `CURRENCY` enum) | ISO 4217 reference data; the source of each currency's number of decimals (XC-1). | `code` (ISO 4217 alpha-3, primary key), `name`, `minor_units` (0 to 4), `is_active` (withdrawn currencies such as EEK are inactive: kept for history, hidden from pickers). Only real ISO 4217 currencies: no metals (XAU, XAG, XPT, XPD), no SDR (XDR), no testing or fund codes, no crypto. | Referenced by `exchange_rates`; later by accounts, users (base currency) and any table holding money. |
| `exchange_rates` | New | Daily market rates (XC-3), stored against one pivot currency (USD) so any cross rate can be derived. | (`currency_code`, `rate_date`) primary key; `units_per_usd` `numeric(24,12)`, parsed losslessly from the provider; `provider`; `fetched_at`. A stored row is **final** (insert-only). | `currency_code` → `currencies.code` (`restrict`). |
| `idempotency_records` | New | Makes create-type mutations safe to retry (offline sync, web retries) without probing or resurrection (D-13). | (`user_id`, `idempotency_key`) primary key; `procedure`; `request_hash` (SHA-256 of the canonical validated input); `response_status`; `result` (`jsonb`, only `{ id, createdAt }`, never entity content); `created_at`; `expires_at` (90 days). | `user_id` → `identity`'s users table with `cascade`, declared in `identity`'s schema (the platform is built before that table exists; both reach production in the baseline release migration). |
| `rate_limit_counters` | New (`UNLOGGED`) | Shared fixed-window counters for sensitive endpoints, so limits hold across stateless API instances (D-22). | (`bucket_key`, `window_start`) primary key; `hits`; `expires_at`. `bucket_key` is the limiter name plus an **HMAC** of the subject (IP or email), never the raw value. | None. |
| `pgboss` schema | New | pg-boss's tables. | Owned by the `budmon_queue` role; installed and upgraded by the platform's queue schema step for the pinned pg-boss version, in every environment (D-12); pg-boss's own maintenance may create and drop objects inside this schema only (D-12). | Job payloads reference other tables' IDs only, never by foreign key. |
| `drizzle.__drizzle_migrations` | New | The applied-migrations journal. | Managed by Drizzle's migrator; exists in production, release-path test databases and the CI release rehearsal (development databases are pushed, D-12). | None. |
| Bucket `exports` | New (S3-compatible object storage, D-35) | Generated data exports (XC-17). | Objects under `users/<userId>/exports/<exportId>.<ext>`; private; deleted after 7 days by a purge job. | Metadata rows are `identity`'s. |
| Bucket `erasure-log` | New (S3-compatible object storage, D-35) | Append-only erasure records (internal user ID + time) to replay after a backup restore (D-30). | One object per erasure; written with a key that can't delete; Object Lock 30 days where available, then lifecycle deletion. | None. |
| Bucket `backups` | New (S3-compatible object storage, D-30) | pgBackRest repository (production only). | Client-side encrypted backups and WAL; 14-day time-based retention. | None. |
| `users`, `accounts`, `accountOwners`, `refreshTokens` | **Removed** | Replaced by `identity` and `accounts` designs (spec §7). | | |

Conventions every module's tables follow (detailed in the LLD):

- **Names:** `snake_case`, plural table names (D-12).
- **Primary keys:** UUIDv7 generated by the server (D-13), except reference tables with a natural key (`currencies.code`).
- **Money columns:** `bigint` minor units plus a `currency_code` column (or a currency fixed by a parent row), never `numeric`, `real` or `double precision` (D-14).
- **Time columns:** `timestamptz` for instants, `date` for calendar dates, `text` IANA zone names; never `timestamp without time zone` (D-16).
- **Every table** has `created_at` and `updated_at`; author columns where a story needs them (for example ACC-US-7).
- **Every foreign key** states its `onDelete` behaviour explicitly (D-17).
- **Sealed secrets** (D-19) live in the owning module's table as one `bytea` column holding a versioned envelope; no central secrets table.
- **Tables holding a user's data** are covered by `identity`'s erasure (XC-16): each module's LLD states how (cascade from the user, or an explicit erasure step).

### 3.2 Entity-relationship diagram

```mermaid
erDiagram
  currencies ||--o{ exchange_rates : "has daily rates"
  currencies {
    char3 code PK "ISO 4217 alpha-3"
    text name
    smallint minor_units "0 to 4"
    boolean is_active
  }
  exchange_rates {
    char3 currency_code PK "FK currencies.code"
    date rate_date PK "UTC day the rate closes"
    numeric units_per_usd "numeric(24,12), final once stored"
    text provider
    timestamptz fetched_at
  }
  idempotency_records {
    uuid user_id PK "FK users added by identity"
    uuid idempotency_key PK
    text procedure
    bytea request_hash
    smallint response_status
    jsonb result "only id + createdAt"
    timestamptz expires_at
  }
  rate_limit_counters {
    text bucket_key PK "limiter + HMAC(subject)"
    timestamptz window_start PK
    integer hits
    timestamptz expires_at
  }
```

### 3.3 Data lifecycle

- **`currencies`:** loaded from a committed ISO 4217 data file by the idempotent reference-data step (D-12); never deleted (`is_active = false` instead). `minor_units` never changes in place: an ISO change would be a deliberate data migration that rescales every stored amount in that currency.
- **`exchange_rates`:** insert-only; a stored day is final and is never overwritten by the application (a provider correction would be a deliberate, reviewed data migration). Kept indefinitely (about 160 currencies × 365 days ≈ 58k rows a year).
- **`idempotency_records`:** deleted 90 days after creation by a platform maintenance job, and with the user on erasure.
- **`rate_limit_counters`:** `UNLOGGED` (a database crash only resets limits); expired rows deleted every 10 minutes.
- **Jobs:** every finished job (completed or failed) is deleted 7 days after it finishes (pg-boss keeps one retention for finished jobs). A job that exhausts its retries is also copied to its role's **dead-letter queue**, which no worker consumes, so its jobs stay queued until the dead-letter queue's own retention (30 days) expires them: that's where failed jobs are inspected (PLT-US-4). Payloads hold IDs only and failure output is sanitised (D-10, D-24), so retention isn't a privacy concern.
- **Exports bucket:** objects deleted by the platform purge job 7 days after creation (lifecycle rule as backstop), and immediately on user erasure (prefix `users/<userId>/`).
- **Erasure-log bucket:** each record is kept 30 days (longer than backup retention, D-30), then deleted.
- **Deletion convention for all modules (D-17):** hard delete is the default; lifecycle states are explicit status columns; soft delete only where a story requires restoring (for example REV-US-4), always with a purge job.
- **Backups (D-30):** daily, kept at most 14 days, point-in-time recovery over at least the last 7 days (as the user accepted). Erasures are replayed after any restore.
- **Telemetry retention** (D-24): logs, traces and error reports keep internal IDs (never names, emails or financial data) for at most 30 days.

## 4. User experience

The platform has almost no screens of its own. What applies is: how unexpected errors, rate limits, offline state and app updates look to the end user, which every module's screens reuse; and how the product owner sees errors and health, which is in external tools (Sentry, Grafana), not in Budmon.

The user accepted P8 for the app's UI (English first, accessible, a calm and non-judgemental tone) and asked for languages from the start: strings, formatting and layout follow D-37 (i18n) and D-38 (RTL); the accessibility level is the D-39 baseline, accepted by the user as "not a showstopper": automated accessibility checks report and don't block (Q-21). `docs/design/ux-guidelines.md` doesn't exist yet; `identity` proposes it from these decisions.

### 4.1 User journeys

**J-1 Something goes wrong on Budmon's side (US-9, US-10).** An end user does anything (saves a transaction, opens a list). The server hits an unexpected error. What the user sees depends on whether the server knows nothing was saved (D-21, `outcome`):
- **Nothing was saved** (`outcome: not_applied`): "Something went wrong on our side. Nothing was changed. Try again in a moment." with **Try again** and "Reference: 4bf92f35" (the first 8 characters of the request ID). Form input is kept.
- **Unknown** (`outcome: unknown`, for example the error happened after the change was committed, or the connection dropped after sending): "We couldn't confirm this was saved. Check before trying again." **Try again** is still offered for creates, because every create carries an idempotency key (D-13): a retry returns the original result rather than creating a duplicate.
- Reads show the first message without "Nothing was changed" wording issues (reads change nothing).
- If the user reports the reference, the product owner finds the error in Sentry and the trace in Grafana. The report contains the reference, the user's internal ID, the error type and the code location, never what they typed.
- *Goes wrong:* retrying fails again: same message; nothing is lost. A screen-level failure while loading shows the full-screen fallback (S-2).

**J-2 Invalid input (US-9).** The user submits a form with a value the server rejects. The field is outlined, an icon and message appear under it (for example "Enter an amount greater than 0"), focus moves to the first invalid field, and a screen reader announces the error. The client maps the error's field paths to its fields. Client-side validation catches most of these first using the same rules from the contract's schemas (D-6).
- *Goes wrong:* a field the form doesn't show is rejected: the message appears at the top of the form ("Something in this form isn't valid: <field label>").

**J-3 Too many attempts (US-13).** The user (or an attacker) repeats a sensitive action too often. The form shows "Too many attempts. Try again in 10 minutes." with the wait from the server's `Retry-After`, and the submit button is disabled until then (the countdown is in text, not only a graphic).

**J-4 Offline on Android (XC-22; shared conventions that `transactions` uses for TXN-US-10).** The phone loses its connection. A slim banner appears: "You're offline. New entries are saved on this phone and sync when you're back online." Screens that need the network keep showing what's **already loaded in memory** (there's no persisted read cache in the MVP), marked "Offline: last updated 14:02", and disable server actions, explaining why on tap. If the app was restarted while offline, those screens show "You're offline. Connect to see this." New transactions and transfers can still be recorded (`transactions`). Each such entry shows a "Not yet synced" chip (icon + text). The app bar shows "3 waiting to sync". When back online: "Back online. Syncing 3 entries…", then chips disappear as entries sync.
- *Goes wrong:* the server rejects a synced entry (for example the account was archived or the user lost their role): the entry stays on the phone marked "Couldn't sync: tap to fix", and the app bar shows "1 entry needs attention". Nothing is silently dropped.
- *Goes wrong:* an entry has waited more than 60 days (close to the 90-day idempotency window, D-13): it isn't sent automatically; it's marked "Check before syncing" so the user confirms it, which prevents a duplicate if an earlier attempt had in fact succeeded.
- *Goes wrong:* the API says the app must be updated (J-5): sync pauses; entries stay "Not yet synced" (not "needs attention").
- (Whether offline entries count in on-device balances is P6, owned by `transactions`.)

**J-5 App update (Android, D-33).** When a newer build is available, a dismissible card on the home screen says "A new version of Budmon is available." with **Update** and **Later** ("Later" hides it for 3 days). When the installed build is below the minimum the API supports, the API answers every request with `CLIENT_UPDATE_REQUIRED`, offline sync pauses, and the app shows **Update required** (S-1): "Entries you saved offline are kept and will sync after you update." Recording new offline entries stays possible from that screen.
- *Goes wrong:* the download link fails: "Couldn't open the download. Ask the person who invited you for the latest version." (distribution, A-12).

**J-6 Web app update.** After a new web release, the open web app notices (it checks the deployed version on window focus and every 30 minutes) and shows a non-blocking toast: "Budmon has been updated. Reload to get the latest version." with **Reload**. It never reloads by itself, so unsaved input isn't lost. If the API reports `CLIENT_UPDATE_REQUIRED` to the web app, the toast becomes a persistent banner with the same button.

**J-7 Budmon is down or in maintenance.** The API is unreachable (in stage 0, typically because the laptop is asleep, off or away from the network), or the maintenance switch is on (D-29: used for queue-upgrade releases and host work), and requests get 503 `SERVICE_UNAVAILABLE` or fail to connect: "Budmon is temporarily unavailable. Try again in a few minutes." Android keeps recording offline entries. No status page in the MVP.

**J-8 The product owner is alerted (US-10, US-11), from stage 1.** In stage 0 (the laptop) there are no alert e-mails except Sentry's notices of new errors (D-25). From stage 1: something breaks (the API stops answering, a worker stops, Gmail notifications back up, a connected Gmail inbox hasn't synced for a day, jobs fail unexpectedly, the VM's disk fills, a backup is overdue; from stage 1, a reboot is required). In stage 0 a reboot restarts the stack by itself. From stage 1, after a reboot, Budmon stays down until the owner unlocks it (D-40); that shows up as "API down" from the external synthetic check (the main VM) or "capture worker heartbeat missing" (the capture VM), because a locked VM has no credentials to report anything itself; the alert email reminds the owner to check whether a VM rebooted. The owner gets an email from Grafana Cloud within about 5 to 15 minutes: subject "[Budmon] Capture worker down", with what's wrong, since when, and links to the dashboard and Sentry. The dashboard shows request rate, errors, latency, queue depth, dead-lettered jobs, Gmail push activity and capture connections by status (counts only). None of these show amounts, payees, message content, tokens, names or emails. When the problem clears, a "Resolved" email follows. First-time experience: right after the first deploy, panels show "No data" until traffic arrives; the synthetic health check produces data within 5 minutes, which proves the pipeline works.
- *Goes wrong:* the monitoring itself fails (Grafana Cloud down, free-tier limit hit): alerts can't fire. Mitigation: a monthly glance at usage against free-tier limits; a second independent uptime check is deferred (D-25).

### 4.2 Screens

| Screen | Purpose | Information hierarchy (first → last) | Primary action | Other actions |
| ------ | ------- | ------------------------------------ | -------------- | ------------- |
| S-1 Update required (Android) | Block use of an app version the API no longer supports, without losing offline entries. | What happened and that it's safe → why → how many offline entries are kept → download | **Update Budmon** | Record an entry offline |
| S-2 Error fallback (web and Android) | Replace a screen that failed to load or crashed. | What happened → what to do → reference | **Try again** | Go to home |

Shared components, used inside every module's screens:

| Component | Purpose | Behaviour |
| --------- | ------- | --------- |
| C-1 Offline banner (Android; the web app shows the same text without the offline-entry sentence) | Tell the user they're offline and what still works. | Appears when connectivity is lost, replaced by "Back online…" for 3 seconds when it returns. |
| C-2 Sync indicator and "Not yet synced" chip (Android) | Show pending and failed offline entries. | App-bar indicator with a count; chip on each pending entry; tapping a failed one opens it with the server's error. |
| C-3 Error message patterns | One look for every module's errors. | Inline field error (icon + text under the field), form-level summary, toast for background failures, full-screen fallback (S-2) for screens that can't load. |
| C-4 Update card (Android) and toast (web) | Announce a new version. | J-5 and J-6. |

S-1 Update required (Android):

```
+----------------------------------+
|                                  |
|        [ update icon ]           |
|                                  |
|  Update Budmon to continue       |
|                                  |
|  This version is no longer       |
|  supported. Updating takes about |
|  a minute.                       |
|                                  |
|  (i) 3 entries you saved offline |
|      are kept and will sync      |
|      after you update.           |
|                                  |
|  [       Update Budmon        ]  |
|                                  |
|     Record an entry offline      |
+----------------------------------+
```

S-2 Error fallback (both apps; web shown):

```
+----------------------------------------------+
| Budmon                          [nav ...]    |
|----------------------------------------------|
|                                              |
|   Something went wrong on our side           |
|                                              |
|   Try again in a moment. If it keeps         |
|   happening, share this reference with the   |
|   person who invited you.                    |
|                                              |
|   [ Try again ]   Go to home                 |
|                                              |
|   Reference: 4bf92f35                        |
+----------------------------------------------+
```

C-1 and C-2 on Android:

```
+----------------------------------+
| (!) You're offline. New entries  |
|     are saved on this phone.     |
|----------------------------------|
| Transactions      [⟳ 3 waiting]  |
|                                  |
|  Coffee         25.00 EGP        |
|  Today · Cash   [⟳ Not yet synced]|
|  Groceries     412.50 EGP        |
|  Yesterday · Bank                |
+----------------------------------+
```

### 4.3 Navigation

The platform adds no navigation destinations of its own. The update-required and error screens sit in front of any screen:

```mermaid
flowchart LR
  Any[Any screen] -- unexpected error while loading --> S2[S-2 Error fallback]
  S2 -- Try again --> Any
  S2 -- Go to home --> Home[Home]
  Any -- API says CLIENT_UPDATE_REQUIRED --> S1[S-1 Update required]
  S1 -- Update Budmon --> Dist[App download page]
  S1 -- Record an entry offline --> Entry[Offline entry form, transactions module]
```

### 4.4 States

| Screen | Empty | Loading | Error | Partial / a lot of data |
| ------ | ----- | ------- | ----- | ----------------------- |
| S-1 Update required | No offline entries: the "(i) entries kept" line is hidden. | Not applicable (shown from local state). | Download link fails: inline message (J-5). | 1,000+ offline entries: "1,000+ entries you saved offline are kept". |
| S-2 Error fallback | Not applicable. | **Try again** shows a spinner in the button and keeps the message. | Retry fails: the screen stays, with "Still not working." added. | Not applicable. |
| C-2 Sync indicator | Hidden when nothing is pending. | "Syncing 3…" with a progress icon (not colour only). | "1 entry needs attention". | "99+ waiting". |
| Product-owner dashboards (Grafana) | "No data" until traffic; the synthetic check fills within 5 minutes. | Grafana's own. | Grafana's own. | Metric labels are bounded (D-25). |

### 4.5 Interaction and feedback

- **Error mapping** is by stable error key, never by parsing messages (D-21). Each client has one table mapping keys to wording; unknown keys fall back to the generic message.
- **Validation errors** are shown inline on submit, and as the user leaves a field when the client already knows the rule from the contract's schema. Server-side validation errors map back to fields by path.
- **Mutations** show progress on the button that triggered them and update the screen after the server confirms. A create returns only `{ id, createdAt }` (D-13), so clients invalidate and refetch the affected list queries (web: TanStack Query invalidation; Android: the list's paging source refreshes) rather than reading the new entity separately. Optimistic updates are a per-module choice; a failure rolls back the change and shows a toast. Offline entries on Android appear immediately with "Not yet synced".
- **Retries:** clients automatically retry only reads and idempotency-keyed creates (D-13), with backoff; other mutations are retried only when the user taps **Try again**. Updates set values (so a repeat is harmless) and a repeated delete that returns `NOT_FOUND` is treated as success.
- **Every response carries `X-Request-Id`**; clients show its first 8 characters as "Reference" on generic errors only.
- **Confirmation and undo** are per module; the platform adds none.

### 4.6 Effort on frequent tasks

The frequent tasks (recording a transaction, reviewing a capture, checking a balance) belong to other modules. The platform's job is not to add steps or latency to them:
- Update prompts never interrupt a task: the soft prompt is a dismissible card on home; the hard block happens only below the minimum supported version (D-33).
- Offline entry is never blocked by the platform, not even by the update-required screen.
- Latency targets for every module (D-25): API p95 under 300 ms for single-item reads and writes, under 800 ms for list and aggregate reads, measured server-side.

### 4.7 Presentation of data

Platform-wide conventions, implemented once in `@budmon/shared` (D-14, D-16) and in Android's equivalent, checked against shared test vectors so both apps agree:

- **Money:** formatted with the user's locale and the currency's code or symbol through `Intl.NumberFormat` (web) and ICU (Android), always with **the currency's `minor_units` from Budmon's `currencies` table** as the number of decimals, overriding the library default ("1,234.50 EGP", "1,234 JPY", "1.234 KWD"). All decimals are always shown. The helper can show a sign (`−12.50`) or not; whether a module shows a minus sign or colours an amount is its UX choice, and colour is never the only cue.
- **Converted amounts** (D-15) can be marked as approximate when the conversion is provisional; modules decide whether to show the mark.
- **Dates:** calendar dates are shown in the user's locale and never shifted by time zone. Instants are shown in the user's time zone (XC-5). Relative times ("2 hours ago") only under 7 days; older ones show the date.
- **Large numbers** don't abbreviate in money fields; reports may abbreviate axis labels.

### 4.8 Platform and accessibility

- **Web:** evergreen browsers (Chrome, Edge, Firefox, Safari, last 2 versions); responsive from 360 px wide to desktop. The platform's components meet the D-39 baseline: banners use `role="status"` with `aria-live="polite"`, error summaries `role="alert"`, focus moves to the error summary or the first invalid field on submit, contrast at least 4.5:1, all actions keyboard-reachable. Automated axe checks run in the web end-to-end tests and report findings without blocking (D-26, D-39); layouts follow D-38's logical rules and must pass the pseudo-RTL smoke run (blocking).
- **Android:** Android 8.0 (API 26) and later (A-6), phones first; Material 3 with font scaling to 200% without clipping, TalkBack labels on every icon (the sync chip reads "Not yet synced"), touch targets at least 48 dp, meaning never conveyed by colour alone, and RTL-ready layouts (D-38).

### 4.9 Wording

Plain, calm, never blaming the user (P8). Key strings (English; clients hold them in message catalogs so other languages can follow):

| Where | Text |
| ----- | ---- |
| Generic error, nothing saved (`INTERNAL`, `outcome: not_applied`) | "Something went wrong on our side. Nothing was changed. Try again in a moment." |
| Generic error, outcome unknown (`INTERNAL`, `outcome: unknown`; or a timeout after sending) | "We couldn't confirm this was saved. Check before trying again." |
| Generic error on a read | "Something went wrong on our side. Try again in a moment." |
| Reference line | "Reference: {first 8 characters of request ID}" |
| Validation, form level (`VALIDATION_FAILED`) | "Some details need fixing." (each field shows its own message) |
| Rate limited (`RATE_LIMITED`) | "Too many attempts. Try again in {n} minutes." |
| Unavailable (`SERVICE_UNAVAILABLE`, network failure) | "Budmon is temporarily unavailable. Try again in a few minutes." |
| Not found (`NOT_FOUND`) | "This item doesn't exist or you no longer have access to it." |
| Forbidden (`FORBIDDEN`) | "You don't have permission to do this." |
| Offline banner | "You're offline. New entries are saved on this phone and sync when you're back online." |
| Offline, nothing loaded | "You're offline. Connect to see this." |
| Back online | "Back online. Syncing {n} entries…" |
| Chips | "Not yet synced" / "Couldn't sync: tap to fix" / "Check before syncing" |
| Update card | "A new version of Budmon is available." Buttons: "Update", "Later" |
| Update required | Title "Update Budmon to continue"; body "This version is no longer supported. Updating takes about a minute."; note "{n} entries you saved offline are kept and will sync after you update."; button "Update Budmon"; link "Record an entry offline" |
| Web update toast | "Budmon has been updated. Reload to get the latest version." Button "Reload" |
| Alert email subject | "[Budmon] {alert name}" and "[Budmon] Resolved: {alert name}" |

`NOT_FOUND` deliberately doesn't distinguish "doesn't exist" from "not yours" (§7.1).

## 5. Interfaces, protocols and integrations

### 5.1 Process and component overview

**One environment (production)** in every infrastructure stage (D-29); staging is replaced by a release rehearsal in CI (D-41). The application code and application images are the same in stages 0 and 1; only the hosts, networks and deploy-bundle configuration differ (D-29 rules 2 and 4).

**Stage 0 (owner only):** the owner's Windows laptop runs the whole Compose stack in Docker Desktop (WSL2). worker-capture is still its own container with its own secret file, database role and TLS network to Postgres, and reaches the internet directly. Nothing is exposed to the LAN or internet: Tailscale Serve on Windows terminates HTTPS for `https://<laptop>.<tailnet>.ts.net` and forwards to Caddy on `127.0.0.1:8080` (D-29). There's no Alloy or Grafana Cloud in stage 0.

```mermaid
flowchart LR
  subgraph Clients
    Web[Web app<br/>Solid SPA]
    And[Android app]
  end
  subgraph LAPTOP[Owner's Windows laptop: Docker Desktop, WSL2]
    TS[Tailscale Serve<br/>HTTPS for laptop.tailnet.ts.net]
    Caddy[Caddy on 127.0.0.1:8080<br/>SPA, /api proxy, maintenance switch]
    API[api]
    WG[worker-general]
    WC[worker-capture<br/>own container + secret file]
    PG[(postgres<br/>local disk, BitLocker)]
  end
  Web & And -- "HTTPS over Tailscale<br/>(LAN path at home)" --> TS
  TS --> Caddy
  Caddy --> API
  API --> PG
  WG --> PG
  WC -- "capture-db network, TLS, role budmon_capture" --> PG
  WC -- "direct: KMS, Pub/Sub, OAuth, Gmail" --> Google[Google Cloud + Gmail]
  WG -- exports, erasure records --> OBJ[(Backblaze B2, EU)]
  API & WG & WC -. errors .-> Sentry[Sentry]
```

**Stage 1 (invite-only), from the gate:** two servers at the provider chosen at the gate, joined by a WireGuard tunnel (shown below as the "private network"). The main VM runs everything except worker-capture; the capture VM runs only worker-capture behind its egress proxy (D-19).

```mermaid
flowchart LR
  subgraph Clients
    Web[Web app<br/>Solid SPA]
    And[Android app<br/>Kotlin + Compose]
  end
  subgraph MAIN[Main server, 4 vCPU / 8 GB class, Docker Compose]
    Caddy[Caddy<br/>TLS, static SPA, /api reverse proxy,<br/>maintenance switch]
    API[api<br/>Fastify + oRPC, stateless]
    WG[worker-general<br/>FX, notifications, deletion,<br/>exports, maintenance, gauges]
    PG[(postgres on a LUKS-encrypted volume<br/>data + pgboss schema,<br/>pgBackRest WAL archiving)]
    AlloyM[Grafana Alloy]
  end
  subgraph CAP[Capture server, small VPS, no inbound internet traffic]
    WC[worker-capture<br/>Gmail listener, OAuth exchange,<br/>capture jobs]
    EP[egress-proxy<br/>hostname allowlist]
    AlloyC[Grafana Alloy]
  end
  Web -- "HTTPS https://budmon.com/ and /api/v1" --> Caddy
  And -- "HTTPS /api/v1" --> Caddy
  Caddy --> API
  API --> PG
  WG --> PG
  WC -- "private network, TLS, role budmon_capture" --> PG
  API -. "seal with public key (no credentials)" .-> WC
  WC --> EP
  EP -- "asymmetricDecrypt (capture service-account key)" --> KMS[Google Cloud KMS]
  Gmail[Gmail API] -- watch notifications --> PS[Google Cloud Pub/Sub topic]
  EP -- streaming pull --> PS
  EP -- OAuth token exchange, history, messages --> Gmail
  API -- presigned URLs --> OBJ[(Backblaze B2, EU<br/>exports, erasure log, backups)]
  WG -- write exports, erasure records --> OBJ
  PG -- encrypted backups + WAL --> OBJ
  WG --> FX[FX rate provider]
  WG --> FCM[FCM push]
  WG --> Mail[Transactional email]
  API & WG -- OTLP --> AlloyM
  WC -- OTLP --> AlloyC
  AlloyM & AlloyC --> Graf[Grafana Cloud]
  API & WG & Web & And -. errors .-> Sentry[Sentry]
  EP -. errors .-> Sentry
```

The dashed API→worker-capture arrow is logical: the API seals with the `capture-credentials` public key and stores the envelope; it never calls worker-capture. In stage 1 worker-capture reaches the internet only through its egress proxy. Stage 2 (public) is the path in §7.6.

### 5.2 Client ↔ API: one HTTP JSON surface defined by the oRPC contract (D-4, D-6)

- **Transport:** HTTPS, JSON, REST-style paths under `https://<domain>/api/v1`, on the same origin as the web app (D-36), generated from the oRPC contract by oRPC's OpenAPI handler mounted in Fastify. The **web app** calls it with oRPC's `OpenAPILink` driven by the same contract; the **Android app** calls it through a Kotlin client generated from the committed `openapi.json`. Both clients hit the same routes.
- **No sensitive values in URLs (D-24):** paths and query strings may contain only IDs, enum values, dates, limits and encrypted cursors. Procedures whose inputs include amounts, payee names, note or message text, emails or tokens are `POST` with a JSON body, even when they only read (for example a transaction search with a payee or amount filter). A contract test enforces this (D-6).
- **Idempotency (D-13):** every create-type procedure requires an `Idempotency-Key` header (a UUID generated by the client per user action); both apps send it.
- **Auth transport** (bearer token vs cookie) is `identity`'s decision. The platform supports both: an auth hook in the oRPC context and `@fastify/cookie`; the API is same-origin with the web app, so no CORS is configured (D-36).
- **Errors:** oRPC's error envelope, with Budmon keys as codes (D-21).
- **Real-time:** none in the MVP. The web app refetches on focus and after mutations; Android receives push through FCM (`notifications`). No story needs sub-second updates; SSE or WebSockets would add long-lived connections to a stateless API. oRPC supports event streams if a later story needs them.
- **Non-contract routes:** `GET /health/live` (process up; reachable only inside the Docker network) and `GET /health/ready` (database reachable and at the expected migration level; exposed through Caddy, which answers it itself during maintenance, D-29), plain Fastify routes, unauthenticated, excluded from OpenAPI, returning no internals. `GET /api/v1/meta/client-config` (in the contract) returns the minimum supported and latest client versions (D-33). In local development only, a route serves files from the filesystem object store in place of presigned URLs (D-35).
- **Client identification:** both apps send `X-Budmon-Client: android/<versionCode>` or `web/<build id>`; used only for D-33 and as the `client_kind` metric label.

### 5.3 Jobs and workers (D-9, D-10)

- **pg-boss** in the same Postgres. Modules use it only through the platform's `JobQueue` interface: define a job (name `<module>.<job>`, a zod payload schema, the worker role that runs it, retry policy, queue policy), enqueue it inside a database transaction, or schedule it with cron.
- **Two worker roles from one codebase**, each a separately deployed process (PLT-BR-6):
  - **worker-capture:** the only process allowed to decrypt capture credentials (PLT-BR-2). Runs the Gmail Pub/Sub listener, the OAuth code exchange (D-19), and every job that needs a user's credentials or raw message content (owned by `sources` and `capture`), plus re-wrapping of capture envelopes. It runs in its own container with its own secret file in every stage, and **on its own VM from the stage-1 gate** (D-19, D-29).
  - **worker-general:** everything else: FX rates (platform), notification and reminder delivery (`notifications`), deletion after the grace period and exports (`identity`), reconciliation of derived values (`accounts`, `budgets`), capture-connection health gauges, and platform maintenance.
  - In local development both roles can run as one process (`WORKER_ROLES=capture,general`); in production they're always separate containers with separate secret files, and from stage 1 on separate VMs, so the decrypt credential never exists on the database host once other people's data is there.
- **Inbound data that can only arrive through the API** (SMS content uploaded by the Android app, OAuth callbacks) is validated, sealed with the capture key, stored in the owning module's table and enqueued; processing happens in worker-capture (A-1).

### 5.4 Integrations

| Integration | Used for | Owner | Failure modes and behaviour |
| ----------- | -------- | ----- | --------------------------- |
| Google Cloud KMS (asymmetric key `capture-credentials`) | Unwrapping data keys of capture secrets in worker-capture (D-19). Sealing needs no KMS call (public key). | platform | **Down or slow:** unsealing fails, so capture jobs retry with backoff (about 1 hour) and then dead-letter; nothing is lost because a mailbox's history ID isn't advanced until a sync succeeds. Sealing in the API is unaffected. **Key version disabled or credentials revoked** (incident response): same, plus an alert. Timeout 5 s per call. Decrypt calls are recorded in Cloud Audit Logs (principal and key only) and a Cloud Monitoring alert fires on an abnormal decrypt rate. |
| Google Cloud Pub/Sub (pull subscription) | Gmail `watch` notifications (PD). | platform hosts the listener; `sources`/`capture` own the handling | **Listener down:** notifications accumulate (retained 7 days) and are processed on restart; alert when the oldest unacknowledged message is older than 15 minutes. **Notification lost or watch expired:** the safety-net sync (at least every 6 hours) catches up, and the stale-connection gauge alerts after 24 hours (D-25). Notifications contain only an email address and a history ID; the address is never logged. Streaming pull is an outbound gRPC connection, so it works from the Hetzner VM. |
| Gmail API and Google OAuth token endpoint | Exchanging authorization codes, reading in-scope messages. | `sources`, `capture` | Designed in those modules. Platform constraints: runs only in worker-capture; destinations are fixed Google hosts from configuration (D-19). Expired or revoked tokens are a connection state, not a job failure (D-25). |
| FX rate provider (Open Exchange Rates; fallback `fawazahmed0/exchange-api`) | Daily market rates (XC-3). | platform (D-15) | **Primary down:** the daily job retries with backoff for up to 6 hours, then fetches the day from the fallback and records `provider` accordingly; conversions keep working provisionally from the latest stored day; alert if no new day for 36 hours. **Bad data** (unknown currency, zero, negative, unparseable): that currency's row is rejected and counted in a metric. |
| S3-compatible object storage (Backblaze B2, EU region) | Exports and the erasure log (D-35); database backups (D-30). | platform | **Down:** export jobs retry, then dead-letter; the user can request the export again (`identity`). Erasure-log write failure stops the erasure before any data is deleted (D-30). pgBackRest queues WAL locally while the repository is unreachable; an alert fires if archiving fails for 15 minutes (local WAL growth would otherwise fill the disk). |
| Firebase Cloud Messaging | Android push. | `notifications` | Designed there; runs in worker-general. |
| Transactional email | Invitations, password reset, deletion notices (XC-27). | `identity` / `notifications` | Designed there; runs in worker-general through a provider adapter; Mailpit locally, a fake in tests. |
| Sentry | Error reports from all three apps (PD). | platform | **Down or quota reached:** reports are dropped after the SDK's buffer; the app is unaffected. Errors are still in logs. |
| Grafana Cloud (via Grafana Alloy on each VM) | Traces, metrics, logs, alerting, synthetic check (PD). | platform | **Down:** Alloy buffers to disk up to a size limit and then drops; apps never block. Logs are also kept locally by Docker's log rotation (3 × 10 MB per container). |
| GitHub Container Registry | Release images pulled by the deploy script (D-29). | platform | **Down:** the deploy fails before touching the running stack; the previous release keeps running. |
| App distribution (Firebase App Distribution, A-12) | Android builds for the invited group. | platform | Download failure handled in J-5. |

## 6. Key flows

**F-1 A request, from client to database and back, including the error paths.**

```mermaid
sequenceDiagram
  participant C as Client (web/Android)
  participant F as Fastify (API)
  participant O as oRPC handler + middleware
  participant S as Module service
  participant R as Repo(s)
  participant Q as JobQueue
  participant DB as Postgres
  C->>F: POST /api/v1/... (JSON, X-Budmon-Client, Idempotency-Key on creates)
  F->>F: request ID = trace ID, rate limit, body limit (parse errors get a fixed message)
  F->>O: route to procedure
  O->>O: client version check (D-33), authenticate (identity hook), validate input (zod)
  alt input invalid
    O-->>C: 400 VALIDATION_FAILED {issues:[{path,code,message}]}, no input values
  end
  O->>S: call with context (principal, clock, tx factory)
  S->>DB: BEGIN
  opt create with Idempotency-Key
    S->>DB: insert idempotency record or find existing (D-13)
    Note over S,DB: existing + same hash: return stored {id, createdAt} (router validates it as usual)
  end
  S->>R: reads/writes with tx
  S->>Q: enqueue(tx, "module.job", {ids only})
  S->>DB: store {id, createdAt} + status in idempotency record, COMMIT (request marked "committed")
  S-->>O: result
  O->>O: validate output against contract
  O-->>C: 200 JSON
  Note over S,O: BudmonError: rollback, map key/status/details to the error envelope
  Note over S,O: Any other error: rollback if open, report type + stack only (D-24),<br/>500 INTERNAL with outcome not_applied (nothing committed) or unknown (committed), X-Request-Id
```

**F-2 Transactional enqueue, processing, retry and dead-lettering.**

```mermaid
sequenceDiagram
  participant S as Service (API or worker)
  participant DB as Postgres
  participant W as Worker (role that owns the queue)
  participant H as Job handler (wrapped by platform)
  S->>DB: BEGIN; write domain rows; INSERT pgboss job (same tx); COMMIT
  Note over S,DB: Rollback removes the job too
  W->>DB: fetch next job
  W->>H: handle(payload validated by zod)
  alt success
    H->>DB: domain writes (own tx), idempotent by design
    W->>DB: complete job
  else throws
    H->>H: wrapper replaces the error with a sanitised one<br/>(error key or class, stack frames, allowlisted code)
    W->>DB: fail attempt (sanitised output only); retry with exponential backoff
    Note over W,DB: After retryLimit: copied to the role's dead-letter queue (kept 30 days);<br/>metric jobs_dead_lettered_total; owner retries with a CLI command
  end
```

**F-3 Connecting Gmail: the API never sees tokens or the client secret and can't decrypt anything it sealed (D-19).**

```mermaid
sequenceDiagram
  participant U as User's browser/app
  participant API as API (holds only the capture public key)
  participant DB as Postgres
  participant WC as worker-capture (holds capture service-account key)
  participant KMS as Google Cloud KMS
  participant G as Google OAuth + Gmail
  U->>API: start connection
  API->>API: generate state + PKCE verifier; seal verifier (random DEK, AES-256-GCM, DEK wrapped with RSA-OAEP public key)
  API->>DB: insert pending OAuth row {state, user ID, sealed verifier, expires in 10 min}
  Note over API,DB: works for Android (custom tab, bearer auth): the callback carries no session,<br/>so the state row, not a session, identifies the user
  API-->>U: redirect to Google consent (code challenge, state)
  U->>G: consent
  G-->>U: redirect to https://domain/api/v1/... callback with code + state
  U->>API: callback(code, state)
  API->>DB: look up unexpired pending row by state (single use)
  API->>API: seal {code} with the capture public key
  API->>DB: store sealed code + enqueue sources.gmail-exchange {pendingId} (one tx)
  API-->>U: "Connecting…" (polls status)
  DB-->>WC: job
  WC->>KMS: asymmetricDecrypt(wrapped DEKs)
  KMS-->>WC: DEKs
  WC->>G: token exchange (code, verifier, client secret held only by worker-capture)
  G-->>WC: refresh + access token
  WC->>WC: seal refresh token (AAD = table + row + purpose) with the public key; access token kept in memory only
  WC->>DB: store sealed token, mark connected, delete pending exchange (one tx)
  U->>API: poll status: "Connected"
  Note over WC,G: Code expired or exchange fails: pending exchange deleted, status "Couldn't connect, try again"
```

**F-4 Gmail push into capture jobs (with fan-out to several connections).**

```mermaid
sequenceDiagram
  participant G as Gmail
  participant PS as Pub/Sub topic + pull subscription
  participant L as Listener (worker-capture)
  participant DB as Postgres (pg-boss)
  participant J as capture job handler (worker-capture)
  G->>PS: {emailAddress, historyId} on mailbox change
  L->>PS: streaming pull
  PS-->>L: notification
  L->>L: HMAC(lowercased address) → look up connections by address hash (never logs the address)
  L->>DB: for each connection (one or more: same inbox connected twice, or a joint inbox of two users, CAP-BR-6):<br/>enqueue "capture.gmail-sync" {connectionId}, queue policy "stately", key = connectionId
  L->>PS: ack (only after the enqueues committed)
  DB-->>J: job
  J->>G: history.list since stored historyId (token opened per D-19)
  J->>DB: write captured transactions, advance historyId (same tx)
  Note over L,DB: "stately": at most one queued + one active job per connection,<br/>so a notification during an active sync queues one more run instead of being dropped.<br/>Listener crash before ack: Pub/Sub redelivers. Metric gmail_push_received_total{matched}.
```

**F-5 Contract change to clients (D-6).**

```mermaid
flowchart LR
  A[Edit contract in packages/contract] --> B[pnpm contract:openapi<br/>writes openapi.json]
  B --> C[Commit contract + openapi.json + server implementation]
  C --> D{CI}
  D --> D1[Server type-check:<br/>implement contract fully]
  D --> D2[Regenerate openapi.json,<br/>fail if it differs from committed]
  D --> D3[oasdiff vs main:<br/>fail on breaking changes]
  D --> D4[Contract rules test:<br/>money fields int64, GET inputs URL-safe]
  D --> D5[Web type-check against contract]
  D --> D6[Android: generate Kotlin client<br/>from openapi.json, compile, test]
```

**F-6 Daily FX rates and late-arriving days (D-15).**

```mermaid
sequenceDiagram
  participant Cron as pg-boss schedule (UTC 00:30)
  participant WG as worker-general
  participant P as FX provider
  participant DB as Postgres
  participant M as Subscribed modules (budgets, reports...)
  Cron->>WG: platform.fx-rates-fetch {rateDate = yesterday (UTC)}
  WG->>P: historical rates for rateDate (USD base), timeout 10 s
  alt ok
    WG->>WG: parse losslessly as decimal strings; keep active ISO codes only; reject bad values
    WG->>DB: INSERT exchange_rates for rateDate (ON CONFLICT DO NOTHING: stored days are final)
    WG->>DB: enqueue fx.rates-added {rateDate, affectedFrom, affectedTo} for each subscribed module (same tx)
    DB-->>M: module recomputes derived values that used provisional rates in [affectedFrom, affectedTo]
  else fails
    WG->>DB: retry with backoff, up to 6 hours, then dead-letter + alert after 36 h without a new day
  end
```

## 7. Cross-cutting concerns

### 7.1 Authorization

- **The platform provides the plumbing; modules decide the rules.** Every procedure is built from one of three bases: `publicProcedure` (explicit allowlist only: in the contract, sign-up/sign-in-type procedures, client config and similar), `authedProcedure` (requires a principal from `identity`'s authentication hook), and `ownerProcedure` (product owner, for `admin`). Resource-level checks live in each module's service.
- **Default deny, tested:** an automated test enumerates every procedure in the contract and calls it without credentials; anything not on the public allowlist must return `UNAUTHENTICATED` (401). This is the structural fix for the unauthenticated `GET /users` (CR X-1).
- **Not found vs forbidden:** reading another user's resource returns `NOT_FOUND` (404), not `FORBIDDEN`, so IDs can't be probed (XC-15, ACC-BR-4). `FORBIDDEN` (403) is for resources the caller can see but can't change (for example a viewer editing an entry, ACC-BR-2). Idempotency keys are scoped per user, so they can't be used to probe other users' data either (D-13).
- **Workers** act as the system, with the user or account ID in the job payload; handlers re-read current state (for example that the source is still connected, the account not frozen) instead of trusting the payload.
- **Database roles (least privilege)** (`budmon_admin` is the owner's interactive role for maintenance, used over SSH only):
  - `budmon_migrator` owns the application schema and is the only role that runs DDL there (the deploy migrate step in production; the push onto empty development and feature-branch test databases).
  - `budmon_capture` (worker-capture, over TLS on its own network: a Compose network in stage 0, the private network from the capture VM in stage 1) has the grants `sources` and `capture` need, which include most financial tables, and never the credential tables (D-19's platform rule). pg-boss in worker-capture also connects as `budmon_capture`, with only the privileges to send, fetch, complete and fail jobs; its maintenance and scheduling are turned off there (they run only in worker-general as `budmon_queue`).
  - `budmon_queue` owns the `pgboss` schema; pg-boss's internal connections (fetching, maintenance) in the workers use it. Its runtime DDL (pg-boss maintenance creating and dropping objects) is confined to that schema.
  - `budmon_app` (API and workers) gets DML on the application schema, and on `pgboss` tables through default privileges granted by `budmon_queue` (so it can enqueue inside its own transactions).
- **Row-level security** isn't used in the MVP (D-23).

### 7.2 Money and currency

- **Storage:** `bigint` minor units plus the currency code; decimals from `currencies.minor_units` (D-14, PLT-BR-3).
- **In TypeScript:** a `Money` value `{ minor: bigint, currency: CurrencyCode }`; arithmetic only through helpers that reject mixed currencies; no `number` arithmetic on money. ESLint rules ban `parseFloat`, `Number(...)` and `bigint({ mode: "number" })` in money code paths.
- **On the wire:** JSON integers in minor units bounded to ±(2^53 − 1), declared `integer`/`int64` in OpenAPI through the shared money codec; `number` in the contract's TypeScript types; converted explicitly to and from `bigint` at two places only: the server's routers and the web app's data hooks (D-14).
- **Aggregates:** `SUM` over `bigint` returns `numeric`, which the driver returns as a string; repos parse it straight to `bigint` (exact). A value outside the wire range fails the response loudly (`INTERNAL`, reported) rather than losing precision.
- **Rounding:** only conversion, percentages and allocation produce fractions. Conversion and percentages use exact rational `bigint` arithmetic and round once, half-to-even. **Converting a set of amounts rounds each item, then sums** (so totals equal the sum of the converted amounts users see). Allocation uses largest remainder so parts sum exactly (TXN-BR-2).
- **Multi-currency and FX:** D-15 (date semantics, provisional conversions, recomputation). Applied rates on transfers are `transactions`' data (TXN-BR-7), never overwritten by market rates.
- **Formatting:** §4.7.

### 7.3 Consistency and transactions

- **Unit of work:** services open the transaction (`withTransaction`) and pass the handle to every repo and to `JobQueue.enqueue`; repos never open their own. This replaces the `getInstance()` singletons (CR §4.1).
- **Isolation:** `READ COMMITTED` by default; modules use `SELECT … FOR UPDATE` on rows they derive from, or request `SERIALIZABLE` for a specific operation. `withTransaction` retries serialization failures and deadlocks (40001, 40P01) up to 3 times with jitter.
- **Commit tracking:** the request context records whether any transaction committed during the request; the error interceptor uses it for `outcome` (D-21).
- **Jobs and data change together:** same-transaction enqueue (F-2); no outbox table.
- **At-least-once jobs:** every handler is idempotent: check state first, use unique constraints as guards, and record external side effects (such as "push sent") in the module's table in the same transaction that completes the work.
- **Derived values** (balances, budget progress) are maintained incrementally in the same transaction as the change (PD), and a scheduled reconciliation job per module recomputes from source rows, corrects drift, and counts corrections in `reconcile_corrections_total{module}`. Conversions are deterministic given the stored rates, and the `fx.rates-added` job (D-15) tells modules exactly which dates' conversions changed, so incremental values and reconciliation converge.
- **Idempotent creates:** per-user idempotency keys and records (D-13).

### 7.4 Time and time zones

- **Instants:** `timestamptz` in the database, `Temporal.Instant` in TypeScript, RFC 3339 with `Z` on the wire.
- **Calendar dates** (a transaction's date, a budget period's start): `date` in the database, `Temporal.PlainDate` in TypeScript, `YYYY-MM-DD` on the wire, `java.time.LocalDate` on Android; never converted through a time zone.
- **Time zones:** IANA names (`Africa/Cairo`), validated against the runtime's zone database. The user's zone lives in `identity`'s profile; changing it doesn't move stored dates (IDN-US-3).
- **"Today" and periods** are computed from the user's zone (XC-5) through an injectable `Clock`.
- **Servers and cron run in UTC.** Per-user local times (quiet hours, reminders) are computed by the owning module.
- **FX dates:** a transaction's calendar date is matched to the rate stored for that same date (a UTC day) without zone conversion (D-15).
- **Library:** Temporal, native where the runtime has it, otherwise the polyfill, behind `@budmon/shared` (D-16).

### 7.5 Privacy and security

- **PLT-BR-1 enforcement** (D-24): allowlist-only logging; values that print as `[redacted]`; telemetry configured to capture no bodies, query strings, headers or local variables; messages of unexpected errors dropped everywhere; sanitised job output; no sensitive values in URLs; infrastructure logging (Caddy, Postgres, Docker, Alloy) configured by checklist; an attribute allowlist in Alloy; a privacy canary suite in CI and a canary scan in the release rehearsal before each production deploy (D-41).
- **PLT-BR-2:** envelope encryption; the API seals with a public key and holds no credential that can decrypt; only worker-capture, through its own secret file, can unwrap through Google Cloud KMS (D-19), in every stage. From stage 1 worker-capture is on its own server: root on the main server can't decrypt capture secrets; root on the capture server can (audited, rate-alerted, revocable). In stage 0, anyone controlling the laptop can (accepted for the owner-only period).
- **Secrets:** never in git. Stage 0: per-service files outside the repository on the laptop. From stage 1: SOPS-encrypted files in the repository (age), decrypted only on the target server into per-service files readable only by that service's container user (D-20); CI and agents never hold the servers' decryption keys. Every stage-0 secret is replaced at the stage-1 gate.
- **Transport:** TLS for all client traffic (stage 0: Tailscale Serve's certificate for the tailnet name, inside the tailnet's own encryption; from stage 1: Caddy with Let's Encrypt), HSTS; Postgres isn't exposed outside the Docker network; all outbound integrations over TLS.
- **Host hardening (D-29):** stage 0: no inbound ports on the laptop (Tailscale only), Windows updates and Docker Desktop updates by the owner. From stage 1: SSH key-only with forced-command deploy keys; provider firewall (if any) plus host nftables allowing only 22, 80, 443 (and WireGuard) on the main server; unattended security upgrades; signed images verified on pull; the capture server accepts only SSH through the tunnel from the main server, with an egress proxy (D-19). Every stage: containers as non-root users with read-only root filesystems, `no-new-privileges`, all capabilities dropped, memory limits; the Docker socket is mounted into no container.
- **At rest:** exports are in a private bucket behind 15-minute presigned URLs (D-35) in every stage. Stage 0: the laptop's disk encryption (A-14) is the only at-rest protection, accepted by the owner. **From stage 1:** backups are encrypted client-side (D-30), and since VPS providers generally don't promise encryption at rest, the design adds its own (D-40): Postgres's data, pgBackRest's spool and the main server's age key live on a LUKS2-encrypted block device whose passphrase is only in memory after `budmonctl unlock`; the capture server's age key is only in tmpfs (D-20); provider snapshots and backups stay disabled. A copy of either disk therefore holds no usable data or key. This doesn't protect a running VM: root on the running main VM can read the database.
- **Job payloads** hold IDs only (D-10).
- **Hashing utilities** for `identity`: Argon2id for low-entropy secrets, HMAC-SHA-256 for high-entropy tokens, constant-time comparison, a random token generator (D-22).
- **Abuse protection:** rate limits, same-origin API (no CORS surface), headers, body limits, timeouts (D-22, D-36).
- **Errors** never leak internals (PLT-BR-8, D-21).
- **Data minimisation:** date of birth is dropped (spec §7 item 3); rate-limit keys and mailbox lookups use HMACs; telemetry retention capped at 30 days.
- **Android:** the local database (offline entries) is excluded from Android Auto Backup and device-to-device transfer, and never attached to Sentry reports.

### 7.6 Scale, performance and observability

- **Expected load (A-4):** stage 0: one user (the owner) on a laptop; stage 1: up to about 100 users, roughly 100 to 300 transactions per user per month, a few requests per second at peak, which one 4 vCPU / 8 GB main VM carries with large headroom.
- **Large tables (web):** a requirement (D-7): ledgers and reports render with virtualised rows and keyset pagination; targets in D-7.
- **Stage 2, the path to public scale** (not designed now; user: the pooler and the rest are considered "when we start thinking about making the application go public"): the stateless API (PLT-BR-6) and the queue behind an interface (PD) make scaling a deployment change: move Postgres from the main VM to a dedicated server or managed service with a replica; put a **transaction-mode connection pooler** (PgBouncer) in front (the code is pooler-safe and the CI pooler suite keeps it so, D-18); run several API containers or hosts behind a Hetzner Load Balancer; give each worker role its own host; put a CDN in front of the static SPA (path-based routing keeps `/api` on the origin). KMS, object storage, observability and the contract are unchanged. The non-infrastructure stage-2 items (row-level security, a staging environment, the formal accessibility audit, Google verification and security assessment) are listed in §12. Rough costs: D-29.
- **Indexes per query:** every module's LLD lists each query with the index that serves it; `pg_stat_statements` is enabled and reviewed after each module ships.
- **Latency targets:** §4.6; tracked with request-duration histograms per route template.
- **Observability** (D-24, D-25): OpenTelemetry traces and metrics plus pino logs from API and workers through Alloy to Grafana Cloud; host and Postgres metrics from Alloy; Sentry for errors from all three apps; W3C trace context from clients; email alerting.

## 8. Decisions

Decisions D-1 to D-4, the queue and worker part of D-9, D-11's push, the core of D-14, D-18's pooler, D-19's managed key, capture-only decryption and dedicated capture VM, D-29's three infrastructure stages, D-40's timing, D-39's non-blocking enforcement, and D-24's tool choices were **made by the user** (PD) and are recorded here with their rationale; they aren't reopened. The rest are the planner's proposals.

### D-1: PostgreSQL as the only database (user decision, PD)
- **Options considered:** PostgreSQL; MongoDB or another document store; PostgreSQL plus a document store.
- **Decision:** PostgreSQL. Flexible data (templates, extracted fields, budget rule conditions) goes in `jsonb`. Major version: the current stable major at implementation time (18 or later), pinned to the same major in local, CI and production.
- **Rationale:** the domain is relational and needs multi-row transactions (splits, transfers, balances); `jsonb` covers the flexible parts; the same database hosts the job queue (D-9).

### D-2: Node.js + TypeScript (user decision, PD), on Node 24 LTS with a planned move to 26
- **Options considered:** runtime: Node + TypeScript (chosen by the user); Kotlin/JVM; Go. Version: Node 24 (Active LTS until this month, then maintenance until April 2028); Node 26 (becomes LTS in October 2026).
- **Decision:** start on **Node 24 LTS**; move to Node 26 as a single pinned-version change (`engines`, `.nvmrc`, CI, Docker image) once it's LTS and the native and instrumented dependencies (`@node-rs/argon2`, pg-boss, OpenTelemetry instrumentations) support it, before the first production deploy if possible. TypeScript in strict mode with the review's settings kept (ESM, `module: nodenext`, `.js` import suffixes, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`). Production runs compiled JavaScript (`tsc -b`); development uses `tsx watch`.
- **Rationale:** the workload is I/O-bound (PD); one language across backend, web and contract lets the web app use the contract's types directly. Starting on the proven LTS avoids being first on a fresh major with native bindings; the move is cheap and planned.

### D-3: Fastify replaces Express (user decision, PD)
- **Options considered:** Express 5 (current), Fastify, Hono.
- **Decision:** Fastify, with `@fastify/helmet`, `@fastify/rate-limit`, `@fastify/cookie` (no `@fastify/cors`: the API is same-origin, D-36); oRPC's OpenAPI handler is mounted through its Fastify adapter. Fastify's built-in request logging is **disabled** (`disableRequestLogging`), replaced by the platform's allowlisted request log, and its logger uses the platform's serialisers for requests and errors (D-24).
- **Rationale (PD):** built-in pino logging, plugin encapsulation per module, `app.inject()` for in-process tests, better typing, mature plugins and OpenTelemetry instrumentation. Speed isn't the reason.

### D-4: oRPC contract-first, one OpenAPI-shaped wire protocol for both clients (user decision for oRPC; planner decision for the single protocol)
- **Options considered:** (a) oRPC serving both its native RPC protocol (web, `RPCLink`) and the OpenAPI protocol (Android); (b) only the OpenAPI protocol, with the web using `OpenAPILink`; (c) ts-rest (rejected by the user); (d) tRPC (the current stub; superseded).
- **Decision:** (b). The contract (`@orpc/contract`, zod 4 schemas) lives in `packages/contract`; the server implements it with `implement(contract)`; Fastify mounts only the `OpenAPIHandler` under `/api/v1`; the web uses `OpenAPILink` plus oRPC's TanStack Query integration. oRPC is pinned to an exact version.
- **Rationale:** with one protocol, the routes Android uses are exactly the routes the web uses and the tests exercise, and errors, dates and money are encoded once. The RPC protocol's richer native types (`Date`, `BigInt`) are things we don't want on the wire anyway, because Android needs plain JSON and money has its own codec (D-14).

### D-5: Monorepo with pnpm workspaces, no build orchestrator
- **Options considered:** (a) pnpm workspaces with plain scripts; (b) plus Turborepo or Nx; (c) separate repositories per app.
- **Decision:** (a). Layout:

  | Path | What | Package |
  | ---- | ---- | ------- |
  | `apps/server/` | API and workers (one codebase, several entry points). `src/platform/` holds the foundations (config, db, errors, observability, queue, crypto, http, storage, FX service, idempotency, rate limits); `src/<module>/` per spec module with `<module>Router.ts` (oRPC implementation; converts wire values to domain values), `<module>Service.ts`, `<module>Repo.ts`, `<module>Errors.ts`, `<module>Jobs.ts`, and `<module>Validators.ts` for server-only validation (third-party payloads); `src/db/schema/<table>.ts` (`<name>Table`, registered in `src/db/schema/index.ts`); `src/main/{api,worker,migrate}.ts`; `drizzle/` migrations; `test/` | `@budmon/server` |
  | `apps/web/` | SolidJS SPA (D-7) | `@budmon/web` |
  | `apps/android/` | Gradle project (D-8); not a pnpm package | (Gradle) |
  | `packages/contract/` | oRPC contract, zod schemas per module (`src/<module>/`), shared wire schemas (`src/common/`: money codec, dates, IDs, cursors, errors), contract-authoring rules, and the committed `openapi.json` | `@budmon/contract` |
  | `packages/shared/` | Pure helpers for server and web: `Money` and its arithmetic, formatting and wire conversion, time helpers, ID generation; `test-vectors/` (JSON) also read by Android tests | `@budmon/shared` |
  | `packages/config/` | Shared `tsconfig` bases, ESLint flat config, Prettier config | `@budmon/config` |
  | `images/` | Dockerfiles of every Budmon-built image (server image for api, worker and migrate; web; Budmon's Postgres image). Frozen across infrastructure stages with the application code (D-29 rule 1). | |
  | `infra/` | `compose.yaml` for local development; `deploy/<host-role>/` (`main`, `capture`: Compose files per infrastructure stage, Caddyfile, Alloy, proxy and nftables configuration, `pg_hba.conf`, `postgresql.conf`, deploy steps), packaged into the signed deploy bundles (D-29 rule 4); `deploy/bootstrap/` (the minimal forced-command bootstrap installed by cloud-init); cloud-init; `budmonctl`; `tofu/` (OpenTofu); `secrets/` (SOPS files) (D-20, D-29) | |
  | `docs/` | As today | |

  Root scripts: `pnpm dev`, `pnpm check`, `pnpm check:all`, `pnpm test`, `pnpm db:reset`, `pnpm db:seed` (development), `pnpm db:release-migration` (release and hotfix branches), `pnpm db:migrate` (deploy), `pnpm contract:openapi`. The review's layering (router → service → repo; only repos touch the database) is kept and enforced with an ESLint import-boundary rule.
- **Rationale:** a handful of packages doesn't need a task graph; Turborepo can be added later without restructuring. One repo keeps contract, server and clients changing in the same pull request, which makes the drift check (D-6) possible. Android stays a plain Gradle project because pnpm can't build it.

### D-6: Contract → OpenAPI → clients, kept in sync by CI; additive API evolution
- **Options considered:** OpenAPI file generated at build time only vs generated and committed; Kotlin client committed vs generated at Gradle build time; drift caught by people vs by CI.
- **Decision:**
  - `pnpm contract:openapi` generates `packages/contract/openapi.json` (OpenAPI 3.1, oRPC's generator with `@orpc/zod`'s zod 4 converter and the platform's schema overrides, D-14) and it's **committed**.
  - The **web** imports the contract package; its client is `OpenAPILink` typed from the contract.
  - The **Kotlin client** is generated during the Android build from the committed `openapi.json` (OpenAPI Generator, `kotlin`, Retrofit + kotlinx.serialization) into the build directory; never committed or hand-edited (PLT-BR-4).
  - **Contract-authoring rules,** checked by a contract test: no `.transform()` or other schemas that convert to an untyped JSON schema; every money field uses the shared money codec and appears as `integer`/`int64` in `openapi.json`; `GET` procedures take only URL-safe inputs (IDs, enums, dates, limits, cursors; D-24); every create declares the `Idempotency-Key` header; every procedure declares its errors.
  - **CI fails if:** the server doesn't implement the contract exactly; a freshly generated `openapi.json` differs from the committed one; `oasdiff` reports a breaking change against main (unless the pull request is labelled as intentionally breaking, which also requires raising the minimum client version, D-33); the contract rules test fails; the web app doesn't type-check; the Android app doesn't compile or its tests fail against the regenerated client.
  - **Runtime:** oRPC validates inputs and outputs against the contract's schemas.
  - **Evolution policy:** additive only (new procedures, new optional fields, new enum values that clients tolerate as "unknown"). A breaking change is a new procedure plus deprecation of the old one, removed only after the minimum supported Android version no longer uses it.
- **Rationale:** each piece fails at the earliest stage that can detect it; generating the Kotlin client at build time removes "forgot to regenerate" drift; breaking-change detection matters because Android installs lag behind deploys.

### D-7: Web app: SolidJS single-page app (user decision for Solid; planner decision for the stack), with virtualised large tables
- **Options considered:** (a) React + Vite SPA (v0.3); (b) **SolidJS + Vite SPA** (the user's choice: "sometimes the app will show big tables and performance will be crucial"); (c) vanilla TypeScript with no framework (raised by the user, rejected); (d) Svelte; (e) a server-rendered framework (Next.js, SolidStart).
- **Decision:** (b), a client-only SPA built with Vite and `vite-plugin-solid`, served as static files by Caddy from the same origin as the API (D-29, D-36). Stack (versions pinned in the LLD; the status of each was checked on 2026-10-05 where noted):

  | Concern | Choice | Notes |
  | ------- | ------ | ----- |
  | Framework | SolidJS **1.9.x** (stable; 1.9.15 on npm on 2026-10-05) | Solid 2.0 is at release candidate (`2.0.0-rc.13` on the `next` tag); migrate once 2.0 is stable **and** the libraries below support it (tracked as a risk, §9). |
  | Routing | TanStack Router for Solid (`@tanstack/solid-router` 1.170.x) | Typed routes; search parameters validated with zod schemas, which is where D-24's "URL-safe values only" rule is enforced. Alternative: `@solidjs/router`. |
  | Server state | TanStack Query for Solid (`@tanstack/solid-query` 5.104.x) through oRPC's TanStack Query integration (`@orpc/tanstack-query` 1.15.4, which supports Solid; `@orpc/solid-query` 1.15.4 also exists) | `OpenAPILink` client typed from the contract (D-4). |
  | Tables | TanStack Table **v9** (`@tanstack/solid-table` 9.2.x; its API differs from v8, so examples written for v8 don't apply) + TanStack Virtual (`@tanstack/solid-virtual` 3.13.x) | Headless; row virtualisation. |
  | Accessible primitives | **Kobalte** (`@kobalte/core` 0.13.14, Solid-native, WAI-ARIA patterns; pre-1.0) | React Aria has no Solid port. Alternative: Ark UI (`@ark-ui/solid` 5.39.x, actively released, Zag.js state machines, multi-framework). The LLD picks after a spike on dialog, combobox, date field and menu (§9). |
  | Styling | Tailwind CSS | Unchanged. |
  | Forms | TanStack Form for Solid (`@tanstack/solid-form` 1.33.x, stable v1) | Validates with Standard Schema, so the contract's zod 4 schemas plug in directly. Alternative: Modular Forms. |
  | i18n and formatting | `@formatjs/intl` (the framework-agnostic core of react-intl) behind a small Solid context; numbers and dates through `@budmon/shared` | ICU MessageFormat catalogs from day one (D-37); RTL rules and lint (D-38). |
  | Error reporting | `@sentry/solid` 11.4.x (official), with its TanStack Router integration | Configured per D-24 (no Session Replay, no console breadcrumbs, URLs without query strings). |
  | Tests | Vitest + `@solidjs/testing-library` + MSW; Playwright and axe unchanged | D-26. |

  **Large tables are a requirement.** Every unbounded list (transactions, captures, report drill-downs) is a virtualised table: only visible rows plus an overscan are in the DOM; data arrives through keyset pagination (D-32) as an infinite query that fetches the next page as the user nears the end; at most 5,000 rows (50 pages of 100) are kept in memory; pages outside that window are dropped and replaced by **placeholder rows of the same fixed height**, so the scrollbar, scroll position and `aria-rowindex` values stay stable; a placeholder page is refetched when it scrolls into view, and its real rows take the same indexes; sorting and filtering of unbounded lists happen on the server; client-side sorting is allowed only for lists bounded at 1,000 rows. Targets, verified by a Playwright performance test on a fixture of 100,000 transactions, in Chromium with fixed CPU throttling (4×) to reduce runner noise, run on release candidates rather than every pull request: first rows visible within 300 ms of the first page's response (median of 5 runs); while scrolling through 5,000 loaded rows, p95 frame time under 33 ms and no more than 5 long tasks over 100 ms; DOM row count under 200 throughout; after scrolling past the 5,000-row window and back, the same row is at the same `aria-rowindex`. Virtualised tables keep accessibility: `role="grid"` or `table` semantics with `aria-rowcount` (total if known) and `aria-rowindex` on rendered rows, and keyboard navigation that scrolls the focused row into view.

  Data hooks convert wire values to domain values (money to `Money`, dates to `Temporal`) in one place per procedure (D-14). After a create, hooks invalidate and refetch the affected list queries (D-13 returns only `{ id, createdAt }`). Router search parameters hold only URL-safe values (D-24); sensitive filters live in component state.
- **Rationale:** Solid's fine-grained reactivity updates only the DOM nodes whose data changed, with no virtual-DOM diff, which suits large, frequently updated tables; its JSX and component model keep the ecosystem benefits the stack needs (router, query, table, forms, Sentry). Vanilla TypeScript was rejected because Budmon would have to hand-build a component model, reactive state, routing, form handling and accessible widgets, which is a framework's worth of code to maintain, and it wouldn't make tables faster: table performance comes from virtualisation and server-side paging, which Solid supports directly. React (a) was the safer ecosystem choice but loses on rendering cost for big tables. A server-rendered framework adds a second server runtime for an app that's entirely behind sign-in. Costs: a smaller ecosystem (Kobalte is pre-1.0; fewer accessible-component options) and an upcoming Solid 2.0 migration.

### D-8: Android stack: Kotlin, Jetpack Compose, Room, WorkManager, generated Retrofit client
- **Options considered:** UI: Compose vs XML Views. Storage: Room vs SQLDelight vs DataStore. Networking: generated Retrofit client vs generated Ktor client (Multiplatform-ready) vs hand-written. Architecture: single-activity MVVM vs MVI frameworks.
- **Decision:** Kotlin, **Jetpack Compose** with Material 3, single activity, MVVM (`ViewModel` + `StateFlow`), **Hilt**, **Room** for the offline-entry outbox (TXN-US-10), **WorkManager** for sync, **Paging 3** over the cursor API for long lists (D-32), **OkHttp + Retrofit + kotlinx.serialization** through the generated client (D-6), Sentry Android SDK (D-24), minSdk 26. The Room database is excluded from Auto Backup and device transfer (data extraction rules). OkHttp's logging interceptor exists only in debug builds and never logs bodies. Debug builds point at the local API (`http://10.0.2.2:<port>`); release builds at the deployed API.
- **Rationale:** Compose, Room and WorkManager are the current Android defaults with the best testing support; WorkManager survives process death and reboots, which offline sync needs; Retrofit is OpenAPI Generator's most mature Kotlin target. Kotlin Multiplatform is deferred until iOS is scheduled (XC-21).

### D-9: pg-boss with separate worker processes in two roles (user decision for pg-boss and separate workers; planner decision for roles, database role and queue setup)
- **Options considered:** queue: pg-boss (user), BullMQ on Redis (revisit only if volume outgrows Postgres). Split: (a) one worker process; (b) one process per module; (c) two roles: capture and general. Schema ownership: application role with DDL rights; pg-boss's own role; pg-boss with runtime DDL features disabled.
- **Decision:** (c). One `worker` entry point started with `WORKER_ROLES`. Each job definition names its role; a worker only works its roles' queues. **pg-boss runs under its own database role `budmon_queue`, which owns the `pgboss` schema** (§7.1); its maintenance may create and drop objects inside that schema, an explicit and documented exception to PLT-BR-5 confined to it. Queues are **not partitioned** (avoids per-queue table creation). **In worker-capture** (whose secret file holds no `budmon_queue` credentials, in every stage) pg-boss runs as `budmon_capture` with send, fetch, complete and fail privileges only, granted through default privileges from `budmon_queue`, and with maintenance and scheduling turned off; maintenance and cron scheduling run only in worker-general. **Queues are created and updated by the schema step** (D-12: `pnpm db:migrate` when deployed, `pnpm db:reset` in development, test setup in CI), through a queue sync from the job registry as `budmon_queue`; workers never create queues and fail fast at start-up if a queue they need is missing. Scheduling uses pg-boss cron schedules (UTC), registered by the general role. Modules use only the platform's `JobQueue` interface (PD).
- **Rationale:** PLT-BR-2 is enforceable only if the capture worker is a separate container with its own secret file holding the only decrypt credential (D-19, D-20), so (a) doesn't work; (b) multiplies deployments for no benefit. pg-boss performs DDL at runtime (maintenance-created objects, deferred index creation), so a DML-only application role can't run it; a dedicated owner role keeps the application schema DDL-free while letting pg-boss work as designed. Creating queues in the schema step keeps all schema-affecting actions in one deliberate place.

### D-10: Transactional enqueue, payload rules, retention and idempotency
- **Options considered:** enqueue after commit (risk: lost jobs); an outbox table; enqueue in the same transaction.
- **Decision:** enqueue in the same transaction, using pg-boss's support for a caller-provided database executor (bound to the Drizzle transaction). **Payloads** hold only IDs, enums, dates and counts, validated by the job's zod schema on enqueue and on receipt; never amounts, payees, message content, tokens, emails or names (sensitive inputs go into the owning module's table, sealed where D-19 applies). **Job output:** the platform's handler wrapper catches every error and rethrows a sanitised one (D-24) so pg-boss only ever stores a key or class name, stack frames and an allowlisted code; it also discards handlers' return values (pg-boss would store them as the completed job's output), so completed jobs store nothing. Dead-lettered copies keep that sanitised output. **Retries:** exponential backoff, default limit 5, per-job override. **Retention:** finished jobs deleted after 7 days (`deleteAfterSeconds`); exhausted jobs copied to the role's dead-letter queue, which nothing consumes, so their lifetime is that queue's retention (30 days); a CLI lists and re-enqueues them. **Queue policies:** default `standard`; `stately` where "one queued plus one running per key" is wanted (F-4); singleton keys for deduplication. Handlers are idempotent (§7.3).
- **Rationale:** same-transaction enqueue is the simplest correct option and the main reason pg-boss was chosen (PD). The payload and failure-output rules keep pg-boss's tables outside PLT-BR-1's blast radius. pg-boss has one retention setting for finished jobs, so longer inspection lives in dead-letter queues.

### D-11: Gmail push via `watch` + Pub/Sub, received by a pull subscription in worker-capture (user decision for push; planner decision for pull)
- **Options considered:** polling (rejected by the user); Pub/Sub push subscription to an HTTPS endpoint; Pub/Sub pull (streaming pull) from a worker.
- **Decision:** a pull subscription consumed by a listener in worker-capture, which maps each notification's mailbox (by HMAC of the lowercased address) to every matching connection and enqueues one `stately` capture job per connection, acknowledging only after the enqueues commit (F-4). `watch` renewal and the safety-net sync are scheduled jobs designed by `sources`.
- **Rationale:** a push endpoint would have to live on the API (the only public HTTP surface), contradicting PLT-BR-6, and would need token verification. Pull keeps ingestion in the worker, needs no public endpoint, and gets redelivery for free; its backlog signals a dead listener (D-25).

### D-12: Keep Drizzle; schema synced directly in development, one reviewed migration per release for deployed environments; snake_case
- **Options considered:**
  - ORM: keep Drizzle; Kysely; Prisma; raw SQL with node-pg-migrate.
  - Migration workflow (PLT-US-7 and PLT-BR-5 in spec v0.10: migrations only where deployed data must be preserved): (a) a migration per schema change, committed with each change (v0.1's design); (b) **development and test databases built directly from the Drizzle schema, with one migration generated per release** capturing the net change since the last deployed migration; (c) no migrations at all, `push` everywhere (rejected: `push` can't express data-preserving changes and would change staging and production ad hoc).
  - Who writes the release migration and when: the person or agent merging each module; a release step when a release is cut; the deploy pipeline (rejected: a migration must be reviewed before it runs).
  - Handling `drizzle-kit`'s interactive prompts (it asks "rename or create?" whenever a column or table disappears and another appears, in `push` and in `generate`, including its programmatic API): answer them by hand (impossible for agents and CI); avoid them by only pushing onto empty databases; answer them mechanically ("create" for every ambiguity) through a pseudo-terminal driver and fix renames by hand; write every release migration by hand (`generate --custom`).
- **Decision:** keep **Drizzle ORM** with `node-postgres`; database identifiers become `snake_case` (Drizzle's `casing: "snake_case"`), TypeScript properties stay camelCase. Workflow **(b)**:
  - **The rule (PLT-BR-5, spec v0.10):** deployed schemas (only production, in every infrastructure stage; the owner's real data exists from stage 0's first deploy, D-29) change only by applying committed, reviewed release migrations through the deploy pipeline, and every release migration preserves existing data; development and test databases are disposable and built directly from the current schema.
  - **Prompts are never answered interactively.** Development and test databases are only ever built by **pushing onto an empty database** (no existing tables, so no ambiguity and no prompt). Migration generation (`db:release-migration` and the pending-changes report) runs `drizzle-kit generate` under a **pseudo-terminal driver** that answers "create" to every ambiguity and lists each ambiguity it answered; renames are then hand-edited into the migration as the Release migration notes require. If the driver stops working with a `drizzle-kit` upgrade, the fallback is a hand-written migration (`generate --custom`), which release check (i) still verifies.
  - **Development (local, feature and module branches, main between releases):** no migration files. `pnpm db:reset` drops the local database and rebuilds it with the development schema step (push onto the empty database), then seeds it. There is no incremental `db:sync` (it would prompt). `db:reset` refuses to run unless the target is a local or test database (`APP_ENV` is `development` or `test` and the host is local or a test container); deploy images contain no push command; deployed environments' DDL-capable credentials never reach developer tools.
  - **Release step** (accepted by the user; the `/release` command that runs it is drafted when there's something to release). A release is cut as branch `release/<version>` from main and opened as a pull request **into main**. In it:
    1. the **software-engineer** runs `pnpm db:release-migration`, which generates **one** migration, `NNNN_<version>.sql`, with the net schema change since the last released snapshot, and hand-edits it for data-preserving changes a schema diff can't express: renames, backfills, `NOT NULL` on existing columns (add nullable → backfill → set `NOT NULL`), type changes with conversion; destructive "contract" steps (dropping what the previous release's code still uses) are deferred to a later release so the migration is compatible with old code during rollout (expand then contract). What each module needs is listed in its LLD's **Release migration notes**, which the **planner** writes and keeps current, including when an implementation-time amendment changes a table;
    2. the **test-architect** writes the **upgrade test** and its fixtures: fixture data in raw SQL written against the **previous release's** schema (factories follow the current schema, so they can't be used), under `apps/server/test/upgrade/<version>/`, with assertions that the data survived as the Release migration notes specify;
    3. the **code-reviewer** reviews the migration; the **user** merges.
    - Branch protection requires the release pull request to be **up to date with main** before merging, so any schema change merged to main meanwhile forces an update and re-runs the release checks (and the migration must be regenerated if check (i) fails). The pipeline creates the release tag on the merge commit only after **re-running check (i) on that exact commit**; the deploy uses that commit.
    - Before the first release there are no migrations; the first release migration is the baseline.
    - Drizzle's migrator runs all pending migrations in one transaction, so `CREATE INDEX CONCURRENTLY` isn't available; plain index builds are acceptable at this scale, and a release needing a concurrent build would do it in a separate, documented step.
  - **Hotfix branches (user decision: built from the last release).** An urgent fix to a deployed release branches as `hotfix/<version>`, where `<version>` is the hotfix's own tag (`vX.Y.Z-hotfix.N`, with `X.Y.Z` the release it fixes and `N` counting from 1), from **the last deployed tag of any kind** (release, hotfix or infrastructure-only, D-29 rule 5), because main may hold unreleased schema changes, and so a hotfix never ships deploy bundles that lack infrastructure changes or secret rotations already deployed. It follows the release rules: it may carry its own migration (generated against the last released snapshot), and it gets the same checks, release rehearsal (D-41) and approval. Its pull request targets `main` and stays open while the hotfix is checked, tagged on the branch head and deployed; that same pull request is then merged as the merge-back, which is **exempt from the "no migration files" rule** (it brings the migration, its Drizzle snapshot and the schema change together). The migration journal stays linear because a release can't be cut while a hotfix or infrastructure-only merge-back is pending, and the next release migration is generated against the hotfix's snapshot.
  - **The schema step**, the same in every environment, run by `pnpm db:migrate` (deploy, a one-off job before rollout, never on start-up) and by `db:reset` and test setup (development and CI): (1) idempotent roles and grants; (2) **deployed and release-path test databases:** Drizzle's migrator applying committed migrations as `budmon_migrator`; **development and feature-branch test databases:** push of the current schema onto the empty database; (3) the queue schema: pg-boss's own install or upgrade SQL for the pinned pg-boss version, applied as `budmon_queue` (pg-boss starts with automatic migration off); (4) idempotent reference data (the `currencies` list from a committed data file); (5) the queue sync (D-9). pg-boss's schema is never part of Drizzle's migrations; it's versioned by the pinned pg-boss version.
  - **pg-boss upgrades** ship in a release that changes nothing else (a "queue upgrade release"). During its deploy, the deploy script turns the maintenance switch on (D-29: Caddy answers `/api/*` with `503 SERVICE_UNAVAILABLE`, J-7; Android keeps recording offline) and stops both worker roles before the schema step, then rolls out the new API and workers and lifts maintenance. This takes minutes and means no process on the old pg-boss version ever touches the upgraded schema, without depending on pg-boss's cross-version compatibility.
  - **CI enforcement** (D-27):
    - *Feature and module pull requests:* any change under `apps/server/drizzle/` fails the build. Test databases are built by pushing the current schema onto an empty database (D-26). A non-blocking "pending schema changes" report (what the generator, through the driver, would produce now, with its list of ambiguities) is attached to the pull request so the coming release's data-preserving work is visible early.
    - *Release and hotfix pull requests:* (i) a database built from **committed migrations only** must match the current schema exactly (generating again produces nothing); (ii) the full test suite runs on a template built from migrations only; (iii) the test-architect's upgrade test: build the previous release's database from its migrations, load its raw-SQL fixtures, apply the new migration, assert; (iv) a **risky-statement check** fails on `DROP TABLE`, `DROP COLUMN`, `RENAME`, `ALTER … TYPE`, `SET NOT NULL`, `ADD COLUMN … NOT NULL` without a default, and constraints added without `NOT VALID`, unless the statement carries a `-- reviewed:` comment explaining why it's safe, which the user sees when merging.
    - *Hotfix merge-back pull requests:* exempt from the "no migration files" rule. Main may already hold further unreleased schema changes, so equality with the schema isn't expected; the check is that the committed migrations (now including the hotfix's) apply cleanly to an empty database and that the hotfix's changes no longer appear in the pending-schema-changes diff.
    - *Deploy:* the pipeline re-runs check (i) in CI on the tagged commit; the deploy script (D-29) runs only `pnpm db:migrate`, which verifies the recorded journal and hashes against the image and fails if the database records a migration the image doesn't have.
- **Rationale:** Drizzle is in use, SQL-shaped, type-safe, and its snapshots make "net change since the last generated migration" what `generate` produces, so one migration per release falls out naturally. Syncing development databases from the schema removes migration churn while modules are built, as the user asked, while production changes only through reviewed, committed, tested migrations. Pushing only onto empty databases and driving `generate` mechanically removes every interactive prompt from agent and CI paths. Requiring up-to-date release branches and re-checking the tagged commit closes the gap where a schema change merged during an open release would be deployed without its migration. Isolating pg-boss upgrades trades a few minutes of maintenance for not having to trust cross-version compatibility. Cost: data-preserving work is deferred to release time; the Release migration notes, the pending-changes report, the upgrade test, the risky-statement check and the release rehearsal (D-41) are the mitigations (§9).

### D-13: Server-generated UUIDv7 IDs; per-user idempotency keys for creates, storing only a minimal result
- **Options considered:** IDs: integer identity (current); UUIDv4; UUIDv7; ULID. Safe retries of creates: (a) clients supply the new entity's ID and the server compares a replay with the current entity; (b) per-user idempotency keys with a stored record. What the record stores: the full response; only a minimal fixed result.
- **Decision:** UUIDv7 primary keys generated by the server's injectable ID generator; reference tables use natural keys. Creates are made retry-safe with **(b)**:
  - Every create-type procedure requires an `Idempotency-Key` header (a UUID the client generates per user action) and **returns a fixed minimal shape: `{ id, createdAt }`**. Clients read the created entity through the normal, authorised read procedures when they need it.
  - In the create's transaction, the service calls the platform's idempotency helper, which inserts `(user_id, key, procedure, request_hash)` into `idempotency_records` before the work (concurrent duplicates wait on the primary key) and stores `{ id, createdAt }` and the status after it. `request_hash` is SHA-256 of the canonical, validated input (keys sorted, defaults applied).
  - A replay is answered **from the record**: same procedure and hash → the stored `{ id, createdAt }` with the original status and `Idempotent-Replayed: true` (the replayed body goes through the router's normal output validation); different procedure or hash → `409 IDEMPOTENCY_KEY_REUSED`. The current entity is never consulted: a later edit doesn't cause a false conflict, a later deletion isn't undone, and losing access to a shared account means the follow-up read returns `NOT_FOUND`.
  - Keys are scoped per user, so another user's key reveals nothing. Records expire after 90 days. Requests that fail don't leave a record (the transaction rolls back).
  - **Android** stores each offline entry's request body **as first serialised** in the Room outbox, with its key, and resends those exact bytes, so an app update that serialises differently can't cause a false `IDEMPOTENCY_KEY_REUSED`. Entries older than 60 days aren't auto-sent (J-4).
- **Rationale:** offline sync and web retries need creates that are safe to repeat. Option (a) leaked existence across users, gave false conflicts after edits and resurrected deleted entries. Storing only `{ id, createdAt }` keeps the record free of financial data (so it can't outlive an entry's deletion or a user's loss of access, D-17), keeps it independent of the wire format (the service has the ID and timestamp; the router still owns domain→wire conversion, D-14), and makes replays trivially valid. Cost: one extra insert per create, and clients make a follow-up read when they need the full entity.

### D-14: Money as 64-bit integer minor units; bigint in code; bounded JSON integers on the wire via one shared codec (user decision for the representation; planner decision for the mechanism)
- **Options considered:** code: `number` restricted to safe integers; `bigint`; a decimal library. Wire: (i) JSON integers; (ii) decimal strings. Mechanism for (i) with oRPC: a zod `bigint` schema (oRPC's JSON-schema converter emits `type: string` with a pattern, and the OpenAPI client serialiser sends bigints as strings, so Kotlin would get `String` and the web would see strings); a `.transform()` (becomes an untyped `{}` schema); a `number` wire schema with an explicit JSON-schema override and explicit conversion.
- **Decision:**
  - **Database:** `bigint` (Drizzle `bigint({ mode: "bigint" })`). **Server and `@budmon/shared`:** `bigint` in `Money`.
  - **Wire:** JSON integers, through **one shared money codec** in `packages/contract/src/common/money.ts`: the wire schema is `z.number().int()` bounded to ±(2^53 − 1); it's registered with the zod 4 JSON-schema registry (or the oRPC converter's override hook) so both input and output schemas are emitted as `{ type: "integer", format: "int64", minimum: −9007199254740991, maximum: 9007199254740991 }`. The contract therefore types amounts as `number`.
  - **Conversion is explicit, in exactly two places,** with `toMoney(minor: number, currency)` and `toWire(money)` from `@budmon/shared`: in each server module's router (wire → domain before calling the service, domain → wire on the way out), and in each web data hook (§D-7). No `.transform()` in contract schemas. Kotlin gets `Long`.
  - Out-of-range input returns `VALIDATION_FAILED`; out-of-range output fails loudly (§7.2).
  - The first contract slice includes this shape in its spike (§9): emitted `openapi.json`, generated Kotlin type, and the web's inferred type.
- **Rationale:** `bigint` makes exact FX conversion possible (a large amount times a scaled rate overflows `number`'s exact range). JSON integers keep both clients simple. The codec makes the wire format a single, tested piece of code rather than a convention, and keeping conversion out of the contract keeps the emitted JSON schema exact. The bound (about 90 trillion units of a 2-decimal currency per value) is the one place the API is narrower than 64 bits, and only on the wire (A-8).

### D-15: Currency reference data and market rates are owned by the platform, with defined date semantics
- **Options considered:** ownership: `accounts`, `transactions`, `reports`, or the platform. Rate date for a daily fetch: store "latest" under the fetch day; store the provider's historical rate for the UTC day that just closed. Late-arriving rates: overwrite and let modules drift; treat stored days as final and notify modules of new days; have modules snapshot the rate they used.
- **Decision:**
  - The platform owns `currencies`, `exchange_rates`, the fetch jobs, and `FxService.convert(money, toCurrency, onDate)` (PLT-US-8). The provider sits behind an interface with a fake for tests.
  - **The rate of date D** is the provider's end-of-day (historical) rate for the **UTC day D**, stored under `rate_date = D`. The daily job runs at 00:30 UTC on D+1 and fetches D. A transaction's calendar date is matched to the rate of that same date without time-zone conversion (§7.4).
  - **Stored days are final:** insert-only; the application never overwrites a stored day.
  - **Conversion for date D:** if D's rate is stored, it's used (`provisional: false`). Otherwise the latest stored date before D is used and the result is marked `provisional: true` with its `rateDate`. (Today's conversions are always provisional until tomorrow's fetch.) If no earlier rate exists either (a back-dated entry before the first stored date), the result is "no rate" and a historical backfill job for D is enqueued.
  - **When new days are inserted** (the daily fetch or a backfill), the platform enqueues an `fx.rates-added` job for each module that registered a handler, with the date range whose conversions just changed (`affectedFrom` = the new date, `affectedTo` = the day before the next stored date, or open-ended). Modules that store converted values (`budgets`' incremental progress) recompute exactly that range; modules that convert on read (`reports`) need no handler. Because conversion is deterministic given stored rates, incremental values and reconciliation converge.
  - **Lossless parsing:** provider responses are parsed so rates stay decimal strings (no float step), stored as `numeric(24,12)`; only active ISO codes in `currencies` are stored (no metals, SDR or crypto); zero, negative or unparseable rates are rejected.
  - **Rounding:** per converted item, then summed (§7.2).
  - **Provider** (researched 2026-10-05; free-plan terms to be confirmed when signing up):

    | Provider | Coverage (EGP?) | Historical daily rates | Price | Notes |
    | -------- | --------------- | ---------------------- | ----- | ----- |
    | **Open Exchange Rates** (primary) | About 170 currencies, EGP included | Free plan: daily historical; Developer: back to 1999 | Free: 1,000 requests/month, USD base; Developer $12/month, 10,000 requests | Mature, USD base fits the pivot design (D-15); free-plan licence for this use to confirm. |
    | **`fawazahmed0/exchange-api`** (fallback) | 200+ codes, EGP included | Any date, served as static files by date | Free, CC0, no key, no rate limit | Community-run, no SLA, aggregated sources; used only when the primary fails. |
    | ExchangeRate-API | About 160, EGP included | Historical data on paid plans (as remembered; unverified) | Free 1,500 requests/month; paid from about $10/month | Free tier reported as non-commercial. |
    | Frankfurter / ECB-based | About 30, **no EGP** | Yes | Free | Rejected: coverage. |
    | currencyapi.com and similar | EGP included | Paid plans | Free tier non-commercial | No advantage over the primary. |

  - **Cost model (user: store only the relevant historical rates if that allows a cheaper service; use a standard currency-to-USD daily rate as much as possible).** The cost driver for every provider is the number of **API requests**, not storage: one request returns every currency against USD for one date. So:
    - **Daily:** one historical request per day for the UTC day that just closed (about 30 a month), storing every active ISO currency's rate against USD (about 160 to 170 rows a day, about 60,000 a year, a few MB). Storing only the currencies in use wouldn't reduce requests, and keeping all of them means a user who later adds an account in another currency, or back-dates an entry, needs no extra request for days already stored.
    - **Back-dated entries before the first stored day:** fetched **on demand, one request per date actually needed**, deduplicated (a date requested by many conversions is fetched once), from the free, quota-less **`fawazahmed0/exchange-api`** (CC0), with `provider` recorded on the stored day, so backfills never consume the Open Exchange Rates quota. Until a date is filled, conversions for it return **"no rate"** (not provisional, per the conversion rule above). If the fallback lacks a date, it stays "no rate" and a metric counts it.
    - Open Exchange Rates is then used only for the daily request (about 31 a month), far below the free plan's 1,000 requests a month, so **the Open Exchange Rates free plan is enough (cost $0)**. If its terms turn out not to allow Budmon's use when signing up, the free fallback becomes the primary rather than paying; a paid plan is only considered with the user.
  - The adapter for each provider sits behind the same interface; the fallback is tried only after the primary has failed for 6 hours, and every stored day records its `provider`.
  - **Gap check** (added in v1.1 for the laptop stage, harmless on servers): a platform job, run when worker-general starts and once a day, enqueues a backfill for every day missing between the latest stored day and yesterday (UTC), at most 31, because pg-boss doesn't replay cron runs missed while the host was off. Backfills use the quota-free fallback provider, as above.
- **Rationale:** at least four modules need conversion; none should own the others' dependency. Fixing the date semantics and finality makes conversions reproducible, and the explicit "rates added" signal is what keeps incrementally maintained budget progress consistent with reconciliation. Using UTC days for rates is an accepted approximation (a rate is a market's daily figure, not a user's local day).

### D-16: Time representation and the Temporal API
- **Options considered:** `Date` plus date-fns and `@date-fns/tz`; Luxon; Temporal (native or polyfill).
- **Decision:** storage and wire as in §7.4; in TypeScript, **Temporal** (`PlainDate` for calendar dates, `Instant` for instants, `ZonedDateTime` for period boundaries) behind `@budmon/shared`, with an injectable `Clock`. Use the runtime's native Temporal where present (checked for the pinned Node version and supported browsers when the LLD is written), and `@js-temporal/polyfill` otherwise (expected at least for some browsers). Android uses `java.time`.
- **Rationale:** Temporal's types match the domain's distinction between a calendar date and an instant, and mirror `java.time`. `Date` conflates the two, the classic source of off-by-one-day bugs. Cost: polyfill bundle size where native support is missing.

### D-17: Deletion conventions: hard delete by default, explicit lifecycle states, explicit `onDelete`
- **Options considered:** a global soft-delete column; hard delete everywhere; hard delete by default with status columns and targeted soft delete.
- **Decision:** the third option (§3.3). Every foreign key's `onDelete` is chosen and justified in the LLD that creates it.
- **Rationale:** XC-16 promises erasure; a global soft delete would keep data forever and leak into every query. Status columns express real states that stories need anyway.

### D-18: No connection pooler in stages 0 and 1; pooler-safe code and sized pools; the pooler is a stage-2 item (user decisions: "none at launch"; "we can take this into consideration later when we start thinking about making the application go public")
- **Options considered:** PgBouncer on its own VM; PgBouncer co-located with a worker; no pooler with pools sized against `max_connections` (the user's choice).
- **Decision:** no pooler in production in infrastructure stages 0 and 1 (D-29); a transaction-mode pooler is considered in stage 2 (§7.6), when going public is being planned. Pools are sized so the total stays well under Postgres's `max_connections` (100): API 10, worker-general 5 plus pg-boss 3, worker-capture 5 plus pg-boss 3 (from its own network in stage 0, from the capture VM in stage 1), migrate step 2, Alloy's Postgres exporter 1, `budmon_admin` sessions 3: 32 in total, leaving room for a second API container and a restore drill. Code stays **pooler-safe** (transaction-mode discipline: no session-level `SET`, advisory locks only transaction-scoped, no `LISTEN`, no named prepared statements across transactions), checked by the CI pooler compatibility suite (D-26), so adding a transaction-mode PgBouncer in stage 2 is a deployment change, not a code change. Local development connects directly (no PgBouncer in compose).
- **Rationale:** with one VM and a handful of processes, a pooler adds a component without reducing anything; keeping the discipline and the CI suite costs little and preserves the scaling path (§7.6).

### D-19: Envelope encryption; the API seals with a public key; only worker-capture can unwrap through Google Cloud KMS, on its own VM from the stage-1 gate (user decisions: managed key, capture-only decryption, Q-2 scope accepted; dedicated Hetzner capture VM "right before I start inviting people", Q-15)
- **Context:** on one VM, root on that VM could decrypt capture secrets (v0.5's residual risk). The user asked for the recommended way to avoid it, is willing to add one or two servers, and asked whether running the capture worker on Google Cloud would be better.
- **Options considered (key mechanism):**
  - (A) **Remote Google Cloud KMS with an asymmetric key** (RSA-OAEP 3072, SHA-256): any process seals locally with the public key (no credentials, no network call); only worker-capture holds a credential with `cloudkms.cryptoKeyVersions.useToDecrypt` on that key.
  - (B) **Local asymmetric envelope** (X25519 sealed boxes / HPKE): the API has the public key; the private key is a file only worker-capture can read. No external dependency.
  - (C) Remote symmetric KMS with separate encrypt-only and decrypt credentials (v0.3): the API would hold a credential, which (A) avoids.
  - (D) A local symmetric key only in worker-capture, with the API sending plaintext to worker-capture to seal (rejected: plaintext crosses into a job or a call).
- **Options considered (where worker-capture runs):**
  - (P1) On the main VM in its own container (v0.5): root on the main VM, which also holds the database, can decrypt.
  - (P2) **A dedicated small server** at the stage-1 provider, for worker-capture only.
  - (P3) **Google Cloud Run** with a workload identity.
- **Comparison of (P2) and (P3):**

  | Aspect | (P2) dedicated small server | (P3) Google Cloud Run |
  | ------ | ------------------------- | --------------------- |
  | Decrypt credential | A service-account key file (or X.509 workload identity federation), in tmpfs on the capture VM. | None: Cloud Run's workload identity; no key file exists anywhere. |
  | Database access | Over a WireGuard tunnel to the main server's Postgres; Postgres isn't reachable from the internet. | Over the internet to the main VM: Postgres must listen publicly with TLS client-certificate authentication, plus an IP allowlist through Cloud NAT with a static IP. The main VM, which holds all financial data, gains a public database port. |
  | Pub/Sub | Streaming pull (outbound). | Push to a Cloud Run endpoint (OIDC-verified) and scale to zero possible. |
  | Queue work (SMS processing, backfills, exchanges via pg-boss) | Polls pg-boss continuously. | Needs at least one always-on instance to poll pg-boss (instance-based billing, about €45 to €50 a month), or a redesign of how capture jobs are triggered. |
  | Patching and host security | Owner patches an Ubuntu VM (unattended upgrades). | Google manages the host. |
  | Latency per query | About 1 ms (same region, through the tunnel; est.). | About 5 to 15 ms per round-trip (a Google region to the server's region, estimate), across many queries per sync. |
  | Cost | About €4 to €8 a month for a small VPS (est., provider-neutral). | About €45 to €50 a month plus Cloud NAT and a static IP (estimates). |
  | Who can decrypt | Root on the capture VM (the owner, or an attacker who compromises that VM); the deploy path. Root on the main VM can't. | Whoever controls the Google project or the Cloud Run deploy; root on the main VM can't. |
- **Decision:** **(A) in every stage; (P2) from the stage-1 gate** (user, Q-15: "we'll do it on its own hetzner server right before I start inviting people"). In **stage 0** worker-capture runs as its own container with its own secret file on the owner's laptop (the (P1) shape, D-29), which the user accepted for the owner-only period. Stage 0 uses **real Google Cloud KMS** (D-29 rule 5), so envelopes sealed on the laptop open on the capture server without re-sealing; everything in code below (sealing, the exchange in worker-capture, `budmon_capture`, proxy support, egress rules) is the same in both stages, and only the network and host items marked "stage 1" differ.
  - **Capture server (stage 1):** a small VPS in the same provider region as the main server, joined to it by a **WireGuard tunnel** (`wg0`, static keys, fixed `/30` addresses; D-29). **No inbound traffic from the internet** except the WireGuard port from the main server's public address. Whatever firewall the provider offers is an extra; **host nftables rules on both servers** do the filtering:
    - the capture server accepts SSH only on `wg0` from the main server's tunnel address;
    - the main server accepts Postgres connections on `wg0` only from the capture server's tunnel address, enforced in Docker's `DOCKER-USER` chain because Docker-published ports bypass the normal input rules. The capture VM runs `worker-capture`, an `egress-proxy` (HTTP CONNECT proxy with **per-client hostname allowlists**: worker-capture may reach only Google OAuth, Gmail, Cloud KMS, Pub/Sub and Sentry; the host's Docker daemon only GitHub Container Registry; apt only the Ubuntu mirrors; Alloy only Grafana Cloud), and Alloy. Host nftables allow outbound traffic only from the proxy, plus WireGuard to the main server and NTP to the provider's or a public NTP pool. **DNS** is available only to the proxy; worker-capture has no resolver and reaches the proxy and Postgres by fixed addresses (`extra_hosts`), so DNS can't be used as an exfiltration channel. **Proxy support in each client** is wired into the code unconditionally from the first slice, so turning the proxy on at stage 1 is configuration only (D-29's stage rule); with no proxy variables (stage 0) the clients connect directly. Checked in the crypto slice's spike and exercised by every release rehearsal (D-41): `@grpc/grpc-js` (Pub/Sub, KMS) via `grpc_proxy`/`https_proxy`, honouring `no_grpc_proxy`/`no_proxy`; `gaxios` (Google OAuth and Gmail REST) via `HTTPS_PROXY`; Node's `fetch` via undici's `EnvHttpProxyAgent` set as the global dispatcher at start-up; Sentry's Node transport via its proxy option. A client that ignores the proxy simply has no route out. **Stage-1 worker-capture configuration** also sets `NO_PROXY`, `no_proxy` and `no_grpc_proxy` to the local Alloy endpoint and `db.budmon.internal`; otherwise the OTLP exporters (gRPC and HTTP) would try the egress proxy, which refuses them.
  - **Database role `budmon_capture`:** connects with TLS in every stage (server certificate from a private CA kept offline by the owner, clients use `sslmode=verify-full`) and a password from its secret file, over a network of its own: the internal `capture-db` Compose network on the laptop in stage 0, the WireGuard tunnel in stage 1. `pg_hba.conf` accepts it only (`hostssl`) from worker-capture's address: its fixed container address in stage 0, the capture VM's private address in stage 1. Creating a captured transaction runs `transactions`' service (balances and budget progress in the same transaction), and capture also reads time zones and locales, auto-confirm settings (REV-US-8), feature switches (ADM-US-7), frozen-account state, manual entries for duplicate checks (CAP-US-6) and classification, and enqueues notifications. So **`budmon_capture` can read and write most financial data**; what it never gets is **credential material**. **Platform rule (binding on `identity` and every module):** credential data (password hashes, sessions and refresh-token hashes, two-step verification envelopes, recovery codes, invitation and reset token hashes) lives only in dedicated tables that `budmon_capture` is never granted; if any credential column ever has to live in a shared table, column-level grants exclude it. The exact grants are listed in the `sources` and `capture` LLDs.
  - **Key material:** the capture service-account key file, the Google OAuth client secret, and the `budmon_capture` password live only in worker-capture's secret file (D-20), mounted into that container only. In stage 1 only the capture server can decrypt that file (SOPS), so the main server has none of them; in stage 0 the file sits on the laptop next to everything else (accepted). The API and worker-general have only the public key in every stage.
  - The Google Cloud project that Gmail and Pub/Sub need anyway (D-11) hosts the KMS key. **Pub/Sub** uses the same capture service account, with `roles/pubsub.subscriber` on the Gmail subscription only.
  - **Service-account key availability:** Google Cloud organisations created since 2024 enforce `iam.disableServiceAccountKeyCreation` by default; if Budmon's project sits under one, the key file can't be created without overriding that policy. The crypto slice's spike checks this first; fallbacks are workload identity federation with an X.509 client certificate held by the capture VM, or option (B). The same applies to FCM's credential (D-20).
  - `api-secrets` (two-step verification secrets, which the API must verify at sign-in): a **local symmetric key** in the API's secret file only; it protects against a database or backup leak, not against a compromised API.
  - **Envelope format** (both keys): per-secret random 256-bit data key, AES-256-GCM, associated data binding table, row and purpose; wrapped data key, nonce, ciphertext and key version in one versioned `bytea` envelope.
  - **OAuth exchange** in worker-capture (F-3).
  - **Plaintext handling:** plaintext exists only in local variables for the duration of an operation; never logged, persisted unsealed, or put in job payloads. Data keys are `Buffer`s zero-filled after use; JavaScript strings can't be wiped (accepted). worker-capture may cache a decrypted refresh token in memory for up to 1 hour per connection; access tokens are memory-only.
  - **Rotation:** a new KMS key version; a worker-capture job re-wraps envelopes, then the old version is disabled. `api-secrets` re-wrap is a one-off command with the API's secret file.
  - **Egress (confused deputy):** worker-capture sends tokens and message content only to destinations fixed in configuration, enforced in code, by the egress proxy's allowlist, and by the host firewall. User-hosted AI endpoints (XC-12) need their own design (flagged for `capture`).
  - **Detection and response:** from the stage-1 gate (gate item 8), Cloud Audit Logs data-access logging on the key and a Cloud Monitoring alert that emails the owner on an abnormal decrypt rate (Google Cloud configuration only). Runbook: disable the key version and the service-account key, rotate the OAuth client secret, re-seal, ask users to reconnect.
  - **Threats with this design, per stage:**

    | Threat | Stage 0 (owner only) | Stage 1 (invite-only) |
    | ------ | -------------------- | --------------------- |
    | Database or backup leak | Sealed secrets stay sealed (no key material in the database or backups). | Same. |
    | API or worker-general compromise (application-level, without root) | Can't decrypt capture secrets: those containers have only the public key, and worker-capture's secret file isn't mounted into them. Exposes the data those processes can read. | Same. |
    | **Administrator on the host** (stage 0: the owner's Windows session or malware on the laptop; stage 1: root on the main server) | Can read worker-capture's secret file, so can decrypt the owner's capture secrets until the KMS key file is revoked (every decrypt is audit-logged in Google Cloud), and can read all data. Accepted for the owner-only period. | Can't decrypt capture secrets: the main VM has only the public key. Exposes all other data on the main VM. |
    | Root on the capture VM, or worker-capture compromise | (worker-capture compromise) Can decrypt capture secrets while present, and with the stolen key file until it's revoked; can read and write financial data through `budmon_capture`, but not credentials. | Same, and every decrypt is audit-logged and rate-alerted. |
    | Copy of the host's disk (stage 0: a lost or stolen laptop) | Protected only by the laptop's own disk encryption (A-14); without it, exposes everything. Every stage-0 secret is replaced at the gate, and the laptop's KMS key is deleted (D-29 gate items 9 and 11). | Main VM: Postgres data is on a LUKS volume whose key is only in memory (D-40) and the age key is on that volume; nothing usable. Capture VM: its age key is only in tmpfs (D-20); nothing usable. |
    | The deploy path | The owner builds and runs a release on the laptop from a tag reachable from `main` (`budmon-local upgrade`, D-29); there's no remote deploy path. | Same, and the capture VM accepts only a signed release's tag (D-29). |
  - **Manual unlock after reboots** is the stage-1 operational cost of the disk protections (D-20, D-40); stage 0 has none.
  - **Local development and tests** use a local key provider behind the same interface; configuration refuses it when `APP_ENV` is `production`.
- **Rationale:** (A) keeps the API unable to decrypt with no credential at all, and adds audit, rate alerting and instant revocation. (P2) moves the only decrypt credential off the host that holds the database for about €6 a month (from the stage-1 gate, when other people's data arrives), without exposing Postgres to the internet. (P3) would remove the key file, which is its real advantage, but it forces a public database port on the main VM (the more valuable target), costs about eight times as much, and adds cross-cloud latency to every capture query; it becomes attractive only if the database moves to a managed service with private connectivity (scaling path, §7.6).

### D-20: Configuration and secrets: validated at start-up; SOPS-encrypted secret files per service
- **Options considered (secret storage on servers, from stage 1):** (a) GitHub environment secrets written to the VM by CI at deploy; (b) **SOPS with age**: encrypted files in the repository, decrypted on the VM with a host-held key; (c) files maintained by hand on the VM; (d) a secrets service (Vault, Infisical, a cloud secret manager).
- **Decision:**
  - **Validation:** one zod schema per process kind (API, worker-capture, worker-general, migrate) built from shared parts, parsed once at start-up; on failure the process prints the **names** of missing or invalid variables and the rule each broke (never values) and exits non-zero before opening any port or connection. Secret-typed values print as `[redacted]`. Secrets are read from files (`*_FILE` variables pointing at Compose secret mounts); non-secret settings from environment variables. `.env.example` lists every variable that's read, with safe development values; a test checks schema and example list the same variables.
  - **Stage 0 (laptop):** no SOPS. `budmonctl secrets init-local` creates per-service secret files at `~/.budmon/secrets/<host-role>/<service>/<KEY>` inside WSL2 (mode 0400, outside the repository, on the encrypted laptop disk, A-14). The owner fills in the externally issued ones. Compose mounts each service's directory into that service only, strictly by host role, so no main-side container reads a capture file. Nothing is ever committed, and CI's secret scanning (below) applies.
  - **Storage from stage 1: (b).** `infra/secrets/<deployment>/<host-role>/<service>.sops.yaml`, one file per service, encrypted to two age recipients: the key of **the VM that runs that host role in that deployment** and the owner's personal key (kept with an offline copy).
    - `<host-role>` is `main` or `capture`.
    - `<deployment>` is one set of values for one set of hosts: `prod-s1` (the stage-1 servers) or `dryrun` (the throwaway dry-run servers, D-29 gate item 4).
    - Each host's `/etc/budmon/host.env` names its deployment and host role(s), and the deploy bundles carry every deployment's encrypted files for their role, so a host can only open its own set.
    - In `prod-s1` the main server can't decrypt the capture files and vice versa.
    - A new set of hosts gets a new deployment set; a set that running hosts still use is never re-encrypted.
  - **Stage-0 secrets at the gate:** the stage-1 servers get fresh values for every secret not tied to data, and the data-bound `api-secrets` key is rotated after the cutover (D-29 gate items 9 and 11).
  - **Where the VM keys live, stage 1:** the main VM's age key is stored on its LUKS-encrypted data volume (D-40), so it's available only after the volume is unlocked; the capture VM's age key is only in tmpfs. **Unlocking after a reboot** is done from the owner's own machine, **one SSH session per VM**: `ssh owner@main budmonctl unlock` (prompts for the main volume's passphrase), and `ssh -J owner@main owner@capture budmonctl unlock` (prompts for the capture VM's age key). The jump through the main VM forwards an end-to-end encrypted SSH connection, so the capture key is never typed into, or visible to, any process on the main VM; host keys of both VMs are pinned in the owner's `known_hosts`; agent forwarding is disabled. A small script on the owner's machine runs both sessions in sequence. Until a VM is unlocked its stack doesn't start (D-40). In stage 1, unattended upgrades install security updates but never reboot; a "reboot required" alert reminds the owner, who reboots and unlocks when convenient (D-40).
  - The deploy script decrypts each file on its VM into a tmpfs directory readable only by that service's container user, and Compose mounts it into that container only. **Strict host-role separation, in every stage:** no container of the `main` role ever reads a file under `capture/`, and vice versa, even in stage 0 where one VM can decrypt both. The CI release rehearsal (D-41) decrypts each role's files with a separate throwaway age key in a separate step, so any cross-role read fails in CI. CI, agents and developers never hold the VMs' age keys. Development uses `.env` files (`node --env-file`) with throwaway values; the CI release rehearsal (D-41) uses throwaway secrets generated per run.
  - **Process-specific secrets:**
    - `main`, the API's file: the `api-secrets` key, the cursor key, the **rate-limit HMAC key** and the presigning (read-only) key.
    - `main`, worker-general's file: the erasure-log and export write keys and FCM's service-account credential.
    - `main`, the Postgres container's file: the backup repository key and passphrase, and the **Postgres server TLS key and certificate** (SAN `db.budmon.internal`, issued by the owner's offline private CA).
    - `main`, the migrate container's file: the migrator password and the **SCRAM-SHA-256 verifiers** of every login role.
    - `capture`, worker-capture's file: the capture service-account key, the Google OAuth client secret, the `budmon_capture` password, the **mailbox-lookup HMAC key** (F-4) and the private CA certificate it verifies against.

    Modules that add a key state in their LLD which file holds it and whether it's rotated, using the rules below.
  - **Role passwords** reach Postgres only as **SCRAM-SHA-256 verifiers** held on the main side. The schema step (`pnpm db:migrate`, D-12) applies them with `ALTER ROLE … PASSWORD '<verifier>'`, so no main-side process ever holds `budmon_capture`'s plaintext password; only worker-capture's own file has it. `budmonctl secrets rotate-role <role>` runs on the owner's machine with the owner's age key. It generates a password, writes the plaintext into the using service's file and the verifier into migrate's file, and both are deployed by the next deploy (an ordinary or infrastructure-only release). **Every deploy, including an infrastructure-only one, runs the schema step** (D-29 deploy step 4), and it runs before any container restarts (step 5). So the new verifier is in Postgres before worker-capture restarts with the new password. Existing connections stay authenticated, and new connections from the old worker-capture fail only for the seconds until step 5, which it retries. `budmonctl` lives in `infra/` (run on the owner's machine from a checkout), and the verifier step is part of `pnpm db:migrate` in the server image; both ship from the first release and are exercised by the rehearsal (D-41).
  - **Rotation rules for each key** (all commands ship in the images from the first release and are exercised in CI before the gate, D-29 rule 3 (f)):
    - *Rotated by replacement, no data to convert:* the cursor key (open cursors fail with `VALIDATION_FAILED` and clients restart the list), the rate-limit HMAC key (counters reset), the presigning and B2 keys, the Postgres server TLS key, role passwords (as above), the capture service-account key and OAuth client secret (new ones issued in Google Cloud, old ones deleted).
    - *Rotated with a re-wrap command:* the `api-secrets` key (D-19's one-off re-wrap with the API's secret file); the KMS key version (a worker-capture job, D-19).
    - *Deliberately kept:* the **mailbox-lookup HMAC key**. Rotating it would make every stored mailbox hash unmatchable without a re-hash, and that needs plaintext addresses only worker-capture sees during a sync. A leaked key only lets someone confirm a guessed address against stored hashes they'd also need, and in stage 0 the only address is the owner's. It's kept across the gate and has no re-key command; if it ever has to change, that's a `sources` design item.
    - *Not secrets:* **Sentry DSNs** are public identifiers by design (they only allow sending events, and they're built into the web bundle and the Android app), so they're never rotated. Sentry's source-map upload token lives only in CI.
- **Leak checks:** CI runs a secret scanner over the repository and over every built image's layers (for example gitleaks and trivy's secret scanner); a finding fails the build.
- **Rationale:** PLT-US-5 and CR X-5. SOPS gives versioned, reviewable secret changes without a secrets service, keeps decryption on the VMs, and maps one file to one container on one VM, which is what D-19's split needs. From stage 1, keys that are only in memory or on an encrypted volume keep a copy of either disk useless. Option (a) would put every production secret in CI; (c) isn't reproducible; (d) is more infrastructure than an invite-only deployment needs.

### D-21: Error model: `BudmonError` keys become oRPC error codes; nothing internal leaks; the outcome is reported
- **Options considered:** keep `BudmonError` with a custom body; adopt oRPC's error envelope; RFC 9457 problem details.
- **Decision:** keep `BudmonError(key, status, message, details)` and map it onto **oRPC's error envelope** (`code` = key, `status`, `message`, `data` = details), so both clients decode errors without custom code. Keys are `UPPER_SNAKE_CASE` and globally unique; each procedure declares its errors in the contract. Platform keys: `VALIDATION_FAILED` 400 (`data.issues: [{ path, code, message }]`, never input values), `CLIENT_UPDATE_REQUIRED` 400 (D-33), `UNAUTHENTICATED` 401, `FORBIDDEN` 403, `NOT_FOUND` 404, `CONFLICT` 409, `IDEMPOTENCY_KEY_REUSED` 409, `PAYLOAD_TOO_LARGE` 413, `RATE_LIMITED` 429 (with `Retry-After`), `INTERNAL` 500, `SERVICE_UNAVAILABLE` 503.
  - **Any non-`BudmonError`** becomes `INTERNAL` with a fixed generic message and `data.outcome`: `not_applied` if no transaction committed during the request, otherwise `unknown` (for example output validation failing after commit). Clients word the message from `outcome` (§4.9).
  - **oRPC's validation errors** carry the input or output in their `cause`; the interceptor builds `issues` (path, code, message) and **discards the cause** before anything is logged or reported. Output validation failures are reported with issue paths and codes only.
  - **Malformed request bodies** (JSON parse errors) return `VALIDATION_FAILED` with a fixed message, never the parser's message (it quotes the body).
  - Every response carries `X-Request-Id` (the trace ID). `message` is developer-facing English; clients map keys to wording.
- **Rationale:** keeps the pattern the review said to keep, fixes X-3 and X-4 structurally (one interceptor), and the `outcome` field stops clients from claiming "nothing was changed" when they can't know.

### D-22: Security baseline: rate limits shared through Postgres, same-origin API, headers, limits, hashing utilities
- **Options considered (rate-limit storage):** per-instance memory only; Redis; Postgres; the cloud's edge rate limiting (paid).
- **Decision:**
  - **Rate limits:** a coarse per-instance in-memory limit per IP on all routes, plus **shared limits in Postgres** (`rate_limit_counters`, fixed windows) for sensitive operations, per IP and per target account (email HMAC). Modules declare limits per procedure in their LLDs. Exceeding a limit returns `RATE_LIMITED` with `Retry-After`. The client IP comes from Caddy's `X-Forwarded-For`, trusting exactly one hop (the `caddy` container's network address).
  - **CORS:** none; the web app and API share one origin, and the API answers no preflights (D-36).
  - **Headers:** helmet on the API (`Content-Security-Policy: default-src 'none'`, `X-Content-Type-Options`, `Referrer-Policy: no-referrer`, HSTS); Caddy serves the SPA with a strict CSP (no inline script; `connect-src 'self'` plus the Sentry endpoint), HSTS and `Referrer-Policy: no-referrer`.
  - **Limits:** JSON body 100 kB by default (per-route override in the LLD), request timeout 30 s, Fastify's default header and URL limits.
  - **Hashing utilities:** Argon2id (`@node-rs/argon2`, OWASP parameters) for passwords and recovery codes; HMAC-SHA-256 for high-entropy tokens; constant-time compare; 256-bit random token generator. `identity` decides where each is used.
- **Rationale:** stateless instances need shared counters for limits to mean anything (US-13); a Postgres upsert per sensitive request is cheap at this scale, with no new infrastructure. Argon2id is the OWASP recommendation and avoids bcrypt's 72-byte truncation.

### D-23: Authorization plumbing in the application; no row-level security in the MVP
- **Options considered:** application-level checks only; Postgres row-level security as defence in depth.
- **Decision:** application-level checks with default-deny procedure bases and the "every procedure rejects anonymous callers" test (§7.1), plus cross-user authorization test cases in every LLD. RLS revisited before any public launch.
- **Rationale:** RLS with transaction pooling needs per-transaction `SET LOCAL`, policies joining account memberships and shared vocabularies, and a worker bypass: significant complexity for an invite-only MVP whose rules are still being designed module by module. The default-deny test addresses the failure that actually happened (CR X-1).

### D-24: Observability: OpenTelemetry, pino, Sentry and Grafana Cloud, with PLT-BR-1 enforced in layers (user decision for the tools and the rule; planner decision for the enforcement)
- **Options considered (enforcement):** guidelines and review only; deny-list redaction; allowlists plus automated canary tests; an OpenTelemetry Collector with a redaction processor as an extra layer.
- **Decision:**
  - **Backend tooling:** OpenTelemetry Node SDK (HTTP server and client, Fastify, `pg`, pg-boss instrumentation) exporting traces and metrics by OTLP to Grafana Cloud; pino logs to stdout and Grafana Cloud with `trace_id`; Sentry Node SDK for errors, linked by trace ID.
  - **Layer 1: allowlist logger.** Modules get a typed logger whose fields come from a closed set of safe keys (IDs, enums, counts, durations, error keys, booleans). Importing `pino` directly or using `console` is an ESLint error outside the observability folder. Fastify's own request logging is disabled; the platform's request log records method, route template, status, duration, client kind, request ID and internal user ID only.
  - **Layer 2: values that can't leak by accident.** `Money` and the secret wrapper print `[redacted]` from `toString`, `toJSON` and Node's inspect hook.
  - **Layer 3: sensitive-data boundaries**, each a rule with a test:
    1. *Unexpected errors carry no message.* On the server and in both apps, errors that aren't `BudmonError` (or a client's own typed errors) are reported and logged as type, stack frames and an allowlisted code only (for example Postgres SQLSTATE, Node `errno` code, HTTP status); their `message` is dropped, because messages of runtime errors can contain values (a `RangeError` with an amount, a `SyntaxError` quoting a body, Android's `NumberFormatException` with the input). Database driver errors lose `detail`, `where`, `parameters` and query text. Third-party SDK errors (Google's Gaxios errors carry request config and the bearer token) are serialised through an allowlist: HTTP status, provider reason code, retryable flag.
    2. *Job failures are sanitised* by the handler wrapper before pg-boss stores them (D-10); pg-boss's `error` event is logged through the same serialiser.
    3. *Validation errors* lose their `cause` (which holds the input or output) before logging or reporting (D-21).
    4. *No sensitive values in URLs:* paths and query strings carry only IDs, enums, dates, limits and encrypted cursors (§5.2, D-32), because URLs end up in Caddy's access logs, browser history and breadcrumbs. Web router search parameters follow the same rule. **One stated exception** (amended during implementation of platform: LLD A-4, requested by the identity HLD's PA-4): `GET /api/v1/auth/google/callback?code&state`, because Google's redirect necessarily carries them. Mitigations: the code is single-use, bound to the PKCE verifier and client secret and exchanged within seconds; `state` is single-use; request logs, spans, Sentry URLs and Caddy's access log drop query strings; `Referrer-Policy: no-referrer`; the handler answers with a `303` away from the URL. Stage 0 checks that Caddy's and Tailscale Serve's logs keep no query strings.
    5. *Outbound calls:* HTTP client spans and breadcrumbs record scheme, host and path only, never query strings (provider API keys and Gmail search strings live there).
    6. *Telemetry configuration:* span names and `http.route` use templates; no headers or bodies recorded; database spans keep parameterised SQL text, never parameter values; custom span attributes go through the allowlist.
    7. *Sentry in all apps:* `sendDefaultPii: false`, no request bodies, no local variables, no attachments; **no Session Replay on web**; **no screenshots or view hierarchy on Android**; web console breadcrumbs off; navigation breadcrumbs and transaction names stripped of query strings; a `beforeSend`/`beforeBreadcrumb` that keeps only allowlisted fields.
    8. *Postgres server logs:* `log_error_verbosity = terse` (no DETAIL lines such as "Failing row contains…"), `log_min_error_statement = panic` (failing statements aren't logged), `log_statement = none`, `log_parameter_max_length = 0` and `log_parameter_max_length_on_error = 0`.
    9. *Infrastructure logs*, configured by a checklist kept with the deploy files: Caddy access logs record method, path without query string, status, duration and upstream timing, with all request and response headers removed; Caddy's error (default) logger gets the same filters, since reverse-proxy errors can include request details; `Authorization` and `Cookie` stay redacted (Caddy's default; credential logging is never enabled); Postgres settings per rule 8 in the committed `postgresql.conf`; pgBackRest at `info` level (no data); Docker `json-file` rotation (3 × 10 MB per container) as the only local copy; Pub/Sub without message logging; the host's SSH and system logs stay on the host (journald, 14 days).
    10. *Alloy allowlist:* Grafana Alloy relays all OTLP data and collects container logs, and drops any span or log attribute and any metric label outside the platform's allowlist before export, a second, independent copy of rules 1, 5 and 6.
  - **Layer 4: canaries.** The **privacy canary suite** (CI) drives real flows (API requests, worker jobs, failures and unexpected errors, including a failing job) with canary values in every sensitive field, captures all logs, an in-memory span and metric exporter, Sentry's test transport, **and `pgboss.job` output**, and fails if any canary appears. Each module's LLD adds its flows. Web and Android have unit tests on their Sentry scrubbers. The **release rehearsal** (D-41) runs the same canary flows against the production-shaped Compose stack built from the release images and scans everything, unfiltered and filtered: every container's Docker log, Caddy's access and error logs, Postgres and pgBackRest logs, Alloy's exported output, captured Sentry events and `pgboss.job` output; a hit blocks the release. In production, Alloy's dropped-attribute and dropped-label counters are exported, and **any drop alerts** (D-25): a drop means a layer 1 to 3 rule was broken upstream.
  - **Clients:** web and Android report errors to Sentry (one organisation, one project per app) with the internal user ID only (A42), and send a W3C `traceparent` header so client errors line up with server traces. They don't export spans in the MVP.
  - **Retention:** Sentry and Grafana Cloud at their free-plan retention (30 days or less, confirmed when the accounts are set up); local container logs a few days at most (rotation by size); host journald 14 days; Pub/Sub messages 7 days. The privacy policy says operational logs keep internal IDs, never names or financial data, for up to 30 days.
  - **Grafana Alloy on each VM** is the collector: apps export OTLP to it, it adds the allowlist layer (rule 10), ships container logs, and collects host metrics (node exporter subset) and Postgres metrics (postgres exporter, via a read-only monitoring role).
- **Rationale:** guidelines fail silently; deny-lists miss new field names (and message scrubbing by pattern is a deny-list); allowlists fail closed. The canaries are what make the rule hard to break: a new log line, span attribute, job failure or infrastructure setting that carries a payee fails CI or blocks the release.

### D-25: Metrics cardinality, latency targets and alerting
- **Options considered (alerting):** none; Sentry alerts only; Grafana Cloud alerting to email; push to the owner's phone. Capture health: job failures; notification silence; connection state gauges.
- **Decision:**
  - **Metric labels (PLT-BR-7):** only bounded values: `service`, `environment`, `http_route` (template), `method`, `status_class`, `client_kind`, `queue`, `job_state`, `module`, `error_key` (bounded by the error catalog), `source_kind` (gmail/sms), `connection_status` (an enum owned by `sources`), `age_bucket` (24h/72h). Never user IDs, emails, amounts, account or connection IDs, raw paths or instance IDs. Histograms use 6 fixed buckets. Each LLD lists its metrics and labels; the platform keeps a series budget under 5,000 of the free tier's 10,000.
  - **Core metrics:** HTTP count and duration; queue depth, job duration and outcomes, `jobs_dead_lettered_total`; `gmail_push_received_total{matched}`; `fx_rates_fetched_total`; worker heartbeat; `reconcile_corrections_total`; **`capture_connections{source_kind, connection_status}`** and **`capture_connections_stale{source_kind, age_bucket}`** (active connections with no successful sync in 24 or 72 hours), computed every 5 minutes. **A successful sync** is defined per source kind: for **Gmail**, any completed sync run for the connection, including the safety-net sync when there's no new mail, with a requirement on `sources` that the safety-net sync runs at least every 6 hours per active connection; for **SMS**, a sync only happens when a bank SMS arrives, so SMS staleness is shown on the dashboard but **excluded from alerting** in the MVP (an app heartbeat is `sources`' option later). The gauges are computed by a worker-general job from counts only. Node runtime metrics. **Host and database metrics** (via Alloy): disk usage, memory, CPU steal, Postgres connections, replication-free WAL size, last successful backup and WAL archive time.
  - **Token expiry is connection state, not job failure:** when a sync finds a refresh token expired or revoked, the job completes and the connection moves to a "needs reconnect" status that the user sees (`sources` designs the state and prompt). So expected expiries (§9, Gmail publishing status) never dead-letter or alert; they show on the dashboard as counts.
  - **Alerting (accepted by the user):** Grafana Cloud alerting, email to the product owner, on: API health check failing for 5 minutes (Grafana synthetic check); a worker heartbeat missing for 5 minutes; Gmail notifications backing up (oldest unacknowledged older than 15 minutes); **any active Gmail connection stale for 24 hours**; any job dead-lettered in a capture queue, or more than 5 dead-lettered in any queue in an hour; API 5xx above 5% for 10 minutes; no new FX day for 36 hours; KMS errors in the last 15 minutes. **Added for self-hosting:** disk usage above 80%; memory above 90% for 10 minutes; Postgres connections above 80% of `max_connections`; no successful backup for 26 hours; WAL archiving failing for 15 minutes; TLS certificate expiring within 14 days (Caddy renews automatically; this catches failures); any attribute or label dropped by Alloy's allowlist (D-24). All of the above apply **from stage 1** (D-29). **Stage 0 (the laptop) has no Grafana Cloud, no Alloy and no alert rules**, because the laptop sleeps and an uptime alert would fire every night. The owner learns of errors through **Sentry's own e-mail notifications for new issues** (free plan, default issue alerts on). Gmail capture health is visible in the app once `sources` designs its connection status. **Added at the stage-1 gate** (D-29 gate item 8, before the cutover; alert rules only, no code): reboot required on either VM (D-20, D-40); the capture worker's heartbeat alert is relabelled for the capture VM; disk usage above 80% on the 20 GB data volume (separately from the root disk); the **KMS decrypt-rate anomaly**, a Google Cloud Monitoring alert by email on the key's data-access audit logs (D-19). In stage 1 a **locked** VM can't send anything (its Grafana credentials are behind its key), so being locked appears as the external synthetic check failing (main VM) or the capture heartbeat missing; while the main VM is locked, the 26-hour backup alert also fires and WAL archiving is paused (Postgres isn't running).@@@END
 The deploy script silences the health alert during deploys (D-29).
  - A second, independent uptime check is deferred.
  - **Stage 0 (the laptop) has no alert rules** (D-29). So that capture failing silently is still noticed, `sources` reports a Gmail connection becoming stale (no successful sync for 24 hours, the definition above) as **one Sentry event per connection per staleness episode** (error key `CAPTURE_CONNECTION_STALE`, connection id only, no mailbox or address data); Sentry's new-issue e-mail is then the alert. The event stays in stage 1 alongside the alert rule. A requirement on `sources`' LLD.
- **Rationale:** the backlog alert catches a dead listener; the stale-connection alert catches what a backlog can't (an expired watch, a broken sync, a token problem the code didn't classify) because it measures the outcome, successful syncs; treating expiry as state avoids weekly false alarms. All within free tiers.

### D-26: Test tooling (foundation for the test-architect)
- **Options considered:** Vitest vs Jest vs `node:test`; database isolation by rollback, truncation, or a database per test file from a template; Testcontainers vs an always-running database.
- **Decision:**
  - **TypeScript (server, packages, web unit and component):** **Vitest**; web component tests with Testing Library and MSW (handlers typed from the contract).
  - **Server integration tests** against **real Postgres** (same major as production), started by **Testcontainers** from Vitest's global setup, both locally and in CI (GitHub's runners have Docker); `TEST_DATABASE_URL` can point at an existing server instead. Global setup builds a template database with the schema step (D-12): on feature and module branches, a **push of the current schema onto an empty database** (no prompts are possible); on `release/*` and `hotfix/*` branches, **committed migrations only**; in both cases with roles, the `pgboss` schema, reference data and queues; each test file gets its own database created from the template, connecting **directly** (not through PgBouncer); tables are truncated between tests within a file. API tests run in-process through Fastify's `inject()`. pg-boss runs for real in queue tests; job handlers are also unit-tested as plain functions.
  - **Pooler compatibility suite:** a small integration suite runs through a PgBouncer container in transaction mode (with a wildcard database entry, so per-file databases resolve) covering transactions, transactional enqueue, pg-boss fetch and maintenance.
  - **Determinism:** injectable `Clock` and ID generator; every external integration (KMS, Pub/Sub, Gmail, OAuth, FX provider, object storage, FCM, email, Sentry transport) behind an interface with an in-memory fake. Factories per table in `apps/server/test/factories/`.
  - **Dependency injection:** D-31.
  - **Web end-to-end:** **Playwright** against the real API, workers and a database built by the schema step (D-12), started by Playwright's `webServer`, with `@axe-core/playwright` checks on each screen whose findings are reported and never fail the run (D-39).
  - **Web table performance test:** a Playwright test on a 100,000-row fixture checks D-7's statistical targets under fixed CPU throttling, on release candidates (time to first rows, p95 frame time and long tasks while scrolling, DOM row count, stable `aria-rowindex` across dropped pages).
  - **Android:** JUnit, MockK and Turbine for ViewModels; Room and Compose UI tests on the JVM with Robolectric; OkHttp MockWebServer for the generated client; a small instrumented smoke suite on an emulator, run on release candidates.
  - **Shared test vectors** (`packages/shared/test-vectors/*.json`) for money formatting, rounding, conversion and the wire codec, run by both TypeScript and Kotlin suites.
  - **Release rehearsal** (D-41): the production Compose stack in CI, owned by the platform; the test-architect owns its upgrade fixtures and assertions.
  - **Production roles in tests:** integration tests connect as `budmon_app`, `budmon_capture` and `budmon_queue` with production grants (created by the schema step), never as a superuser, so a missing grant fails in CI.
  - **Platform-owned suites every module extends:** privacy canary (D-24), default-deny (§7.1), contract rules (D-6).
- **Rationale:** Vitest handles ESM and TypeScript natively; a database per file gives real-Postgres fidelity without rollback isolation's pitfalls (pg-boss and services open their own transactions); one mechanism (Testcontainers) in both places avoids local/CI divergence; the pooler suite proves D-18 without slowing every test.

### D-27: CI on GitHub Actions
- **Options considered:** GitHub Actions; GitLab CI; Google Cloud Build.
- **Decision:** GitHub Actions (A-3), on every pull request and on main. Steps (called steps to avoid confusion with D-29's infrastructure stages), failing fast:
  1. install (pnpm, cached); format check (Prettier), lint (ESLint, including layering and logging rules), type-check (`tsc -b`);
  2. contract checks (D-6), env-example check (D-20), and the migration checks for the branch type (D-12): on feature and module pull requests, "no migration files changed" plus the pending-schema-changes report; on `release/*` pull requests, migrations reproduce the schema, the destructive-statement check, and (in step 4) the upgrade test;
  3. unit tests (all TypeScript workspaces);
  4. server integration tests (Testcontainers), including the privacy canary, default-deny and pooler compatibility suites;
  5. web end-to-end (Playwright, Chromium; all three browsers on release candidates), including the pseudo-RTL run (blocking) and axe checks (reported only, D-39);
  6. Android (when `apps/android/`, `packages/contract/` or `packages/shared/test-vectors/` changed, and on release candidates): ktlint and Android lint (its accessibility category set to non-fatal, so neither CI nor `./gradlew check` fails on it, D-39), Kotlin client generation, unit and Robolectric tests, `assembleDebug`;
  7. release rehearsal (D-41) on `release/*` and `hotfix/*` pull requests, in its **stage-0 shape** (the laptop topology) from the first release. **Stage 0:** after the merge, `tag.yml` re-runs D-12's check (i) on the merge commit and tags it with `GITHUB_TOKEN`; nothing is built for deployment in CI, because the owner builds the tagged release on the laptop (`budmon-local upgrade`, D-29). **From stage 1** (D-29 rule 4), this step becomes the full release pipeline: tagging restricted to a GitHub App behind a ruleset and the `tag-approval` environment; images and deploy bundles built, rehearsed in the server topology, then signed; signatures verified; the user's approval in the protected `production` environment; the forced-command SSH deploy; and the Android build uploaded to distribution. Infrastructure-only releases (`vX.Y.Z-infra.N`) exist from stage 1.
  `pnpm check` runs steps 1 to 4 locally; `pnpm check:all` adds end-to-end and Android (`./gradlew check`). Main is protected: required checks green before merge (the user merges).
- **Rationale:** PLT-US-12; path filters keep the slow Android job off unrelated changes while catching contract and test-vector changes; slower suites run on release candidates rather than nightly.

### D-28: Local development: compose for infrastructure, one command for the stack
- **Options considered:** everything in containers; infrastructure in containers and apps on the host; dev containers.
- **Where development happens:** on the owner's Windows laptop, **inside WSL2** (D-29: the repository clone, Node, pnpm and Docker Desktop's WSL integration); the same commands work on any Linux or macOS machine and in CI. The development stack is a separate Compose project (`budmon-dev`) with its own database, published on `localhost:5432` for host-run apps. The stage-0 production stack on the same laptop publishes no database port, so `db:reset`'s local-host guard can never reach the production database.
- **Decision:** `infra/compose.yaml` (replacing the root `compose.yaml`) runs Postgres (the same pinned image as production, D-29) and **Mailpit** (local SMTP with a web inbox, so developers and QA can follow invitation and reset links). Apps run on the host with hot reload; Vite's dev server proxies `/api` to the local API, so the web app is same-origin locally as in production (D-36). `pnpm dev` starts compose, waits for the database, builds the schema with the development schema step (D-12: push onto an empty database, no migrations) if it doesn't exist, seeds development data (idempotent), then runs the API, one worker with both roles, and the web dev server. Integrations default to local stand-ins: KMS → local key provider; FX → fixed sample rates; email → Mailpit; FCM → logged no-op; object storage → a local filesystem store under `.data/` served by a development-only route; Gmail → disabled unless real development credentials are configured. Android builds against the local API from the emulator. The README documents prerequisites (Node, pnpm via Corepack, Docker, JDK and Android Studio) and commands. Seed data is a platform framework; modules add their rows in their own slices.
- **Rationale:** PLT-US-2; host-run apps keep hot reload and debugging simple; the pinned image keeps the database identical to CI and production; stand-ins let anyone run Budmon with no cloud accounts.

### D-29: Hosting and deployment: three infrastructure stages over one invite-only codebase; stage 0 on the owner's Windows laptop, stage 1 on a provider chosen at the gate (user decisions: one environment with no staging, three infrastructure stages over two code stages, stage 0 on the owner's laptop, Tailscale for phone access, no off-site backups in stage 0; planner decision for the design)
- **Context:**
  - The user: "the codebase/logic is planned for two stages: invite-only and public and the infrastructure is planned for 3: just me, invite-only, and public."
  - On 2026-10-07 the user moved stage 0 off servers ([platform decisions](../../product/notes/2026-10-05-platform-decisions.md), "Stage 0 runs on the owner's laptop"). Hetzner's cheap tier became unavailable ("whole CX/CAX line marked unavailable since early September 2026"). The user: "for the first version, we're not going to use a vps … the just me, it can just run on my laptop". The laptop runs **Windows**.
  - Accepted at the same time: Tailscale for phone access away from home (LAN at home). Declined: off-site backups in stage 0 ("except for the off-site backup, I don't care enough about it right now"). The domain isn't needed until the first server.
  - The three are **infrastructure stages 0, 1 and 2**; they're unrelated to the spec's scope stages A to C.
- **Options considered:**
  - **Staging:** (i) build server infrastructure for the first deploy; (ii) **three infrastructure stages over one invite-only codebase** (user decision); (iii) a lighter stage-0 code path (worker-capture folded into worker-general, a local key provider instead of KMS, no `budmon_capture` role). (iii) is rejected: the stage-1 move would then be a code change made just before invitations, and the code that protects invitees would never have run against real Gmail data.
  - **Stage-0 host:** (a) a small VPS (v1.0's design; the user scratched it); (b) **the owner's Windows laptop** (user decision).
  - **Running Docker on Windows:** Docker Desktop with the WSL2 backend; Docker Engine installed directly inside a WSL2 distribution; Podman Desktop.
  - **Phone access to the laptop:** port forwarding on the home router (rejected: exposes the laptop to the internet); LAN only (no access away from home); **Tailscale** (user accepted); a Cloudflare Tunnel (public exposure, needs a domain).
  - **Stage-1 host:** Hetzner Cloud (cheap tier unavailable at the moment); other EU VPS providers (OVHcloud, Netcup); Google Cloud (rejected on cost in v0.3). The choice is now made at the stage-1 gate.
  - **Process management, pre-production checking, infrastructure as code:** as before. Docker Compose; a release rehearsal in CI instead of staging (D-41); OpenTofu from stage 1.
- **Decision:**

  **Stages at a glance.**

  | | Stage 0: owner only | Stage 1: invite-only (the first server deployment) | Stage 2: public (path only, §7.6) |
  | - | ------------------- | -------------------- | --------------------------------- |
  | Whose data | The owner's real data and Gmail inbox | The owner and the invited group (A-4) | Anyone |
  | Code | The invite-only codebase | **The same code and images** (stage rule below) | Code stage 2: what going public adds (§12) |
  | Hosts | The owner's Windows laptop: Docker Desktop (WSL2 backend), the whole Compose stack | Main server + capture server at one provider (chosen at the gate), joined by a WireGuard tunnel | Separate database, API and worker hosts (§7.6) |
  | Reachable from | The laptop itself and the owner's phone over Tailscale (`https://<laptop>.<tailnet>.ts.net`); nothing exposed to the LAN or internet | The internet at `https://budmon.com` | Same |
  | worker-capture | Own container and secret file; `budmon_capture` over TLS on its own Compose network | Own server; `budmon_capture` over TLS through the WireGuard tunnel (D-19) | Own host(s) |
  | Data at rest (D-40) | The laptop's own disk encryption (BitLocker or Windows device encryption, A-14) | LUKS on the main server; the capture server's age key only in tmpfs; manual unlock | Same, or the managed database's encryption |
  | Backups (D-30) | **None off-site** (user's accepted risk); a local dump before every upgrade | pgBackRest to Backblaze B2; a restore drill at the gate, then every 3 months | Same |
  | Monitoring and alerts (D-24, D-25) | Sentry error reports (with Sentry's own email on new issues); no Grafana Cloud, no Alloy, no alert rules | Full D-24/D-25 (Alloy, Grafana Cloud, alert e-mails) | Same |
  | Release deployment | The owner runs `budmon-local upgrade <tag>` in WSL2, which builds the tagged release's images locally | Signed deploy bundles, the trust-anchored bootstrap, forced-command SSH, the tag ruleset and approval chain | Designed then |
  | Connection pooler (D-18) | None | None | Transaction-mode PgBouncer |
  | Monthly cost (below) | about €0 to €1 | about €15 to €27 (est., provider-neutral) | not designed; rough order €100 to €300 |

  **The stage rule (binding on every LLD and on the build).**
  1. **Two code stages.** The following are built for invite-only from the first slice and are the same in stages 0 and 1:
     - everything under `apps/`, `packages/` and `images/` (the Dockerfiles of the server image, the web image and Budmon's Postgres image; D-5), and the application images built from them;
     - the contract, the schema, roles and grants;
     - the operational commands the stage-1 gate runs (below);
     - every privacy and security mechanism in code: KMS asymmetric sealing, the sealed OAuth exchange in worker-capture, D-24's layers, idempotency, the `budmon_capture` role and the credential-table rule, and the i18n, RTL and accessibility guards.
  2. **Moving from the laptop to the first server changes no application code and runs no schema change beyond the release migrations already applied.** Nothing under `apps/`, `packages/` or `images/` changes for the move, and the cutover deploys a release with no application-code change from the one running on the laptop, built and signed by the stage-1 pipeline (stage 1 deploys only CI-built signed images, so the laptop's locally built images are never moved). What's **added** at stage 1 is infrastructure only:
     - the deploy bundles and bootstrap (rule 4);
     - OpenTofu, cloud-init, host and Compose files for the servers;
     - SOPS secret sets;
     - Alloy and Grafana alert rules;
     - the egress proxy, the WireGuard tunnel and firewall rules;
     - the release-signing chain;
     - Google Cloud console settings.
  3. **How it's kept true:**
     - (a) **No stage setting.** The application has no `STAGE` variable, and nothing in `apps/` or `packages/` branches on the topology. What differs is expressed through settings the code reads the same way everywhere: connection URLs with `sslmode` and a CA file, the standard proxy variables, the OTLP endpoint (unset on the laptop), the Sentry DSN, host addresses.
     - (b) **Network mechanisms wired in unconditionally.** Every network-level mechanism that only stage 1 uses is in the code from the first slice and switched on by configuration alone: proxy support in each client library (D-19), and TLS on `budmon_capture`'s connection, which the laptop also uses.
     - (c) **Gate commands tested in CI from the first release.** Every command the gate runs ships in the server image and is exercised in CI: the `api-secrets` re-wrap, the role/grant/verifier part of `pnpm db:migrate`, restore integrity checks and erasure replay (D-20, D-30).
     - (d) **The laptop runs production configuration.** It uses `APP_ENV=production`, so every production rule in configuration validation (D-20) is already in force: real Google Cloud KMS, S3-compatible object storage, TLS for `budmon_capture`, a trusted proxy.
     - (e) **Strict secret separation.** Secret files are mounted strictly by host role (`main`, `capture`) on the laptop too. No main-side container reads a capture file.
     - (f) **A stage-1 dry run before the cutover** (gate item 4). The stage-1 LLD adds the server-topology release rehearsal (D-41), so stage 1's configuration is rehearsed before any invitee arrives.
  4. **Server deployment machinery from stage 1** (designed in v0.9 to v1.0, unchanged in substance, deferred). Every release builds, signs and pushes two **deploy-bundle images** (`budmon-deploy-main`, `budmon-deploy-capture`), each holding:
     - its host role's Compose and configuration files;
     - the role's SOPS-encrypted secret sets per deployment;
     - a signed manifest with the application image digests and a monotonic release sequence number.

     A minimal bootstrap on each server, installed by cloud-init, does the following:
     - accepts only a tag over a forced-command SSH key;
     - verifies the bundle's and every image's cosign signature offline against **trust anchors**: the release workflow identity regex, the GitHub OIDC issuer and a pinned Sigstore trusted root;
     - accepts only a newer sequence number or exactly the previous one (rollback);
     - can self-update its anchors through a bundle verified with the current anchors.

     The capture server is deployed through a channel that carries only the tag. **Release tags** are created only by a GitHub App through `tag.yml`, behind a tag ruleset and an owner approval in a `tag-approval` environment. Agents hold no token that can approve deployments. Infrastructure-only releases (`vX.Y.Z-infra.N`) carry infrastructure changes without rebuilding application images.
     - The **"approval click on every release, not only hotfixes"** proposed in the LLD's v0.5 review is **deferred with this chain**. It's recorded as an open item for the user (§11), to decide when stage 1 is designed.
  5. **What stage 0 keeps from day one.** These are cheap, they protect the owner's real data and Gmail tokens, and they keep the move to stage 1 a configuration change:
     1. **worker-capture as a separate container with its own secret file**, its own role `budmon_capture`, and its own internal `capture-db` network to Postgres with TLS `verify-full` to `db.budmon.internal` (D-19). The credential-table rule applies.
     2. **Real Google Cloud KMS** for sealing Gmail tokens (decided here). The capture service-account key lives in worker-capture's secret file on the laptop. It costs cents a month, the envelopes need no re-sealing when the data moves to the server (only the key file is replaced), every decrypt is audit-logged, and the key can be revoked instantly. The local key provider stays development-only, and production configuration refuses it.
     3. **The privacy and logging rules** (D-24 layers 1 to 3), the request and error scrubbing, and Sentry (D-24's Sentry rules).
     4. **Secrets never in git.** On the laptop they're per-service files outside the repository, generated by `budmonctl` (D-20). CI scans the repository and images for secrets.
     5. **Release migrations from the first install** (PLT-BR-5): the laptop holds real data, so its schema changes only through committed, reviewed release migrations. The first install's migration is the baseline (D-12). The release checks (check (i), the upgrade test, the risky-statement check) run on every release PR.
     6. **A CI release rehearsal of the stage-0 shape** (D-41): every release's images run the laptop's Compose topology with stand-ins, through an upgrade from the previous release, the privacy canary scan and a rollback check.
     7. **Budmon's Postgres image boot safeguards** (no implicit `initdb`; D-40), which also protect the laptop against silently starting an empty database.
     8. **The laptop's own disk encryption** (A-14), and Postgres reachable only on internal Docker networks.

  **Stage 0: the owner's Windows laptop.**
  - **Docker:** Docker Desktop with the **WSL2 backend**. Docker Desktop is free for personal use and for businesses under 250 employees and $10 million revenue, per Docker's licence terms as reported by multiple sources (checked 2026-10-07). It publishes container ports on Windows' `localhost`.
  - **The repository and all tooling live inside WSL2** (an Ubuntu LTS distribution), not on the Windows drive:
    - the clone is at `~/src/budmon` in the WSL2 filesystem;
    - Node 24, pnpm, git, sops, age and the Android SDK command-line tools for Gradle CLI builds are installed in WSL2;
    - Docker Desktop's WSL integration is enabled for that distribution;
    - editors attach through VS Code's WSL remote or JetBrains' WSL support.

    Reasons: bind mounts and file watching on the Windows drive are slow and unreliable from WSL2/Docker; the scripts are bash; development and CI then run the same Linux toolchain.
  - **Windows-specific rules:**
    - `.gitattributes` with `* text=auto eol=lf`, `*.sh` and `*.bash` `eol=lf`, `*.bat`/`*.cmd`/`*.ps1` `eol=crlf`, and binary types marked `binary`. Git in WSL2 uses `core.autocrlf=false`.
    - Every script is runnable in WSL2 and CI (Linux) only. No PowerShell scripts are required.
    - Paths in scripts are POSIX paths inside WSL2. Never `/mnt/c/...` for anything Budmon reads or writes, except the Windows `tailscale.exe` call below.
    - `.wslconfig` caps WSL2's memory (6 GB on a 16 GB laptop; the stack needs about 3 GB). WSL2 stays in its default NAT networking mode, whose localhost forwarding lets Windows (and the emulator) reach servers started inside WSL2. `networkingMode=mirrored` is left commented out: Docker Desktop has had problems with it, including port publishing to Windows' `localhost`, and it needs verifying on the pinned Docker Desktop version before use. `adb` runs on Windows (Android Studio's platform tools), not in WSL2.
  - **Android development on Windows:**
    - Gradle builds and the JVM tests run in WSL2, as in CI.
    - Android Studio and the emulator run on Windows. **Debug builds talk to the development stack, never the production one:** the emulator reaches it at `http://10.0.2.2:5173` (its alias for Windows' `localhost`; WSL2 forwards that port to the Vite dev server, which proxies `/api` and `/health` to the development API). Port `8080` on the same laptop is the production Caddy holding the owner's real data, so no debug default points at it. The emulator or phone reaches production only through an explicit `stage0` release build carrying the Tailscale address.
    - Android Studio opens a **Windows-side clone used only for Android work**, because Android Studio on `\\wsl.localhost` paths is unsupported and slow. This is the one documented exception to "the repository lives in WSL2".
    - The owner's phone gets builds over `adb` (Wi-Fi debugging) or as a sideloaded APK. Firebase App Distribution is for invitees from stage 1 (A-12).
  - **Containers:** two Compose projects as in v1.0's stage 0:
    - `budmon-main`: `caddy` (the web image), `api`, `worker-general`, `postgres`, the one-off `migrate`, and `mailpit` (amended during implementation of platform: LLD A-2, requested by the identity HLD's PA-2): the stage-0 SMTP target for worker-general, run with `--quiet` and Docker logging driver `none` so no address reaches the logs, its inbox published only on `127.0.0.1:8025`; any SMTP relay can replace it by configuration;
    - `budmon-capture`: `worker-capture`;
    - they're joined only by the internal `capture-db` network.

    There's no `alloy` and no pgBackRest archiving (`archive_mode = off` in the laptop's `postgresql.conf`). Same container hardening, distinct UIDs and per-role secret mounts.
  - **Caddy on the laptop** listens on HTTP port 8080 only, published to `127.0.0.1:8080` on Windows. Its automatic HTTPS is off, because Tailscale terminates TLS. It serves the SPA and proxies `/api/*`, with the same headers, logging filters and maintenance switch as later.
  - **Access, LAN and Tailscale:**
    - Tailscale runs on Windows, with MagicDNS and HTTPS certificates enabled in the tailnet. `tailscale serve --bg --https=443 http://127.0.0.1:8080` gives the stack a stable HTTPS address, **`https://<laptop>.<tailnet>.ts.net`**, with a Let's Encrypt certificate that Tailscale obtains and renews. It's reachable only from devices in the owner's tailnet.
    - The owner's phone runs the Tailscale app and **always uses that address**. At home, Tailscale connects directly over the LAN; away from home, it goes over the internet. So "LAN at home, Tailscale away" needs no second address, certificate or app setting.
    - Nothing listens on the LAN or the internet. Windows' firewall needs no inbound rule.
    - The laptop's own browser uses the same address, so cookies, HTTPS-only browser features and the CSP behave as on a server.
    - Tailscale's free personal plan covers this (up to 100 devices, per Tailscale's documentation).
    - The trusted proxy (D-22) is Caddy. Tailscale Serve reaches Caddy through Docker Desktop's port forward, so on the laptop every request's client IP is the Docker gateway. That's acceptable with a single user, since the per-IP limits then act as global limits.
  - **Android build base URL:** a Gradle property, `budmon.apiBaseUrl`, set per build flavour.
    - `stage0` release builds use `https://<laptop>.<tailnet>.ts.net/`, read from `~/.budmon/android.properties` and never committed.
    - Debug builds use `http://10.0.2.2:5173/` (the development stack, above); cleartext is allowed only to `10.0.2.2` and only in debug builds.
    - At stage 1 the release build uses `https://budmon.com/`. The owner reinstalls once; this is acceptable because only the owner has the app in stage 0, and it revises v1.0's "base URL baked into the APK" reasoning for buying the domain early (D-36).
  - **Gmail OAuth without a domain:** the Google OAuth client is a "Web application" client with redirect URI `http://localhost:8080/api/v1/<sources' callback path>`. Google allows `http://localhost` redirects for web clients. So in stage 0, **the Gmail connection is made from the laptop's browser**. While the OAuth app is in Google's testing mode (A-16), Google expires refresh tokens after 7 days, so the owner reconnects from the laptop's browser about **weekly** (the connection shows "needs reconnect", D-25) until the Gmail spike (Q-11) settles the publishing status: the flow starts on the tailnet address and lands on `localhost`, both of which the same stack serves. The pending-OAuth row (F-3) identifies the user, not a cookie, so the callback works across the two origins.
    - Whether Google also accepts the `*.ts.net` address as a redirect URI, which would let the phone connect Gmail, is added to the Gmail spike (Q-11). Nothing depends on it.
    - `sources` designs the screens around this constraint.
  - **When the laptop is off or asleep:**
    - **Android:** keeps recording new entries offline (J-4) and syncs when the laptop is reachable again. The web app shows J-7's "temporarily unavailable" message.
    - **Gmail push:** notifications wait in the Pub/Sub subscription (7-day retention) and are processed on wake. Gmail's `watch` expires after 7 days without renewal, so `sources` must renew it on start-up as well as on schedule, and run the safety-net sync on start-up. A gap longer than Gmail's history retention needs `sources`' full-resync path. These are requirements on `sources`' design.
    - **FX:** the daily fetch doesn't run while the laptop is off, and pg-boss doesn't replay missed cron ticks. So the platform adds an **FX gap check**, run at worker start-up and daily, that enqueues backfills (D-15) for every missing day since the last stored one (at most 31). Conversions are "provisional" until the gap is filled.
    - **Scheduled work in other modules** (reminders, watch renewal, reconciliation): must tolerate late execution. Each module's LLD states, for each scheduled job, whether it catches up on start-up (and how) or skips missed runs. Reminders arrive late rather than never.
    - **Sentry:** nothing to report while the laptop is off. No alert fires for downtime (stage 0 has no uptime alerts by design).
  - **Releases in stage 0:**
    - Release, hotfix and their checks work as in D-12. `tag.yml` creates the tag (with `GITHUB_TOKEN`; no App, ruleset or signing in stage 0) after check (i) on the merge commit.
    - The owner installs a release with **`budmon-local upgrade <tag>`** (bash, in WSL2):
      1. fetches tags and checks the tag is reachable from `origin/main` (or, for a hotfix tag, from the branch `hotfix/<tag>`; D-12);
      2. copies the tag's own `infra/local/` files (Compose, Caddy and Postgres configuration, and `budmon-local` itself) into `~/.budmon/releases/<tag>/` and continues from that copy, so production never runs infrastructure files from the working clone, and builds the three images from that tag, tagging them `budmon/<image>:<tag>` (the same inputs as CI's rehearsal build: pinned base digests and a frozen lockfile, though not necessarily byte-identical images);
      3. takes a local `pg_dump -Fc` (the last 5 are kept in `~/.budmon/dumps/`, on the laptop disk; not a backup against losing the laptop);
      4. runs the `migrate` container;
      5. `docker compose up -d` for both projects;
      6. waits up to 120 s for `/health/ready` (checked inside the API container) and the worker heartbeats;
      7. on failure, starts the previous tag's images again, with the previous tag's own copied files, and exits non-zero.
    - `budmon-local start|stop|status|logs|maintenance on|off` cover daily use, always with the files of the release that's running.
    - Docker Desktop is set to start at login, and the containers have `restart: unless-stopped`, so the stack comes back after a reboot or wake.
  - **First install:** `budmon-local install <tag>`, resumable (each step is skipped when already done):
    1. runs `budmonctl secrets init-local` (per-service files under `~/.budmon/secrets/<host-role>/<service>/`), then gives each service's directory to that container's user (`sudo chown`; files mode 0400), because containers run under their own UIDs and bind mounts keep the host's ownership;
    2. sets up the private CA and the Postgres TLS certificate for `db.budmon.internal`;
    3. asks for the laptop's non-secret settings (Tailscale name, B2 endpoint and bucket names, OAuth client id, Sentry DSN) and writes `~/.budmon/site.env`;
    4. stops and lists what's still missing while any placeholder remains. The owner then runs the Google Cloud bootstrap (which writes the KMS public key and key version) and fills the externally issued secrets (the KMS service-account key, the OAuth client secret, the B2 keys, the OXR app id) with `budmon-local secret set`, which writes each file with the right owner and mode, and re-runs `install`;
    5. starts Postgres once with `BUDMON_FIRST_SETUP=1` on a data directory owned by the Postgres user;
    6. runs `upgrade <tag>`;
    7. prints the `tailscale serve` command for the owner to run on Windows.
  - **Object storage in stage 0:** Backblaze B2 buckets for `exports` and `erasure-log` (D-35). The free tier is enough, and presigned download URLs then work on the phone. This is object storage, not backup; the user declined off-site **backups**, and no database copy goes to B2 in stage 0.

  **Stage-0 risks, accepted by the user:**
  - **No off-site backups.** A lost, stolen or failed laptop loses all data. The user: "I don't care enough about it right now".
    - The only copies are the local pre-upgrade dumps on the same disk.
    - As an optional manual safeguard (not a plan), the user's own data export (XC-17, `identity`) can be downloaded from time to time once `identity` exists.
    - The laptop's disk encryption (A-14) protects a stolen laptop's data.
  - **The laptop is the trust boundary.** Anyone with the owner's Windows session, or malware on the laptop, can read the database and use worker-capture's KMS credential (audited and revocable; D-19's threat table).

  **Stage-1 gate.** Every item is done, in this order, before the first invitation is sent. The stage-1 LLD writes the checklist; the owner ticks it in a pull request they merge.
  1. **Provider chosen and domain bought.**
     - The provider is picked by these criteria: EU location; two servers in one region; IPv4 included; a block volume if offered; an OpenTofu provider or a usable API; price.
     - Candidates: OVHcloud VPS, Netcup VPS, and Hetzner Cloud if its cheap tier is back in stock. No commitment is made now.
     - `budmon.com` (fallback `.io`) is bought, and its DNS points at the main server (D-36).
  2. **Release chain set up** (rule 4):
     - the GitHub App, the tag ruleset, the `tagging` and `tag-approval` environments and the `production` environment;
     - agents' tokens without deployment-approval rights;
     - hardware-key 2FA on the owner's GitHub account;
     - the user's decision on the approval click on every release (§11).
  3. **Stage-1 release rehearsal** (D-41): the server topology (the egress proxy, the tunnel-shaped network, the signed bundles) runs in CI on every release from now on.
  4. **Dry run** of the stage-1 OpenTofu and cloud-init on throwaway servers. It uses throwaway secrets and a separate dry-run KMS key, never the production key or Pub/Sub subscription. The servers are deleted afterwards.
  5. **Dedicated capture server** (D-19), connected to the main server by a **WireGuard tunnel** with static keys and fixed `/30` addresses (replacing v1.0's Hetzner private network). It's deployed through the tag-only channel.
  6. **Encryption at rest** (D-40) on the main server: LUKS on a block volume, or, if the provider has none, on a dedicated partition or a LUKS file container on the server disk. Also the capture server's age key only in tmpfs, swap off and automatic reboots off. The owner has had D-40 explained before this item.
  7. **Egress proxy and host firewall** (D-19), verified from the hosts:
     - worker-capture reaches only the allowlisted Google and Sentry hosts;
     - Postgres is unreachable except from the capture server through the tunnel;
     - SSH to the capture server works only through the main server.
  8. **Backups and monitoring:** pgBackRest to B2 (D-30); Alloy and Grafana Cloud; the D-25 alert rules, including KMS audit logging and the decrypt-rate alert; each alert test-fired once.
  9. **The `prod-s1` secret set** (SOPS). Every secret is fresh, except the `api-secrets` key, which is data-bound and rotated in item 11. That includes a new KMS service-account key (the laptop's key is deleted in item 11) and a new OAuth client secret.
  10. **Cutover from the laptop:**
      1. Lower the DNS TTL beforehand.
      2. On the laptop: maintenance on, then stop the API and both workers, so only one Pub/Sub subscriber ever pulls and nothing writes after the dump.
      3. Take `pg_dump -Fc` and copy it to the main server over SSH (over Tailscale or the internet).
      4. `pg_restore` it onto the LUKS volume with the stage-1 schema step, run `restore:verify` and replay erasures.
      5. Start stage 1 and confirm readiness and the capture heartbeat.
      6. Take an immediate full pgBackRest backup, then a **restore drill** from it onto a throwaway server.

      If anything fails before step 5, the laptop leaves maintenance and keeps running.
  11. **Stage 0 retired:**
      - the `api-secrets` key is rotated with re-wrap;
      - the laptop's KMS service-account key is deleted in Google Cloud;
      - the laptop's Budmon secrets, dumps and Docker volumes are deleted once stage 1 is confirmed (the owner may first keep one encrypted export of their own data);
      - **recommended:** revoke Budmon's Gmail grant and reconnect.
  12. **Apps on the domain:**
      - Google OAuth redirect URIs switch to `https://budmon.com/...`, and the phone can now connect Gmail;
      - the Android release build gets `budmon.apiBaseUrl=https://budmon.com/`, and the owner reinstalls;
      - the web app moves to the domain.
  13. **Reboot-and-unlock run-through** (D-40) on both servers, with the "locked" signals seen firing and resolving.
  14. **Gmail publishing status** (Q-11), set to match the spike's outcome.
  15. **What invitees receive:** Android distribution to the group (A-12), and the privacy notice that D-24 and D-30 quote, published (content owned by `identity`).

  **Stage 2 (public)** is a path, not a design: §7.6, plus the items in §12.

  **Environments (every stage):** one deployed environment, `production` (the laptop in stage 0, the servers from stage 1), plus `development` (local, inside WSL2 on the same laptop: a separate Compose project and database, `budmon-dev`, never the production one) and `test` (CI). Stage-1 location: an EU region of the chosen provider (A-11). Buckets at Backblaze B2's EU region (D-30, D-35).

  **Stage-1 hosts (provider-neutral):**
  - A **main server** of the 4 vCPU / 8 GB class with an extra encrypted block device (D-40), and a **capture server** of the 2 vCPU / 2 to 4 GB class.
  - They're in one region, connected by **WireGuard** (`wg0`, static keys from SOPS). Postgres listens on the tunnel address for `budmon_capture` only.
  - Host nftables rules on both servers, whatever firewall the provider also offers.
  - Provider snapshots and provider backups are disabled.
  - Hosts are rebuilt from cloud-init and OpenTofu (the provider's OpenTofu provider, or a documented manual step where none exists), and data is restored from pgBackRest.

  **Cost per stage,** monthly, excluding VAT. "est." marks unverified figures.

  | Item | Stage 0 | Stage 1 |
  | ---- | ------- | ------- |
  | Host(s) | the owner's laptop (electricity not counted) | two VPS of the classes above at one provider: about €10 to €20 (est.; varies by provider and availability) |
  | Extra block volume, 20 GB (D-40) | none | €0 to €2 (est.; €0 where encryption uses the server disk) |
  | Backblaze B2 | exports and erasure log within the free 10 GB: €0 | backups + exports + erasure log: under €1 (est.) |
  | Google Cloud: KMS key version and decrypt operations; Pub/Sub within free tier | under €1 (est.) | about €1 to €3 (est.) |
  | Sentry (free tier); Grafana Cloud (free tier, stage 1 only); GitHub Container Registry | €0 | €0 to €1 (est.) |
  | Tailscale (free personal plan); Docker Desktop (free for personal use) | €0 | €0 |
  | FX provider (D-15): Open Exchange Rates free plan | €0 | €0 |
  | Domain `budmon.com`, amortised | none | about €1 (est.) |
  | **Total** | **about €0 to €1** | **about €15 to €27 (est.)** |

  **Stage 2** isn't designed. As a rough order of magnitude only (est.): €100 to €300 a month, plus Google's yearly security assessment for the restricted Gmail scope.
- **Rationale:**
  - The laptop gives the owner real use of Budmon on their own data at no cost and with no server to run, while the code that protects invitees is exercised against real Gmail data the whole time (real KMS, worker-capture's isolation, the privacy layers).
  - Tailscale gives the phone one stable HTTPS address at home and away without exposing the laptop or buying a domain.
  - Deferring the whole server-deployment chain to stage 1 removes work that would protect nothing on a laptop the owner controls directly. It's designed in full (rule 4) and lands, with its own rehearsal, before anyone else's data does.
  - Making stage 1 provider-neutral (WireGuard instead of a provider's private network; LUKS on whatever block device exists) keeps the choice open while cheap capacity is scarce.
  - The design is honest about stage 0's limits: no off-site copy (the user's choice), no uptime while the laptop sleeps (best effort, P9, with offline entry on Android covering the gap), and the laptop as the trust boundary.

### D-30: Backups and restore: pgBackRest to off-provider object storage (user decision for the policy: daily, 14 days, 7-day PITR; planner decision for the mechanism)
- **Options considered:** pgBackRest; WAL-G; nightly `pg_dump` only (no PITR, rejected); the hosting provider's server backups (whole-disk images, not consistent for a running database, kept on the same provider; rejected as the database backup). Repository: Hetzner Object Storage (€6.49/month base, same provider) vs Backblaze B2 (pay per use, a different provider).
- **Decision:**
  - **Stage 0 (the laptop): no off-site backups**, by the user's decision ("except for the off-site backup, I don't care enough about it right now"; D-29). The only copies are `budmon-local upgrade`'s local `pg_dump` files taken before each upgrade (the last 5, on the same disk; they protect against a bad release, not against losing the laptop). As an optional manual safeguard, once `identity` exists the owner can download their own data export (XC-17). The policy below applies from stage 1.
  - **pgBackRest** inside the `postgres` container (its spool on the LUKS volume, D-40), from the first server deployment (D-29), repository on **Backblaze B2 (EU region)** through its S3-compatible API, in a dedicated bucket with a key scoped to that bucket and held only by the Postgres container.
  - **Client-side encryption** (`repo1-cipher-type=aes-256-cbc`); the passphrase is in SOPS and in the owner's password manager (losing it means losing the backups).
  - **Schedule:** full backup weekly, differential daily, continuous WAL archiving (asynchronous, compressed) with `archive_timeout = 300` (at most about 5 minutes of data loss).
  - **Retention:** time-based with weekly fulls (`repo1-retention-full-type=time`, `repo1-retention-full=7`). pgBackRest keeps the newest full backup that is at least 7 days old plus everything after it, so the oldest backup kept is between 7 and 14 days old: point-in-time recovery always covers at least the last 7 days (as accepted), daily backups are available for at least 7 and at most 14 days, and nothing older than 14 days is kept. Deleted users' data therefore leaves backups within 14 days of erasure, which is the privacy-policy wording.
  - **Monitoring:** a systemd timer runs `pgbackrest check` and `info` and writes the last-success timestamps for Alloy to export; alerts on no successful backup for 26 hours and on WAL archiving failing for 15 minutes (D-25).
  - **Restore drills:** **one successful drill is a stage-1 gate item** (D-29 gate item 10: right after the cutover's first full backup); from then on, a drill every 3 months, following the runbook: create a temporary server with its own LUKS-encrypted volume (unlocked with a one-off passphrase), restore onto that volume the latest backup and a point in time, run integrity checks and the erasure replay command, record the time taken, then delete the VM and the volume (a few cents). A restored production database contains queued jobs, cron schedules and sealed tokens, so on the drill VM: only Postgres and the erasure command run; no workers, API, Alloy or Sentry DSNs; no capture service-account key, FCM or email credentials are copied there; outbound traffic is blocked except to the backup repository. A real restore follows the same order: restore, replay erasures, then start the stack.
  - **Erasure after restore:** `identity`'s erasure first writes an erasure record (internal user ID and time) to the `erasure-log` bucket (D-35) and then deletes data; the restore runbook replays every record newer than the restore point; replay is idempotent.
- **Rationale:** pgBackRest is mature, supports time-based retention, encryption, parallel restore and `verify`. An off-provider repository means an account problem or a provider location failure doesn't take the backups with it, and B2 costs cents at this size (estimate) against Hetzner Object Storage's €6.49 base. Its S3 compatibility with pgBackRest is expected but I couldn't verify it here; the fallback is Hetzner Object Storage in a different Hetzner location.

### D-31: Composition root and injectable dependencies instead of singletons
- **Options considered:** keep `getInstance()` singletons; a DI container library; a hand-written composition root with constructor injection.
- **Decision:** a composition root per process (`createApiContainer`, `createWorkerContainer`) building config, database, clock, ID generator, queue, KMS client, object store, integrations, then repos and services. Services receive repos and integrations through constructors; repos receive the database executor per call. Tests build the container with overrides.
- **Rationale:** fixes the review's singleton problems (CR §4.1) and makes injectable dependencies explicit for the test-architect, without a framework.

### D-32: Keyset pagination with encrypted cursors
- **Options considered:** fix the current offset helper (CR X-8); keyset pagination with plain base64 cursors; keyset with ID-only cursors; keyset with encrypted cursors.
- **Decision:** lists use keyset pagination: request `{ cursor?, limit }` with `limit` 1 to 100 (default 50); response `{ items, nextCursor | null }`. The cursor holds the sort key, the last ID, a hash of the list's filters and an expiry (24 hours), **encrypted and authenticated** (AES-256-GCM with a server-side cursor key from configuration), so it can travel in a query string without exposing amounts, payee names or dates (D-24). A tampered, expired or mismatched cursor returns `VALIDATION_FAILED`. The broken offset helper is removed.
- **Rationale:** ledger lists grow without bound and change while being read; keyset pages are stable and use the sort's index. Plain base64 cursors would expose the sort key (an amount or payee) in URLs; ID-only cursors would need an extra lookup and break when that row is deleted. Encryption is cheap and keeps cursors opaque in fact, not only in name.

### D-33: Client version policy and update prompts
- **Options considered:** no version handling; store-only updates; a server-driven minimum version. Status code: 426 (requires an `Upgrade` header naming a protocol, which doesn't fit an app update), 400 with a dedicated key.
- **Decision:** clients send `X-Budmon-Client`. Configuration holds, per client kind, the minimum supported and latest versions, exposed by `meta/client-config`. Below the minimum, every procedure except `meta/client-config` returns **`400 CLIENT_UPDATE_REQUIRED`** (clients act on the key, as for every error); Android pauses offline sync and shows S-1 (J-5), the web shows J-6's banner. Between minimum and latest, apps show the soft prompt. The minimum is raised only together with a deliberate breaking contract change (D-6).
- **Rationale:** Android builds outside a store can't be force-updated; a server-driven floor lets the API evolve safely, and the offline queue survives updates. A 400 with a specific key is HTTP-compliant and needs nothing special from proxies or clients.

### D-34: The clean-up happens in the first slice, by verdict
- **Options considered:** a separate clean-up pull request; inside the first slice (decided by the user, spec §7 item 4).
- **Decision:** the first slice restructures the repo into D-5's layout and handles every item:

  | Item (CR §5 unless noted) | Verdict | Handling in the first slice |
  | ------------------------- | ------- | --------------------------- |
  | `src/index.ts` bootstrap | Keep (rework) | Replaced by `apps/server/src/main/api.ts` on Fastify (D-3) with the security baseline (D-22). |
  | `src/router/index.ts` | Rework | Replaced by the oRPC contract router (D-4); the broken `../trpc.js` import and the tRPC stub are removed. |
  | `src/env.ts` | Keep (rework) | Becomes the fail-fast config module (D-20). |
  | `src/errors/index.ts` | Keep class, rework handler | `BudmonError` kept; the Express handler replaced by the oRPC error interceptor (D-21); unused `ValidationError` removed. |
  | `src/auth/*` | Replace flows, keep patterns | Deleted; `identity` designs sign-in fresh; patterns carried into conventions; bcrypt replaced by the Argon2id utility (D-22). |
  | `src/users/usersRouter.ts` | Replace | Deleted (removes X-1 and the hanging `POST /users`, X-11). |
  | `src/users/userRepo.ts` | Rework | Deleted; `identity` designs its repo. |
  | `src/accounts/accountsRepo.ts` | Replace | Deleted. |
  | `src/db/schemas/users.ts`, `account.ts`, `refreshTokens.ts` | Rework / replace | Deleted (database disposable); `dob` is gone with them (spec §7 item 3). |
  | `src/db/schemas/currencies.ts` | Rework | Replaced by the new `currencies` table (§3). |
  | `src/db/index.ts` (CR X-10: `refresTokens` typo, missing tables and relations) | Rework | Replaced by `src/db/schema/index.ts` registering every table and relation, and the platform's database module (D-18, D-31). |
  | `src/enums/currency.ts` | Replace | Deleted; `currencies` is the single source. |
  | `src/utils/pagination.ts` | Rework | Replaced by keyset pagination (D-32). |
  | `src/types/TableRecord.ts` | Replace | Deleted. |
  | `server/dist/` | Remove from git | Removed; `dist/` stays ignored. |
  | `server/.env.example` | Replace | Replaced by a correct one checked by the env test (D-20). |
  | `server/drizzle.config.ts` | (CR §1.3) | Moved to `apps/server/`, pointing at `src/db/schema/`, `casing: "snake_case"`, no non-null assertion (reads validated config). |
  | `server/tsconfig.json` | (CR §1.3) | Replaced by per-package configs extending `packages/config` bases (no `rootDir: "."`, no `jsx` on the server). |
  | `package.json` scripts and dependencies | Rework | Workspace scripts (D-5) with real `build`, `test`, `db:reset`, `db:release-migration`, `db:migrate`; the old `db:push` script is replaced by the guarded `db:reset` (D-12). Removed: `@rollup/plugin-typescript`, `rollup`, `tslib`, `@types/mssql`, Express and `@types/express`, morgan and `@types/morgan`, `@trpc/server`, `jsonwebtoken` and `@types/jsonwebtoken`, `drizzle-zod`, `dotenv`, bcrypt and `@types/bcrypt`. |
  | `server/.gitignore` | (CR §3.4) | Prisma line removed; ignores consolidated in the root `.gitignore` (including `.data/` and `.env*` except `.env.example`). |
  | `compose.yaml` | Keep (rework) | Moved to `infra/compose.yaml`, image pinned, Mailpit added (D-28). |
  | Root `.prettierrc` | (CR §4.1: rework) | Replaced by the full Prettier config in `packages/config`, referenced from the root. |
  | `.zed/settings.json` | (CR §1.1) | Kept (personal editor setting, harmless). |
  | `code-bites.md`, empty root `README.md` | (CR §1.1) | A real README (layout, prerequisites, commands, environments) replaces both; `code-bites.md` deleted. |
  | Debug endpoints `GET /`, `GET /auth/test-auth` | (CR §3.4) | Gone with the files above. |

  The first slice also proposes CLAUDE.md's "Project conventions" text (based on CR §4.2, updated for this HLD); only the user approves CLAUDE.md, so the text goes into the pull request for the user to accept (Q-10). It includes the database rules agents follow, the i18n, RTL and accessibility rules (D-37, D-38, D-39), and that the web app is SolidJS: rebuild the development database only with `pnpm db:reset`; never write migration files outside `release/*` and `hotfix/*` branches.
- **Rationale:** decided by the user; doing it inside the slice means the skeleton and the removals are reviewed together.

### D-35: Private S3-compatible object storage for exports and the erasure log
- **Options considered:** storing exports in Postgres (`bytea`); streaming exports from the API; object storage with presigned URLs. Provider: Hetzner Object Storage or another provider's object storage; Backblaze B2; Cloudflare R2.
- **Decision:** a platform `ObjectStore` interface over the S3 API (filesystem store locally, in-memory fake in tests), on **Backblaze B2 (EU region)**, the same provider as backups (D-30) but separate buckets and keys. Per environment:
  - **`exports`:** private bucket. worker-general writes under `users/<userId>/exports/<exportId>` with a key scoped to this bucket (read, write, delete); downloads only through **S3 presigned URLs valid 15 minutes**, issued by the API after an authorization check, signed with a separate read-only key held by the API. Deletion after 7 days by a platform purge job (deterministic and tested), with a bucket lifecycle rule as a backstop; `identity`'s erasure deletes the user's prefix. Object names contain IDs only.
  - **`erasure-log`:** append-only erasure records (D-30), written by worker-general with a key that can write but not delete (B2 application keys carry per-bucket capabilities), with Object Lock retention of 30 days where available, then lifecycle deletion.
- **Rationale:** exports are a full copy of a user's financial data, so they need private storage, short-lived access and guaranteed deletion (XC-16, XC-17); generating them in the API would break PLT-BR-6 for large exports. The erasure log must live outside the database to survive a restore. Scoped keys give least privilege per process. B2's capability-scoped keys and Object Lock are as I remember them; I couldn't verify current details here, and the fallback is Hetzner Object Storage with per-project credentials.

### D-36: Domain, same-origin API under a path, and the API version in the path
- **Context:** the user chose `budmon.com` (fallback `budmon.io`), and suggested the API as a subdomain or as a subpath like `/api/v<x>_<y>/`.
- **Options considered:**
  - Placement: (a) **subpath on the web app's origin** (`https://<domain>/api/...`); (b) subdomain (`https://api.<domain>/...`).
  - Version in the path: (1) **major only, `/api/v1`**, with additive changes (D-6); (2) major and minor, `/api/v<x>_<y>/`.
- **Decision:** **(a) and (1).** The web app is served at `https://<domain>/`, the API at `https://<domain>/api/v1/...`, the health endpoint at `https://<domain>/health/ready`, all through the same Caddy site.
  - **Same origin** means no CORS at all (the API sends no `Access-Control-*` headers and rejects preflights), cookies can be `Secure; HttpOnly; SameSite=Strict` scoped to `Path=/api` if `identity` chooses cookies, the CSP is `connect-src 'self'` plus the telemetry endpoints, and one certificate covers everything. Android uses the same base URL. The later Electron app (spec §5 Later) will need either CORS for its origin or a custom protocol; that's designed when it's scheduled.
  - **Version:** the path carries the **major version only**. Because the contract evolves additively (D-6), a minor version in the path would either force every client to change URLs for non-breaking changes or require the server to serve every `v1_y` alias as the same routes, which adds nothing. The contract's version (`1.<minor>`) is published in `openapi.json` (`info.version`) and in an `X-Budmon-API-Version` response header, which clients can log and Sentry can tag. `/api/v2` exists only if the whole API is ever redesigned; individual breaking changes are new procedures (D-6). The user accepted this ("major versions only").
  - **Domain:** `budmon.com` (user decision; `budmon.io` as fallback if `.com` is unavailable), **bought at the stage-1 gate** (user, 2026-10-07: not needed until the first server). Stage 0 needs no domain: the laptop is reached at its Tailscale HTTPS name, Google OAuth uses an `http://localhost` redirect, and the Android base URL is a build property, so the one change at stage 1 is a rebuild and a reinstall on the owner's phone (D-29). This revises v1.0's "acquired before the stage-0 deploy". Configuration holds the domain, so the fallback changes no design.
- **Rationale:** a single origin is the simplest and safest setup for one host (no CORS surface, strictest cookie policy) and doesn't block scaling: CDNs and load balancers route by path. A subdomain would only pay off when the API and web are hosted separately, which the scaling path can still do later behind the same paths.

### D-37: Internationalisation from day one (user decision: "something from the very start for languages"; English ships first)
- **Options considered:** English-only strings now, extracted later; **message catalogs from the first screen**; a translation-management service now (premature with one language).
- **Decision:**
  - **No hard-coded user-facing strings** in any client or in server-rendered messages. Web: every string goes through `@formatjs/intl` message descriptors with ICU MessageFormat (plurals, selects, number and date arguments), catalogs in `apps/web/src/i18n/messages/<locale>.json`. Android: string resources (`res/values*/strings.xml`, with ICU plurals via `plurals` resources). Server: email and push templates in `apps/server/src/i18n/messages/<locale>.json`, rendered with `@formatjs/intl` in worker-general using the recipient's locale.
  - **Lint enforcement:** web: ESLint `formatjs` rules (no literal strings in JSX, every message has an ID and a default English message, valid ICU syntax), plus a CI check that every shipped locale's catalog has every ID used in code; Android: lint `HardcodedText` and `SetTextI18n` as errors (they cover XML and View code only), and a **custom lint check** that rejects string literals passed to Compose `Text`, `contentDescription` and other text parameters, which is the real guard for Compose screens; server: templates are referenced only by message ID.
  - **Per-user preference:** `identity`'s profile holds the user's **locale** (a BCP 47 tag such as `en`, `en-GB`, `ar-EG`), used for both message selection (fallback chain: exact tag → language → `en`) and formatting. The platform provides the resolution helper; `identity` owns the column and the setting (IDN-US-3).
  - **Formatting:** numbers, money, dates, relative times, list joins and currency names come from `Intl` (`NumberFormat`, `DateTimeFormat`, `RelativeTimeFormat`, `ListFormat`, `DisplayNames`) through `@budmon/shared`, and from ICU (`android.icu`) on Android, always with the currency's `minor_units` from Budmon's table (§4.7). The numbering system follows the locale's default (for example Arabic-Indic digits in some Arabic locales); a `-u-nu-latn` override is available if users ask for Latin digits.
  - **API errors** are stable keys translated by clients (D-21); validation issues carry a code and parameters that clients translate; `message` fields stay developer-facing English.
  - **Pseudo-locales** for testing: an accented, 30%-longer English (`en-XA`) to catch truncation and untranslated strings, and a right-to-left pseudo-locale (D-38). Android's built-in pseudo-locales (`en-XA`, `ar-XB`) are enabled in debug builds.
  - **Shipping:** English only at launch; adding a language means adding catalogs and a locale to the supported list, with no code changes.
- **Rationale:** extracting strings later means touching every screen again; catalogs, ICU syntax and lint rules from the first screen make a second language a translation task, not a refactor. Server-side catalogs keep emails and pushes consistent with the apps.

### D-38: Right-to-left readiness from day one (user rules, reviewed and extended, and confirmed; real RTL testing after the MVP)
- **Context:** the user set the core rules (logical CSS properties, Tailwind's logical utilities, mirroring only arrow-like icons) and asked for the list to be reviewed. The user confirmed the reviewed list ("this is basically an exhaustive list") and asked for the lint guards and the pseudo-RTL test from day one ("yes please"). Real testing in an RTL language comes after the MVP; the rules and automated guards apply from the first screen.
- **Decision: rules (web).**
  1. **Direction and language on the document:** `<html lang dir>` set from the user's locale (`dir="rtl"` for Arabic, Hebrew, Persian, Urdu); changing locale updates both without a reload.
  2. **Logical CSS only:** `margin/padding-inline-start/end`, `inset-inline-start/end`, `border-inline-start/end`, `border-start-start-radius` and the other logical radii, `text-align: start/end`, `float/clear: inline-start/inline-end`, `scroll-margin/padding-inline-*`. Physical `left/right` properties and values are forbidden except where marked as exceptions (below).
  3. **Tailwind logical utilities only:** `ms-*`/`me-*`, `ps-*`/`pe-*`, `start-*`/`end-*`, `text-start`/`text-end`, `border-s*`/`border-e*`, `rounded-s*`/`rounded-e*` (and `rounded-ss`/`se`/`es`/`ee`), `scroll-ms`/`me`/`ps`/`pe`, `float-start`/`float-end`. Prefer `gap-*` in flex and grid over `space-x-*` and `divide-x-*`, which aren't direction-aware (forbidden unless paired with `rtl:space-x-reverse` / `rtl:divide-x-reverse`).
  4. **Flex and grid** follow the inline direction automatically: don't reverse order manually for RTL; don't use `flex-row-reverse` to fake alignment.
  5. **Non-logical effects get an `rtl:` variant:** `translate-x-*` and directional animations, drawers and slide-in panels (enter from the inline-end side), `background-position`, box-shadow x-offsets, linear gradients defined left-to-right, carets and tooltips with a physical arrow side.
  6. **Mirrored icons, only those with a direction:** arrows, chevrons, back and forward, undo and redo, send, reply, "next/previous page", progress and slider direction, list indentation (outdent/indent), and "text direction" icons are mirrored in RTL (`rtl:-scale-x-100`). **Not mirrored:** checkmarks, play/pause and media controls, clocks and refresh-like circular arrows, logos and brand marks, slashes, search/magnifier, plus/minus, currency symbols, charts' own glyphs. Each icon in Budmon's icon set is tagged `mirrorInRtl: true|false` so the rule is decided once per icon.
  7. **Bidirectional text isolation:** user-generated text (payee names, notes, account names, tags, purposes) is rendered isolated (`dir="auto"` on its element or `<bdi>`, CSS `unicode-bidi: isolate`); placeholders inside ICU messages are wrapped in first-strong isolates (FSI…PDI) by a platform helper so an RTL message with an LTR payee name (or the reverse) renders correctly.
  8. **Always-LTR content, isolated:** amounts with their signs and currency codes (formatted by `Intl`, which emits the correct bidi marks for the locale), IBANs and account identifiers, card last-4 digits, phone numbers, email addresses, URLs, codes and references (the error "Reference"), and numeric dates when shown in numeric form. Inputs for these fields use `dir="ltr"` (or `dir="auto"` for free text), so the caret and alignment behave.
  9. **Tables** mirror column order (the first column is at the inline start); numeric columns align to the inline end; sort and expand indicators follow rule 6.
  10. **Charts:** in RTL, **time axes are mirrored** (earliest at the inline end, so time flows in reading direction), value axes sit at the inline start; legends and tooltips follow logical alignment. The chosen chart library must support this or the axis is transformed.
  11. **Keyboard:** arrow-key navigation in menus, tabs, sliders, grids and carousels reverses in RTL (Kobalte and TanStack handle their widgets; custom widgets read the direction from context). Keyboard shortcuts that mean "previous/next" follow the visual direction.
  12. **Fonts:** the font stack covers Arabic (for example Noto Sans with Noto Sans Arabic, or IBM Plex Sans with IBM Plex Sans Arabic), loaded with `unicode-range` so Latin-only users don't download Arabic glyphs; line height leaves room for Arabic diacritics.
  13. **Exceptions** to rules 2 and 3 (for example a physically placed decoration) are allowed only with an inline `rtl-exempt: <reason>` comment, which the lint rules recognise.
- **Decision: rules (Android).** `android:supportsRtl="true"`; `start`/`end` everywhere in XML; Compose follows `LayoutDirection` automatically, so no manual left/right padding or alignment (`Arrangement.Start`, `Alignment.Start`, `PaddingValues(start=…)`); `Icons.AutoMirrored.*` for directional icons and the same mirror tags as web for custom ones; swipe gestures are defined toward "start" or "end", not left or right (a "swipe to confirm" goes toward the end in both directions); bidi isolation via `BidiFormatter` / `TextDirectionHeuristics` for user-generated text and LTR content as in rules 7 and 8; fonts as rule 12.
- **Automated guards from day one:**
  - Web: **stylelint** with a logical-properties plugin (`stylelint-use-logical` from csstools) for any CSS; an **ESLint rule for Tailwind classes** forbidding physical utilities (`ml-`, `mr-`, `pl-`, `pr-`, `left-`, `right-`, `text-left`, `text-right`, `border-l`, `border-r`, `rounded-l`, `rounded-r`, `float-left`, `float-right`, `scroll-ml`/`mr`/`pl`/`pr`, unpaired `space-x-`/`divide-x-`), as a **custom ESLint rule** built in the first web slice (no maintained plugin does this); an ESLint rule that every icon used is from the tagged icon set.
  - Web: a **pseudo-RTL Playwright smoke run** on every pull request over the main screens with `dir="rtl"` and an RTL pseudo-locale (English text with RTL marks, so layouts flip while text stays readable): checks no horizontal overflow, runs axe (reported only, D-39), and asserts on **named probes**: components mark elements with `data-rtl-probe="start"` or `"end"` (must sit at the inline start or end edge of their container) and icons with `data-rtl-probe="mirror"` or `"no-mirror"` (must or must not have a horizontal flip applied), so tests can be written from the LLD; screenshots are stored for review.
  - Android: lint `RtlHardcoded`, `RtlCompat` and `RtlEnabled` as errors; Compose UI tests for key screens run once with `LayoutDirection.Rtl`; debug builds enable the `ar-XB` pseudo-locale for manual checks.
- **Blocking:** unlike accessibility (D-39), the RTL guards block merges: the stylelint and ESLint rules fail the lint stage, the pseudo-RTL run's overflow and probe assertions fail the end-to-end stage, and Android's RTL lint checks are errors. They're deterministic and each finding is a one-line fix, and they're what the user asked for from day one.
- **After the MVP:** testing in a real RTL language (Arabic), including number formatting choices (rule in D-37), text expansion and font rendering.
- **Rationale:** RTL bugs are cheap to prevent with lint and expensive to fix after hundreds of screens exist. The list adds to the user's rules what usually breaks next: document direction, bidi isolation of mixed text, always-LTR data, tables, charts, keyboard direction, fonts and Android specifics.

### D-39: Accessibility baseline from day one, reported but not blocking; formal WCAG 2.2 AA audit considered before going public (user decision, Q-21: "yes pay attention to it, just note that it's not a showstopper")
- **Context:** the user asked whether accessibility is a big requirement, then accepted the baseline with the condition that it isn't a showstopper. Retrofitting accessibility (semantics, focus handling, labels) into finished screens costs far more than building it in, while a formal audit is expensive and only needed when strangers use the app.
- **Options considered:** (a) none until public launch; (b) **a baseline from day one, formal audit before going public**; (c) full WCAG 2.2 AA conformance and audit from the start. Enforcement of (b): (b1) automated checks block merges and releases; (b2) **automated checks report; only a few deterministic lint rules block**; (b3) everything advisory.
- **Decision:** (b) with (b2). The baseline is what screens are designed and reviewed against:
  - **Web:** semantic HTML (landmarks, headings, lists, real `<button>`/`<a>`, `<table>` or grid semantics); interactive widgets only from Kobalte primitives or reviewed custom code; every control has an accessible name and visible label; full keyboard operability with a visible focus indicator and focus management on route changes, dialogs and errors; text contrast at least 4.5:1 (checked on the design tokens) and 3:1 for UI components; meaning never by colour alone; `aria-live` for asynchronous results (§4.5); `prefers-reduced-motion` respected; target size at least 24 × 24 CSS px; zoom to 200% without loss.
  - **Android:** content descriptions for icons, TalkBack basics (labels, roles, logical traversal order, merged semantics for list rows), touch targets at least 48 dp, font scaling to 200%.
  - **Reported, never blocking:** **axe checks in Playwright** on every screen (including the pseudo-RTL run, D-38), the design-token contrast check, and Android's accessibility checks in Compose UI tests and Android lint's accessibility category (configured as non-fatal, D-27). Findings are published as a CI summary and annotations on the pull request and on release candidates, with serious and critical violations listed first; they never fail a merge or a release.
  - **Still blocking, because they're trivial to fix and deterministic:** a small set of static lint rules on the web (`jsx-a11y`-style rules that apply to Solid's JSX): images have `alt`; form controls and icon-only buttons have an accessible name; `aria-*` attributes and roles are valid; no positive `tabindex`. Each is fixed by one attribute on the flagged line, is caught while writing the code (not by a flaky runtime scan), and accessible names are needed anyway: the test-architect's Playwright and Testing Library tests find elements by role and name (`getByRole('button', { name })`), so a missing name already breaks tests. On Android, the equivalent (`contentDescription` on icons) stays a review item rather than a blocking lint, because Android lint can't tell decorative images from meaningful ones in Compose.
  - **Before going public (stage 2):** a formal WCAG 2.2 AA audit of the web app and an Android accessibility review are on the stage-2 list (§12); whether they gate the public launch is decided then.
- **Rationale:** the baseline costs little per screen when it's built in, and reporting keeps it visible without ever holding up a merge or release, as the user asked. The handful of blocking rules are the ones that cost seconds to satisfy and that the tests depend on anyway.

### D-40: Encryption at rest for the main VM's data, from the stage-1 gate (user decision: deferred to "before I start inviting people", Q-15; the owner gets this explained in full before the gate)
- **In plain terms.** From stage 1, Budmon's database is stored on a disk in the hosting provider's data centre. Encryption at rest scrambles everything on that disk with a passphrase only you hold, so anyone who gets a *copy* of the disk (a leaked snapshot, a drive that's replaced or recycled without being wiped, a mistake at the provider) gets unreadable data. The server can only read it while it's running and after you've given it the passphrase; when it restarts, it forgets the passphrase, so Budmon stays offline until you unlock it again: one command from your own computer, which asks for the passphrase (kept in your password manager) and takes about a minute. It does *not* protect against someone who breaks into the server while it's running, because at that moment the data is unlocked; the other protections (D-19's capture VM, hardening, alerts) cover that. If the passphrase is ever lost, the disk can't be read by anyone, including you, and Budmon is restored from the encrypted backups instead (which have their own passphrase, D-30).
- **Context:** the Postgres data files hold all financial data. VPS providers generally don't promise encryption at rest for server disks, so a copy of the disk would expose them regardless of the key split in D-19. The user deferred this to the stage-1 gate (D-29). In stage 0 the data is on the owner's laptop, protected by the laptop's own disk encryption (A-14).
- **Options considered:** (a) accept unencrypted data at rest; (b) **LUKS2 on a dedicated block device (a provider block volume, or where none exists a dedicated partition or a LUKS file container on the server disk), with the key only in memory, unlocked manually after each reboot**; (c) LUKS2 unlocked automatically through Clevis and Tang (network-bound disk encryption), with a Tang server on the capture VM over the private network; (d) LUKS on the root disk (needs an unlock step in early boot over the network, e.g. dropbear in initramfs; more fragile on cloud images).
- **Decision:** **(b) from the stage-1 gate** (D-29 gate items 6 and 13); stage 0 relies on the laptop's disk encryption. A 20 GB block device (volume, partition or file container) formatted with LUKS2 (AES-XTS, Argon2id key derivation) holds Postgres's data directory, pgBackRest's local spool, **Caddy's data directory** (TLS private keys and the ACME account, so a disk copy can't be used to impersonate `budmon.com`) and the main VM's age key. The passphrase exists only in the owner's password manager (with an offline copy). The root disk holds only the OS, images and scrubbed logs; swap is disabled. The capture VM has no data volume; its age key is only in tmpfs (D-20). Encryption at rest protects disk copies and snapshots, not a running VM: root on the running main VM can still read the database.
- **Unlock procedure** (stage 1; performed once end to end at the gate):
  1. A VM reboots: planned (the owner runs `budmonctl reboot`, which stops the stack cleanly) or unplanned (the owner receives "API down" or "capture worker heartbeat missing", D-25).
  2. On the owner's own machine, the unlock script opens `ssh owner@main budmonctl unlock`, which asks for the volume passphrase, opens the LUKS volume, mounts it, decrypts the main VM's SOPS files into tmpfs with the age key from the volume, and starts the stack.
  3. The script then opens `ssh -J owner@main owner@capture budmonctl unlock`, which asks for the capture VM's age key (end-to-end encrypted through the jump, never visible on the main VM, D-20) and starts worker-capture.
  4. The script waits for `/health/ready` and the capture heartbeat and prints the result; alerts resolve by themselves.
- **Boot ordering safeguards** (so a locked server, or a laptop whose data directory is missing, can't start an empty database). Postgres's data directory is a subdirectory (`pgdata/`) that exists only inside the volume, bind-mounted with Compose's `create_host_path: false`, so the container fails instead of creating an empty directory on the root disk; Budmon's Postgres image refuses to run `initdb` unless an explicit first-setup flag is set; pgBackRest refuses to archive or back up a cluster whose system identifier doesn't match the repository's. Containers whose secrets are missing (tmpfs is empty after a reboot) fail to start. The image behaviours are in Budmon's Postgres image **from the first release** (D-29's stage rule), where they also stop a stage-0 VM from silently starting an empty database.
- **Operational cost:** after every reboot of either stage-1 VM (planned kernel updates, roughly monthly; rare host migrations or crashes), Budmon is down until the owner unlocks it. Detection: a locked VM can't report itself, so the external synthetic check (main VM) or the missing capture heartbeat (capture VM) fires (D-25); "reboot required" is reported while the VM is still running. Option (c) removes the manual step (each VM unlocks automatically if it can reach the other over the private network), at the cost that a copy of **both** VMs' disks can unlock itself; it's the fallback if manual unlocks become a burden, and switching is an infrastructure change only.
- **Rationale:** a volume is the simplest place to apply LUKS on a cloud VM (no early-boot networking), can be detached and attached to a rebuilt host, and puts every piece of user data behind one passphrase that never touches the disk. Throughput cost of LUKS on this workload is negligible. Deferring it to the gate costs nothing in code (it's below the application) and spares the owner manual unlocks while they're the only user.

### D-41: Release rehearsal in CI instead of a staging environment (user decision: no staging; planner decision for the replacement)
- **Options considered:** a staging server (rejected by the user); installing releases straight into production with only the regular CI suites; **an ephemeral, production-shaped stack in CI**.
- **Decision:** on every `release/*` and `hotfix/*` pull request (and, from stage 1, again on the tagged commit before signing; D-29 rule 4), CI runs a **release rehearsal** on a GitHub-hosted runner. Its shape follows the production topology of the current stage.
- **Stage-0 shape (from the first release):**
  1. Builds the release images from the same inputs as `budmon-local upgrade` on the laptop (the same Dockerfiles, pinned base-image digests and frozen lockfile). They aren't necessarily byte-identical to the laptop's builds; stage 1 removes the difference by deploying the CI-built images themselves.
  2. Builds the **previous release's database** from its committed migrations, with the pg-boss schema and queues, and loads the test-architect's upgrade fixtures (raw SQL, D-12).
  3. Runs the new image's `migrate` container against it (the same `pnpm db:migrate` as production, including the journal and hash verification).
  4. Starts the **laptop's Compose files** (`budmon-main` and `budmon-capture` joined by `capture-db`, Caddy on HTTP, worker-capture connecting as `budmon_capture` over TLS `verify-full` with a throwaway CA, per-role secret mounts) with a CI overlay. The stand-ins are used only where production uses external services:
     - MinIO for B2;
     - a local key provider for KMS (`APP_ENV=rehearsal`);
     - a fake FX provider;
     - Mailpit for email; an FCM fake;
     - a **fake Google endpoint** (OAuth token exchange, Gmail history and messages, Pub/Sub). It returns canary tokens and canary message content, and also error responses shaped like Google's client errors (including Gaxios errors carrying request config), so capture's privacy paths are exercised;
     - Sentry DSNs pointing at a local capture endpoint;
     - throwaway secrets generated per run.
  5. Runs the upgrade test assertions against the migrated data.
  6. Runs the **privacy canary flows** through Caddy (API requests, worker jobs, failing jobs, unexpected errors). Then it scans every container's Docker `json-file` log, Caddy's access and error logs, Postgres's log, the captured Sentry events and `pgboss.job` output. Any canary match fails the rehearsal.
  7. Checks:
     - that no application container's environment or mounts reveal a stage setting;
     - that no main-side container has a capture secret mount;
     - `/health/ready`, the maintenance switch, and a rollback (start the previous release's images on the migrated database and expect ready);
     - the gate commands: the `api-secrets` re-wrap, `restore:verify` on a dump-and-restore copy, and erasure replay (D-29 rule 3 (c)).
  8. Runs a Playwright smoke suite against the composed stack.
- **Server shape (added by the stage-1 LLD, before the gate; D-29 gate item 3).** The rehearsal then also runs:
  - the stage-1 topology: worker-capture behind the egress proxy on a tunnel-shaped network, Alloy with its allowlist and file sink, pgBackRest to MinIO with a restore;
  - verification of the deploy bundles and of real signatures against the trust anchors, and the bootstrap's release-acceptance rule;
  - infrastructure-only releases (previous application images, new bundles).

  The production deploy then uses the very images the tagged-commit rehearsal ran.
- **What the rehearsal doesn't cover:** the real external services (Google KMS, Pub/Sub and Gmail, B2, Let's Encrypt, Tailscale, Grafana Cloud's own processing), and the hosts themselves (Windows, WSL2 and Docker Desktop in stage 0; kernels, firewalls, the tunnel and LUKS from stage 1). Mitigations:
  - integration adapters have contract tests against fakes;
  - `budmon-local upgrade` (stage 0) and the deploy script (stage 1) wait for readiness and roll back on failure;
  - from stage 1, production alerting includes the telemetry drop counters;
  - the stage-1 hosts are dry-run on throwaway servers (D-29 gate item 4).

  This residual risk is the price of having no staging.
- **Rationale:** the rehearsal reproduces the parts of staging that catch the most expensive mistakes (a migration that loses data, a configuration that leaks, a release that doesn't start or can't roll back) on every release, at no hosting cost, and in the shape production actually has at each stage.

## 9. Risks

| Risk | Impact | Mitigation |
| ---- | ------ | ---------- |
| oRPC is young and evolving (a v2 is in development). | API churn could force rework of contract or handler code. | Pin an exact version; keep oRPC behind the platform's procedure bases, codec and error interceptor; the OpenAPI document is the stable external contract. |
| OpenAPI Generator's Kotlin output may handle oRPC's OpenAPI 3.1 output poorly (unions, `oneOf`, nullable), and the money codec's override may not apply to both input and output schemas. | Android compile errors, `String` instead of `Long`, or web amounts typed as strings. | **First contract slice spike:** emit `openapi.json` for representative shapes (money in inputs and outputs, nested objects, discriminated unions, nullable fields, enums, the error envelope), generate and compile the Kotlin client, check the web's inferred types; the contract-rules test (D-6) then guards the result. |
| pg-boss's transactional `send` through a Drizzle transaction under a different database role. | Privilege errors on maintenance-created objects, or a weaker enqueue guarantee. | Verified in the first queue slice with integration tests (default privileges from `budmon_queue`); fallback: grant explicit privileges in the queue schema step. |
| One host holding the database (the laptop in stage 0, the main server in stage 1): a host failure, a full disk, or a bad update takes production down; Postgres is self-managed. | Downtime (best effort accepted, P9). Data loss: stage 0 everything since the last local dump if the laptop's disk fails (accepted); from stage 1 bounded by WAL archiving (about 5 minutes). | From stage 1: health, disk, memory, backup-age and WAL-archive alerts (D-25); a restore drill at the gate, then every 3 months (D-30); cloud-init and OpenTofu rebuild a host in under an hour; no snapshots of production (§7.5): a broken host is rebuilt, not restored from a snapshot. |
| Compromise of the host. | Stage 0 (the laptop): exposes everything, including the ability to decrypt the owner's Gmail token until the KMS key is revoked (owner's data only; accepted). Stage 1: the main server exposes the database, but not capture secrets; the capture server can decrypt capture secrets until revoked. | Stage 0: no inbound ports, KMS audit logs in Google Cloud. From stage 1: hardening, signed images and user-approved forced-command deploys (§7.5); a capture server with no inbound internet access, KMS audit and rate alerts with instant revocation (D-19). |
| Manual unlock after reboots, from stage 1 (D-20, D-40). | Budmon stays down after an unplanned reboot until the owner unlocks it. | Alerts for "locked" and "reboot required"; reboots scheduled by the owner; the unlock procedure rehearsed at the gate; automatic Clevis/Tang unlock as the fallback, an infrastructure change only. |
| The whole server-deployment chain (bundles, bootstrap, signing, tag protection, servers, tunnel, proxy, LUKS, backups, monitoring) is first built for stage 1. | A long or failed stage-1 gate; invitations wait. | It's designed in full now (D-29 rule 4, D-19, D-30, D-40, D-41); the stage-1 LLD and its server-topology rehearsal land before the gate; a dry run on throwaway servers; cutover from the laptop with the laptop able to resume until stage 1 is ready (gate items 3, 4 and 10). |
| Stage-0 exposure carried into stage 1: secrets and data that sat on the laptop. | Stage 1's protection would be weaker than it claims. | Fresh secrets on the servers; the `api-secrets` key rotated after the cutover; the laptop's KMS key deleted; laptop copies deleted; Gmail reconnect recommended (gate items 9 and 11). |
| The stage-1 gate is skipped or left half done under time pressure. | Other people's data on stage-0 infrastructure. | The gate is a checklist in the repository ticked in a pull request the user merges, and "no invitation before the gate" is a rule in it (D-29); Gmail in testing mode can't be connected by anyone not added as a test user. |
| Code that only stage 1 needs at the network level drifts into stage-specific code. | Breaks the stage rule; the cutover needs a code change. | No stage setting exists in the configuration schema; proxy support and TLS for `budmon_capture` are unconditional; the code-reviewer checks for topology branches (D-29). |
| No staging environment (any stage). | Problems that only appear with real external services or the real VMs surface in production. | Release rehearsal in CI (D-41), readiness-gated deploys with automatic rollback, production alerting including Alloy drop counters. |
| Cheap VPS capacity is scarce in 2026 (Hetzner's cheap tier unavailable since early September 2026; prices rose). | Stage 1 costs more or waits for capacity. | Stage 1 is provider-neutral (WireGuard instead of a provider network, LUKS on any block device); the provider is chosen at the gate (D-29). |
| **No off-site backups in stage 0** (user's decision). | A lost, stolen or failed laptop loses all data. | Accepted by the user. Local pre-upgrade dumps protect against bad releases only; the user's own data export (XC-17) is an optional manual safeguard; the laptop's disk encryption protects a stolen laptop (A-14). |
| The laptop is off, asleep or offline (stage 0). | The web app is unavailable; Gmail capture, FX fetches and reminders run late. | Android's offline outbox (J-4); Pub/Sub retains notifications for 7 days; watch renewal and the safety-net sync on start-up (`sources`); the FX gap check (D-15, D-29); modules state catch-up behaviour per scheduled job (D-29). |
| Windows-specific friction (line endings, WSL2 networking, Android Studio outside WSL2). | Broken scripts or a slow inner loop. | `.gitattributes`, everything scripted for WSL2/Linux only, `networkingMode=mirrored`, a Windows-side clone for Android Studio only (D-29). |
| Solid 2.0 is at release candidate; Kobalte is pre-1.0. | A framework migration soon after launch; component library gaps or breaking changes. | Start on Solid 1.9; migrate when 2.0 and the libraries are stable; spike the accessible components first (D-7); keep UI primitives behind Budmon's own component layer. |
| FX: the free plan's terms may not allow Budmon's use; the fallback (`fawazahmed0/exchange-api`) has no SLA and aggregated sources. | The fallback becomes the primary; its rates may differ slightly from Open Exchange Rates'. | `provider` recorded per stored day; no paid plan without asking the user (D-15). |
| Backblaze B2's compatibility with pgBackRest and its key capabilities weren't verified here. | Backup or least-privilege design needs adjusting. | Verified in the backup slice; fallback another provider's S3-compatible object storage in another location (D-30, D-35). |
| Free-tier limits (Sentry about 5k errors a month; Grafana 10k series and log volume). | Missing data in an incident storm. | SDK sampling and rate limits; series budget (D-25); Alloy drops verbose host metrics; monthly usage check. |
| A privacy leak through an SDK default, an infrastructure log, or a runtime error message. | Breaks PLT-BR-1. | D-24's boundaries, Alloy's attribute allowlist, CI canary suite (including job output), release-rehearsal canary scan of unfiltered and filtered logs (D-41), Alloy drop alerts in production, scrubber tests in each app. |
| Gmail OAuth "In production" without verification (Q-11 (b), accepted): token lifetime unconfirmed. | Weekly reconnection if tokens still expire. | The spike before `sources` is designed; fallback (a) weekly reconnection with a one-tap prompt; token expiry is a connection state, not an alert (D-25). |
| Release-time migrations (D-12): data-preserving changes are deferred until a release is cut. | A missed rename or backfill could lose data in production; a `drizzle-kit` upgrade could break the prompt driver. | Release migration notes in each LLD; the pending-changes report on every pull request; the pseudo-terminal driver lists every ambiguity; upgrade test and risky-statement check; the release rehearsal (D-41) migrating a copy of the previous release's database; PITR (D-30). |
| Exact-money discipline erodes (someone uses `number` arithmetic). | Rounding drift, violating XC-1. | Branded `Money` type, codec, lint rules, shared test vectors, review checklist. |

## 10. Assumptions

| ID | Assumption |
| -- | ---------- |
| A-1 | PLT-BR-6 ("ingestion runs in workers, never in the API") allows the API to **receive** inbound data that can only arrive over HTTP (SMS uploaded by the Android app, OAuth callbacks), as long as it only validates, seals, stores and enqueues it. |
| A-2 | The platform owns currency reference data, market rates and conversion (D-15). |
| A-3 | The repository is (or will be) hosted on GitHub, so CI is GitHub Actions and images go to GitHub Container Registry. |
| A-4 | Load: stage 0, one user; stage 1 (invite-only), up to about 100 users, 100 to 300 transactions per user per month, a few requests per second at peak. |
| A-5 | API messages are English-only and for developers; clients localise by error key. |
| A-6 | Android minimum version is 8.0 (API 26). |
| A-7 | One product owner (A28) receives all alerts by email; their address lives in deployment configuration. |
| A-8 | No single amount exceeds ±(2^53 − 1) minor units (D-14). |
| A-9 | Two-step verification secrets (IDN-US-8) are verified inside the API, so they use the `api-secrets` key, not the capture key (D-19). |
| A-10 | Matching a transaction's local calendar date to the rate of the same UTC day is acceptable precision (D-15). |
| A-11 | An EU region of the stage-1 provider (chosen at the gate) suits the invited group (EU data location, reasonable latency to Europe and the Middle East). |
| A-12 | Android builds reach the invited group through Firebase App Distribution (v0.3 Q-8, unanswered; recommendation stands). |
| A-13 | The first slice's pull request proposes CLAUDE.md's "Project conventions" text for the user to approve (v0.3 Q-10, unanswered; recommendation stands). |
| A-14 | The owner's Windows laptop has full-disk encryption on (BitLocker on Windows Pro, or Windows device encryption on Home), so WSL2's virtual disk, Docker Desktop's data and the stage-0 secret files are encrypted at rest. This is the only at-rest protection in stage 0. |
| A-15 | The laptop has at least 16 GB of RAM and a 64-bit Windows 10 22H2 or Windows 11 with virtualisation enabled (WSL2 and Docker Desktop requirements); the stage-0 stack needs about 3 GB. |
| A-16 | Google allows an `http://localhost` redirect URI on Budmon's "Web application" OAuth client while the app is in testing mode, so Gmail can be connected from the laptop's browser in stage 0 (D-29). |

## 11. Open questions

**Resolved by the user** (2026-10-05, [platform decisions](../../product/notes/2026-10-05-platform-decisions.md)):

| Question | Answer | Recorded in |
| -------- | ------ | ----------- |
| v0.3 Q-1 Backups | Accepted: daily, 14 days, 7-day PITR. | D-30 |
| v0.3 Q-2 Capture-only key scope | Accepted as proposed. | D-19 |
| v0.3 Q-3 Alerts | Accepted. | D-25 |
| v0.3 Q-4 Hosting | Hetzner (or an inexpensive self-managed server); design for the invite-only stage (now infrastructure stages 0 and 1). Since 2026-10-07: stage 0 on the owner's laptop; the stage-1 provider is chosen at the gate. | D-29 |
| v0.3 Q-11 Gmail publishing status | (b) "In production" without verification, confirmed by a spike before `sources`; (a) as fallback. | §9, D-25 |
| v0.3 Q-12 Production pooler | None at launch; considered in stage 2. | D-18 |
| v0.3 Q-13 Release step | Accepted; the `/release` command is drafted when there's something to release. | D-12 |
| v0.3 Q-14 Hotfixes | From the last release. | D-12 |
| v0.3 Q-8, Q-10 | Not answered; recommendations stand. | A-12, A-13 |
| Q-16 API path | Major versions only: `/api/v1`. | D-36 |
| Q-17 App UI conventions | English first, accessible, calm and non-judgemental tone; languages supported from the start. | D-37; accessibility level in Q-21 |
| RTL rules | The user's rules, reviewed and extended; real RTL testing after the MVP. | D-38 |
| Q-18 FX budget / FX storage | Keep costs low; store only what's needed, USD-based daily rates where possible. | D-15: Open Exchange Rates free plan, $0 |
| Q-19 Staging | One environment, no staging, in every infrastructure stage before going public. | D-29, D-41 |
| Q-20 Domain | `budmon.com` (fallback `budmon.io`), subject to availability. Since 2026-10-07: bought at the stage-1 gate, not before stage 0 ("not needed until the first server"). | D-36, D-29 |
| Rollout stages (new) | "the codebase/logic is planned for two stages: invite-only and public and the infrastructure is planned for 3: just me, invite-only, and public." | D-29 (stages, stage rule, kept-from-day-one list, stage-1 gate, costs) |
| Q-15 Capture isolation | Dedicated capture server, "right before I start inviting people" (the user said Hetzner; the provider is now chosen at the gate). | D-19, D-29 gate item 5 |
| Q-15 Encryption at rest and manual unlock | Decided for the stage-1 gate; the owner gets it explained in more detail before then. | D-40 (plain-terms paragraph, unlock procedure), D-29 gate items 6 and 13 |
| Stage 0 on the laptop (2026-10-07) | "for the first version, we're not going to use a vps … the just me, it can just run on my laptop"; Windows. | D-29, D-28 |
| Phone access in stage 0 | Tailscale away from home, LAN at home (accepted). | D-29 (one Tailscale HTTPS address used everywhere) |
| Off-site backups in stage 0 | Declined: "except for the off-site backup, I don't care enough about it right now". | D-29, D-30 (accepted risk), §9 |
| Q-21 Accessibility | Baseline accepted: "yes pay attention to it, just note that it's not a showstopper". Automated checks report and don't block; a few static lint rules still block. | D-39, D-26, D-27 |
| Connection pooler | Considered "when we start thinking about making the application go public". | D-18, §7.6 (stage 2) |
| RTL list | "this is basically an exhaustive list"; lint guards and the pseudo-RTL test from day one: "yes please". | D-38 (already in place; confirmed, blocking) |
| Q-1 Blocking accessibility lint rules (raised by the v0.8 plan review) | Not answered explicitly at approval; the recommended option (a) is recorded: the four static web lint rules (`alt` on images; accessible names on form controls and icon-only buttons; valid `aria-*` attributes and roles; no positive `tabindex`) stay blocking. The user can change this to (b), everything report-only, at any time. | D-39 |
| Q-1 (from the platform LLD) Exchange rates before 2024-03-02 | Option (a), the recommended default, accepted by the user's go-ahead on 2026-10-07: conversions dated before the fallback provider's floor (2024-03-02) with no stored day return "no rate". Extendable later by an LLD amendment (for example an Open Exchange Rates historical backfill, if its free plan allows it). | D-15; LLD F-132 |

**Open** (for the user):

| # | Question | Options | Blocks |
| - | -------- | ------- | ------ |
| Q-2 (from the platform LLD, **deferred to stage 1**) | **An owner approval click on every release, not only hotfix/infra releases.** It belongs to the release-signing chain, which now starts at stage 1 (D-29 rule 4); stage 0 has no signing. | Keep it (one click per release; protects against an agent merging a release PR under the owner's account), or drop it. | The stage-1 LLD. |


## 12. Out of scope / future work

- **Stage 2 (public), designed when going public is decided:** dedicated or managed Postgres with a replica, a transaction-mode pooler (D-18), several API hosts behind a load balancer, separate worker hosts, a CDN for the SPA (§7.6); Postgres row-level security (D-23); a staging environment; a formal WCAG 2.2 AA audit and Android accessibility review (D-39); real RTL testing in Arabic (after the MVP, D-38); Google verification and security assessment, Play Store SMS compliance (spec §5 Later).
- Full-disk encryption on the servers; high availability; cross-provider failover.
- **Stage 1's server-deployment machinery** is designed here (D-29 rule 4, D-19, D-30, D-40, D-41) but specified in a separate stage-1 LLD written before the first invitation.
- Off-site backups in stage 0 (declined by the user).
- An OpenTelemetry Collector beyond Alloy's allowlist; client-side trace export (D-24).
- Real-time updates (SSE or WebSockets) if a later story needs them (§5.2).
- A persisted offline read cache and full offline use on Android (XC-22, later).
- A separate egress design for user-hosted AI endpoints (XC-12, flagged for `capture`, D-19).
- Kotlin Multiplatform data layer when iOS is scheduled (D-8); CORS or a custom protocol for the Electron app (D-36).
- The `/release` command (D-12, drafted when there's something to release).
- Turborepo or Nx if builds get slow (D-5); BullMQ on Redis if job volume outgrows Postgres (PD); table partitioning only if ever needed (PD).
- A status page; a second independent uptime check; an in-app error and health view for the owner (spec P22).
