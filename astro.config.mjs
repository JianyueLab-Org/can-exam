// @ts-check
import { defineConfig } from "astro/config";
import node from "@astrojs/node";
import vue from "@astrojs/vue";
import tailwindcss from "@tailwindcss/vite";

/**
 * 考试中心。第三个从 can-web 的形状里长出来的卫星站点，和 can-dev、can-radar
 * 同一套：Astro SSR + Vue 岛屿 + Tailwind v4，没有自己的数据库。
 *
 * `output: "server"` 是必须的，而且理由比雷达那边更硬：这一整个站点没有一个
 * 页面是所有人看到的东西都一样的 —— 能考什么取决于你的 rating，卷子是随机抽
 * 的，管理页取决于你是不是 SUP。预渲染任何一页都是把某一个人的状态发给下一个
 * 访客。
 *
 * **题库和答案一点都不在这里。** 它们在 can-api 的 MySQL 里，判卷也在那边。
 * 这个站点拿到的卷子是 can-api 抽好、去掉答案之后的那一份 —— 它就算被整个翻
 * 出来，也翻不出任何一道题的正确选项。见 `src/server/upstream.ts`。
 */
export default defineConfig({
  output: "server",
  adapter: node({ mode: "standalone" }),
  integrations: [vue()],

  /**
   * **必须关掉，否则每一个 POST 都是 403** —— 而这个站点几乎全是 POST。
   *
   * Astro 在 SSR 下默认开着 `checkOrigin`：它从 `Host` 头推出本站的 origin，
   * 再和浏览器发来的 `Origin` 比对。这个站跑在 TLS 终止的反代后面，推出来的
   * 是 `http://exam.airwaysn.org`、浏览器发的是 `https://…`，永远对不上。
   * can-web 从一开始就关了，can-dev 和 can-radar 都是踩了才关的，两边第一个
   * 撞上的都是登出。这里不必再踩一次。
   *
   * 关掉不等于不检查：写操作的 Origin 由 `src/server/guard.ts` 比对**显式配
   * 置**的 `PUBLIC_ORIGIN`，那个值不是从请求头推的，反代动不了它。
   */
  security: { checkOrigin: false },

  vite: { plugins: [tailwindcss()] },
});
