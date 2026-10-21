import { describe, expect, test } from "bun:test";
import { attemptPageState } from "./attemptResult";

describe("attemptPageState", () => {
  test("preserves sign-in and not-found responses even with non-JSON bodies", () => {
    expect(attemptPageState(401, "expired")).toEqual({ kind: "signin" });
    expect(attemptPageState(404, "missing")).toEqual({ kind: "notFound" });
  });
  test("shows unavailable for upstream failure or invalid success data", () => {
    for (const [status, body] of [
      [502, "offline"],
      [200, "oops"],
      [200, "{}"],
      [200, '{"data":null}'],
    ] as const) {
      expect(attemptPageState(status, body)).toEqual({ kind: "unavailable" });
    }
  });
  test("reads old results without requiring question details", () => {
    const result = {
      id: 12,
      examId: 1,
      score: 80,
      passed: null,
      createdAt: "2026-10-21T10:00:00Z",
      questionResults: [],
      passMark: null,
      earnedScore: null,
      totalQuestions: null,
    };
    expect(attemptPageState(200, JSON.stringify({ data: result }))).toEqual({
      kind: "ready",
      result,
    });
  });
});
