import { describe, expect, test } from "bun:test";
import { createHealth } from "./health";

describe("createHealth", () => {
  test("all checks ok", async () => {
    const h = createHealth({ "can-api": async () => {} });
    const r = await h();
    expect(r.ok).toBe(true);
    expect(r.body).toEqual({ status: "ok", checks: { "can-api": "ok" } });
  });

  test("failing check reports fail", async () => {
    const h = createHealth({
      "can-api": async () => {
        throw new Error("status 502");
      },
    });
    const r = await h();
    expect(r.ok).toBe(false);
    expect(r.body).toEqual({
      status: "fail",
      checks: { "can-api": "status 502" },
    });
  });

  test("caches for 10 s and shares in-flight checks", async () => {
    let calls = 0;
    let t = 0;
    const h = createHealth(
      {
        "can-api": async () => {
          calls++;
        },
      },
      () => t,
    );
    await Promise.all([h(), h(), h()]);
    expect(calls).toBe(1);
    t = 9_999;
    await h();
    expect(calls).toBe(1);
    t = 10_000;
    await h();
    expect(calls).toBe(2);
  });
});
