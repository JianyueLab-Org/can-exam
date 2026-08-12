import type { APIContext } from "astro";

import { crossOrigin, forbidden } from "@/server/guard";
import { LIMITS, clientIp, enforce } from "@/server/rateLimit";
import { callApi, relay } from "@/server/upstream";

/**
 * 题库配图上传。body 就是图片本身，不是 multipart。
 *
 * 这条路和这个仓库里其他每一条一样，**一次判断都不做**：谁能上传、什么格式算
 * 图片、多大算太大，全在 can-api 里判，这边只把字节转过去、把状态码抄回来。这
 * 里再判一遍的诱惑是很实在的（挡掉一个 5MB 的请求省一次内网往返），但两处各判
 * 一次的话，两处会慢慢长得不一样，而更宽松的那一处就是实际生效的那一处。
 *
 * 上游会 sniff 字节来决定类型，所以浏览器发来的 Content-Type 只是**转发**，不
 * 是判断依据 —— 这里也就不必检查它。
 *
 * 拿回来的是一个 cdn.airwaysn.org 上的地址，页面把它存进题里；存那一步是另一次
 * 请求（PATCH 那道题），也是另一次鉴权。
 */
const UPSTREAM_PATH = "/api/v1/super/exam/images";

/**
 * 这一条比别的等得久。
 *
 * `upstream.ts` 的 8 秒是按「最慢也只是一张几十道题的卷子」定的；这里是一张最大
 * 4MB 的图，先进 can-api 再进 R2，两跳。8 秒会把上传大图这件事变成随机失败，而
 * 失败的代价是重传一遍那 4MB。
 */
const UPLOAD_TIMEOUT_MS = 30_000;

/**
 * 本站先挡一次大小。
 *
 * 上游的上限是 4MB 且**那一次才算数**；这里挡是因为不挡的话，一个 200MB 的
 * 请求会先完整流进这个进程的内存、再被上游拒绝。和上游的数字保持一致，改一边
 * 要改两边。
 */
const MAX_BYTES = 4 * 1024 * 1024;

export const POST = async (context: APIContext) => {
  if (crossOrigin(context)) return forbidden();

  const limited = enforce([[`admin:ip:${clientIp(context)}`, LIMITS.admin]]);
  if (limited) return limited;

  // Content-Length 先看一眼：能在读之前拒绝的就别读进来。它可以缺席也可以撒
  // 谎，所以下面读完还要再量一次真实长度。
  const declared = Number(context.request.headers.get("content-length") ?? "0");
  if (declared > MAX_BYTES) return tooLarge();

  const body = await context.request.arrayBuffer();
  if (body.byteLength === 0) {
    return Response.json(
      { error: "invalid_request", message: "没有收到文件。" },
      { status: 400 },
    );
  }
  if (body.byteLength > MAX_BYTES) return tooLarge();

  return relay(
    await callApi(context, UPSTREAM_PATH, {
      method: "POST",
      body,
      // 原样转发浏览器说的那个类型。上游不信它（它 sniff 字节），转过去只是为了
      // 不在中间凭空造一个头。
      contentType:
        context.request.headers.get("content-type") ??
        "application/octet-stream",
      timeoutMs: UPLOAD_TIMEOUT_MS,
    }),
  );
};

/** 形状和上游的 `too_large` 一致，这样页面只认一个码。 */
function tooLarge(): Response {
  return Response.json(
    { error: "too_large", message: "图片太大了，上限是 4 MB。" },
    { status: 413 },
  );
}
