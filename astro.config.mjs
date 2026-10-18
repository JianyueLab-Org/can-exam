// @ts-check
import { defineConfig } from "astro/config";
import node from "@astrojs/node";
import vue from "@astrojs/vue";
import mdx from "@astrojs/mdx";
import { unified } from "@astrojs/markdown-remark";
import tailwindcss from "@tailwindcss/vite";

/**
 * Wrap every markdown table in a scroll container.
 *
 * Eight of the division documents carry a table — the JPN training syllabus,
 * the JPN ATC rules — three or four columns of Japanese that are wider than a
 * phone. Without a container of its own the table widens the *article*, and
 * then the whole page scrolls sideways: every heading and paragraph on it
 * sits off-centre, not just the table.
 *
 * This has to be a wrapper element rather than `display: block; overflow: auto`
 * on the table itself, which is the shorter CSS-only version of the same fix:
 * changing a table's `display` drops its `table` role from the accessibility
 * tree, so a screen reader loses row and column navigation through exactly the
 * documents — a syllabus, a rules index — where the grid is the content. The
 * paired styles are `.table-scroll` in src/styles/globals.css.
 *
 * Hand-rolled rather than pulling in `unist-util-visit`: it is a dozen lines,
 * and the alternative is depending on a package that is currently only a
 * transitive dependency of Astro's own markdown pipeline.
 *
 * The node shape is spelled out locally rather than imported from `hast` for
 * the same reason — this file is `@ts-check`ed, and borrowing types from a
 * package nothing here declares is how a config breaks on an unrelated bump.
 *
 * @typedef {{ type: string, tagName?: string, properties?: Record<string, unknown>, children?: HastNode[] }} HastNode
 */
function rehypeScrollableTables() {
  /** @param {HastNode} tree */
  return (tree) => {
    /** @param {HastNode} node */
    const walk = (node) => {
      if (!Array.isArray(node.children)) return;
      for (const child of node.children) walk(child);
      node.children = node.children.map((child) =>
        child.type === "element" && child.tagName === "table"
          ? {
              type: "element",
              tagName: "div",
              properties: { className: ["table-scroll"] },
              children: [child],
            }
          : child,
      );
    };
    walk(tree);
  };
}

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
  integrations: [vue(), mdx()],

  // 训练教材（MDX）里的表格外面包一层 `.table-scroll`，见上面的插件。
  // `markdown.rehypePlugins` 是已弃用的写法，管线改由 `markdown.processor` 接一个
  // unified() 实例。@astrojs/markdown-remark 钉成 astro 自己解析到的那一版，两边
  // 才是同一个模块：astro 按实例而不是按形状认自己的 processor，两份拷贝意味着插件
  // 静默失效，表格失去滚动容器，整页开始横向滚动，而没有任何东西报错。
  // 跟着 astro 和 @astrojs/mdx 一起升，并确认 `bun.lock` 里只有一份。验证看构建
  // 产物而不是构建日志：`grep -o table-scroll dist/server/chunks/* | wc -l` 应等于
  // src/content 里的表格数（15）。
  markdown: { processor: unified({ rehypePlugins: [rehypeScrollableTables] }) },

  /**
   * **必须关掉，否则每一个 POST 都是 403** —— 而这个站点几乎全是 POST。
   *
   * Astro 在 SSR 下默认开着 `checkOrigin`：它从 `Host` 头推出本站的 origin，
   * 再和浏览器发来的 `Origin` 比对。这个站跑在 TLS 终止的反代后面，推出来的
   * 是 `http://exam.ceruleanavi.net`、浏览器发的是 `https://…`，永远对不上。
   * can-web 从一开始就关了，can-dev 和 can-radar 都是踩了才关的，两边第一个
   * 撞上的都是登出。这里不必再踩一次。
   *
   * 关掉不等于不检查：写操作的 Origin 由 `src/server/guard.ts` 比对**显式配
   * 置**的 `PUBLIC_ORIGIN`，那个值不是从请求头推的，反代动不了它。
   */
  security: { checkOrigin: false },

  vite: {
    plugins: [tailwindcss()],

    /**
     * can-ui 发的是**源码**（`.vue` / `.ts` / `.css`）而不是构建产物。代价是必须
     * 告诉 Vite 不要把它当外部依赖：不加这行，SSR 会去 `require` 一个 `.vue`
     * 文件，首屏直接 500。
     */
    ssr: { noExternal: ["@jianyuelab-org/can-ui"] },
  },
});
