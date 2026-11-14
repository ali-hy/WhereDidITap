// F-215: one stroke icon from its path data (SVG lives only under ui/icons, F-3).
import { For, type Component, type JSX } from "solid-js";

export function svgIcon(paths: readonly string[]): Component<JSX.SvgSVGAttributes<SVGSVGElement>> {
  return (props) => (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width="24"
      height="24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      {...props}
    >
      <For each={paths}>{(d) => <path d={d} />}</For>
    </svg>
  );
}
