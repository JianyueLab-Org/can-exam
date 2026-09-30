import type { APIContext } from "astro";

import { readCappedText } from "./body";
import { crossOrigin, forbidden } from "./guard";
import { LIMITS, clientIp, enforce } from "./rateLimit";
import { callApi, relay } from "./upstream";

/**
 * 通知铃的转发：can-ui `NotificationBell` 同源调的五条，原样转给 can-api 的
 * `/api/v1/notifications…`。
 *
 * 路径按 `ROUTES` 收紧，表外 404，方法不对 405。写操作（`POST read-all`、
 * `PATCH {member|broadcast}/{id}`）先查 Origin。鉴权在 can-api。
 */

/** `rest` 是 `/api/v1/notifications` 之后的部分，不带前导斜杠。 */
const ROUTES: ReadonlyArray<{ test: RegExp; methods: readonly string[] }> = [
  { test: /^$/, methods: ["GET"] },
  { test: /^unread$/, methods: ["GET"] },
  { test: /^read-all$/, methods: ["POST"] },
  { test: /^(member|broadcast)\/[0-9]{1,20}$/, methods: ["PATCH"] },
];

export type NotificationMatch =
  | { ok: true; path: string }
  | { ok: false; status: 404 }
  | { ok: false; status: 405; allow: string };

export function matchNotificationRoute(
  rest: string | undefined,
  method: string,
): NotificationMatch {
  const tail = rest ?? "";
  const route = ROUTES.find((entry) => entry.test.test(tail));
  if (!route) return { ok: false, status: 404 };
  if (!route.methods.includes(method.toUpperCase())) {
    return { ok: false, status: 405, allow: route.methods.join(", ") };
  }
  return {
    ok: true,
    path: tail ? `/api/v1/notifications/${tail}` : "/api/v1/notifications",
  };
}

const NO_STORE = { "Cache-Control": "no-store, private" };

export async function handleNotifications(
  context: APIContext,
): Promise<Response> {
  const method = context.request.method.toUpperCase();
  const match = matchNotificationRoute(context.params.path, method);
  if (!match.ok) {
    if (match.status === 404) {
      return Response.json(
        { status: 404, error: "Not found." },
        { status: 404, headers: NO_STORE },
      );
    }
    return Response.json(
      { status: 405, error: "Method not allowed." },
      { status: 405, headers: { ...NO_STORE, Allow: match.allow } },
    );
  }

  if (method !== "GET" && crossOrigin(context)) return forbidden();

  const limited = enforce([
    [`notifications:ip:${clientIp(context)}`, LIMITS.notifications],
  ]);
  if (limited) return limited;

  let body: string | undefined;
  if (method !== "GET") {
    const read = await readCappedText(context.request);
    if (!read.ok) return read.response;
    if (read.value) body = read.value;
  }

  const result = await callApi(context, match.path + context.url.search, {
    method,
    body,
  });
  // 204 不能带响应体：`new Response("", { status: 204 })` 会抛。
  if (result.status === 204) {
    return new Response(null, { status: 204, headers: NO_STORE });
  }
  return relay(result);
}
