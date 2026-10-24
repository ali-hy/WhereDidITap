# Stage 0: Budmon on the Windows laptop

Budmon's stage 0 runs on the owner's Windows laptop: Docker Desktop with the WSL2 backend, with the
repository and every command inside WSL2 (Ubuntu). The phone reaches it over Tailscale. This
runbook is the first installation, in order, then everyday operation. `budmon-local` is described
in the platform LLD (F-178); its commands print a one-line reason for every failure.

## First installation

1. **WSL2.** In an administrator PowerShell: `wsl --install -d Ubuntu-24.04` (the current Ubuntu
   LTS), reboot, and create the Ubuntu user. This user needs `sudo`.
2. **Docker Desktop.** Install it with the WSL2 backend. In Settings: Resources → WSL integration →
   enable the Ubuntu distribution; General → "Start Docker Desktop when you sign in".
3. **WSL settings.** Copy `infra/local/wslconfig.example` to `%UserProfile%\.wslconfig` (NAT
   networking; the mirrored line stays commented out), then `wsl --shutdown` once.
4. **Disk encryption.** Check that BitLocker or Windows device encryption is on (Settings → Privacy
   & security → Device encryption). Budmon's database and secret files live on this disk.
5. **The repository and tools, in Ubuntu:**
   - `git clone <repository URL> ~/src/budmon`, then in it `git config core.autocrlf false`;
   - Node 24 (for example through `nvm install 24`) and pnpm (`corepack enable`);
   - the Google Cloud CLI (`gcloud`, then `gcloud auth login`);
   - `jq`, `openssl` and `curl` (`sudo apt install jq openssl curl`).
6. **Tailscale** on Windows and on the phone, signed in to the same tailnet. In the admin console,
   enable MagicDNS and HTTPS certificates. Note the laptop's name: `<laptop>.<tailnet>.ts.net`.
7. **External accounts:**
   - Backblaze B2: buckets `budmon-exports` and `budmon-erasure-log` (region `eu-central-003`), a
     read-only application key for the API and a read-write key for the worker;
   - Sentry: two projects, `budmon-server` and `budmon-web` (a DSN each; the install asks for
     both), with e-mail alerts;
   - Google Cloud, in the project used below:
     - the Gmail OAuth client (web application) with the redirect
       `http://localhost:8080/api/v1/…` (Gmail is connected from the laptop's own browser);
     - the separate "Budmon sign-in" web client (scopes `openid email profile`, redirect
       `http://localhost:8080/api/v1/auth/google/callback`) and its Android client;
   - Open Exchange Rates: an app id.
8. **First install run:** `~/src/budmon/infra/local/budmon-local install <tag>` (the release tag,
   for example `v1.0.0`). Answer the prompts; Enter takes the default shown in brackets. Blank
   answers without a default are written as `__FILL_ME__`. The run stops at the placeholder check
   (exit 20) and lists the secret files and `site.env` keys still to fill.
9. **Google Cloud:** `~/src/budmon/infra/local/gcp-bootstrap.sh --project <project id>`. Then run
   the service-account key command it prints, which writes the key straight into its secret file.
10. **The remaining placeholders:** for each file the install listed,
    `~/src/budmon/infra/local/budmon-local secret set <role>/<service>/<KEY>` (it prompts without
    echo; or pipe the value in). Edit the listed `site.env` keys in `~/.budmon/site.env`.
11. **Install again:** `~/src/budmon/infra/local/budmon-local install <tag>`. It builds the images,
    sets up Postgres, migrates and starts both stacks.
12. **PATH:** now that the install has created `~/.budmon/bin/budmon-local`, add
    `export PATH="$HOME/.budmon/bin:$PATH"` to `~/.bashrc` and open a new shell. From here on,
    `budmon-local` means that one.
13. **Tailscale Serve:** in Windows PowerShell, run the command the install printed:
    `tailscale serve --bg --https=443 http://127.0.0.1:8080`.
14. **Check:** open `https://<laptop>.<tailnet>.ts.net` on the laptop and on the phone (at home and
    on mobile data).
15. **The owner account:** `budmon-local bootstrap-owner --email <owner address>`, and open the
    printed link. E-mails (invitations, password resets) are read in Mailpit at
    `http://127.0.0.1:8025` on the laptop.
16. **Privacy checklist:**
    - `budmon-local logs caddy` shows `/api/v1/auth/google/callback` without its query string;
    - Tailscale Serve keeps no log of query strings (it has none by default): confirm no
      `tailscale serve` logging and no Funnel are enabled (`tailscale serve status`,
      `tailscale funnel status`).

Repository setting: "Allow merge commits" stays on, and hotfix merge-back pull requests are merged
with "Create a merge commit" (never squash or rebase), so the tagged commit stays an ancestor of
`main`.

## Everyday operation

| Task                              | Command                                                                       |
| --------------------------------- | ----------------------------------------------------------------------------- |
| Start, stop, restart              | `budmon-local start`, `stop`, `restart`                                       |
| State, containers and readiness   | `budmon-local status`                                                         |
| Logs                              | `budmon-local logs [-f] [service]`                                            |
| Upgrade to a new release          | `budmon-local upgrade <tag>`                                                  |
| Maintenance page                  | `budmon-local maintenance on`, `off`, `status`                                |
| Change one secret                 | `budmon-local secret set <role>/<service>/<KEY>`, then `budmon-local restart` |
| Restore a dump (with its release) | `budmon-local restore ~/.budmon/dumps/<file>`                                 |

`upgrade` dumps the database first (`~/.budmon/dumps/`, the newest five kept), migrates, starts the
new release and rolls back to the running one if it doesn't become ready. `restore` takes its own
safety dump (`…_pre-restore.dump`, never pruned) and switches databases only once the restored copy
has been migrated and verified; the previous database is kept as `budmon_old_<timestamp>` until the
next upgrade.

## Switching e-mail between Mailpit and a relay

To a relay:

1. Edit `~/.budmon/site.env`: `SMTP_URL=smtp://<user>@<host>:587` (or `smtps://<user>@<host>`)
   and `EMAIL_FROM`.
2. `budmon-local secret set main/worker-general/SMTP_PASSWORD` (prompted, hidden).
3. `budmon-local restart`.

Back to Mailpit:

1. Set `SMTP_URL=smtp://mailpit:1025` in `~/.budmon/site.env`.
2. `budmon-local secret set main/worker-general/SMTP_PASSWORD --empty`.
3. `budmon-local restart`, then read mail at `http://127.0.0.1:8025`.

Either way, `site.env` stays mode 0600, and an invalid `SMTP_URL` stops worker-general at start-up
with the configuration problem in its log.

## Android

Android Studio and `adb` run on Windows, from a Windows-side clone used only for Android work. The
emulator uses debug builds against the development stack (`pnpm dev`, `http://10.0.2.2:5173/`). The
phone gets the `stage0` release build (with `~/.budmon/android.properties`) over `adb` Wi-Fi
debugging from Windows.

## Gmail

While the Google OAuth app is in testing mode, its tokens expire about weekly: reconnect from the
laptop's browser when the connection shows "needs reconnect".

## Troubleshooting

- **Exchange rates lag after a power loss.** After the laptop loses power or a worker is killed,
  rates may lag by up to about 10 minutes while an interrupted fetch expires. Nothing to do.
- **Postgres won't start** (so `restore` exits 18): stop the stack (`budmon-local stop`), move
  `~/.budmon/pg` aside (never delete it), `budmon-local maintenance on`, recreate an empty `pg/`
  owned by 999 (`sudo install -d -o 999 -g 999 -m 0700 ~/.budmon/pg`), run first setup with the
  current tag's files
  (`BUDMON_FIRST_SETUP=1 docker compose --project-directory ~/.budmon/releases/<tag> -p budmon-main -f ~/.budmon/releases/<tag>/compose.main.yaml --env-file ~/.budmon/releases/<tag>/local.env up -d postgres`
  with `BUDMON_TAG=<tag>` and `BUDMON_HOME=~/.budmon` exported), then `budmon-local restore` the
  chosen dump.
- **A command says "release copy mismatch"** (exit 3): run it as `budmon-local …` from `~/.budmon/bin`,
  not from the clone.

### A restore didn't finish

Use this whenever `~/.budmon/restore.inprogress` exists: `restore` exited 26, `upgrade` or `restore`
exited 27 ("a restore didn't finish"), or `budmon-local status` shows `restore unfinished`. The data
is safe; this finds where it is and puts it back. **Rules:** never drop a database by hand (the
next successful `upgrade` drops leftovers once the marker is gone); remove the marker only in step 7,
after its check; keep maintenance on until you have looked at the data.

1. **Read the facts.** `budmon-local status` prints the marker's lines: `tag` (**T**, the restored
   release), `from` (**F**, the release before), `old` (**O**, `budmon_old_<ts>`) and `failed`
   (**X**, `budmon_restore_failed_<ts>`). `cat ~/.budmon/state` gives `current` (**C**). Note the
   newest safety dump: `ls -t ~/.budmon/dumps/*_pre-restore.dump | head -n 1`.
2. **Helpers**, in one shell, with the values from 1:

   ```bash
   export BUDMON_HOME=~/.budmon BUDMON_TAG=<C>
   R=~/.budmon/releases/<C>
   main()    { docker compose --project-directory "$R" -p budmon-main    -f "$R/compose.main.yaml"    --env-file "$R/local.env" "$@"; }
   capture() { docker compose --project-directory "$R" -p budmon-capture -f "$R/compose.capture.yaml" --env-file "$R/local.env" "$@"; }
   pgsql()   { main exec -T -u postgres postgres psql -v ON_ERROR_STOP=1 -X -q -U budmon_admin -d postgres -At; }
   ```

3. **Quiesce.** `budmon-local maintenance on`; `main stop api worker-general`;
   `capture stop worker-capture`; `main up -d postgres`, then repeat
   `main exec -T -u postgres postgres pg_isready -q -h /var/run/postgresql -U budmon_admin -d postgres`
   until it exits 0. If Postgres won't start, follow "Postgres won't start" above and leave the
   marker in place.
4. **List the databases:**
   `echo "SELECT datname || ' ' || datallowconn FROM pg_database WHERE datname IN ('budmon', 'budmon_restore', '<O>', '<X>') ORDER BY 1;" | pgsql`
5. **Classify:** take the first row that matches ("present" means exactly these of the four names).

   | Present                    | C               | Layout      | What happened                                                                                                                                                 |
   | -------------------------- | --------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
   | `budmon`, `budmon_restore` | F               | **L1**      | Nothing was renamed (killed before the first rename, or the restore put the names back). `budmon` holds the data from before the restore.                     |
   | `O`, `budmon_restore`      | F               | **L2**      | Half done: killed between the two renames. `O` holds the data from before the restore.                                                                        |
   | `budmon`, `O`              | T, and T ≠ F    | **L3-done** | The restore completed (`state` is written only after the restored release was ready); only the marker's removal was missed. `budmon` holds the restored copy. |
   | `budmon`, `O`              | F, and T ≠ F    | **L3-undo** | Half done: both renames happened, but the restored release was never proven ready.                                                                            |
   | `budmon`, `O`              | T = F           | **L3-same** | The same release was restored, so `state` can't tell L3-done from L3-undo. `budmon` holds the restored copy, which passed `restore:verify`.                   |
   | `O`, `X`                   | F               | **L4**      | The undo stopped after its first rename.                                                                                                                      |
   | `budmon`, `X`              | F               | **L5**      | The undo's renames are done; only re-opening `budmon` and removing the marker are missing. `budmon` holds the data from before the restore.                   |
   | anything else              | neither T nor F | **none**    | Change nothing. Keep the marker and maintenance on: while the marker exists nothing drops any of these databases, and the safety dump from 1 is intact.       |

6. **Recover.** Run the statements through `pgsql`, one per line. Before any `RENAME`, run
   `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname IN ('budmon', 'budmon_restore', '<O>', '<X>') AND pid <> pg_backend_pid();`;
   if a `RENAME` reports that the database is being accessed, terminate again and repeat it. On any
   other error, stop there, leave the marker, and classify again from 4.
   - **L1:** `ALTER DATABASE budmon WITH ALLOW_CONNECTIONS true;` then
     `ALTER DATABASE budmon_restore RENAME TO "<X>";` (so the next successful `upgrade` drops the
     unused copy). Finish with F.
   - **L2:** `ALTER DATABASE "<O>" RENAME TO budmon;` `ALTER DATABASE budmon WITH ALLOW_CONNECTIONS true;`
     `ALTER DATABASE budmon_restore RENAME TO "<X>";`. Finish with F.
   - **L3-undo:** `ALTER DATABASE budmon WITH ALLOW_CONNECTIONS false;` `ALTER DATABASE budmon RENAME TO "<X>";`
     `ALTER DATABASE "<O>" RENAME TO budmon;` `ALTER DATABASE budmon WITH ALLOW_CONNECTIONS true;`. Finish
     with F.
   - **L4:** `ALTER DATABASE "<O>" RENAME TO budmon;` `ALTER DATABASE budmon WITH ALLOW_CONNECTIONS true;`.
     Finish with F.
   - **L5:** `ALTER DATABASE budmon WITH ALLOW_CONNECTIONS true;`. Finish with F.
   - **L3-done:** `ALTER DATABASE budmon WITH ALLOW_CONNECTIONS true;`, then
     `ln -sfn ~/.budmon/releases/<T>/budmon-local ~/.budmon/bin/budmon-local`. Finish with T. `O` is
     kept until the next successful `upgrade`, as after any restore.
   - **L3-same:** `ALTER DATABASE budmon WITH ALLOW_CONNECTIONS true;`. Finish with T. If the
     readiness check in 7 fails, stop the app services as in 3, write the marker back
     (`printf 'tag=%s\nfrom=%s\nold=%s\nfailed=%s\n' <T> <F> <O> <X> > ~/.budmon/restore.inprogress; chmod 0600 ~/.budmon/restore.inprogress`),
     do L3-undo, and finish with F.
7. **Finish with `<tag>`:**
   1. Repeat 4. The listing must name exactly two databases: `budmon` with `t`, plus `<X>` (after
      L1, L2, L3-undo, L4 and L5) or `<O>` (after L3-done and L3-same), whatever the leftover's own
      flag. Otherwise stop, with the marker in place.
   2. `rm ~/.budmon/restore.inprogress`.
   3. `budmon-local start` (it starts `state.current`, which is `<tag>` in every layout).
   4. `budmon-local status` until `/health/ready` reports ready (about 2 minutes at most).
   5. Open Budmon and check the data is the expected one (from before the restore after F; the
      restored copy after T), then `budmon-local maintenance off`.

   If 4 never reports ready in L3-done, the restored release had already been ready once: treat it
   as an ordinary outage (`budmon-local logs`) and rename nothing.

8. To try the restore again afterwards, run `budmon-local restore <dump>` as usual.
