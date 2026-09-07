import { defineMiddleware } from "astro:middleware";

/**
 * 每一个响应上的三个安全头。
 *
 * 四个兄弟站（can-dev、can-efb、can-controller、can-portal）都有这一份，这个
 * 站点从前**一个都没有** —— 它连 `src/middleware.ts` 都没有，所以差的不是某一
 * 条头，是整层。
 *
 * 这里没有会话解析、也没有 `PROTECTED_PREFIXES`：这个站点一次授权判断都不做，
 * 每一页要什么权限由 can-api 在转发的那一次回答（见 `server/upstream.ts`）。
 * 在这里补一份路由保护只会得到第二份、迟早和上游长得不一样的判断，而更宽松的
 * 那一份就是实际生效的那一份。
 *
 * ## 三条头各自挡什么
 *
 * - `X-Frame-Options: DENY` —— 别人不能把考试页嵌进自己的框里。这一条在这个站
 *   点上不只是点击劫持的老套路：发卷和交卷都是 POST，而一个被嵌起来的考试页是
 *   一个可以被覆盖、被诱导点击的一次性动作。
 * - `X-Content-Type-Options: nosniff` —— 转发回来的 body 是上游的字节，浏览器
 *   不该替它猜类型。
 * - `Referrer-Policy` —— 见下面那段，这个站点上它是三条里最要紧的一条。
 */

/**
 * 用函数包一层，而不是在 `next()` 之后就地设置。
 *
 * 兄弟站的注释都写了同一句话，理由也一样：将来这里一旦出现提前返回的分支（重
 * 定向、维护页、健康检查），就地写法会让它成为唯一一个什么头都没有的响应，而
 * 那正是最容易被漏看的一个。can-web 被这一条咬过。
 */
function withSecurityHeaders(response: Response): Response {
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("X-Content-Type-Options", "nosniff");
  /**
   * **这一条在考试中心比在别处重要。**
   *
   * 一张抽出去的卷子是靠地址栏里那个 token 认的：`/sit/<slug>?token=<token>`。
   * 没有这条头，浏览器会把**完整地址连着查询串**放进跨源请求的 `Referer` 里
   * —— 题面里挂着的配图在 cdn.ceruleanavi.net 上，那是另一个源，于是每加载一张
   * 图就把这张卷子的 token 送出去一次。
   *
   * `origin-when-cross-origin` 跨源时只送 origin，路径和查询串都被砍掉；同源
   * 的请求仍然拿得到完整地址，页面内部的相对跳转不受影响。和 can-efb、
   * can-controller 用的是同一个值。
   */
  response.headers.set("Referrer-Policy", "origin-when-cross-origin");
  return response;
}

export const onRequest = defineMiddleware(async (_context, next) => {
  return withSecurityHeaders(await next());
});
