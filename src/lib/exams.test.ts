import { describe, expect, test } from "bun:test";
import { formatDateTime, regionKey } from "./exams";

describe("regionKey", () => {
  test("maps every division region to its dictionary key", () => {
    expect([0, 1, 2, 3, 4, 5].map(regionKey)).toEqual([
      "network",
      "prc",
      "usa",
      "jpn",
      "hk",
      "roc",
    ]);
  });

  test("unknown region falls back", () => {
    expect(regionKey(99)).toBe("unknown");
  });
});

describe("formatDateTime", () => {
  test("drops seconds", () => {
    const text = formatDateTime("2026-10-01T10:00:30Z", "en-US");
    expect(text).not.toMatch(/\d:\d\d:\d\d/);
    expect(text).toContain("2026");
  });

  test("returns unparseable input unchanged", () => {
    expect(formatDateTime("not a date", "zh-CN")).toBe("not a date");
  });
});
