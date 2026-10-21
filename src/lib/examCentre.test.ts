import { describe, expect, test } from "bun:test";
import type { AttemptRecord, PaperSummary } from "./exams";
import {
  doneHref,
  paperForRecord,
  parseScope,
  recordsForScope,
  resultHref,
  scopeHref,
  sitHref,
} from "./examCentre";

const paper = (id: number, scope: "pilots" | "controllers"): PaperSummary => ({
  id,
  slug: `p${id}`,
  title: `P${id}`,
  description: "",
  scope,
  questionCount: 1,
  bankSize: 1,
  passMark: 80,
  timeLimit: 0,
  promoteTo: null,
  eligible: true,
  reason: "",
  openSitting: null,
});

describe("resultHref", () => {
  test("links to an attempt and preserves the exam track", () => {
    expect(resultHref(12, "pilots")).toBe("/results/12");
    expect(resultHref(12, "controllers")).toBe("/results/12?scope=controllers");
  });
});
const record = (id: number, examId: number): AttemptRecord => ({
  id,
  examId,
  score: 90,
  passed: true,
  createdAt: "2026-10-01T00:00:00Z",
});
const papers = [paper(1, "pilots"), paper(2, "controllers")];

describe("parseScope", () => {
  test("controllers only when asked", () => {
    expect(parseScope("controllers")).toBe("controllers");
    expect(parseScope("pilots")).toBe("pilots");
    expect(parseScope(null)).toBe("pilots");
    expect(parseScope("constructor")).toBe("pilots");
  });
});

describe("paperForRecord", () => {
  test("examId 0 is the legacy new-member test, paper 1", () => {
    expect(paperForRecord(record(1, 0), papers)?.id).toBe(1);
  });
  test("unknown paper is undefined", () => {
    expect(paperForRecord(record(1, 99), papers)).toBeUndefined();
  });
});

describe("recordsForScope", () => {
  const records = [record(1, 0), record(2, 2), record(3, 99), record(4, 1)];
  test("pilot tab: its papers, legacy rows and retired papers", () => {
    expect(recordsForScope(records, papers, "pilots").map((r) => r.id)).toEqual(
      [1, 3, 4],
    );
  });
  test("controller tab: its papers only", () => {
    expect(
      recordsForScope(records, papers, "controllers").map((r) => r.id),
    ).toEqual([2]);
  });
});

describe("scopeHref", () => {
  test("pilots is the root", () => {
    expect(scopeHref("pilots")).toBe("/");
    expect(scopeHref("controllers")).toBe("/?scope=controllers");
  });
});

describe("doneHref", () => {
  test("飞行员栏回到根页", () => {
    expect(doneHref("pilots")).toBe("/?done=1");
  });
  test("管制员栏带着 scope", () => {
    expect(doneHref("controllers")).toBe("/?scope=controllers&done=1");
  });
});

describe("sitHref", () => {
  test("飞行员栏不带 scope", () => {
    expect(sitHref("entry", "a b", "pilots")).toBe("/sit/entry?token=a%20b");
  });
  test("管制员栏追加 scope", () => {
    expect(sitHref("s1", "tok", "controllers")).toBe(
      "/sit/s1?token=tok&scope=controllers",
    );
  });
});
