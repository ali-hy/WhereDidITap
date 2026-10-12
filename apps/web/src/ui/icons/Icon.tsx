// F-215: an icon from the registry, decorative unless it has a label.
import { Dynamic } from "solid-js/web";
import type { JSX } from "solid-js";
import { icons, type IconName } from "./registry.js";

export function Icon(props: { name: IconName; label?: string; class?: string }): JSX.Element {
  const entry = () => icons[props.name];
  const classes = () =>
    [props.class, entry().mirrorInRtl ? "rtl:-scale-x-100" : undefined]
      .filter((c): c is string => c !== undefined && c !== "")
      .join(" ");
  return (
    <Dynamic
      component={entry().svg}
      class={classes() === "" ? undefined : classes()}
      data-rtl-probe={entry().mirrorInRtl ? "mirror" : "no-mirror"}
      {...(props.label === undefined
        ? { "aria-hidden": "true" as const }
        : { role: "img", "aria-label": props.label })}
    />
  );
}
