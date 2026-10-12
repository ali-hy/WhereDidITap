// /__fixtures/rtl-probe: every platform component, each in its own <section data-rtl-container>
// (A-330), with start and end probes, for the pseudo-RTL run (TP-11.17).
import type { JSX } from "solid-js";
import { ErrorFallback } from "../ui/ErrorFallback.js";
import { FieldError, FormErrorSummary } from "../ui/forms.js";
import { Icon } from "../ui/icons/Icon.js";
import { RateLimitNotice } from "../ui/RateLimitNotice.js";

function Probed(props: { title: string; children: JSX.Element }): JSX.Element {
  return (
    <section data-rtl-container class="my-4 border p-2">
      <h2>{props.title}</h2>
      <div class="flex justify-between">
        <span data-rtl-probe="start">start</span>
        <span data-rtl-probe="end">end</span>
      </div>
      {props.children}
    </section>
  );
}

export function RtlProbeFixture(): JSX.Element {
  return (
    <>
      <h1 tabindex="-1">RTL probe</h1>
      <Probed title="Banner">
        <p role="status" class="flex items-center gap-2">
          <Icon name="offline" />
          Offline banner
        </p>
      </Probed>
      <Probed title="Toast">
        <div class="flex items-center gap-4 rounded p-3 shadow">
          <span>Toast message</span>
          <button type="button">Action</button>
        </div>
      </Probed>
      <Probed title="Error fallback">
        <ErrorFallback
          error={{ kind: "unknown" }}
          requestId="4bf92f35ab12cd34ef567890abcdef12"
          onRetry={() => Promise.resolve()}
        />
      </Probed>
      <Probed title="Form errors">
        <FormErrorSummary messages={[{ text: "Some details need fixing.", fieldId: "probe" }]} />
        <label for="probe">Amount</label>
        <input id="probe" aria-invalid="true" aria-describedby="probe-error" />
        <FieldError id="probe-error" message="Check the format." />
        <RateLimitNotice secondsLeft={125} />
      </Probed>
      <Probed title="Icons">
        <p class="flex gap-2">
          <Icon name="chevron-start" />
          <Icon name="chevron-end" />
          <Icon name="arrow-back" />
          <Icon name="check" />
          <Icon name="alert" />
        </p>
      </Probed>
    </>
  );
}
