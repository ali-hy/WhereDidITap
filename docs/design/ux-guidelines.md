---
doc: ux-guidelines
version: 0.3
status: draft
updated: 2026-11-15
---

# UX guidelines: visual style

The visual style of the product's web app (`apps/web`) and Android app (`apps/android`): colour, type, spacing, shape, components, feedback states, icons, right-to-left (RTL) layout and accessibility, and how each maps onto Tailwind and Compose.

- **Who uses it:** the planner, when an HLD or LLD defines screens; the test-architect, software-engineer, code-reviewer and qa, when they build and check them.
- **What it doesn't cover:** journeys, screens and wording, which stay in each module's HLD §4. The behaviour rules already decided elsewhere stay where they are and are only referenced here. These are: the platform's error, offline and update patterns (platform HLD §4), RTL rules (platform D-38), the accessibility baseline (platform D-39), and identity's interaction conventions (identity HLD §4.0).
- **Precedence:** if a module's design disagrees with this guide, the module's design wins for that module, and the planner raises the conflict so one of the two is amended.

## Changelog

| Version | Date | Change |
| ------- | ---- | ------ |
| 0.3 | 2026-11-15 | Owner decision UX-D17: the password toggle's accessible name follows its visible text ("Show password" / "Hide password"), and `aria-pressed` is dropped (§8.2). Found by identity's S-0b code review (WCAG 2.5.3). |
| 0.2 | 2026-11-15 | Brand changed by the owner: the product is **wDit** (said "dit"), not "Where did I tap?". UX-D10 to UX-D13 revised; new UX-D15 (the wordmark's accessible name) and UX-D16 (the long form). §2 rewritten; §1, §3.1, §3.3, §13, §16, §17 and §18 follow. |
| 0.1 | 2026-11-15 | First draft. The owner's decisions from the style-guide session (UX-D1 to UX-D14, below; the brand rows were revised in v0.2), plus proposed defaults for everything they didn't decide (marked *default*), for review in the PR. |

## 1. Decisions

The owner made these decisions on 2026-11-15, after comparing mockups of the sign-in, invitation, home first-run and error screens. Everything else in this guide is a *default* that follows from them and from the platform's rules. The owner reviews the defaults in the pull request.

| ID | Topic | Decision | Consequence |
| -- | ----- | -------- | ----------- |
| UX-D1 | Accent colour | **Teal**, chosen over indigo and amber. | Primary buttons, links, focus rings and the wordmark's "D" are teal. Red stays for errors, amber for warnings. |
| UX-D2 | Themes | Colours are **generated from one base colour**, so a theme can later be made from another base colour (owner: "start doing this in a way that allows us to make themes based on different base colors"). | Tokens come from recipes (§3.1), not hand-picked hex values. A new theme is one base hue and chroma, checked by the same contrast test. Only teal ships. |
| UX-D3 | Typeface | **IBM Plex Sans** for Latin text, **Noto Sans Arabic** for Arabic. | Both are bundled and self-hosted (§4). This satisfies platform D-38 rule 12 (a font stack that covers Arabic). |
| UX-D4 | Dark mode | **A setting: System (default), Light, Dark.** The owner first said "no theme settings in the first version", then chose the setting. | Every screen is designed and checked in both modes. The setting needs an identity amendment (§3.5). |
| UX-D5 | Where the setting lives | **On the account**, with language and currency (identity D-17), and cached on each device. | Every device follows it after sign-in, and signed-out screens use the device's last value. Needs an identity HLD/LLD amendment. |
| UX-D6 | Corner shape | **Soft: 8 px** on controls. | Buttons, fields and chips: 8 px. Cards and dialogs: 12 px (§6). |
| UX-D7 | Android colours | **The product's own theme**, not Material dynamic colour (wallpaper-based). | Web and Android match. Dynamic colour may return later as an extra theme option. |
| UX-D8 | Money amounts | **Income tinted green; spending in the normal text colour with a minus sign.** | Spending is never shown in red (P8: never guilt-inducing). Every amount carries a sign, so colour is never the only cue (§9.6). |
| UX-D9 | Icons | **Lucide on both platforms.** | The web keeps its current icon drawings. Android imports the same SVGs instead of Material icons (§10). |
| UX-D10 | Product name | **wDit**, pronounced "dit" (owner: "as a general style guide wDit is the better approach"). Revised in v0.2: it replaces "Where did I tap?", which replaced Budmon. | A rename pass is needed across code, designs and emails (§17). |
| UX-D11 | Wordmark | **"wDit" as text, with the capital "D" in the accent colour** ("w" and "it" in the text colour). | Text only, no logo artwork. It follows the theme (§2.1). |
| UX-D12 | App icon and favicon | **An accent-coloured tile with a white "D".** | Replaces today's grey "B" tile (§2.2). |
| UX-D13 | The name in sentences | **Screens don't repeat the name**, because the header wordmark already shows it ("Sign in", "Welcome, Mona."). Emails, tab titles and legal pages say "wDit". Kept after the rename. | The identity wording already planned name-free stays (§2.3). |
| UX-D14 | Empty states | **A Lucide icon in a pale accent circle**, then a heading, one line and one button. No illustrations. | No artwork to produce. It follows the theme and works in RTL (§9.2). |
| UX-D15 | The wordmark's accessible name | **The visible text, "wDit".** No hidden label with the pronunciation. | Screen readers may say it oddly, but voice control works ("click wDit") and nothing can drift out of sync (WCAG 2.5.3, label in name). |
| UX-D16 | The long form "Where did I tap" | **Only in a few places, such as the domain name and parts of the website.** The owner: "We can decide more later." | Not used in the apps. Which places use it is open (Q-1, §18). |
| UX-D17 | The password toggle's accessible name | **The name follows the visible text:** "Show" / "Show password", then "Hide" / "Hide password". No `aria-pressed`. Chosen over keeping the visible text fixed at "Show". | The name always contains the visible word (WCAG 2.5.3), so voice control works ("click Hide"). Identity's A-515 is amended to match (§8.2). |

## 2. Brand

### 2.1 Wordmark (UX-D11, UX-D15)

- **Text:** "wDit", exactly this casing, in IBM Plex Sans **semibold (600)**: 20 px on web, 20 sp on Android (the same size at every breakpoint). Never "WDIT", "Wdit" or "wdit".
- **Colour:** "w" and "it" in the text colour (`fg`), the capital "D" in `accent-fg`. The "D" is a `<span>` with no role of its own.
- **Accessible name:** the visible text, "wDit" (UX-D15). No `aria-label` with the pronunciation, so voice control matches what users see.
- **Placement:** the header's inline start. On signed-in screens it's a link to home. On signed-out screens it's plain text.
- **RTL:** the name is never translated (as `APP_NAME`). It's always isolated as LTR (`<bdi dir="ltr">` or `dir="ltr"`, `BidiFormatter` on Android) in Arabic layouts.
- **Boot screen:** the wordmark alone in the header, with an empty `<main aria-busy="true">` (identity LLD §8.1).
- **Not a logo:** if a real logo is made later, it replaces this section.

### 2.2 App icon and favicon (UX-D12)

- A square tile in the theme's `accent` colour, with corners at 22% of its size and a white capital "D" in Plex Sans bold, centred, about 62% of the tile's height.
- It's a letter, so it's **never mirrored** in RTL.
- **Web:** `public/favicon.svg` (replaces the grey "B").
- **Android:** an adaptive launcher icon (the tile as background, the "D" as foreground) plus a monochrome layer for themed icons.
- **Theme:** the icon uses the default theme's colour (teal), even when another theme exists, because launchers and browser tabs can't follow an in-app setting.

### 2.3 The product's name in text (UX-D13, UX-D16)

- **Screens:** don't name the product in headings, buttons or sentences. The header shows it.
  - Instead of "Sign in to Budmon", write "Sign in".
  - Instead of "Join Budmon", write "You've been invited".
  - Instead of "Welcome to Budmon, {name}.", write "Welcome, {name}."
- **Where the name stays,** as "wDit":
  - the browser tab title ("Sign in – wDit", P-F-218's pattern);
  - email subjects and bodies;
  - the Android app label;
  - About and legal pages;
  - places where leaving it out would be unclear (the privacy notice).
- **Inside a sentence:** when the name must appear, it's passed as `{appName}` (an isolated placeholder). It's never split, styled or recased inside running text: the accent "D" is only for the wordmark.
- **The long form, "Where did I tap":** not used in the apps. It's for the domain name and some parts of the website; the exact places are open (Q-1, §18).

## 3. Colour

### 3.1 How colours are made (UX-D2)

Every colour is a **token** with a role (`accent`, `fg-muted`, `danger-tint`, …). No screen uses a raw colour value or Tailwind's built-in palette.

- **Base colour:** a theme is defined by a hue `h` and a chroma `C` in OKLCH. OKLCH keeps perceived lightness steady across hues, so the same lightness recipe gives the same contrast for teal, indigo or amber.
- **Recipes:** each token has a fixed OKLCH lightness and chroma per mode (table below). Accent tokens use the theme's `C`; neutral tokens are tinted with the theme's hue at a low chroma (0.006 to 0.02), so greys lean slightly towards the base colour.
- **Status colours** (danger, warning, success, info) have **fixed hues** and don't change with the theme, so an error always looks like an error.
- **One source, generated outputs:** the recipes live in one file. A generator turns them into hex values for the web's CSS and for Android's Kotlin colours, so both apps get identical values. Colours outside sRGB are brought into gamut by lowering chroma. A test computes the contrast pairs in §3.4 for every theme and mode. As platform D-39 requires, it reports and doesn't block. Where the file lives and how the generator runs is the planner's choice.

**The teal theme:** `h = 186`, `C = 0.09`. The theme mockups also checked indigo (277, 0.13), plum (330, 0.11) and amber (62, 0.11); all of them pass §3.4.

| Token | Role | Light (L, C) | Dark (L, C) |
| ----- | ---- | ------------ | ----------- |
| `canvas` | Page background | 0.975, 0.006 | 0.17, 0.01 |
| `surface` | Header, cards, fields | 1, 0 | 0.205, 0.012 |
| `surface-raised` | Dialogs, menus, toasts | 1, 0 | 0.245, 0.014 |
| `surface-sunken` | Skeletons, wells, hover on secondary | 0.955, 0.008 | 0.15, 0.01 |
| `fg` | Body text, headings | 0.22, 0.015 | 0.94, 0.01 |
| `fg-muted` | Secondary text, hints, captions | 0.46, 0.02 | 0.76, 0.02 |
| `line` | Dividers, card borders (decorative) | 0.885, 0.012 | 0.33, 0.012 |
| `line-strong` | Field and secondary-button borders (must reach 3:1) | 0.60, 0.012 | 0.55, 0.012 |
| `accent` | Primary button fill, selected states | 0.50, C | 0.80, C |
| `accent-hover` | Primary button hover and pressed | 0.44, C | 0.86, C |
| `on-accent` | Text and icons on `accent` | 1, 0 | 0.20, 0.04 |
| `accent-fg` | Links, the wordmark's "D", accent text on surfaces | 0.47, C | 0.82, C |
| `accent-tint` | Empty-state circle, selected rows, avatar | 0.955, 0.03 | 0.30, 0.05 |
| `on-accent-tint` | Text and icons on `accent-tint` | 0.38, C | 0.88, C |
| `focus` | Focus ring | 0.50, C | 0.80, C |

Status tokens (fixed hues: danger 27, warning 75, success 150, info 245; chroma 0.15, or 0.12 for warning):

| Token | Light (L, C) | Dark (L, C) |
| ----- | ------------ | ----------- |
| `{status}` (text, icons, destructive fill) | 0.50, c | 0.78, c |
| `{status}-tint` (banner and chip background) | 0.96, 0.03 | 0.29, 0.05 |
| `on-{status}-tint` | 0.40, c | 0.88, 0.8c |
| `on-danger` (text on a destructive button) | white | = `canvas` |
| `income` | = `success` | = `success` |
| `inverse` / `on-inverse` (system banners) | = dark `surface` / dark `fg` | = light `surface` / light `fg` |

### 3.2 Teal values

Generated from the recipes, for reference and for the build's first tokens file. If these values and the recipes disagree, the recipes win.

| Token | Light | Dark |
| ----- | ----- | ---- |
| `canvas` | `#F3F8F7` | `#0B1110` |
| `surface` | `#FFFFFF` | `#111918` |
| `surface-raised` | `#FFFFFF` | `#192321` |
| `surface-sunken` | `#EBF2F1` | `#070D0C` |
| `fg` | `#131D1C` | `#E4EDEC` |
| `fg-muted` | `#4C5C5A` | `#A4B5B3` |
| `line` | `#D1DCDA` | `#2F3736` |
| `line-strong` | `#798381` | `#6A7472` |
| `accent` | `#07736B` | `#75D1C6` |
| `accent-hover` | `#046059` | `#88E5DA` |
| `on-accent` | `#FFFFFF` | `#011B18` |
| `accent-fg` | `#026962` | `#7BD7CD` |
| `accent-tint` | `#DBF7F3` | `#043631` |
| `on-accent-tint` | `#024D48` | `#8FEBE0` |
| `focus` | `#07736B` | `#75D1C6` |
| `danger` | `#A83630` | `#FF968A` |
| `danger-tint` / `on-danger-tint` | `#FEEEEB` / `#861213` | `#41211E` / `#FEC9C2` |
| `warning` | `#855904` | `#E4AC59` |
| `warning-tint` / `on-warning-tint` | `#FEEFDC` / `#624001` | `#3A270B` / `#FDCF8F` |
| `success` (= `income`) | `#057836` | `#67D283` |
| `success-tint` / `on-success-tint` | `#E4F8E7` / `#005725` | `#17321E` / `#9CEEAD` |
| `info` | `#0568A4` | `#71BFFF` |
| `info-tint` / `on-info-tint` | `#E7F4FF` / `#014B79` | `#142E43` / `#B6DDFE` |

### 3.3 Using colour

- **One accent per view:**
  - **Filled accent:** only the screen's one primary button (identity §4.0).
  - **Accent text:** links and the wordmark's "D".
  - **Accent tint:** the empty-state circle, the avatar and selected rows.
- **Status colours mean status only:** danger for errors and destructive actions, warning for things that need attention (the pending-deletion banner, an overspent budget), success for completed actions and income, info for neutral notices.
- **Colour is never the only cue:** every status has an icon and text, and every amount has a sign (platform D-39, identity §4.8).
- **No gradients, no shadows on in-page elements, and no colour on large areas** apart from `canvas` and `surface`.

### 3.4 Contrast (default, checked)

The thresholds come from platform D-39: 4.5:1 for text, 3:1 for UI components and focus indicators. Measured for teal:

| Pair | Light | Dark | Needs |
| ---- | ----- | ---- | ----- |
| `fg` on `canvas` / `surface` | 16.1 / 17.2 | 16.0 / 15.0 | 4.5 |
| `fg-muted` on `canvas` / `surface` / `surface-raised` | 6.6 / 7.0 / 7.0 | 8.9 / 8.4 / 7.6 | 4.5 |
| `on-accent` on `accent` / `accent-hover` | 5.7 / 7.4 | 10.0 / 12.2 | 4.5 |
| `accent-fg` on `canvas` / `surface` | 6.1 / 6.6 | 11.3 / 10.6 | 4.5 |
| `on-accent-tint` on `accent-tint` | 8.6 | 9.6 | 4.5 |
| `line-strong` on `surface` / `canvas` | 3.9 / 3.6 | 3.7 / 4.0 | 3 |
| `focus` on `canvas` / `surface` | 5.3 / 5.7 | 10.6 / 9.9 | 3 |
| `danger` / `success` / `warning` / `info` on `surface` | 6.5 / 5.6 / 6.1 / 6.0 | 8.5 / 9.5 / 8.8 / 9.0 | 4.5 |
| `on-{status}-tint` on `{status}-tint` | 7.9 to 8.8 | 9.6 to 10.1 | 4.5 |
| `on-danger` on `danger` | 6.5 | 9.1 | 4.5 |

`line` is decorative (dividers, card edges) and is exempt. Anything a user must see in order to operate a control uses `line-strong`. Indigo, plum and amber also pass every row; the lowest is `line-strong` on `surface` in dark mode, at 3.7.

### 3.5 Light, dark and the theme setting (UX-D4, UX-D5)

- **The setting:** "Appearance: System / Light / Dark", **System by default**, stored on the account with the other preferences (identity D-17). *Proposed:* it goes in Settings > Profile & preferences (S-9), as a radio group saved with **Save changes**. The amendment decides the exact place.
- **Resolving the mode:**
  1. the account's setting, once `me` is known;
  2. otherwise the device's cached last value (web: `localStorage`; Android: app storage);
  3. otherwise the system setting.
  
  While the setting is System, the app follows system changes live. On sign-out the device keeps its cached value.
- **No flash of the wrong mode:**
  - **Web:** the mode is set on `<html>` before first paint, by a small synchronous script file in `<head>` (not an inline script, so the CSP stays as it is).
  - **Android:** the window background follows the mode, so no white frame appears before Compose draws.
- **Themes:** only teal ships, and no setting chooses a theme yet. The `data-theme` hook (§14) exists so a second theme needs no restructuring.
- **Changing the setting** applies immediately after the server confirms, without a reload, like language (identity §4.5).

## 4. Typography (UX-D3)

### 4.1 Families

| Use | Family | Weights |
| --- | ------ | ------- |
| Latin text | IBM Plex Sans | 400, 500, 600 |
| Arabic text | Noto Sans Arabic | 400, 500, 600 |
| Codes, keys, references, recovery codes | IBM Plex Mono | 400, 500 |

- **Web:**
  - Fonts are **self-hosted woff2 files**, served from the app's own origin. Not Google Fonts: that keeps the privacy commitments and the same-origin CSP.
  - Each `@font-face` has a `unicode-range`. Noto Sans Arabic covers only the Arabic blocks (U+0600–06FF, U+0750–077F, U+0870–08FF, U+FB50–FDFF, U+FE70–FEFF), so Latin-only users never download it (D-38 rule 12). Plex Sans covers Latin and Latin-1 plus the punctuation and currency symbols in use.
  - The stack is `"IBM Plex Sans", "Noto Sans Arabic", system-ui, sans-serif`, and the browser picks per character.
  - `font-display: swap`.
- **Android:** the same files are bundled in `res/font`. Arabic text must render in the bundled Noto Sans Arabic, not in the device's default Arabic font. Compose has no per-script fallback between families, so the planner picks the mechanism (for example, a `FontFamily` chosen by locale, with user-generated Arabic text in Latin screens still covered) and the test plan checks it.
- **Licences:** all three are under the SIL Open Font License; the licence files ship with the fonts.

### 4.2 Type scale (default)

| Role | Web | Android (Material role) | Weight | Used for |
| ---- | --- | ----------------------- | ------ | -------- |
| Page title | 24 / 32 px (`text-2xl`) | 24 / 32 sp (`headlineSmall`) | 600 | The page's one `<h1>` |
| Section title | 20 / 28 px (`text-xl`) | 20 / 28 sp (`titleLarge`) | 600 | `<h2>`, empty-state heading |
| Sub-section, card title | 16 / 24 px (`text-base`) | 16 / 24 sp (`titleMedium`) | 600 | `<h3>`, setting row titles |
| Body | 16 / 24 px (`text-base`) | 16 / 24 sp (`bodyLarge`) | 400 | Text, field values |
| Label | 14 / 20 px (`text-sm`) | 14 / 20 sp (`labelLarge`) | 500 | Field labels, chips, table headers |
| Secondary | 14 / 20 px (`text-sm`) | 14 / 20 sp (`bodyMedium`) | 400 | Hints, metadata, "Reference: …" |
| Caption | 12 / 16 px (`text-xs`) | 12 / 16 sp (`bodySmall`) | 400 | Rare; never for anything a user must read to act |
| Button | 16 / 24 px | 16 / 24 sp | 600 | All button labels |

Rules:
- **Sizes:** web text is in `rem` and Android text in `sp`, so both scale with the user's settings to 200% without clipping (D-39). Nothing below 12 px.
- **Weights:** three weights only (400, 500, 600). Hierarchy comes from size and weight, never from colour alone.
- **Line height for Arabic:** Arabic needs room for diacritics. Under `:lang(ar)` (web) or an Arabic locale (Android), body line height is at least 1.6 and headings at least 1.4. Text containers never have a fixed height.
- **Numbers:** amounts, counts and dates in lists use tabular figures (`tabular-nums`; Android `fontFeatureSettings = "tnum"`). Whether Noto Sans Arabic's Arabic-Indic digits support `tnum` is checked when real Arabic testing starts (D-38's after-MVP item).
- **No letter-spacing on Arabic text** (it breaks letter joining), no `text-transform: uppercase` (sentence case only, identity §4.0), and no italics (Noto Sans Arabic has none). Use weight for emphasis.
- **Monospace:** codes, keys and references are Plex Mono, LTR and isolated (identity §4.7). Recovery codes and TOTP keys use 16 px with a wider gap between groups.

## 5. Spacing and layout (default)

### 5.1 Spacing scale

A 4 px base, which is Tailwind's default spacing unit (`p-1` = 0.25 rem = 4 px). Allowed steps:

| Step | px | Tailwind | Typical use |
| ---- | -- | -------- | ----------- |
| 1 | 4 | `1` | Icon to text inside chips, field to hint |
| 2 | 8 | `2` | Label to field, icon to label in buttons |
| 3 | 12 | `3` | Between buttons in a row, list row padding |
| 4 | 16 | `4` | Between form fields, page gutter on phones, card padding |
| 6 | 24 | `6` | Between groups in a form, gutter from 600 px |
| 8 | 32 | `8` | Between page sections |
| 12 | 48 | `12` | Top of signed-out pages, empty-state padding |
| 16 | 64 | `16` | Rare: large empty areas |

On Android the same numbers are in dp.

### 5.2 Layout

- **Header:**
  - Web: 56 px tall, full width, `surface` with a `line` bottom border; the wordmark at the inline start and the account menu at the inline end. Its inner content uses the same width and gutter as `<main>`.
  - Android: a Material 3 small top app bar in `surface`.
- **Content widths (web, from identity LLD §8.1):**
  - `<main>`: `mx-auto max-w-[40rem]`;
  - settings routes: `max-w-[72rem]`, two columns from 60 rem (960 px);
  - signed-out and unguarded pages: a centred column of at most 26.25 rem (420 px).
  
  These stay as decided. This guide only adds the gutters: 16 px below 600 px, 24 px from 600 px.
- **Signed-out pages:**
  - Web: the column starts 48 px below the header on screens wider than 600 px, and 24 px below it on phones. No card around the form on phones. From 600 px the column sits on a `surface` card with a `line` border, 12 px corners and 32 px padding, on the `canvas` background.
  - Android: full-screen, with 24 dp horizontal margins.
- **Breakpoints:** Tailwind's defaults (`sm` 40 rem, `md` 48 rem, `lg` 64 rem), plus the settings layout's 60 rem. Everything works from 360 px (identity §4.8).
- **Android:** phones first, 16 dp screen margins (24 dp on signed-out screens), edge-to-edge with insets.

## 6. Shape and elevation (UX-D6)

| Token | Value | Used for |
| ----- | ----- | -------- |
| `radius-control` | 8 px | Buttons, fields, comboboxes, checkboxes (4 px), menus' items, toasts |
| `radius-card` | 12 px | Cards, dialogs, sheets (top corners on Android), the signed-out card, popovers |
| `radius-full` | 9999 px | Avatars, the empty-state circle, status chips (so they don't read as buttons), spinners |

- **Flat by default:** surfaces are separated by `line` borders and `canvas` versus `surface`, not by shadows.
- **Shadow** (`shadow-overlay`: `0 8px 24px rgb(0 0 0 / 0.12), 0 2px 6px rgb(0 0 0 / 0.08)`, with no x-offset so RTL needs nothing): only on things that float over the page, such as dialogs, menus, combobox lists and toasts. In dark mode, floating things also use `surface-raised`, because shadows barely show.
- **Single-sided accent borders** (the toast's tone bar, error-summary bar): the corners on that side are square.

## 7. Buttons (default)

### 7.1 Variants

| Variant | Look | Use |
| ------- | ---- | --- |
| Primary | `accent` fill, `on-accent` text | The screen's one main action ("Sign in", "Create account", "Try again", "Add account") |
| Secondary | `surface` fill, 1 px `line-strong` border, `fg` text | Other actions ("Go to home", "Continue with Google", "Use a password", "Copy") |
| Tertiary | No fill or border, `accent-fg` text | Low-emphasis actions inside a row ("Show", "Resend"); never the only action |
| Destructive | `danger` fill, `on-danger` text, a destructive verb ("Delete my account") | The primary action of a destructive step (identity §4.0) |

- **One primary per screen** (identity §4.0). Where a screen offers equal choices (S-5's "Continue with Google" and "Use a password"), both are secondary.
- **The Google button** follows Google's sign-in branding rules: the official multicolour "G" on a secondary button, with the label "Continue with Google". It's an exception to the Lucide-only icon rule.
- **Links that navigate** but look like buttons (the error page's "Go to home") are `<a>` elements with the button style. Inline links in text stay links (§8.6).

### 7.2 Size and layout

- **Height:** 44 px on web (`min-h-11`), 48 dp on Android. A compact 36 px size exists for actions inside dense rows (a session row's "Sign out"). Both are well above D-39's 24 px minimum.
- **Padding and label:** 16 px at the inline start and end. The label is one line where it fits and wraps rather than truncating. Icons are 20 px, 8 px from the label, at the inline start.
- **Width:**
  - full width in the signed-out column, on Android full-screen forms, and inside dialogs on phones;
  - elsewhere the button is as wide as its content.
- **Button rows:** the primary comes first (at the inline start), 12 px gap, wrapping on narrow screens. The same order on web and Android, and in RTL it follows the reading direction automatically (D-38 rule 4).

### 7.3 States

| State | Look |
| ----- | ---- |
| Hover (web) | Primary: `accent-hover`. Secondary: `surface-sunken`. Tertiary: underline. |
| Pressed | As hover; no scale or bounce. |
| Focus | The focus ring (§12.2). |
| Busy | A 20 px spinner (the `refresh` or a ring icon, rotating) at the inline start. The label stays the same, so the button doesn't change width. `aria-busy="true"`. The button doesn't respond to clicks while busy. Platform S-2 and identity §4.4. |
| Disabled | `surface-sunken` fill, `fg-muted` text, no border change. Used only where the design asks for it (a rate-limit wait, delete blockers), always with the reason in text nearby. |

## 8. Form controls (default)

### 8.1 Text fields

- **Order:** label above the field, then the field, then the hint, then the error (identity §4.0). Labels are 14 px/500 in `fg`; placeholders are never labels.
- **Field:**
  - 44 px tall (48 dp on Android), `surface` fill, 1 px `line-strong` border, 8 px corners;
  - 12 px padding at the inline start and end;
  - 16 px text, which also stops iOS from zooming in.
- **Spacing:** 8 px between label and field, 4 px between field and hint, 16 px between fields.
- **Hover:** border `fg-muted`. **Focus:** the focus ring, with the border unchanged.
- **Error:**
  - the border becomes `danger` and 2 px wide (the width change is the non-colour cue);
  - under the field: the `alert` icon and the message in `danger`;
  - `aria-invalid="true"`, and the message is in `aria-describedby` (platform P-F-213 `FieldError`).
- **Read-only values** (the invited email on S-6) are shown as text under their label, not as a disabled field.
- **LTR fields:** email, URL, codes and amounts get `dir="ltr"` (D-38 rule 8). Their text aligns to the field's inline start in LTR and to its end in RTL, as the browser does for `dir="ltr"` inside an RTL page.

### 8.2 Password fields

- A tertiary toggle button at the field's inline end, inside the field's border: the `eye` / `eye-off` icon and the text "Show" / "Hide". Tapping it never moves focus out of the field.
- **The accessible name follows the visible text (UX-D17):** "Show password" while the password is hidden, "Hide password" while it's shown, so the name always contains the visible word (WCAG 2.5.3). No `aria-pressed`: the changing name already says the state. On Android, the button's `contentDescription` changes the same way, with no toggle role or state description.
- The rule ("At least 12 characters.") is the hint under the field.

### 8.3 Code fields

- One input (identity §4.8), in Plex Mono at 20 px, with letter spacing, `dir="ltr"` and `inputmode="numeric"` (`autocomplete="one-time-code"`). The field is 12 em wide, not full width.

### 8.4 Selects and comboboxes

- Kobalte's Combobox and Select on web, Material's exposed dropdown on Android, styled as a text field. The `chevron-down` icon sits at the inline end; it isn't mirrored, because it points down.
- The list is a floating surface (`surface-raised`, `radius-card`, `shadow-overlay`). Options are 44 px rows; the selected option shows a `check` icon and `accent-tint`.

### 8.5 Checkboxes and radio buttons

- **Size:** a 20 px box, inside a target of at least 44 px (web) or 48 dp (Android) that includes the label. The label sits at the inline end.
- **Look:** a 1 px `line-strong` border. A checkbox has 4 px corners; a radio button is round.
- **Selected:** an `accent` fill with an `on-accent` check or dot.

### 8.6 Links

- `accent-fg`, **always underlined** (1 px, offset 2 px), so they don't rely on colour. Hover makes the underline 2 px.
- Standalone links ("Forgot password?", "Use a recovery code instead") are 14 or 16 px, with at least a 44 px tall target. They follow D-38 alignment (inline start or end).

### 8.7 Form-level error summary

- At the top of the form: a `surface` box with a 1 px `danger` border, 8 px corners and 16 px padding.
- First line: the `alert` icon (`danger`) and "Some details need fixing." in 600 weight. Below it, a list of links to the fields.
- `role="alert"` and focus behaviour as in platform P-F-213.
- The rate-limit notice (P-F-214) uses the same box with `warning` instead of `danger`.

## 9. Feedback states (default)

### 9.1 Loading

| Situation | Pattern |
| --------- | ------- |
| An action runs (submit, retry) | The busy button (§7.3). The form stays visible and read-only (identity §4.4). |
| A page or section loads | Skeleton blocks in `surface-sunken`, with 8 px corners, in the shape of the content (text lines 12 to 16 px tall, rows 44 px). They appear only if loading takes over 300 ms, so fast loads don't flash. A gentle opacity pulse (1.5 s), off under reduced motion. `aria-busy="true"` on the region. |
| App start (web boot) | The header wordmark only, with an empty `<main>` (§2.1). |
| A long job (export) | An indeterminate progress bar (4 px, `accent` on `surface-sunken`) with a text status ("Preparing your export…"); the text is the cue, not the bar (identity §4.4). |

### 9.2 Empty (UX-D14)

- **Page-level** (the home first-run page, an empty list that fills a page):
  - a 48 px circle in `accent-tint`, holding a 24 px Lucide icon in `on-accent-tint`;
  - 12 px below it, the heading (section-title size);
  - 4 px below that, one line in `fg-muted`;
  - 16 px below that, the one primary button.
  
  Centred in its area, with 48 px top padding. The icon is decorative (`aria-hidden`).
- **Section-level** ("No exports yet."): one line of `fg-muted` text where the content would be, with no circle and no button unless the section has its own action.
- **Wording:** an invitation, not an apology (P8): "Add your first account to start.", not "Nothing here".

### 9.3 Errors

The patterns are the platform's C-3; this guide only gives them a look.

| Pattern | Look |
| ------- | ---- |
| Field error | §8.1 |
| Form error summary | §8.7 |
| Section error ("Couldn't check your shared accounts.") | The `alert` icon in `danger`, then the message in `fg`, then a secondary **Try again**, in the section's place; no tinted box. |
| Background failure | A toast in the error tone (§9.5). |
| Full-page fallback (platform S-2, P-F-209) and not-found page | See below. |

**Error and not-found pages** (this closes platform FU-1):
- **Layout:** inside the normal frame (header shown). Start-aligned in the 40 rem `<main>`, 32 px below the header.
- **Text:** the `<h1>` at page-title size, the body at body size in `fg`, and the "Reference: 4bf92f35" line in Plex Mono, 14 px, `fg-muted`, isolated as LTR.
- **Error page actions:** **Try again** is the primary button, with the `refresh` icon at the inline start. The icon spins while the retry runs; under reduced motion it stays still and only `aria-busy` changes. **Go to home** is a secondary-styled `<a href="/">`. They sit in a button row (§7.2), and the "Still not working." status line is 16 px below it, in `fg`.
- **Not-found page actions:** **Go to home** is the page's only action, so it's the primary button.
- **Android:** the same order, with full-width buttons stacked on phones, primary first.

### 9.4 Success

- **Completed settings changes** get a toast in the success tone ("Saved.", "Invitation sent to …"), per identity §4.5.
- **No success screens and no confetti:** the screen simply shows the new state.
- After a sign-up, the home first-run page is itself the success state.

### 9.5 Toasts, banners and chips

- **Toasts** (P-F-212 web; a Snackbar on Android):
  - `surface-raised` with a 1 px `line` border, `radius-control` and `shadow-overlay`, plus a 4 px bar at the inline start in the tone colour, and the tone's icon (`info`, `check`, `alert`) in the tone colour;
  - the text is `fg`, and an action is a tertiary button;
  - web: bottom centre below 600 px, bottom inline-end above; at most 3 visible (A-463).
  
  The existing `border-sky-700` / `green-700` / `red-700` classes become `info` / `success` / `danger` tokens.
- **System banners** (offline and update, P-F-210 and P-F-211, A-462 "light text on dark"):
  - full width with no corners, in `inverse` / `on-inverse`, with 8 px vertical and 16 px horizontal padding;
  - the icon is before the text; an action is a secondary button in inverse colours.
  
  In dark mode the inverse is light, so they still stand out.
- **Account banners** (identity's pending-deletion banner S-15, the unsaved-recovery-codes banner):
  - `warning-tint` with `on-warning-tint` text, the `alert` icon, and the action as a secondary button;
  - full width, under the header.
- **Status chips** ("Pending · expires 14 Oct", "Not yet synced"):
  - 24 px tall (28 dp on Android) with `radius-full`, the status tint and its `on-` text, a 16 px icon and the text;
  - neutral statuses (Accepted, Expired) use `surface-sunken` and `fg-muted`.
  
  When a chip is tappable (Android's sync chip), its target is extended to 48 dp.

### 9.6 Money (UX-D8)

| Kind | Look |
| ---- | ---- |
| Money in (income, refunds, transfers in) | `income` (= `success`) with a `+` sign |
| Money out (spending, transfers out) | `fg` with a minus sign (U+2212, from the formatter) |
| Zero, balances, totals | `fg`, sign only when negative |
| Overspent budgets | The budget gets a warning-style indicator; the amounts stay in their normal colours |

- **Never red for spending.** Amounts use 500 weight and tabular figures, and are always isolated as LTR (D-38 rule 8, platform §4.7). The sign is always shown in lists, so colour is never the only cue. Each module still decides where signs appear (platform §4.7); this is the default look.

### 9.7 Dialogs

- **Look:** `surface-raised`, `radius-card`, `shadow-overlay`, 24 px padding, at most 28 rem wide, over a scrim of `rgb(0 0 0 / 0.45)` (0.6 in dark mode).
- **Content:** the title at section-title size, then the body, then a button row at the bottom inline end (primary or destructive first in reading order).
- **Phones:** full-width buttons.
- **Android:** M3 dialogs and bottom sheets for step-up (identity J-15), with the same tokens.

## 10. Icons (UX-D9)

- **The set:** Lucide (ISC licence, version pinned), drawn on a 24 × 24 grid with a 2 px stroke and round caps and joins. The web's eight existing icons are already Lucide-style. Identity's eleven come from Lucide too (`eye`, `eye-off`, `copy`, `download`, `user`, `log-out`, `mail`, `shield`, `trash-2`, `external-link`), except `google`, which is Google's own mark (§7.1).
- **Sizes:** 16 px next to 14 px text and in chips; 20 px in buttons and fields; 24 px standalone and in navigation; 24 px inside the 48 px empty-state circle.
- **Colour:** `currentColor`, so icons follow the text they sit with. Status icons take the status colour.
- **Mirroring:** each icon keeps its `mirrorInRtl` tag (D-38 rule 6, F-215). New icons are tagged when they're added.
- **Accessibility:** decorative icons are `aria-hidden`. Icon-only buttons have a translated `aria-label` (web) or `contentDescription` (Android), and a target of at least 44 px (web) or 48 dp (Android) even though the icon is 20 px.
- **Web:** the registry (`apps/web/src/ui/icons/registry.ts`) holds Lucide's path data. Only registry icons may be used (the existing ESLint rule).
- **Android:** the same SVGs are imported as vector drawables (`res/drawable/ic_<name>.xml`), with `android:autoMirrored="true"` on the mirrored ones. They replace `Icons.Filled.*` from `material-icons-core` in the platform's components. The planner decides whether the dependency is dropped.

## 11. Tone of the visuals

The look matches the tone of the words: calm, plain and never blaming (P8).

- **Flat and quiet:** white or near-white surfaces (near-black in dark mode), thin borders, generous space, one accent per view. No gradients, textures, photos or illustrations in the MVP.
- **Colour means something:** accent for "do this" and status colours for status; everything else is neutral.
- **Motion:**
  - short and functional: 120 ms for hover and press, 200 ms ease-out for things appearing (dialogs, toasts, menus), 150 ms for leaving;
  - no bouncing, no parallax, no animated decoration;
  - under `prefers-reduced-motion` (Android: the animator duration scale set to 0), transitions are instant and skeletons don't pulse. Progress spinners still turn, because they're the only sign that something is running.
- **Directional motion** (drawers, slide-ins) follows D-38 rule 5: it enters from the inline end.

## 12. Accessibility

This builds on platform D-39 (the baseline) and identity §4.8. Contrast is in §3.4.

### 12.1 Targets

- **Web:** controls are at least 44 × 44 CSS px (buttons, fields, standalone links, icon buttons, checkbox rows). Inline links in text are exempt, and compact buttons are 36 px tall but at least 44 px wide. Either way it's above D-39's 24 px minimum.
- **Android:** at least 48 × 48 dp (platform §4.8).

### 12.2 Focus

- **Web:** keyboard focus (`:focus-visible`) shows a 2 px `focus` outline with a 2 px offset, outside the element, so it shows on accent fills too (3:1 or more against `canvas` and `surface` in both modes, §3.4). The ring is never removed or hidden. Fields use the same ring instead of a border colour change.
- **Android:** Compose's default focus indication, tinted with `focus`, for keyboard and switch-access users.
- **Focus order and movement** follow platform D-39 and identity §4.8 (to the `<h1>` on navigation, to the first invalid field or the summary on submit).

### 12.3 Other rules

- **Never colour alone:** errors have icons and text, amounts have signs, links have underlines, chips have text, and selected states have a check or a border change as well as a tint.
- **Zoom and text size:** text in `rem` or `sp`; layouts reflow at 200% zoom and at 320 CSS px width, with no fixed heights on text.
- **High-contrast modes:** controls draw real borders (not only fills), so they stay visible in Windows' forced-colours mode. Under `forced-colors: active` the focus ring uses `Highlight`.
- **Dark mode** gets the same contrast checks (§3.4) and the same axe run in end-to-end tests, as D-39 reports.

## 13. Arabic and RTL

Platform D-38 is the rulebook (logical properties only, mirrored icons by tag, bidi isolation, always-LTR data, tables, charts, keyboard). This guide adds the visual details:

- **Fonts:** Arabic text renders in Noto Sans Arabic, with the line heights in §4.2. No letter spacing, uppercase or italics on Arabic.
- **The name:** the wordmark and `{appName}` are isolated as LTR (§2.1). The "D" app icon isn't mirrored.
- **Alignment:** everything is start-aligned, so it flips automatically. Centred text (empty states) stays centred. Nothing is aligned with `left` or `right`.
- **Layout:** button rows, icons in buttons and fields, toggles inside fields, the toast's tone bar, and the header's wordmark and avatar all sit at their logical side, so they flip with the direction.
- **Shadows:** they have no x-offset, so they need no RTL variant.
- **Numbers:** digits follow the locale (D-37). Amounts, codes, emails and references are always LTR and isolated.
- **Checks:** the pseudo-RTL run (D-38) covers these screens in light mode. Dark mode in RTL is part of the qa journey for each slice.

## 14. Web mapping: Tailwind CSS 4 (`apps/web`)

Tokens become CSS custom properties, and Tailwind's theme points at them. The exact files are the planner's (LLD), but the shape is:

```css
@import "tailwindcss";

/* Dark utilities follow the resolved mode attribute on <html>, not the media query. */
@custom-variant dark (&:where([data-mode="dark"], [data-mode="dark"] *));

/* Generated from the token recipes: one block per theme × mode. */
:root[data-theme="teal"][data-mode="light"] { color-scheme: light; --c-canvas: #f3f8f7; --c-accent: #07736b; /* … */ }
:root[data-theme="teal"][data-mode="dark"]  { color-scheme: dark;  --c-canvas: #0b1110; --c-accent: #75d1c6; /* … */ }

@theme inline {
  --color-*: initial;            /* drop Tailwind's palette: only tokens exist */
  --color-canvas: var(--c-canvas);
  --color-surface: var(--c-surface);
  --color-accent: var(--c-accent);
  /* … every token in §3.1 … */
  --font-sans: "IBM Plex Sans", "Noto Sans Arabic", system-ui, sans-serif;
  --font-mono: "IBM Plex Mono", ui-monospace, monospace;
  --radius-control: 0.5rem;
  --radius-card: 0.75rem;
  --shadow-overlay: 0 8px 24px rgb(0 0 0 / 0.12), 0 2px 6px rgb(0 0 0 / 0.08);
}
```

| Need | Utilities |
| ---- | --------- |
| Page and surfaces | `bg-canvas`, `bg-surface`, `bg-surface-raised`, `bg-surface-sunken` |
| Text | `text-fg`, `text-fg-muted`, `text-accent-fg`, `text-danger`, `text-income` |
| Borders | `border-line`, `border-line-strong`, `border-danger` |
| Primary button | `bg-accent hover:bg-accent-hover text-on-accent rounded-control min-h-11 px-4 font-semibold` |
| Secondary button | `bg-surface hover:bg-surface-sunken text-fg border border-line-strong rounded-control min-h-11 px-4 font-semibold` |
| Focus | `focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus` |
| Tints | `bg-accent-tint text-on-accent-tint`, `bg-warning-tint text-on-warning-tint` |

Rules for the web:
- **Shared components:** buttons, fields, the error summary, the empty state, chips and banners are components in `apps/web/src/ui/`, so screens don't repeat class lists. The planner names them in the LLD.
- **No raw colours:** no raw hex values or Tailwind palette names in components (`bg-gray-900`, `border-sky-700` and `bg-red-…` are removed by `--color-*: initial`). Today's uses in `OfflineBanner` and `Toaster` move to tokens.
- **Mode and theme:** `<html>` gets `data-theme` (always `teal` for now) and `data-mode` (`light` or `dark`, resolved per §3.5) before first paint.
- **Fonts:** self-hosted under `public/fonts/` (or bundled by Vite), with `@font-face` blocks per §4.1.

## 15. Android mapping: Compose and Material 3 (`apps/android`)

- **A `ui/theme` package** with one `AppTheme` composable that wraps `MaterialTheme(colorScheme, typography, shapes)`. Every screen, including the platform's `PlatformUi.kt` components and `MainActivity`'s content, sits inside it. **No dynamic colour** (UX-D7).
- **Colour scheme:** `lightColorScheme()` / `darkColorScheme()` filled from the generated tokens:

| Material role | Token |
| ------------- | ----- |
| `primary` / `onPrimary` | `accent` / `on-accent` |
| `primaryContainer` / `onPrimaryContainer` | `accent-tint` / `on-accent-tint` |
| `secondary`, `tertiary` (and their `on` roles) | `accent` / `on-accent` (no second accent) |
| `background` / `onBackground` | `canvas` / `fg` |
| `surface` / `onSurface` | `surface` / `fg` |
| `surfaceVariant` / `onSurfaceVariant` | `surface-sunken` / `fg-muted` |
| `surfaceContainerLowest` … `Highest` | `surface` … `surface-raised` |
| `outline` / `outlineVariant` | `line-strong` / `line` |
| `error` / `onError` | `danger` / `on-danger` |
| `errorContainer` / `onErrorContainer` | `danger-tint` / `on-danger-tint` |
| `inverseSurface` / `inverseOnSurface` | `inverse` / `on-inverse` |

- **Extra colours:** success, warning, info, income and their tints are given through a `CompositionLocal`, read the same way as `MaterialTheme.colorScheme`.
- **Typography:** a `Typography` with the roles in §4.2, Plex Sans for Latin and Noto Sans Arabic per §4.1.
- **Shapes:** `Shapes(extraSmall = 4.dp, small = 8.dp, medium = 12.dp, large = 12.dp, extraLarge = 12.dp)`. Buttons use 8 dp (Material's default is a full pill), and text fields are outlined with 8 dp corners.
- **Sizes:** buttons and fields at least 48 dp tall.
- **Mode:** from the account setting, else the device cache, else `isSystemInDarkTheme()` (§3.5). The window theme in `themes.xml` gets a night variant (or a day-night parent) with `windowBackground` = `canvas`, so the window behind Compose matches. Status and navigation bar icons follow the mode.
- **Icons:** Lucide vector drawables (§10).

## 16. What the first identity screens need (S-1)

Identity's S-1 builds the invitation sign-up (S-5, S-6, S-7), the home first-run page, the sign-in page shell (S-1) and the header wordmark. From this guide they need:

1. **Tokens and theme plumbing** (§3, §14, §15): the generated teal tokens in both modes, `data-theme`/`data-mode` on `<html>` before first paint (System only, until the setting exists), and Android's `AppTheme` with the colour scheme, typography and shapes. Without these, nothing else can be styled.
2. **Fonts** (§4.1): Plex Sans, Plex Mono and Noto Sans Arabic, self-hosted and bundled, with `unicode-range` on web.
3. **The header** (§2.1, §5.2): 56 px, the "wDit" wordmark with the accent "D", LTR-isolated, its accessible name the visible text; the account menu slot comes in S-3.
4. **The signed-out column** (§5.2): 420 px, the card from 600 px, and the spacing in §5.1.
5. **Buttons** (§7): primary, secondary (S-5's two equal choices), the Google button exception, busy state and full width in the column.
6. **Text fields** (§8.1 to §8.4): label, field, hint and error; the password show/hide toggle; the currency and time-zone comboboxes; the read-only email on S-6.
7. **The empty state** (§9.2): the home first-run page's icon circle, heading, line and **Add account** button.
8. **The S-7 invitation problem and the error page** (§9.3): the page pattern, which also closes platform FU-1 (**Try again** primary, **Go to home** secondary; not-found's **Go to home** primary).
9. **Skeletons** (§9.1): "Checking your invitation…".
10. **The favicon** (§2.2): the "D" tile.
11. **Focus, targets and contrast** (§12), and the RTL details (§13) for the pseudo-RTL run.

Not needed by S-1: the theme setting itself (it waits for the identity amendment, §17), dialogs, chips, banners and toasts (later slices), and the money styles.

## 17. Changes this guide needs elsewhere

These are follow-ups for the planner. None of them is made by this guide.

| Item | What | Where |
| ---- | ---- | ----- |
| Product rename (UX-D10, UX-D13) | "Budmon" becomes "wDit": `APP_NAME`, the Android app label and strings, the HLD wording tables, email subjects, and the strings that name the product, rewritten name-free on screens. | Identity and platform HLD/LLD, code (via the pipeline) |
| Theme setting (UX-D4, UX-D5) | A `theme` preference (System, Light, Dark; default System) on the user, in `me.get` / `me.update`, on S-9, with the device cache and the resolution order in §3.5. | Identity HLD §4 and D-17, LLD |
| Platform FU-1 | Styling of the error page's **Try again** and the not-found page's **Go to home** is now defined (§9.3). | Platform LLD (close FU-1) |
| Existing platform components | `OfflineBanner`, `Toaster`, `ErrorFallback`, `NotFound`, `FieldError`, `FormErrorSummary`, `RateLimitNotice`, and Android's `PlatformUi.kt` move to tokens, Lucide and the patterns here. | Platform LLD amendment, or folded into identity S-1's theme work |
| Token source and contrast check | Where the recipe file and generator live; the contrast report in CI (D-39: reported, not blocking). | Platform or identity LLD |

## 18. Open questions

| ID | Question | Proposal |
| -- | -------- | -------- |
| Q-1 | Where the long form "Where did I tap" appears (UX-D16): the domain, which parts of the website, and whether it ever appears in the apps (About, emails' footer). | The owner decides later; until then the apps use only "wDit". |
| Q-2 | Dynamic colour on Android, as a theme option (UX-D7). | Later, with a theme picker. |
| Q-3 | A real logo to replace the text wordmark and the "D" tile. | Later; §2 is replaced when one exists. |
| Q-4 | Real Arabic review of the fonts, line heights and digits (D-38's after-MVP testing). | With the first Arabic catalogue. |
