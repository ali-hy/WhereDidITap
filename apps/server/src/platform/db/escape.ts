// Client-side quoting for utility statements, which take no bind parameters (F-15 rule 3).
// pg only offers these on a Client instance; an unconnected one is enough.
import pg from "pg";

const quoting = new pg.Client();

export function escapeIdentifier(identifier: string): string {
  return quoting.escapeIdentifier(identifier);
}

export function escapeLiteral(value: string): string {
  return quoting.escapeLiteral(value);
}
