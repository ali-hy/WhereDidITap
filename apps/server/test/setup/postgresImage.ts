// The Postgres image for integration tests, pinned by digest (§10.1, A-61). Until S-15 this file
// is the source of truth; images/postgres/Dockerfile then starts FROM this exact value, and
// TP-15.30 fails when the two differ. A bump changes both in one pull request.
export const POSTGRES_IMAGE =
  "postgres:18@sha256:74935e72241653ca55e0414067e6d8763aceb8a810eb51b452253ec3dcfc4336";
