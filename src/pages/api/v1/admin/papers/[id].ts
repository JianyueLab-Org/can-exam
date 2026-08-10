import type { APIContext } from "astro";

import { crossOrigin, forbidden } from "@/server/guard";
import { LIMITS, clientIp, enforce } from "@/server/rateLimit";
import { callApi, relay } from "@/server/upstream";

/** 改一份卷子，或者删掉它。授权全在上游，见同目录的 `papers.ts`。 */
const path = (context: APIContext) =>
  `/api/v1/super/exam/papers/${encodeURIComponent(context.params.id ?? "")}`;

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

/**
 * 删卷子会连着它的题目和正在作答的卷子一起删，但**不删成绩** —— 一场考试下线
 * 不该抹掉当初有人通过了它这件事。那条规矩在上游的 `DeletePaper` 里。
 */
export const DELETE = async (context: APIContext) => {
  if (crossOrigin(context)) return forbidden();

  const limited = enforce([[`admin:ip:${clientIp(context)}`, LIMITS.admin]]);
  if (limited) return limited;

  return relay(await callApi(context, path(context), { method: "DELETE" }));
};
