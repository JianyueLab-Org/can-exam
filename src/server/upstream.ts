import type { APIContext } from "astro";

import { SESSION_COOKIE, apiOrigin } from "./config";

/**
 * 这个站点和 can-api 之间**唯一**的一条路。
 *
 * 每一次调用都在服务端发出，带着浏览器本来就有的那枚会话 cookie，浏览器那边
 * 看到的永远是同源的一次 fetch。三个后果，都是有意的：
 *
 * 1. **不用给 can-api 开 CORS。** exam.ceruleanavi.net 不在它的 ALLOWED_ORIGINS
 *    里，也不需要在 —— 和 can-radar 一样。少一个跨源白名单条目，就少一处「哪
 *    天忘了同步就整站登录失效」的地方。
 *
 * 2. **考试的答案永远不经过浏览器能看到的地方。** 抽好的卷子是 can-api 去掉
 *    答案之后的那一份，管理端的题目**带答案**，所以那一组转发全部只在
 *    `/api/admin/*` 下、且由 can-api 的 WithSup 守着。这里不做鉴权判断，一次
 *    都不做：鉴权全在上游，这边照抄它的状态码。
 *
 * 3. **只有一处拼 URL、一处转发 cookie、一处处理超时。** 之前三个卫星站点各
 *    自抄了四五遍，改一处就漏一处。
 *
 * ## 为什么不在这里验会话
 *
 * 令牌是 can-api 用 HMAC-SHA256 签的，验签只要那把密钥 —— 而那正是不能做的
 * 事：`SESSION_SECRET` 多存一处，就多一处能签发任何人身份的地方，省下的只是
 * 一次内网 HTTP。这个站点永远只是一个**读者**。
 */

/**
 * 上游最多等这么久。
 *
 * 比 can-radar 的航迹查询短：这里没有一次调用是几十兆的数据，最慢的一次也只
 * 是一张几十道题的卷子。交卷卡住比读不到列表严重得多，所以宁可早点回一个明确
 * 的 502 让人重试 —— 交卷是幂等的（同一张卷子只能交一次，重复的那次会被上游
 * 判为 already_submitted），重试不会记两笔。
 */
const TIMEOUT_MS = 8000;

/** 转发的结果。`ok` 之外的一切都由调用方原样传回浏览器。 */
export interface UpstreamResult {
  status: number;
  body: string;
  contentType: string;
}

/**
 * 带着调用者的会话，向 can-api 发一次请求。
 *
 * `path` 是 can-api 上的完整路径（`/api/v1/…`）。没有登录时**照样发**：上游
 * 会答 401，而 401 正是页面需要知道的东西 —— 这里替它判断「反正没 cookie，
 * 不用问了」，就会把「会话过期了」和「你没权限」变成同一句话。
 */
export async function callApi(
  context: APIContext,
  path: string,
  init?: {
    method?: string;
    body?: string | ArrayBuffer;
    /**
     * 覆盖请求的 Content-Type。
     *
     * 只有上传题库配图用得上：那一条转发的 body 是图片本身，不是 JSON。默认仍
     * 然是 application/json，所以其余每一处调用一个字都不用改。
     */
    contentType?: string;
    /** 这一次允许等多久。默认 TIMEOUT_MS。 */
    timeoutMs?: number;
  },
): Promise<UpstreamResult> {
  const token = context.cookies.get(SESSION_COOKIE)?.value;

  const headers: Record<string, string> = { Accept: "application/json" };
  if (token) {
    // 原样转发，不重新拼装：这枚 cookie 的值是签名的一部分，任何「整理」都会
    // 把它改坏。
    headers.Cookie = `${SESSION_COOKIE}=${token}`;
  }
  if (init?.body !== undefined) {
    headers["Content-Type"] = init.contentType ?? "application/json";
  }

  let response: Response;
  try {
    response = await fetch(`${apiOrigin()}${path}`, {
      method: init?.method ?? "GET",
      headers,
      body: init?.body,
      signal: AbortSignal.timeout(init?.timeoutMs ?? TIMEOUT_MS),
    });
  } catch {
    return {
      status: 502,
      body: JSON.stringify({
        error: "upstream_unreachable",
        message: "上游没有响应。",
      }),
      contentType: "application/json",
    };
  }

  return {
    status: response.status,
    body: await response.text(),
    contentType: response.headers.get("content-type") ?? "application/json",
  };
}

/**
 * 把一次转发的结果变成给浏览器的答复。
 *
 * `no-store` 一律加上，没有例外。这个站点上**每一条**答复都是随人而异的 ——
 * 你能考什么、你抽到哪几道题、你考了多少分 —— 中间任何一层把它存下来，都等于
 * 把一个人的卷子发给下一个访客。
 */
export function relay(result: UpstreamResult): Response {
  return new Response(result.body, {
    status: result.status,
    headers: {
      "Content-Type": result.contentType,
      "Cache-Control": "no-store, private",
    },
  });
}

/**
 * 服务端渲染时读一次 JSON。
 *
 * 页面首屏用的那一份 —— 岛屿挂载之后再 fetch 一次会让人先看到一个空壳。读不
 * 到就返回 null，由页面决定是显示「请登录」还是显示一个错误；这里不抛，因为
 * can-api 抖一下不该变成整页 500。
 */
export async function readApi<T>(
  context: APIContext,
  path: string,
): Promise<T | null> {
  const result = await callApi(context, path);
  if (result.status < 200 || result.status >= 300) return null;
  try {
    return JSON.parse(result.body) as T;
  } catch {
    return null;
  }
}
