import type { APIContext } from "astro";

import { crossOrigin, forbidden } from "@/server/guard";
import { LIMITS, clientIp, enforce } from "@/server/rateLimit";
import { callApi, relay } from "@/server/upstream";

/**
 * 发卷。
 *
 * POST 而不是 GET，因为它**写东西**：上游抽一次题、把抽中的题号和选项顺序落
 * 库，然后把去掉答案的那一份发回来。用 GET 表达它，意味着一次预取、一次爬虫、
 * 一次浏览器的推测加载都能替人抽走一张卷子。
 *
 * 手上已经有一张没交的卷子时，上游返回的是**同一张**，不是新抽的一张 —— 那是
 * 它那边的规矩，不是这里的：如果重开一次就换一套题，抽题就变成了重摇，关掉标
 * 签页再来一次直到题目顺眼为止。这里只是不要把它绕过去。
 */
export const POST = async (context: APIContext) => {
  if (crossOrigin(context)) return forbidden();

  const limited = enforce([
    [`sitting:ip:${clientIp(context)}`, LIMITS.sitting],
  ]);
  if (limited) return limited;

  const slug = encodeURIComponent(context.params.slug ?? "");
  return relay(
    await callApi(context, `/api/v1/pilot/exam/papers/${slug}/sit`, {
      method: "POST",
    }),
  );
};
