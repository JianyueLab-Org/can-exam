import type { APIContext } from "astro";

import { crossOrigin, forbidden } from "@/server/guard";
import { LIMITS, clientIp, enforce } from "@/server/rateLimit";
import { callApi, relay } from "@/server/upstream";

/**
 * 改一道题，或者删掉它。
 *
 * 改题会把选项整组重写，于是选项拿到新的 id —— 那意味着一张**改动之前**发出去
 * 的卷子上，那道题的答案会解析不到，判为答错。这是上游有意选的方向（题面刚改
 * 过，就不该把旧答案当没事发生），这里只是不要以为改题是无痛的。
 */
const path = (context: APIContext) =>
  `/api/v1/super/exam/questions/${encodeURIComponent(context.params.id ?? "")}`;

export const PATCH = async (context: APIContext) => {
  if (crossOrigin(context)) return forbidden();

  const limited = enforce([[`admin:ip:${clientIp(context)}`, LIMITS.admin]]);
  if (limited) return limited;

  return relay(
    await callApi(context, path(context), {
      method: "PATCH",
      body: await context.request.text(),
    }),
  );
};

export const DELETE = async (context: APIContext) => {
  if (crossOrigin(context)) return forbidden();

  const limited = enforce([[`admin:ip:${clientIp(context)}`, LIMITS.admin]]);
  if (limited) return limited;

  return relay(await callApi(context, path(context), { method: "DELETE" }));
};
