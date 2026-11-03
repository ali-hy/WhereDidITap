// F-206: the catalogs I18nProvider loads lazily, through Vite's import.meta.glob. They're in a .ts
// module because Vite 8's dependency scanner rewrites any module that calls import.meta.glob and
// then parses the result as plain JavaScript, so in a .tsx file it fails on the JSX (QA Q-F4).

export type Catalog = Record<string, string>;

export const shipped = import.meta.glob<Catalog>("./messages/*.json", { import: "default" });
// N-2: the generated pseudo catalogs only in pseudo builds; Vite replaces the flag statically, so
// other builds drop the branch and its chunks.
export const generated: Record<string, () => Promise<Catalog>> =
  import.meta.env.VITE_PSEUDO_LOCALES === "1"
    ? import.meta.glob<Catalog>("./generated/*.json", { import: "default" })
    : {};
