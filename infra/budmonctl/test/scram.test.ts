// F-190 scramVerifier. TP-15.11 (unit part): the RFC 7677 test vector.
import { describe, expect, it } from "vitest";
import { scramVerifier } from "../src/scram.js";

// RFC 7677 §3: password "pencil", salt W22ZaJ0SNY7soEsUEjb6gQ== (base64), 4096 iterations.
const SALT = Buffer.from("W22ZaJ0SNY7soEsUEjb6gQ==", "base64");
const STORED_KEY = "WG5d8oPm3OtcPnkdi4Uo7BkeZkBFzpcXkuLmtbsT4qY=";
const SERVER_KEY = "wfPLwcE6nTWhTAmQ7tl2KeoiWGPlZqQxSrmfPwDl2dU=";

describe("TP-15.11: scramVerifier (F-190)", () => {
  it("TP-15.11: pencil with the RFC 7677 salt and 4096 iterations gives the RFC's StoredKey and ServerKey", () => {
    expect(scramVerifier("pencil", { salt: SALT, iterations: 4096 })).toBe(
      `SCRAM-SHA-256$4096:W22ZaJ0SNY7soEsUEjb6gQ==$${STORED_KEY}:${SERVER_KEY}`,
    );
  });

  it("TP-15.34x: defaults are 4096 iterations and a fresh 16-byte salt each call", () => {
    const a = scramVerifier("pw");
    const b = scramVerifier("pw");
    const m = /^SCRAM-SHA-256\$4096:([A-Za-z0-9+/=]+)\$[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/.exec(a);

    expect(m).not.toBeNull();
    expect(Buffer.from(m?.[1] ?? "", "base64")).toHaveLength(16);
    expect(a).not.toBe(b);
  });
});
