# shellcheck shell=bash
# budmon-local (F-178, F-191): secret files, their owners, site.env and the placeholder check.

# Each service directory and its container UID (F-175's Compose `user:` values).
SERVICE_DIRS=(main/api main/worker-general capture/worker-capture main/migrate main/postgres)

service_uid() {
  case "$1" in
    main/api) echo 10001 ;;
    main/worker-general) echo 10002 ;;
    capture/worker-capture) echo 10003 ;;
    main/migrate) echo 10004 ;;
    main/postgres) echo 999 ;;
    *) return 1 ;;
  esac
}

# The files `secret set` may write: F-191's table, plus GCP_CREDENTIALS and the TLS and CA files.
allowed_secret() {
  local dir="$1" key="$2" allowed
  case "${dir}" in
    main/api) allowed="DB_PASSWORD CURSOR_KEY RATE_LIMIT_HMAC_KEY API_SECRETS_KEYS RECOVERY_CODE_HMAC_KEYS S3_ACCESS_KEY_ID S3_SECRET_ACCESS_KEY CAPTURE_PUBLIC_KEY GOOGLE_SIGNIN_CLIENT_SECRET" ;;
    main/worker-general) allowed="DB_PASSWORD QUEUE_DB_PASSWORD SMTP_PASSWORD S3_ACCESS_KEY_ID S3_SECRET_ACCESS_KEY FX_PRIMARY_APP_ID CAPTURE_PUBLIC_KEY" ;;
    main/migrate) allowed="DB_PASSWORD ROLE_SECRETS" ;;
    main/postgres) allowed="ADMIN_PASSWORD MIGRATOR_VERIFIER TLS_KEY TLS_CERT" ;;
    capture/worker-capture) allowed="DB_PASSWORD MAILBOX_HMAC_KEY GCP_CREDENTIALS GOOGLE_OAUTH_CLIENT_SECRET CAPTURE_PUBLIC_KEY DB_CA_CERT" ;;
    *) return 1 ;;
  esac
  [[ " ${allowed} " == *" ${key} "* ]]
}

# Hands each service directory to its container's UID: files 0400, directory 0500.
apply_secret_ownership() {
  local dir uid path
  for dir in "${SERVICE_DIRS[@]}"; do
    uid="$(service_uid "${dir}")"
    path="${BUDMON_HOME}/secrets/${dir}"
    # The files are still the WSL user's here (F-191 just wrote them), so the glob can list them.
    sudo chmod 0400 "${path}"/*
    sudo chmod 0500 "${path}"
    sudo chown -R "${uid}:${uid}" "${path}"
  done
}

# write_secret <role>/<service>/<KEY>: the value from stdin straight into the file, as its owner,
# mode 0400. The value is held in a shell variable only (never an argument, the environment or a
# temporary file). Exit 22 on an empty value.
write_secret() {
  local rel="$1" value="" dir key uid
  dir="${rel%/*}"
  key="${rel##*/}"
  uid="$(service_uid "${dir}")"
  if [ -t 0 ]; then
    IFS= read -rs -p "${rel}: " value || true
    echo >&2
  else
    IFS= read -r -d '' value || true
  fi
  [ -n "${value}" ] || die 22 "empty value for ${rel}; nothing written"
  printf '%s' "${value}" |
    sudo install -o "${uid}" -g "${uid}" -m 0400 /dev/stdin "${BUDMON_HOME}/secrets/${dir}/${key}"
  value=""
}

cmd_secret() {
  if [ "${1:-}" != "set" ] || [ "$#" -ne 2 ]; then usage; fi
  local rel="$2"
  [[ "${rel}" =~ ^(main|capture)/[a-z-]+/[A-Z0-9_]+$ ]] || die 64 "not a secret path: ${rel}"
  allowed_secret "${rel%/*}" "${rel##*/}" || die 64 "not a secret path: ${rel}"
  write_secret "${rel}"
  echo "written ${rel}"
  local current
  current="$(state_get current)"
  if [ -n "${current}" ] && [ -n "$(compose_for "${current}" main ps -q 2>/dev/null </dev/null)" ]; then
    echo "restart needed: budmon-local restart"
  fi
}

# ---- site.env (F-175's table order; A-385) ----

SITE_KEYS=(PUBLIC_ORIGIN GOOGLE_OAUTH_CLIENT_ID S3_ENDPOINT S3_REGION S3_BUCKET_EXPORTS
  S3_BUCKET_ERASURE_LOG SENTRY_DSN GOOGLE_SIGNIN_CLIENT_ID GOOGLE_SIGNIN_ANDROID_CLIENT_IDS
  GOOGLE_SIGNIN_CALLBACK_ORIGIN GOOGLE_SIGNIN_APP_ORIGINS SMTP_URL EMAIL_FROM)

site_default() {
  case "$1" in
    S3_ENDPOINT) echo "https://s3.eu-central-003.backblazeb2.com" ;;
    S3_REGION) echo "eu-central-003" ;;
    S3_BUCKET_EXPORTS) echo "budmon-exports" ;;
    S3_BUCKET_ERASURE_LOG) echo "budmon-erasure-log" ;;
    GOOGLE_SIGNIN_CALLBACK_ORIGIN) echo "http://localhost:8080" ;;
    GOOGLE_SIGNIN_APP_ORIGINS) echo "${SITE_PUBLIC_ORIGIN},http://localhost:8080" ;;
    SMTP_URL) echo "smtp://mailpit:1025" ;;
    EMAIL_FROM) echo "Budmon <no-reply@budmon.local>" ;;
    *) echo "" ;;
  esac
}

site_valid() {
  local key="$1" v="$2"
  local origin='(https://[A-Za-z0-9.-]+(:[0-9]+)?|http://localhost:[0-9]+)'
  case "${key}" in
    PUBLIC_ORIGIN) [[ "${v}" =~ ^[a-z0-9-]+\.[a-z0-9-]+\.ts\.net$ ]] ;;
    GOOGLE_OAUTH_CLIENT_ID | GOOGLE_SIGNIN_CLIENT_ID) [[ "${v}" == *.apps.googleusercontent.com ]] ;;
    S3_ENDPOINT | SENTRY_DSN) [[ "${v}" =~ ^https://[^[:space:]]+$ ]] ;;
    S3_REGION) [ -n "${v}" ] ;;
    S3_BUCKET_EXPORTS | S3_BUCKET_ERASURE_LOG) [[ "${v}" =~ ^[A-Za-z0-9-]{6,50}$ ]] ;;
    GOOGLE_SIGNIN_ANDROID_CLIENT_IDS)
      [[ "${v}" =~ ^[^,[:space:]]+\.apps\.googleusercontent\.com(,[^,[:space:]]+\.apps\.googleusercontent\.com)*$ ]] ;;
    GOOGLE_SIGNIN_CALLBACK_ORIGIN) [[ "${v}" =~ ^${origin}$ ]] ;;
    GOOGLE_SIGNIN_APP_ORIGINS) [[ "${v}" =~ ^${origin}(,${origin})*$ ]] ;;
    SMTP_URL) [[ "${v}" =~ ^smtps?://[^[:space:]]+$ ]] ;;
    EMAIL_FROM) [[ "${v}" =~ ^([^\<\>]*\<[^\<\>@[:space:]]+@[^\<\>@[:space:]]+\>|[^\<\>@[:space:]]+@[^\<\>@[:space:]]+)$ ]] ;;
    *) return 0 ;;
  esac
}

# One answer per key: `KEY [default]: ` on stderr, read from stdin; blank → the default, or
# __FILL_ME__ (an empty value for the optional Android ids); end of input answers blank.
prompt_site_key() {
  local key="$1" default answer
  while :; do
    default="$(site_default "${key}")"
    printf '%s [%s]: ' "${key}" "${default}" >&2
    if ! IFS= read -r answer; then
      answer=""
      SITE_EOF=1
    fi
    if [ -z "${answer}" ]; then
      if [ -n "${default}" ]; then
        answer="${default}"
      elif [ "${key}" = "GOOGLE_SIGNIN_ANDROID_CLIENT_IDS" ]; then
        answer=""
      else
        answer="${PLACEHOLDER}"
      fi
      SITE_ANSWER="${answer}"
      return 0
    fi
    if site_valid "${key}" "${answer}"; then
      [ "${key}" = "PUBLIC_ORIGIN" ] && answer="https://${answer}"
      SITE_ANSWER="${answer}"
      return 0
    fi
    echo "invalid value for ${key}" >&2
    if [ "${SITE_EOF:-0}" = 1 ]; then
      SITE_ANSWER="${PLACEHOLDER}"
      return 0
    fi
  done
}

write_site_env() {
  local key tmp
  SITE_PUBLIC_ORIGIN="${PLACEHOLDER}"
  tmp="$(mktemp "${BUDMON_HOME}/.site.env.XXXXXX")"
  chmod 0600 "${tmp}"
  for key in "${SITE_KEYS[@]}"; do
    prompt_site_key "${key}"
    printf '%s=%s\n' "${key}" "${SITE_ANSWER}" >>"${tmp}"
    if [ "${key}" = "PUBLIC_ORIGIN" ]; then
      SITE_PUBLIC_ORIGIN="${SITE_ANSWER}"
      printf 'CAPTURE_KEY_VERSION=%s\n' "${PLACEHOLDER}" >>"${tmp}"
    fi
  done
  mv -f "${tmp}" "${BUDMON_HOME}/site.env"
}

# Prints every secret file and site.env key still equal to __FILL_ME__, by path or name only.
unfilled_placeholders() {
  local f
  while IFS= read -r f; do
    if [ -n "${f}" ]; then echo "${f#"${BUDMON_HOME}/secrets/"}"; fi
  done < <(sudo grep -rlx "${PLACEHOLDER}" "${BUDMON_HOME}/secrets" 2>/dev/null || true)
  if [ -f "${BUDMON_HOME}/site.env" ]; then
    sed -n "s/^\([A-Z0-9_]*\)=${PLACEHOLDER}\$/site.env \1/p" "${BUDMON_HOME}/site.env"
  fi
}
