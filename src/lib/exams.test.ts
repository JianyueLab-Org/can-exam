import { describe, expect, test } from "bun:test";
import { regionKey } from "./exams";

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
