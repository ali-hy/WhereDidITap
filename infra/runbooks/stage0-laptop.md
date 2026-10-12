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
   - Sentry: a project `budmon-server` (its DSN) with e-mail alerts;
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
    `budmon-local secret set <role>/<service>/<KEY>` (it prompts without echo; or pipe the value
    in). Edit the listed `site.env` keys in `~/.budmon/site.env`.
11. **Install again:** `~/src/budmon/infra/local/budmon-local install <tag>`. It builds the images,
    sets up Postgres, migrates and starts both stacks.
12. **PATH:** add `export PATH="$HOME/.budmon/bin:$PATH"` to `~/.bashrc`, and open a new shell.
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
