/**
 * 服务端读的那几个地址，以及会话 cookie 的名字。
 *
 * 全部在服务端读，**没有一个带 `PUBLIC_` 前缀的语义**：`PUBLIC_ORIGIN` 是个
 * 例外的名字（Astro 不会把它塞进客户端包），它只是这个部署自己的对外地址，
 * 只用来比对写操作的 Origin。
 *
 * 和 can-radar 的同名文件几乎一样，是有意抄的而不是抽包共用：三个卫星站点各
 * 自部署、各自有自己的默认值，把它们绑成一个包意味着改雷达的默认端口会顺手改
 * 掉考试中心的。
 */

/** 会话 cookie 的名字。can-api 的 `internal/session` 定义，改名要两边一起改。 */
export const SESSION_COOKIE = "can_session";

const trim = (value: string) => value.replace(/\/+$/, "");

/**
 * 数据层。
 *
 * 这个站点问它要**四样东西**，而且只有这四样：这枚 cookie 是谁、有哪些卷子、
 * 一张抽好的卷子、以及交卷的判分结果。管理端再加一组题库读写。题库、答案、
 * 判卷逻辑一样都不在这边。
 */
export const apiOrigin = () =>
  trim(process.env.CAN_API_ORIGIN || "https://api.ceruleanavi.net");

/**
 * 主站。页眉导航和**唯一的登录入口**指向它。
 *
 * 分成两个地址而不是一个，和 can-dev、can-radar 同一个理由：登录页是一个要渲
 * 染给人看、带着主站样式的**页面**，它没有跟着数据层搬进 can-api。本地开发时
 * 主站在 :4321，所以这个值必须可配，否则开发机上的「登录」会把人送到线上去。
 */
export const webOrigin = () =>
  trim(process.env.CAN_WEB_ORIGIN || "https://ceruleanavi.net");

/**
 * 这个部署自己的对外地址。
 *
 * 只有一个用途：比对写操作的 `Origin` 头（见 `guard.ts`）。它是**显式配置**
 * 而不是从 `Host` 头推的 —— 这个站跑在 TLS 终止的反代后面，从请求头推出来的
 * 东西正是反代能影响的东西。
 */
export const publicOrigin = () =>
  trim(process.env.PUBLIC_ORIGIN || "http://localhost:4324");
