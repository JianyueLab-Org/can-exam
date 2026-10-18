// @ts-check
import { defineConfig } from "astro/config";
import node from "@astrojs/node";
import vue from "@astrojs/vue";
import mdx from "@astrojs/mdx";
import { unified } from "@astrojs/markdown-remark";
import tailwindcss from "@tailwindcss/vite";

/**
 * 给每张 markdown 表格套一层滚动容器。
 *
 * 7 篇培训资料共 15 张表，全在 src/content/training，三四列的日文，比手机屏幕
 * 宽。表格没有自己的容器时会撑宽整篇文章，整页横向滚动，标题和段落都跟着偏离
 * 中线。
 *
 * 必须是包一层元素，而不是给表格设 `display: block; overflow: auto`：改 display
 * 会让表格丢掉无障碍树里的 `table` 角色，读屏软件就无法按行列浏览。配套样式是
 * can-ui 的 components.css 里的 `.table-scroll`。
 *
 * 手写而不引 `unist-util-visit`：它只是 Astro markdown 管线的传递依赖。节点形状
 * 在本地声明而不从 `hast` 导入，同理 —— 本文件开着 `@ts-check`，借用没声明的包
 * 的类型，会在无关的升级上崩。
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
 * `output: "server"` 是必须的，而且理由比雷达那边更硬：考试页和管理页没有一个
 * 是所有人看到的东西都一样的 —— 能考什么取决于你的 rating，卷子是随机抽的，
 * 管理页取决于你是不是 SUP。预渲染其中任何一页都是把某一个人的状态发给下一个
 * 访客。`/training` 是公开的，但顶栏读会话，同样不预渲染。
 *
 * **题库和答案一点都不在这里。** 它们在 can-api 的 MySQL 里，判卷也在那边。
 * 这个站点拿到的卷子是 can-api 抽好、去掉答案之后的那一份 —— 它就算被整个翻
 * 出来，也翻不出任何一道题的正确选项。见 `src/server/upstream.ts`。
 */
export default defineConfig({
  output: "server",
  adapter: node({ mode: "standalone" }),
  integrations: [vue(), mdx()],

  // 培训资料（MDX）里的表格外面包一层 `.table-scroll`，见上面的插件。
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
