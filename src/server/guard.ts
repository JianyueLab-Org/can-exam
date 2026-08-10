import type { APIContext } from "astro";

import { publicOrigin } from "./config";

/**
 * 写操作的 Origin 检查。
 *
 * 和 `astro.config.mjs` 里关掉的 `checkOrigin` 是一件事的两半，必须一起读：
 *
 * Astro 在 SSR 下默认开着 `checkOrigin`，它从 `Host` 头推出本站的 origin 再和
 * 浏览器发来的 `Origin` 比对。这个站跑在 TLS 终止的反代后面 —— 推出来的是
 * `http://exam.airwaysn.org`，浏览器发的是 `https://…`，**永远对不上，每一个
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
 * 会话 cookie 是 SameSite=Lax，跨站的表单 POST 本来就带不上它，所以这不是唯一
 * 的门 —— 但 Lax 对顶层导航的 GET 是放行的，哪天有人把某个写操作改成 GET、或
 * 者浏览器再改一次 Lax 的语义，这里是唯一还站着的东西。
 */
export function crossOrigin(context: APIContext): boolean {
  const sent = context.request.headers.get("origin");
  // 没有 Origin 头的不是浏览器发起的跨站请求（curl、同源的老浏览器），放行 ——
  // 拒绝它只会打到不带这个头的正常调用，挡不住任何东西。
  return !!sent && sent !== publicOrigin();
}

/** 跨站请求的答复。形状和本站其他 `/api/v1/*` 的错误一致。 */
export function forbidden(): Response {
  return Response.json(
    { status: 403, error: "Cross-site request rejected." },
    { status: 403 },
  );
}
