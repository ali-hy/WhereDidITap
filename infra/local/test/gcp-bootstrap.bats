#!/usr/bin/env bats
# shellcheck disable=SC2016,SC2030,SC2031 # bats: per-test exports and single-quoted awk programs
# F-179 gcp-bootstrap.sh. TP-15.26.
#
# gcloud is a stub: `describe`/`list`/`get-iam-policy` calls exit 0 when EXISTING=1 and 1 otherwise;
# `kms keys versions list` prints $VERSIONS (default 1) as version names and exits
# $VERSIONS_LIST_EXIT; `kms keys versions get-public-key` prints a PEM; everything is recorded.
# A-427: the script uses its sibling budmon-local, so it runs from a copy in $TOOLS next to a
# recording budmon-local (`secret set` calls with the length of their stdin only); a second one on
# PATH records as `path-budmon-local` and must never be called.

load helpers

setup() {
  common_setup
  TOOLS="${BATS_TEST_TMPDIR}/tools"
  install_tools "${TOOLS}"
  cat >"${STUB_DIR}/budmon-local" <<'REC'
#!/usr/bin/env bash
printf 'path-budmon-local\t%s\n' "$*" >>"${CALLS}"
exit 0
REC
  chmod +x "${STUB_DIR}/budmon-local"
  cat >"${STUB_CONFIG}" <<'CONF'
stub_gcloud() {
  local all="$*"
  case "${all}" in
    *get-public-key*) printf -- '-----BEGIN PUBLIC KEY-----\nMIIB\n-----END PUBLIC KEY-----\n'; return 0 ;;
    *"versions list"*)
      local v
      for v in ${VERSIONS-1}; do
        echo "projects/p/locations/europe-west3/keyRings/budmon/cryptoKeys/capture-credentials/cryptoKeyVersions/${v}"
      done
      return "${VERSIONS_LIST_EXIT:-0}" ;;
    *" describe"*|*" list"*|*get-iam-policy*) [ "${EXISTING:-0}" = 1 ] && return 0 || return 1 ;;
  esac
  return 0
}
CONF
}

# gcp-bootstrap.sh copied into $1 next to a recording budmon-local (A-427's sibling).
install_tools() {
  local dir="$1"
  mkdir -p "${dir}"
  cp "${ROOT}/infra/local/gcp-bootstrap.sh" "${dir}/gcp-bootstrap.sh"
  cat >"${dir}/budmon-local" <<'REC'
#!/usr/bin/env bash
len="$(cat | wc -c)"
printf 'budmon-local\t%s\tstdin=%s\n' "$*" "${len}" >>"${CALLS}"
exit 0
REC
  chmod +x "${dir}/gcp-bootstrap.sh" "${dir}/budmon-local"
  GCP="${dir}/gcp-bootstrap.sh"
}

ready_home() {
  mkdir -p "${BUDMON_HOME}/secrets"
  : >"${BUDMON_HOME}/secrets/.initialised"
  printf 'PUBLIC_ORIGIN=https://l.t.ts.net\nCAPTURE_KEY_VERSION=__FILL_ME__\n' >"${BUDMON_HOME}/site.env"
}

creates() { awk -F'\t' '$1=="gcloud" && $3 ~ / create( |$)|add-iam-policy-binding|set-iam-policy/' "${CALLS}"; }

@test "TP-15.26 (a): without secrets/.initialised: exit 2, run budmon-local install <tag> first, no gcloud calls" {
  run "${GCP}" --project p
  assert_failure 2
  assert_output --partial "run budmon-local install <tag> first"
  run calls_of gcloud
  assert_output ""
}

@test "TP-15.26 (b): nothing existing: creates key ring, key (ASYMMETRIC_DECRYPT, RSA_DECRYPT_OAEP_3072_SHA256), service account, IAM on the key only, topic, subscription, audit config; three CAPTURE_PUBLIC_KEY writes; CAPTURE_KEY_VERSION in site.env" {
  ready_home
  run "${GCP}" --project p
  assert_success
  run creates
  assert_output --regexp "kms keyrings create budmon .*--location[= ]europe-west3"
  assert_output --regexp "kms keys create capture-credentials"
  assert_output --partial "asymmetric-decryption"
  assert_output --partial "rsa-decrypt-oaep-3072-sha256"
  assert_output --regexp "iam service-accounts create budmon-capture"
  assert_output --regexp "kms keys add-iam-policy-binding capture-credentials.*roles/cloudkms.cryptoKeyDecrypter"
  assert_output --regexp "pubsub topics create gmail-push"
  assert_output --regexp "pubsub subscriptions create gmail-push-capture"
  run bash -c "awk -F'\t' '\$1==\"gcloud\" && \$3 ~ /projects add-iam-policy-binding/ && \$3 ~ /cryptoKeyDecrypter/' '${CALLS}'"
  assert_output ""
  run calls_of budmon-local
  assert_output --partial "secret set main/api/CAPTURE_PUBLIC_KEY"
  assert_output --partial "secret set main/worker-general/CAPTURE_PUBLIC_KEY"
  assert_output --partial "secret set capture/worker-capture/CAPTURE_PUBLIC_KEY"
  run grep -c "CAPTURE_PUBLIC_KEY" "${CALLS}"
  assert_output "3"
  run cat "${BUDMON_HOME}/site.env"
  assert_line "CAPTURE_KEY_VERSION=projects/p/locations/europe-west3/keyRings/budmon/cryptoKeys/capture-credentials/cryptoKeyVersions/1"
}

@test "TP-15.26 (b): prints the keys create | secret set GCP_CREDENTIALS command and never runs keys create" {
  ready_home
  run "${GCP}" --project p
  assert_success
  # A-427: the sibling, by its absolute path.
  assert_output --partial "gcloud iam service-accounts keys create /dev/stdout --iam-account=budmon-capture@p.iam.gserviceaccount.com | $(printf '%q' "${TOOLS}/budmon-local") secret set capture/worker-capture/GCP_CREDENTIALS"
  run bash -c "awk -F'\t' '\$1==\"gcloud\" && \$3 ~ /keys create/ && \$3 ~ /service-accounts/' '${CALLS}'"
  assert_output ""
}

@test "TP-15.26 (c): everything existing: no create calls, the same writes" {
  ready_home
  export EXISTING=1
  run "${GCP}" --project p
  assert_success
  run creates
  refute_output --regexp " create( |$)"
  run grep -c "CAPTURE_PUBLIC_KEY" "${CALLS}"
  assert_output "3"
  run cat "${BUDMON_HOME}/site.env"
  assert_line --partial "CAPTURE_KEY_VERSION=projects/p/"
}

# ---- TP-15.38 (A-427, A-434) ----

@test "TP-15.38: every secret set goes to the sibling budmon-local, never to the one on PATH" {
  ready_home
  run "${GCP}" --project p
  assert_success
  run calls_of budmon-local
  assert_output --partial "secret set capture/worker-capture/CAPTURE_PUBLIC_KEY"
  run calls_of path-budmon-local
  assert_output ""
}

@test "TP-15.38 (a): the sibling budmon-local missing: exit 2, budmon-local not found next to gcp-bootstrap.sh, no gcloud call" {
  ready_home
  rm "${TOOLS}/budmon-local"
  run "${GCP}" --project p
  assert_failure 2
  assert_output --partial "budmon-local not found next to gcp-bootstrap.sh"
  run calls_of gcloud
  assert_output ""
  run calls_of path-budmon-local
  assert_output ""
}

@test "TP-15.38 (b): versions 2, 9 and 10 listed in that order: CAPTURE_KEY_VERSION ends /cryptoKeyVersions/10 and get-public-key gets 10; list has no --sort-by or --limit" {
  ready_home
  export VERSIONS="2 9 10"
  run "${GCP}" --project p
  assert_success
  run cat "${BUDMON_HOME}/site.env"
  assert_line --regexp "^CAPTURE_KEY_VERSION=.*/cryptoKeyVersions/10$"
  run bash -c "awk -F'\t' '\$1==\"gcloud\" && \$3 ~ /get-public-key/ { print \$3 }' '${CALLS}'"
  assert_output --regexp "get-public-key ([^ ]*/)?10( |$)|--version[= ]10( |$)"
  run bash -c "awk -F'\t' '\$1==\"gcloud\" && \$3 ~ /versions list/ { print \$3 }' '${CALLS}'"
  [ -n "${output}" ]
  refute_output --partial "--sort-by"
  refute_output --partial "--limit"
}

@test "TP-15.38 (c), (d): versions list failing or empty: exit 1 with the reason; no secret set and site.env unchanged" {
  local mode before
  for mode in fail empty; do
    ready_home
    before="$(cat "${BUDMON_HOME}/site.env")"
    : >"${CALLS}"
    if [ "${mode}" = fail ]; then export VERSIONS_LIST_EXIT=1; unset VERSIONS; else unset VERSIONS_LIST_EXIT; export VERSIONS=""; fi
    run "${GCP}" --project p
    [ "${status}" -eq 1 ] || { echo "${mode}: exit ${status}: ${output}"; return 1; }
    if [ "${mode}" = fail ]; then
      assert_output --partial "listing key versions failed"
    else
      assert_output --partial "no enabled key version"
    fi
    run calls_of budmon-local
    assert_output ""
    [ "$(cat "${BUDMON_HOME}/site.env")" = "${before}" ]
  done
}

@test "TP-15.38 (e): the printed key command names the sibling by its absolute path, shell-quoted when it holds a space" {
  ready_home
  install_tools "${BATS_TEST_TMPDIR}/tools with space"
  run "${GCP}" --project p
  assert_success
  local quoted
  quoted="$(printf '%q' "${BATS_TEST_TMPDIR}/tools with space/budmon-local")"
  assert_output --partial "| ${quoted} secret set capture/worker-capture/GCP_CREDENTIALS"
}

