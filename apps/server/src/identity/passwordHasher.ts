// F-39: Argon2id hashing behind a concurrency limit.
import { randomBytes } from "node:crypto";
import {
  hashSecret as platformHash,
  verifySecret as platformVerify,
} from "../platform/security/hashing.js";
import { ARGON2_MAX_CONCURRENCY } from "./constants.js";

export interface PasswordHasher {
  hash(p: string): Promise<string>;
  /** A null PHC verifies against a dummy hash and returns false, so an unknown user costs the same. */
  verify(phc: string | null, p: string): Promise<boolean>;
  needsRehash(phc: string): boolean;
}

// P-F-66's parameters.
const CURRENT = { m: "19456", t: "2", p: "1" };

function createSemaphore(max: number) {
  let active = 0;
  const waiting: (() => void)[] = [];
  return async function run<T>(task: () => Promise<T>): Promise<T> {
    if (active >= max) {
      await new Promise<void>((resolve) => waiting.push(resolve));
    } else {
      active += 1;
    }
    try {
      return await task();
    } finally {
      // The slot passes straight to the next waiter.
      const next = waiting.shift();
      if (next === undefined) active -= 1;
      else next();
    }
  };
}

export function createPasswordHasher(
  deps: {
    hashSecret?: typeof platformHash;
    verifySecret?: typeof platformVerify;
    maxConcurrency?: number;
  } = {},
): PasswordHasher {
  const hashSecret = deps.hashSecret ?? platformHash;
  const verifySecret = deps.verifySecret ?? platformVerify;
  const limit = createSemaphore(deps.maxConcurrency ?? ARGON2_MAX_CONCURRENCY);
  let dummy: Promise<string> | null = null;
  const dummyHash = (): Promise<string> => {
    dummy ??= hashSecret(`dummy-${randomBytes(16).toString("hex")}`);
    return dummy;
  };
  // Computed at start-up, so the first unknown-user sign-in doesn't pay for it.
  dummyHash().catch(() => undefined);

  return {
    hash: (p) => limit(() => hashSecret(p.normalize("NFC"))),
    async verify(phc, p) {
      const plain = p.normalize("NFC");
      if (phc === null) {
        const hash = await dummyHash();
        await limit(() => verifySecret(hash, plain));
        return false;
      }
      return limit(() => verifySecret(phc, plain));
    },
    needsRehash(phc) {
      const params = /\$m=(\d+),t=(\d+),p=(\d+)\$/.exec(phc);
      if (params === null) return true;
      return params[1] !== CURRENT.m || params[2] !== CURRENT.t || params[3] !== CURRENT.p;
    },
  };
}
