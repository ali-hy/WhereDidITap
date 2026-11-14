// F-32: a wrapper that never prints its value.
const REDACTED = "[redacted]";

export class Secret<T> {
  readonly #value: T;

  private constructor(value: T) {
    this.#value = value;
  }

  static of<T>(value: T): Secret<T> {
    return new Secret(value);
  }

  reveal(): T {
    return this.#value;
  }

  toString(): "[redacted]" {
    return REDACTED;
  }

  toJSON(): "[redacted]" {
    return REDACTED;
  }

  [Symbol.for("nodejs.util.inspect.custom")](): "[redacted]" {
    return REDACTED;
  }
}
