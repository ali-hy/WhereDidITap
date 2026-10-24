// F-223 (A-462): the app's banners, before the router in DOM and reading order. Sticky at the top,
// so they push the page down rather than cover it, and stay visible while scrolling. The
// update-required banner (F-210) comes first, then the offline banner (F-211).
import type { Accessor, JSX } from "solid-js";
import { OfflineBanner } from "./OfflineBanner.js";
import { UpdateNotifier } from "./UpdateNotifier.js";

export function AppBanners(props: {
  buildNumber: number;
  updateRequired?: Accessor<boolean>;
}): JSX.Element {
  return (
    <div data-banners class="sticky top-0 z-10">
      <UpdateNotifier
        buildNumber={props.buildNumber}
        {...(props.updateRequired === undefined ? {} : { updateRequired: props.updateRequired })}
      />
      <OfflineBanner />
    </div>
  );
}
