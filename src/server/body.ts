/**
 * 带上限地读请求体 —— **边读边量，不是读完再量**。
 *
 * 这个模块存在的理由是一个具体的洞。`/api/v1/admin/images` 从前的写法是：先看
 * `Content-Length`、超了就拒绝，然后 `await request.arrayBuffer()`，读完再量一
 * 次真实长度。第二步和第三步之间就是那个洞 —— `Content-Length` **可以缺席**
 * （分块编码根本没有这个头），缺席时第一步读到的是 0、放行，于是整个 body 完
 * 整地流进这个进程的堆里，量完才拒绝。而「量完才拒绝」没有阻止任何一个字节被
 * 读进来，它只是在字节已经在内存里之后，礼貌地说了一声不。
 *
 * 这条路的前面没有任何一道门能先挡住它：
 *
 * - `crossOrigin()` 对**不带 Origin 头**的请求是放行的（非浏览器的调用本来就
 *   不带），所以一个 curl 过来的分块 POST 直接就到了这里；
 * - 鉴权在 can-api，而 can-api 是在这次读**之后**才被访问的 —— 转发的前提是
 *   先有 body；
 * - 剩下的只有一只按 IP 的桶（`admin` 是每小时 900 次），它限的是次数不是体积。
 *
 * 容器的内存上限是 384Mi（`deploy/k8s.yaml`），`replicas: 2`，没有会话亲和。
 * 一两个并发的大请求就够把一个 Pod OOM 掉，而滚动重启期间另一个 Pod 接住全部
 * 流量、然后轮到它。
 *
 * 所以这里从流上读，超过上限的那一刻就 `cancel()` 掉底下的流并返回 413：堆里
 * 最多留下「上限 + 最后一个 chunk」那么多字节，而不是对方想给多少就是多少。
 *
 * **每一条收 body 的路由都要走这里**，不只是上传图片那条。JSON 那几条从前一
 * 个字节都不挡（`await request.text()`），它们和图片那条的区别只是没人注意到
 * 而已 —— 尤其是交卷那条，它的附带损害是一个考生交不上卷。
 */

/** 读的结果：要么是字节，要么是一个可以直接返回的 413。 */
export type Capped<T> =
  | { ok: true; value: T }
  | { ok: false; response: Response };

/**
 * JSON 请求体的上限。
 *
 * 这一侧最大的一次合法请求是「一道题连着它的选项」或者「一张卷子的一组答案」，
 * 都是几 KB 的量级 —— 图片不走 JSON，题上挂的是一个 `cdn.ceruleanavi.net` 的
 * URL 而不是字节。256 KB 是「合法请求碰不到、而攻击者的堆开销可以忽略」之间的
 * 一个宽松取值；调大它不会让任何页面多做成一件事，只会让上面那个洞重新变宽。
 */
export const MAX_JSON_BYTES = 256 * 1024;

/** 上限的答复。形状和上游的 `too_large` 一致，这样页面只认一个码。 */
export function tooLarge(message: string): Response {
  return Response.json({ error: "too_large", message }, { status: 413 });
}

const EMPTY = new ArrayBuffer(0);

/**
 * 读 `request` 的 body，最多 `maxBytes` 个字节。
 *
 * 超过就**立刻停止读取**并返回 413，而不是读完再判断。
 */
export async function readCapped(
  request: Request,
  maxBytes: number,
  message = "请求体太大了。",
): Promise<Capped<ArrayBuffer>> {
  // Content-Length 只是一次便宜的提前拒绝：能在读之前拒绝的就别读进来。它可
  // 以撒谎、也可以缺席，所以它**不是**上限本身 —— 下面那一段才是。
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    return { ok: false, response: tooLarge(message) };
  }

  const stream = request.body;
  if (!stream) return { ok: true, value: EMPTY };

  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value || value.byteLength === 0) continue;

      total += value.byteLength;
      if (total > maxBytes) {
        // 别再读了。剩下的字节不该进这个进程 —— 这一行就是整个模块的意义。
        await reader.cancel().catch(() => {});
        return { ok: false, response: tooLarge(message) };
      }
      chunks.push(value);
    }
  } catch {
    // 连接中途断了。当成空 body 交给上游去判，而不是在这里造一个 5xx：这条路
    // 上「读不到」和「没给」对上游是同一件事。
    return { ok: true, value: EMPTY };
  } finally {
    reader.releaseLock();
  }

  // 总是拷进一块**正好这么大**的新缓冲区，即使只读到一个 chunk。
  // Node 的 Buffer 是从一个共享池里切出来的，`chunk.buffer` 往往比 chunk 本身
  // 大得多、而且装着别的请求的字节 —— 顺手把它直接转出去，转的就不只是这一次
  // 请求的内容。
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, value: out.buffer };
}

/**
 * 同上，但把字节按 UTF-8 解成字符串 —— 转发 JSON 的那几条用这个。
 *
 * 上限按字节算而不是按字符算，因为进内存的是字节：一个汉字在这里是 3 个。
 */
export async function readCappedText(
  request: Request,
  maxBytes = MAX_JSON_BYTES,
  message = "请求体太大了。",
): Promise<Capped<string>> {
  const result = await readCapped(request, maxBytes, message);
  if (!result.ok) return result;
  return { ok: true, value: new TextDecoder().decode(result.value) };
}
