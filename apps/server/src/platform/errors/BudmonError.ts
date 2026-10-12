// F-50 (delivered in S-3, A-100): the application error with an API key and an HTTP status.
const KEY = /^[A-Z][A-Z0-9_]{1,63}$/;

export class BudmonError<D extends Record<string, unknown> | undefined = undefined> extends Error {
  readonly key: string;
  readonly status: number;
  readonly details: D;

  constructor(key: string, status: number, message?: string, details?: D) {
    if (!KEY.test(key)) throw new TypeError("BudmonError key must match ^[A-Z][A-Z0-9_]{1,63}$");
    if (!Number.isInteger(status) || status < 400 || status > 599) {
      throw new TypeError("BudmonError status must be 400..599");
    }
    super(message ?? key);
    this.name = new.target.name;
    this.key = key;
    this.status = status;
    this.details = details as D;
  }
}
