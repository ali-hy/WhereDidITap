// F-7: identity's table grants (§3.2), merged into P-F-16's `tableGrants`.
import type { Privilege, TableGrant } from "../platform/db/grants.js";

const ALL: readonly Privilege[] = ["SELECT", "INSERT", "UPDATE", "DELETE"];

/** Credential tables: P-F-16 refuses any capture grant on them. */
const credential: TableGrant = { app: ALL, capture: [], credential: true };
const plain: TableGrant = { app: ALL, capture: [], credential: false };

export const identityGrants: Readonly<Record<string, TableGrant>> = {
  // DV-4: capture reads users (table level).
  users: { app: ALL, capture: ["SELECT"], credential: false },
  password_credentials: credential,
  google_identities: credential,
  two_step_credentials: credential,
  recovery_codes: credential,
  sessions: credential,
  session_refresh_tokens: credential,
  known_devices: credential,
  auth_challenges: credential,
  password_resets: credential,
  invitations: credential,
  email_bans: plain,
  identity_settings: plain,
  security_events: plain,
  data_exports: plain,
};
