import type { APIContext } from "astro";

import { LIMITS, clientIp, enforce } from "@/server/rateLimit";
import { callApi, relay } from "@/server/upstream";

/**
 * 我的成绩 —— 一个转发。
 *
 * 上游刻意**不**返回 `results`：那个字段里存着每一道题的正确答案，把成绩单原
 * 样发回来，等于让刚考砸的人拿到补考的答案。这里能拿到的只有分数、及格与否和
 * 时间，而那正好是这一页要显示的全部。
 */
export const GET = async (context: APIContext) => {
  const limited = enforce([[`papers:ip:${clientIp(context)}`, LIMITS.papers]]);
  if (limited) return limited;

  return relay(await callApi(context, "/api/v1/pilot/exam"));
};
