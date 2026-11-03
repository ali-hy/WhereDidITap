// F-160: server-side message rendering (emails and pushes).
import { createIntl, createIntlCache } from "@formatjs/intl";
import { isolateSimpleArguments, resolveLocale } from "@budmon/shared";
import en from "./messages/en.json" with { type: "json" };

type Catalogs = Readonly<Record<string, Readonly<Record<string, string>>>>;
type Values = Record<string, string | number>;

export function createMessageRenderer(
  catalogs: Catalogs,
): (locale: string, id: string, values?: Values) => string {
  const english = catalogs["en"];
  if (english === undefined) throw new TypeError("catalogs need an en catalogue");
  const locales = Object.keys(catalogs);
  const cache = createIntlCache();
  return (locale, id, values) => {
    if (!Object.hasOwn(english, id)) throw new Error("unknown message id");
    const tag = resolveLocale(locale, locales);
    const catalog = catalogs[tag] ?? english;
    const source = Object.hasOwn(catalog, id) ? catalog : english;
    const messages = source === english ? english : { ...english, ...catalog };
    const intl = createIntl(
      { locale: source === english ? "en" : tag, messages: { ...messages } },
      cache,
    );
    // A-319: only simple {name} arguments are isolated; select, plural and number get raw values.
    const isolated: Values | undefined =
      values === undefined
        ? undefined
        : (isolateSimpleArguments(messages[id] ?? "", values) as Values);
    return intl.formatMessage({ id }, isolated);
  };
}

/** The shipped catalogues (A-126): no test messages in the product. */
export const renderMessage = createMessageRenderer({ en });
