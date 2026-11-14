// F-311: identifiers.
import { v7 } from "uuid";

export interface IdGenerator {
  next(): string;
}

export const uuidv7Generator: IdGenerator = { next: () => v7() };

/** F-311's rule: lower case, version 1 to 8, variant 8, 9, a or b. Exported so the contract's copy
 * can be checked against it (A-169). */
export const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}
