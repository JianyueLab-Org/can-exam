import type { APIContext } from "astro";

import { crossOrigin, forbidden } from "@/server/guard";
import { LIMITS, clientIp, enforce } from "@/server/rateLimit";
import { callApi, relay } from "@/server/upstream";

/**
 * 题库管理的转发，共四个文件，这是第一个。
 *
 * **这一组路径下的答复带着正确答案** —— 整个站点只有这一组。它们能这么做，是
 * 因为上游把每一条都挂在 `WithSup` 后面（SUP/ADM），而这里**一次授权判断都不
 * 做**：不看 rating、不看会话内容，只把 cookie 转过去、把状态码抄回来。
 *
 * 这不是偷懒，是刻意的。两处各判一次的话，两处就会慢慢长得不一样，而更宽松的
 * 那一处就是实际生效的那一处。判断只有一份，在 can-api 里。这边的
 * `canManageBank()` 只决定要不要**画出**那个入口。
 */
export const GET = async (context: APIContext) => {
  const limited = enforce([[`admin:ip:${clientIp(context)}`, LIMITS.admin]]);
  if (limited) return limited;

  return relay(await callApi(context, "/api/v1/super/exam/papers"));
};

export const POST = async (context: APIContext) => {
  if (crossOrigin(context)) return forbidden();

  const limited = enforce([[`admin:ip:${clientIp(context)}`, LIMITS.admin]]);
  if (limited) return limited;

  return relay(
    await callApi(context, "/api/v1/super/exam/papers", {
      method: "POST",
      body: await context.request.text(),
    }),
  );
};
