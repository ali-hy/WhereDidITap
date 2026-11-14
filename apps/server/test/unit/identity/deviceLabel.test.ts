// F-5 device labels (identity LLD §4.1). TP-0.4, plus extra cases TP-0.4x.
// IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
import { describe, expect, it } from "vitest";
import { deviceLabelFor } from "../../../src/identity/deviceLabel.js";

const UA = {
  edgeWindows:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0",
  chromeLinux:
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  firefoxMac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14.5; rv:132.0) Gecko/20100101 Firefox/132.0",
  safariIphone:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  unknown: "curl/8.9.1",
};

describe("TP-0.4: device labels", () => {
  it.each([
    ["Edge on Windows", UA.edgeWindows],
    ["Chrome on Linux", UA.chromeLinux],
    ["Firefox on macOS", UA.firefoxMac],
    ["Safari on iOS", UA.safariIphone],
    ["A browser on an unknown system", UA.unknown],
  ])("TP-0.4: web is %s", (label, ua) => {
    expect(deviceLabelFor("web", ua, null)).toBe(label);
  });

  it('TP-0.4: Android with model "Pixel 8" is "Android · Pixel 8"', () => {
    expect(deviceLabelFor("android", null, "Pixel 8")).toBe("Android · Pixel 8");
  });

  it('TP-0.4: Android with an empty model is "Android"', () => {
    expect(deviceLabelFor("android", null, "")).toBe("Android");
  });

  it('TP-0.4: other is "Another app"', () => {
    expect(deviceLabelFor("other", UA.chromeLinux, "Pixel 8")).toBe("Another app");
  });
});

describe("TP-0.4x: device label edge cases", () => {
  it("TP-0.4x: Android model is trimmed, control characters removed, cut to 60 characters", () => {
    const model = `  Pix\u0000el\u0007 ${"x".repeat(80)}  `;

    const label = deviceLabelFor("android", null, model);

    const cleaned = `Pixel ${"x".repeat(80)}`.slice(0, 60);
    expect(label).toBe(`Android · ${cleaned}`);
  });

  it('TP-0.4x: Android with a null or whitespace-only model is "Android"', () => {
    expect(deviceLabelFor("android", null, null)).toBe("Android");
    expect(deviceLabelFor("android", null, "   \u0001 ")).toBe("Android");
  });

  it('TP-0.4x: web with no user agent is "A browser on an unknown system"', () => {
    expect(deviceLabelFor("web", null, null)).toBe("A browser on an unknown system");
  });

  it.each([
    [
      "Opera on Windows",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 OPR/115.0.0.0",
    ],
    [
      "Samsung Internet on Android",
      "Mozilla/5.0 (Linux; Android 14; SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36",
    ],
    [
      "Chrome on Android",
      "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36",
    ],
    [
      "Chrome on ChromeOS",
      "Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
    ],
    [
      "Safari on iOS",
      "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    ],
    [
      "Safari on macOS",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
    ],
  ])("TP-0.4x: the match order gives %s", (label, ua) => {
    expect(deviceLabelFor("web", ua, null)).toBe(label);
  });

  it("TP-0.4x: a label is never longer than 80 characters and never holds the raw user agent", () => {
    const ua = `${UA.chromeLinux} ${"z".repeat(500)}`;

    const label = deviceLabelFor("web", ua, null);

    expect(label.length).toBeLessThanOrEqual(80);
    expect(label).not.toContain("Mozilla");
  });
});
