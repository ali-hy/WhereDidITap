// Loaders for the rehearsal harness (S-16, `tools/rehearsal/src`), typed from the LLD's
// signatures (F-193, F-196) so the tests compile before the harness exists.
import type { KeyObject } from "node:crypto";
import type { Canaries } from "@budmon/test-support";

export interface Needle {
  name: string;
  value: string;
}
export interface NeedlesModule {
  REHEARSAL_OWNER_EMAIL: string;
  REHEARSAL_SIGNIN_CLIENT_ID: string;
  scanForNeedles: (
    sources: readonly { name: string; text: string }[],
    needles: readonly Needle[],
  ) => { source: string; needle: string; offset: number }[];
}

export interface SignInKeyPair {
  privateKey: KeyObject;
  publicKey: KeyObject;
}
export interface FakeGoogleModule {
  FAKE_SIGNIN_KID: string;
  generateSignInKeyPair: () => SignInKeyPair;
  fakeSignInCode: (nonce: string) => string;
  startFakeGoogle: (opts: {
    tls: { key: Buffer; cert: Buffer };
    port: number;
    controlPort: number;
    canaries: Canaries;
    signInClientId: string;
    signInKeyPair: SignInKeyPair;
  }) => Promise<{ close(): Promise<void> }>;
}

async function load<T>(spec: string): Promise<T> {
  return (await import(/* @vite-ignore */ spec)) as T;
}

export const loadNeedles = () => load<NeedlesModule>("../../src/needles.ts");
export const loadFakeGoogle = () => load<FakeGoogleModule>("../../src/fakeGoogle.ts");
