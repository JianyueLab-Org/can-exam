import { describe, expect, test } from "bun:test";
import { pageTitle } from "./pageTitle";

describe("pageTitle", () => {
  test("page · site, localised", () => {
    expect(pageTitle("培训资料", "zh-cn")).toBe("培训资料 · 考试中心");
    expect(pageTitle("Training", "en-us")).toBe("Training · Exam Centre");
    expect(pageTitle("訓練", "ja-jp")).toBe("訓練 · 試験センター");
    expect(pageTitle("題庫管理", "zh-tw")).toBe("題庫管理 · 考試中心");
  });
  test("root page shows the site alone", () => {
    expect(pageTitle(undefined, "en-us")).toBe("Exam Centre");
    expect(pageTitle("", "zh-cn")).toBe("考试中心");
  });
  test("unknown locale falls back like siteLabel (en-us)", () => {
    expect(pageTitle(undefined, "xx")).toBe(pageTitle(undefined, "en-us"));
  });
});
