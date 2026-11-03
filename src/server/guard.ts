import type { APIContext } from "astro";

import { publicOrigin } from "./config";

/**
 * 写操作的 Origin 检查。
 *
 * 和 `astro.config.mjs` 里关掉的 `checkOrigin` 是一件事的两半，必须一起读：
 *
 * Astro 在 SSR 下默认开着 `checkOrigin`，它从 `Host` 头推出本站的 origin 再和
 * 浏览器发来的 `Origin` 比对。这个站跑在 TLS 终止的反代后面 —— 推出来的是
 * `http://exam.ceruleanavi.net`，浏览器发的是 `https://…`，**永远对不上，每一个
 * POST 都是 403**。can-web 从一开始就关了，can-dev 和 can-radar 都是踩了才关
 * 的，两边第一个撞上的都是登出。
 *
 * 关掉不等于不检查，检查换到这里、比对**显式配置**的 `PUBLIC_ORIGIN`，那个值
 * 不是从请求头推的，所以反代动不了它。
 *
 * 这道门在这个站点上比在另外两个站点上重要得多：那边唯一的写操作是登出，这边
 * 的写操作是**发卷和交卷** —— 一个跨站请求能替人抽走一张卷子，或者替人交一张
 * 空白卷，而交卷是一次性的，交掉就没了。
 *
 * SameSite=Lax still sends cookies between sibling hosts. Unsafe requests must
 * carry this site's configured Origin; safe requests do not need one.
 */
export function crossOrigin(context: APIContext): boolean {
  const method = context.request.method;
  if (method === "GET" || method === "HEAD" || method === "OPTIONS")
    return false;
  return context.request.headers.get("origin") !== publicOrigin();
}

/** 跨站请求的答复。形状和本站其他 `/api/v1/*` 的错误一致。 */
export function forbidden(): Response {
  return Response.json(
    { status: 403, error: "Cross-site request rejected." },
    { status: 403 },
  );
}
