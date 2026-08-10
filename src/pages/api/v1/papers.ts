import type { APIContext } from "astro";

import { LIMITS, clientIp, enforce } from "@/server/rateLimit";
import { callApi, relay } from "@/server/upstream";

/**
 * 能考什么 —— 一个转发。
 *
 * 首屏不走这条路（页面服务端读好了），它是给「考完一场回到列表」和「另一个标
 * 签页刚登录」用的。上游同时告诉我们每一场是否可考、以及不可考的原因码，页面
 * 用自己的语言把那个码翻出来。
 */
export const GET = async (context: APIContext) => {
  const limited = enforce([[`papers:ip:${clientIp(context)}`, LIMITS.papers]]);
  if (limited) return limited;

  return relay(await callApi(context, "/api/v1/pilot/exam/papers"));
};
