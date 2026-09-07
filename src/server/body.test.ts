import { describe, expect, test } from "bun:test";

import { MAX_JSON_BYTES, readCapped, readCappedText } from "./body";

/**
 * 这一组测试盯的是一件事：**上限在读的过程中生效，不是读完之后**。
 *
 * 所以最要紧的两条不是「大的会被拒绝」，而是「大的被拒绝时，剩下的字节没有被
 * 读进来」。那正是从前那个写法过不了的地方 —— 它也会返回 413，只是在整个 body
 * 已经在堆里之后。
 */

/**
 * 一条**没有 Content-Length** 的分块请求体。
 *
 * `Request` 拿到 ReadableStream 时不会替你算长度（也算不出来），所以这正好就
 * 是线上那个场景：`content-length` 缺席，从前的预检查读到 0、放行。
 *
 * `pulled` 记下底层实际被要走了多少个 chunk —— 断言它没有被读完，就是断言
 * `cancel()` 真的把水管关掉了。
 */
function chunkedRequest(chunkSize: number, chunks: number) {
  const counter = { pulled: 0 };
  const chunk = new Uint8Array(chunkSize).fill(0x61); // 'a'

  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (counter.pulled >= chunks) {
        controller.close();
        return;
      }
      counter.pulled++;
      controller.enqueue(chunk.slice());
    },
  });

  const request = new Request(
    "https://exam.ceruleanavi.net/api/v1/admin/images",
    {
      method: "POST",
      body,
      // Node/undici 要求流式 body 显式声明 half duplex。
      duplex: "half",
    } as RequestInit,
  );

  return { request, counter };
}

describe("readCapped", () => {
  test("拒绝没有 Content-Length 的超限请求（分块编码）", async () => {
    const cap = 64 * 1024;
    const { request, counter } = chunkedRequest(16 * 1024, 1024); // 想给 16 MB

    // 前提：这正是那个洞 —— 头缺席，所以预检查看到的是 0。
    expect(request.headers.get("content-length")).toBeNull();

    const result = await readCapped(request, cap);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.response.status).toBe(413);
    expect(await result.response.json()).toMatchObject({
      error: "too_large",
    });

    // 关键的一条：**没有读完**。上限是 64 KB、chunk 是 16 KB，所以读到第五个
    // 就该停 —— 而不是把 1024 个全部拉进堆里再判断。
    expect(counter.pulled).toBeLessThanOrEqual(cap / (16 * 1024) + 1);
    expect(counter.pulled).toBeLessThan(1024);
  });

  test("Content-Length 撒谎也拦得住", async () => {
    const cap = 64 * 1024;
    const { request, counter } = chunkedRequest(16 * 1024, 1024);
    // 声称很小，实际很大。预检查放行，边读边量把它拦下来。
    request.headers.set("content-length", "10");

    const result = await readCapped(request, cap);

    expect(result.ok).toBe(false);
    expect(counter.pulled).toBeLessThan(1024);
  });

  test("Content-Length 老实超限时，我们一个 chunk 都不再要", async () => {
    const { request, counter } = chunkedRequest(16 * 1024, 1024);
    request.headers.set("content-length", String(1024 * 1024));

    const result = await readCapped(request, 64 * 1024);

    expect(result.ok).toBe(false);
    // 运行时自己会把流预热一格（`Request` 一构造就排了一次 pull），那一格不
    // 是我们要的，所以断言不是绝对的 0 —— 要紧的是「没有沿着这条路继续读」。
    expect(counter.pulled).toBeLessThanOrEqual(1);
  });

  test("正好在上限之内的请求原样读出来", async () => {
    const cap = 64 * 1024;
    const { request } = chunkedRequest(16 * 1024, 4); // 正好 64 KB

    const result = await readCapped(request, cap);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.value.byteLength).toBe(cap);
  });

  test("上限之上一个字节就是超限", async () => {
    const { request } = chunkedRequest(1, 65);

    const result = await readCapped(request, 64);

    expect(result.ok).toBe(false);
  });

  test("没有 body 时是空字节串，不是错误", async () => {
    const request = new Request(
      "https://exam.ceruleanavi.net/api/v1/admin/images",
      {
        method: "POST",
      },
    );

    const result = await readCapped(request, 64);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.value.byteLength).toBe(0);
  });
});

describe("readCappedText", () => {
  test("按 UTF-8 解码，并且默认上限是 JSON 那一档", async () => {
    const request = new Request(
      "https://exam.ceruleanavi.net/api/v1/admin/papers",
      {
        method: "POST",
        body: JSON.stringify({ title: "入网测试" }),
      },
    );

    const result = await readCappedText(request);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(JSON.parse(result.value)).toEqual({ title: "入网测试" });
  });

  test("上限按字节算，不是按字符算", async () => {
    // 一个汉字 3 个字节，所以 4 个汉字是 12 字节，超过 10。
    const request = new Request(
      "https://exam.ceruleanavi.net/api/v1/admin/papers",
      {
        method: "POST",
        body: "题题题题",
      },
    );

    const result = await readCappedText(request, 10);

    expect(result.ok).toBe(false);
  });

  test("默认上限拦得住一份超大的 JSON", async () => {
    const { request } = chunkedRequest(64 * 1024, 64); // 4 MB

    const result = await readCappedText(request);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.response.status).toBe(413);
    expect(MAX_JSON_BYTES).toBeLessThan(4 * 1024 * 1024);
  });
});
