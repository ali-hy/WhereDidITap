// F-36 step 1: the request facts a service needs, built from the RequestContext.
import type { RequestContext } from "../platform/http/context.js";
import { parseCookies, readCookie } from "./cookies.js";
import type { ReqInfo } from "./sessionService.js";

/** `presentedDeviceToken` comes from the body for bearer delivery, else from the device cookie. */
export function reqInfoFrom(
  ctx: RequestContext,
  body: {
    tokenDelivery?: "cookie" | "body";
    deviceModel?: string | undefined;
    deviceToken?: string | undefined;
  } = {},
): ReqInfo {
  const host = ctx.headers["host"];
  const cookies = parseCookies(ctx.headers["cookie"]);
  const presented =
    body.tokenDelivery === "body"
      ? (body.deviceToken ?? null)
      : readCookie("device", cookies, host);
  return {
    ip: ctx.ip,
    clientKind: ctx.clientKind,
    userAgent: ctx.headers["user-agent"] ?? null,
    origin: ctx.headers["origin"] ?? null,
    host,
    cookies,
    deviceModel: body.deviceModel === undefined ? null : body.deviceModel.slice(0, 100),
    presentedDeviceToken: presented,
    tracker: ctx.commitTracker,
    requestId: ctx.requestId,
  };
}
