import { describe, expect, test } from "bun:test";
import type { AttemptRecord, PaperSummary } from "./exams";
import {
  paperForRecord,
  parseScope,
  recordsForScope,
  scopeHref,
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
