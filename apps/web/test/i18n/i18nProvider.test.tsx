// F-206 the i18n provider. TP-11.6 (A-309, A-310, A-311, A-315), in web-unit with pseudo-locales on.
import { Money, Temporal, asCurrencyCode } from "@budmon/shared";
import { render } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../src/i18n/I18nProvider.js";
import { messages } from "../../src/i18n/messages.js";
import { useI18n, type I18n } from "../../src/i18n/useI18n.js";

const NOW = Temporal.Instant.from("2026-10-07T12:00:00Z");

/** Renders the provider and hands back its context. */
function provider(initialLocale = "en"): I18n {
  let captured: I18n | undefined;
  function Probe() {
    captured = useI18n();
    return null;
  }
  render(() => (
    <I18nProvider initialLocale={initialLocale}>
      <Probe />
    </I18nProvider>
  ));
  if (captured === undefined) throw new Error("the provider rendered no context");
  return captured;
}

describe("TP-11.6: the i18n provider (F-206)", () => {
  it('TP-11.6: setLocale("ar-XB") sets <html lang="ar-XB" dir="rtl">', async () => {
    const i18n = provider();

    await i18n.setLocale("ar-XB");

    expect(document.documentElement.lang).toBe("ar-XB");
    expect(document.documentElement.dir).toBe("rtl");
    expect(i18n.locale()).toBe("ar-XB");
    expect(i18n.dir()).toBe("rtl");
  });

  it.each([
    ["2 h", { hours: 2 }, "2 hours ago"],
    ["24 h", { hours: 24 }, "yesterday"],
    ["30 s", { seconds: 30 }, "now"],
  ] as const)(
    "TP-11.6 (A-311): formatRelative(now − %s, now, UTC) is %j",
    async (_label, ago, text) => {
      const i18n = provider();
      await i18n.setLocale("ar-XB");

      expect(i18n.formatRelative(NOW.subtract(ago), NOW, "UTC")).toBe(text);
    },
  );

  it("TP-11.6 (A-309): beyond 7 days, formatRelative gives the date in the caller's zone: 2026-09-29T23:30Z is 2026-09-30 in Asia/Tokyo", async () => {
    const i18n = provider();
    await i18n.setLocale("ar-XB");

    const text = i18n.formatRelative(
      Temporal.Instant.from("2026-09-29T23:30:00Z"),
      NOW,
      "Asia/Tokyo",
    );

    expect(text).toBe(i18n.formatDate(Temporal.PlainDate.from("2026-09-30")));
    expect(text).not.toBe(i18n.formatDate(Temporal.PlainDate.from("2026-09-29")));
  });

  it("TP-11.6: t wraps a value in U+2068 and U+2069", async () => {
    const i18n = provider();
    await i18n.setLocale("ar-XB");

    const text = i18n.t({ id: "test.greeting", defaultMessage: "Hello {name}" }, { name: "Ada" });

    expect(text).toContain("⁨Ada⁩");
  });

  // A-315: pseudo-locales format through Intl as en; only the catalog, lang and dir change.
  it("TP-11.6 (A-315): formatMoney(EGP 1234.50, 2) and formatDate(2026-10-07) under ar-XB and en-XA equal en's, with Latin digits", async () => {
    const money = Money.of(123450n, asCurrencyCode("EGP"));
    const date = Temporal.PlainDate.from("2026-10-07");
    const formatted: Record<string, { money: string; date: string }> = {};
    for (const locale of ["en", "ar-XB", "en-XA"]) {
      const i18n = provider();
      await i18n.setLocale(locale);
      formatted[locale] = { money: i18n.formatMoney(money, 2), date: i18n.formatDate(date) };
    }

    expect(formatted["ar-XB"]).toEqual(formatted["en"]);
    expect(formatted["en-XA"]).toEqual(formatted["en"]);
    expect(formatted["en"]?.money).toMatch(/1,234\.50/);
    expect(formatted["en"]?.date).toMatch(/2026/);
    for (const { money: m, date: d } of Object.values(formatted)) {
      // No Arabic-Indic (U+0660..U+0669) or Extended Arabic-Indic (U+06F0..U+06F9) digits.
      expect(`${m}${d}`).not.toMatch(/[\u0660-\u0669\u06F0-\u06F9]/);
    }
  });
});

// Review B-3: the edges of formatRelative, locale fallback, formatInstant's zone and t's values.
describe("TP-11.6: edges (F-206, review B-3)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const DAY = 86_400_000;
  const ago = (ms: number) => Temporal.Instant.fromEpochMilliseconds(NOW.epochMilliseconds - ms);

  it.each([
    ["7 d", 7 * DAY, null],
    ["7 d − 1 ms", 7 * DAY - 1, "6 days ago"],
    ["59 s", 59_000, "now"],
    ["60 s", 60_000, "1 minute ago"],
    ["2 h − 1 ms", 2 * 3_600_000 - 1, "1 hour ago"],
    ["47 h", 47 * 3_600_000, "yesterday"],
  ] as const)("TP-11.6: formatRelative(now − %s, now, UTC)", (_label, ms, text) => {
    const i18n = provider();

    const out = i18n.formatRelative(ago(ms), NOW, "UTC");

    // null: beyond the 7-day cut-off, the date (2026-09-30 in UTC).
    expect(out).toBe(text ?? i18n.formatDate(Temporal.PlainDate.from("2026-09-30")));
  });

  it('TP-11.6: setLocale("fr") falls back to en and ltr', async () => {
    const i18n = provider();
    await i18n.setLocale("ar-XB");

    await i18n.setLocale("fr");

    expect(i18n.locale()).toBe("en");
    expect(i18n.dir()).toBe("ltr");
    expect(document.documentElement.lang).toBe("en");
    expect(document.documentElement.dir).toBe("ltr");
  });

  it('TP-11.6: with pseudo-locales off, setLocale("ar-XB") gives en', async () => {
    vi.stubEnv("VITE_PSEUDO_LOCALES", "0");
    const i18n = provider();

    await i18n.setLocale("ar-XB");

    expect(i18n.locale()).toBe("en");
    expect(document.documentElement.dir).toBe("ltr");
  });

  it("TP-11.6: formatInstant(2026-09-29T23:30Z, Asia/Tokyo) is Sep 30, 2026, 8:30", () => {
    const i18n = provider();

    const out = i18n.formatInstant(Temporal.Instant.from("2026-09-29T23:30:00Z"), "Asia/Tokyo");

    expect(out).toContain("Sep 30, 2026");
    expect(out).toMatch(/8:30/);
    expect(i18n.formatInstant(Temporal.Instant.from("2026-09-29T23:30:00Z"), "UTC")).toMatch(
      /Sep 29, 2026.*11:30/,
    );
  });

  it("TP-11.6: t doesn't wrap a number value in U+2068", () => {
    const i18n = provider();

    const text = i18n.t({ id: "test.count", defaultMessage: "{n} items" }, { n: 3 });

    expect(text).toBe("3 items");
    expect(text).not.toContain("\u2068");
  });
});

// Review B-1: two setLocale calls whose catalog loads finish out of order; the last request wins.
describe("TP-11.6: the last setLocale wins (F-206, review B-1)", () => {
  const HOME = { id: "home.placeholder", defaultMessage: "Nothing here yet." };

  it("TP-11.6: setLocale(ar-XB) then setLocale(en): ar-XB's lazy catalog resolves last, and en (lang, dir, messages) still applies", async () => {
    const i18n = provider();

    // en needs no import, so its load finishes before ar-XB's lazy one.
    await Promise.all([i18n.setLocale("ar-XB"), i18n.setLocale("en")]);

    expect(i18n.locale()).toBe("en");
    expect(document.documentElement.lang).toBe("en");
    expect(document.documentElement.dir).toBe("ltr");
    expect(i18n.t(HOME)).toBe("Nothing here yet.");
  });

  it("TP-11.6: setLocale(en-XA) then setLocale(ar-XB): ar-XB applies whichever load finishes first", async () => {
    const i18n = provider();

    await Promise.all([i18n.setLocale("en-XA"), i18n.setLocale("ar-XB")]);

    expect(i18n.locale()).toBe("ar-XB");
    expect(document.documentElement.lang).toBe("ar-XB");
    expect(document.documentElement.dir).toBe("rtl");
    expect(i18n.t(HOME)).toContain("\u200f");
    expect(i18n.t(HOME)).not.toMatch(/[áéíóú]/);
  });
});

// A-319: only simple {name} arguments are isolated; select and plural see raw values.
describe("TP-11.6 (A-319): t passes select and plural values raw", () => {
  it('TP-11.6 (A-319): select with kind "card" is "Card"; plural with count 2 is "2 items"; neither isolated, no NaN', () => {
    const i18n = provider();

    const card = i18n.t(
      { id: "test.kind", defaultMessage: "{kind, select, card {Card} other {Other}}" },
      { kind: "card" },
    );
    const items = i18n.t(
      { id: "test.items", defaultMessage: "{count, plural, one {# item} other {# items}}" },
      { count: 2 },
    );

    expect(card).toBe("Card");
    expect(items).toBe("2 items");
    for (const text of [card, items]) {
      expect(text).not.toMatch(/[\u2068\u2069]/);
      expect(text).not.toContain("NaN");
    }
  });

  it("TP-11.6 (A-319): a string count in a plural isn't isolated either (no NaN)", () => {
    const i18n = provider();

    const items = i18n.t(
      { id: "test.items", defaultMessage: "{count, plural, one {# item} other {# items}}" },
      { count: "2" },
    );

    expect(items).not.toContain("NaN");
    expect(items).not.toMatch(/[\u2068\u2069]/);
  });
});

// A-321: future instants are never relative: up to 5 minutes ahead is "now", further is the date.
describe("TP-11.6 (A-321): future instants", () => {
  const ahead = (d: Temporal.DurationLike) => NOW.add(d);

  it("TP-11.6 (A-321): now + 3 min is now", () => {
    expect(provider().formatRelative(ahead({ minutes: 3 }), NOW, "UTC")).toBe("now");
  });

  // N-7: the 5-minute boundary itself.
  it("TP-11.6 (A-321): now + 5 min exactly is now", () => {
    expect(provider().formatRelative(ahead({ minutes: 5 }), NOW, "UTC")).toBe("now");
  });

  it("TP-11.6 (A-321): now + 5 min + 1 ms is the date 2026-10-07", () => {
    const i18n = provider();

    expect(i18n.formatRelative(ahead({ minutes: 5, milliseconds: 1 }), NOW, "UTC")).toBe(
      i18n.formatDate(Temporal.PlainDate.from("2026-10-07")),
    );
  });

  it("TP-11.6 (A-321): now + 2 h is the date 2026-10-07", () => {
    const i18n = provider();

    expect(i18n.formatRelative(ahead({ hours: 2 }), NOW, "UTC")).toBe(
      i18n.formatDate(Temporal.PlainDate.from("2026-10-07")),
    );
  });

  it("TP-11.6 (A-321): now + 30 d is the date 2026-11-06", () => {
    const i18n = provider();

    expect(i18n.formatRelative(ahead({ hours: 30 * 24 }), NOW, "UTC")).toBe(
      i18n.formatDate(Temporal.PlainDate.from("2026-11-06")),
    );
  });
});

// A-401: t adds appName to every call, so the brand is isolated like any simple argument.
describe("TP-11.6 (A-401): the brand in catalog texts", () => {
  it("TP-11.6 (A-401): t(update.web.available) with no values gives the text with Budmon isolated", () => {
    const i18n = provider();

    expect(i18n.t(messages.updateWebAvailable)).toBe(
      "\u2068Budmon\u2069 has been updated. Reload to get the latest version.",
    );
  });

  it("TP-11.6 (A-401): under en-XA the brand stays unaccented (an argument, not catalog text)", async () => {
    const i18n = provider();
    await i18n.setLocale("en-XA");

    expect(i18n.t(messages.updateWebAvailable)).toContain("\u2068Budmon\u2069");
  });
});
