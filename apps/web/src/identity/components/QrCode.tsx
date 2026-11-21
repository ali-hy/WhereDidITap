// F-165: a QR code as an inline SVG, drawn from the module matrix.
import qrcode from "qrcode-generator";
import { createMemo, type JSX } from "solid-js";

const QUIET = 4;

export function QrCode(props: { text: string; alt: string }): JSX.Element {
  const drawn = createMemo(() => {
    const qr = qrcode(0, "M");
    qr.addData(props.text);
    qr.make();
    const count = qr.getModuleCount();
    let path = "";
    for (let row = 0; row < count; row += 1) {
      for (let col = 0; col < count; col += 1) {
        if (qr.isDark(row, col)) path += `M${String(col + QUIET)} ${String(row + QUIET)}h1v1h-1z`;
      }
    }
    return { size: count + QUIET * 2, path };
  });
  return (
    <div
      role="img"
      aria-label={props.alt}
      class="size-56 shrink-0 rounded-control"
      // A QR code needs dark modules on a light ground in every theme.
      style={{ "background-color": "#fff" }}
    >
      {/* eslint-disable-next-line budmon/icon-from-registry -- a QR code, not an icon */}
      <svg
        viewBox={`0 0 ${String(drawn().size)} ${String(drawn().size)}`}
        class="size-full"
        aria-hidden="true"
        shape-rendering="crispEdges"
      >
        <path d={drawn().path} fill="#000" />
      </svg>
    </div>
  );
}
