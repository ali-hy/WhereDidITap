// F-214: the rate-limit gate and its notice (J-3).
import { createSignal, onCleanup, type Accessor, type JSX } from "solid-js";
import { messages } from "../i18n/messages.js";
import { useI18n } from "../i18n/useI18n.js";

const DEFAULT_RETRY_AFTER_S = 60;

export function createRateLimitGate(now: () => number = Date.now): {
  blockedFor: Accessor<number>;
  block(retryAfterSeconds?: number): void;
} {
  const [expiresAt, setExpiresAt] = createSignal(0);
  const [tick, setTick] = createSignal(0);
  let timer: ReturnType<typeof setInterval> | undefined;
  const stop = () => {
    clearInterval(timer);
    timer = undefined;
  };
  onCleanup(stop);

  const blockedFor = () => {
    tick();
    return Math.max(0, Math.ceil((expiresAt() - now()) / 1000));
  };

  return {
    blockedFor,
    block(retryAfterSeconds) {
      // A-404: a 429 without Retry-After waits the shortest limiter window, 60 s.
      setExpiresAt(now() + (retryAfterSeconds ?? DEFAULT_RETRY_AFTER_S) * 1000);
      stop();
      timer = setInterval(() => {
        setTick((n) => n + 1);
        if (blockedFor() === 0) stop();
      }, 1000);
    },
  };
}

/**
 * A-400: a permanent status region, rendered whether or not the gate is closed and filled only
 * while it is, so the message is announced when it appears.
 */
export function RateLimitNotice(props: { secondsLeft: number }): JSX.Element {
  const { t } = useI18n();
  return (
    <p role="status">
      {props.secondsLeft > 0
        ? t(messages.errorRateLimited, { minutes: Math.ceil(props.secondsLeft / 60) })
        : ""}
    </p>
  );
}
