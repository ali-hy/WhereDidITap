// F-15, F-16, F-21: errors the schema step raises (§6). Subjects are role, table, queue or
// currency names, never values (A-52).
export type SchemaStepCode =
  | "invalid_verifier"
  | "password_form_in_production"
  | "table_without_grants"
  | "credential_table_granted_to_capture"
  | "minor_units_changed"
  | "role_attributes_unexpected"
  | "table_missing"
  | "queue_schema_ahead"
  | "queue_policy_changed";

export class SchemaStepError extends Error {
  readonly code: SchemaStepCode;
  readonly subject: string | undefined;

  constructor(code: SchemaStepCode, subject?: string) {
    super(`schema step failed: ${code}${subject === undefined ? "" : ` (${subject})`}`);
    this.name = "SchemaStepError";
    this.code = code;
    this.subject = subject;
  }
}
