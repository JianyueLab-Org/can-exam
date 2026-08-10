import type { APIContext } from "astro";

import { crossOrigin, forbidden } from "@/server/guard";
import { LIMITS, clientIp, enforce } from "@/server/rateLimit";
import { callApi, relay } from "@/server/upstream";

/**
 * 一份卷子的题库：GET 读全部（**带答案**），POST 加一道题。
 *
 * GET 返回的题目里 `isCorrect` 是真的在的，这是全站唯一如此的地方。发给考生的
 * 那一份走的是另一条完全不同的路（`/api/v1/sittings/[token]`），两条路在上游
 * 也是两个不共享任何响应形状的文件 —— 那是有意的，共享一个结构体的下一步就是
 * 某天某个字段顺着最短的路径漏到考生页面上。
 */
const path = (context: APIContext) =>
  `/api/v1/super/exam/papers/${encodeURIComponent(context.params.id ?? "")}/questions`;

export const GET = async (context: APIContext) => {
  const limited = enforce([[`admin:ip:${clientIp(context)}`, LIMITS.admin]]);
  if (limited) return limited;

  return relay(await callApi(context, path(context)));
};

export const POST = async (context: APIContext) => {
  if (crossOrigin(context)) return forbidden();

  const limited = enforce([[`admin:ip:${clientIp(context)}`, LIMITS.admin]]);
  if (limited) return limited;

  return relay(
    await callApi(context, path(context), {
      method: "POST",
      body: await context.request.text(),
    }),
  );
};
