// F-215: the platform's icons. Every icon in the app comes from here (F-3).
import type { Component, JSX } from "solid-js";
import { svgIcon } from "./svgIcon.js";

export type IconName =
  | "alert"
  | "info"
  | "offline"
  | "refresh"
  | "chevron-start"
  | "chevron-end"
  | "arrow-back"
  | "check"
  | "eye"
  | "eye-off"
  | "chevron-down";

type SvgComponent = Component<JSX.SvgSVGAttributes<SVGSVGElement>>;

/** 24×24 stroke paths (drawn for left-to-right; `mirrorInRtl` icons are flipped in RTL). */
const PATHS: Readonly<Record<IconName, readonly string[]>> = {
  alert: [
    "M12 9v4",
    "M12 17h.01",
    "M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z",
  ],
  info: ["M12 16v-4", "M12 8h.01", "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z"],
  offline: [
    "M2 2l20 20",
    "M8.5 16.5a5 5 0 0 1 7 0",
    "M2 8.8a15 15 0 0 1 4.2-2.7",
    "M10.7 5.1A15 15 0 0 1 22 8.8",
    "M12 20h.01",
  ],
  refresh: ["M21 12a9 9 0 1 1-2.6-6.4L21 8", "M21 3v5h-5"],
  "chevron-start": ["M15 18l-6-6 6-6"],
  "chevron-end": ["M9 18l6-6-6-6"],
  "arrow-back": ["M19 12H5", "M12 19l-7-7 7-7"],
  check: ["M20 6 9 17l-5-5"],
  eye: [
    "M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0",
    "M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0z",
  ],
  "eye-off": [
    "M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49",
    "M14.084 14.158a3 3 0 0 1-4.242-4.242",
    "M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143",
    "m2 2 20 20",
  ],
  "chevron-down": ["m6 9 6 6 6-6"],
};

const MIRROR_IN_RTL: ReadonlySet<IconName> = new Set([
  "chevron-start",
  "chevron-end",
  "arrow-back",
]);

export const icons: Record<IconName, { svg: SvgComponent; mirrorInRtl: boolean }> =
  Object.fromEntries(
    (Object.keys(PATHS) as IconName[]).map((name) => [
      name,
      {
        svg: svgIcon(PATHS[name]),
        mirrorInRtl: MIRROR_IN_RTL.has(name),
      },
    ]),
  ) as Record<IconName, { svg: SvgComponent; mirrorInRtl: boolean }>;
