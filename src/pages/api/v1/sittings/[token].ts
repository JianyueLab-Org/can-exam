import type { APIContext } from "astro";

import { readCappedText } from "@/server/body";
import { crossOrigin, forbidden } from "@/server/guard";
import { LIMITS, clientIp, enforce } from "@/server/rateLimit";
import { callApi, relay } from "@/server/upstream";

/**
 * 一张已经抽出来的卷子：GET 取回，POST 交卷。
 *
 * GET 存在是为了让刷新是安全的。上游按记下来的顺序重新渲染同一张卷子，题目和
 * 选项的次序都不变 —— 否则手一抖按了 F5，选项就在已经决定「选第二个」的人眼
 * 前重新洗了一遍。
 *
 * POST 是这个站点上唯一不可撤销的动作。交卷在上游的一个事务里同时做三件事：
 * 把这张卷子标记为已用、写成绩、（如果这场考试给等级）提升等级。所以**一张卷
 * 子只能交一次**，重复的那一次会拿到 409 `already_submitted` —— 那不是错误处
 * 理的边角，那是分数不成为预言机的原因。
 */
const path = (context: APIContext) =>
  `/api/v1/pilot/exam/sittings/${encodeURIComponent(context.params.token ?? "")}`;

export const GET = async (context: APIContext) => {
  const limited = enforce([
    [`sitting:ip:${clientIp(context)}`, LIMITS.sitting],
  ]);
  if (limited) return limited;

  return relay(await callApi(context, path(context)));
};

export const POST = async (context: APIContext) => {
  if (crossOrigin(context)) return forbidden();

  const limited = enforce([
    [`sitting:ip:${clientIp(context)}`, LIMITS.sitting],
  ]);
  if (limited) return limited;

  // **交卷的 body 也要挡。** 这条路和上传图片那条的区别只是没人注意到 ——
  // 它一样是匿名可达的（鉴权在上游，在这次读之后），一样把整个 body 读进堆。
  // 附带损害更难看：把这个进程压垮，代价是一个考生交不上他那张一次性的卷子。
  const read = await readCappedText(context.request);
  if (!read.ok) return read.response;

  return relay(
    await callApi(context, path(context), {
      method: "POST",
      body: read.value,
    }),
  );
};
