// F-193 scanForNeedles and the rehearsal constants (A-24, A-25). TP-16.15.
import { beforeAll, describe, expect, it } from "vitest";
import { loadNeedles, type NeedlesModule } from "./support/load.js";

let m: NeedlesModule;
beforeAll(async () => {
  m = await loadNeedles();
});

describe("TP-16.15: scanForNeedles (F-193)", () => {
  const value = `bmi_${"Ab3_-xYz9".repeat(5).slice(0, 43)}`;
  const base64 = Buffer.from(value, "utf8").toString("base64");
  // In a query string, so the URL-encoded form sits behind other encoded text.
  const url = `GET /accept?next=%2Fhome&t=${encodeURIComponent(value)}`;
  const sources = [
    { name: "a-raw", text: `token issued: ${value} for user` },
    { name: "b-base64", text: `${base64} trailing` },
    { name: "c-url", text: url },
    { name: "d-none", text: "nothing to see here" },
  ];

  it("TP-16.15: the needle is 4 + 43 characters", () => {
    expect(value).toHaveLength(47);
  });

  it("TP-16.15: one hit per source holding it raw, base64- or URL-encoded, ordered by source, with the needle's name and offset", () => {
    const hits = m.scanForNeedles(sources, [{ name: "t", value }]);

    expect(hits).toEqual([
      { source: "a-raw", needle: "t", offset: sources[0]?.text.indexOf(value) },
      { source: "b-base64", needle: "t", offset: 0 },
      { source: "c-url", needle: "t", offset: url.indexOf(encodeURIComponent(value)) },
    ]);
  });

  it("TP-16.15: no hit carries the value", () => {
    const hits = m.scanForNeedles(sources, [{ name: "t", value }]);

    expect(hits).toHaveLength(3);
    expect(JSON.stringify(hits)).not.toContain(value);
    expect(JSON.stringify(hits)).not.toContain(base64);
  });

  it("TP-16.15: a needle whose value is shorter than 8 characters throws TypeError", () => {
    expect(() => m.scanForNeedles(sources, [{ name: "s", value: "short" }])).toThrow(TypeError);
  });
});

describe("TP-16.15: the rehearsal constants (F-193)", () => {
  it("TP-16.15: REHEARSAL_OWNER_EMAIL and REHEARSAL_SIGNIN_CLIENT_ID", () => {
    expect(m.REHEARSAL_OWNER_EMAIL).toBe("rehearsal-owner.7f3a@example.invalid");
    expect(m.REHEARSAL_SIGNIN_CLIENT_ID).toBe("rehearsal-signin.apps.googleusercontent.com");
  });
});
