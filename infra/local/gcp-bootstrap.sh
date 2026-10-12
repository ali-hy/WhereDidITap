#!/usr/bin/env bash
# F-179: the stage-0 Google Cloud resources, created when missing (idempotent), run once by the
# owner in WSL2 after `budmon-local install` stops at its placeholder check:
#   infra/local/gcp-bootstrap.sh --project <project id>
# Creates the capture KMS key, the budmon-capture service account (decrypt on that key only), the
# Gmail push topic and subscription and Cloud KMS Data Access audit logging; then writes the key's
# public key into the three CAPTURE_PUBLIC_KEY files and CAPTURE_KEY_VERSION into site.env.
# The service-account key is never created here: the command to pipe it into its secret file is
# printed instead.
set -euo pipefail

LOCATION=europe-west3
KEYRING=budmon
KEY=capture-credentials
SA_NAME=budmon-capture
TOPIC=gmail-push
SUBSCRIPTION=gmail-push-capture
: "${BUDMON_HOME:=${HOME}/.budmon}"

usage() {
  echo "usage: gcp-bootstrap.sh --project <project id>" >&2
  exit 64
}

project=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --project)
      [ "$#" -ge 2 ] || usage
      project="$2"
      shift
      ;;
    --project=*) project="${1#--project=}" ;;
    *) usage ;;
  esac
  shift
done
[[ "${project}" =~ ^[a-z][a-z0-9-]{0,29}$ ]] || usage

if [ ! -f "${BUDMON_HOME}/secrets/.initialised" ] || [ ! -f "${BUDMON_HOME}/site.env" ]; then
  echo "gcp-bootstrap: run budmon-local install <tag> first" >&2
  exit 2
fi

g() {
  gcloud --quiet --project="${project}" "$@"
}

sa="${SA_NAME}@${project}.iam.gserviceaccount.com"
key_flags=(--keyring="${KEYRING}" --location="${LOCATION}")

# KMS: the key ring and the asymmetric decryption key.
if ! g kms keyrings describe "${KEYRING}" --location="${LOCATION}" >/dev/null 2>&1; then
  g kms keyrings create "${KEYRING}" --location="${LOCATION}"
fi
if ! g kms keys describe "${KEY}" "${key_flags[@]}" >/dev/null 2>&1; then
  g kms keys create "${KEY}" "${key_flags[@]}" --purpose=asymmetric-decryption \
    --default-algorithm=rsa-decrypt-oaep-3072-sha256
fi

# The capture service account, with decrypt on this key only (never on the project).
if ! g iam service-accounts describe "${sa}" >/dev/null 2>&1; then
  g iam service-accounts create "${SA_NAME}" --display-name="Budmon capture worker"
fi
g kms keys add-iam-policy-binding "${KEY}" "${key_flags[@]}" \
  --member="serviceAccount:${sa}" --role=roles/cloudkms.cryptoKeyDecrypter >/dev/null

# Gmail push: the topic Gmail publishes to, and the capture worker's pull subscription.
if ! g pubsub topics describe "${TOPIC}" >/dev/null 2>&1; then
  g pubsub topics create "${TOPIC}"
fi
g pubsub topics add-iam-policy-binding "${TOPIC}" \
  --member=serviceAccount:gmail-api-push@system.gserviceaccount.com \
  --role=roles/pubsub.publisher >/dev/null
if ! g pubsub subscriptions describe "${SUBSCRIPTION}" >/dev/null 2>&1; then
  g pubsub subscriptions create "${SUBSCRIPTION}" --topic="${TOPIC}" \
    --message-retention-duration=7d
fi
g pubsub subscriptions add-iam-policy-binding "${SUBSCRIPTION}" \
  --member="serviceAccount:${sa}" --role=roles/pubsub.subscriber >/dev/null

# Data Access audit logging for Cloud KMS (DATA_READ and DATA_WRITE).
tmp="$(mktemp -d)"
trap 'rm -rf "${tmp}"' EXIT
policy="$(g projects get-iam-policy "${project}" --format=json 2>/dev/null || true)"
if [ -z "${policy}" ]; then
  echo "gcp-bootstrap: couldn't read the project's IAM policy; turn on Data Access audit logs" \
    "(Data Read, Data Write) for Cloud Key Management Service in IAM & Admin > Audit Logs" >&2
elif ! jq -e '[.auditConfigs[]? | select(.service == "cloudkms.googleapis.com")
    | .auditLogConfigs[]?.logType] | (index("DATA_READ") != null and index("DATA_WRITE") != null)' \
  <<<"${policy}" >/dev/null; then
  jq '.auditConfigs = ([.auditConfigs[]? | select(.service != "cloudkms.googleapis.com")]
      + [{service: "cloudkms.googleapis.com",
          auditLogConfigs: [{logType: "DATA_READ"}, {logType: "DATA_WRITE"}]}])' \
    <<<"${policy}" >"${tmp}/policy.json"
  g projects set-iam-policy "${project}" "${tmp}/policy.json" >/dev/null
fi

# The newest enabled key version (1 for a new key): its public key and CAPTURE_KEY_VERSION.
latest="$(g kms keys versions list --key="${KEY}" "${key_flags[@]}" --filter=state=ENABLED \
  --sort-by=~name --limit=1 --format='value(name)' 2>/dev/null || true)"
version="${latest##*/}"
[[ "${version}" =~ ^[0-9]+$ ]] || version=1
g kms keys versions get-public-key "${version}" --key="${KEY}" "${key_flags[@]}" \
  --output-file=/dev/stdout >"${tmp}/public.pem"
for target in main/api main/worker-general capture/worker-capture; do
  budmon-local secret set "${target}/CAPTURE_PUBLIC_KEY" <"${tmp}/public.pem"
done

version_name="projects/${project}/locations/${LOCATION}/keyRings/${KEYRING}/cryptoKeys/${KEY}/cryptoKeyVersions/${version}"
site="${BUDMON_HOME}/site.env"
if grep -q '^CAPTURE_KEY_VERSION=' "${site}"; then
  sed -i "s|^CAPTURE_KEY_VERSION=.*|CAPTURE_KEY_VERSION=${version_name}|" "${site}"
else
  printf 'CAPTURE_KEY_VERSION=%s\n' "${version_name}" >>"${site}"
fi
chmod 0600 "${site}"

echo "gcp-bootstrap: done. Create the capture service account's key straight into its file:"
echo "  gcloud iam service-accounts keys create /dev/stdout --iam-account=${sa} | budmon-local secret set capture/worker-capture/GCP_CREDENTIALS"
