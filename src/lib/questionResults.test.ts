import { describe, expect, test } from "bun:test";
import {
  questionVerdict,
  questionScore,
  selectedAnswerState,
} from "./questionResults";

describe("selectedAnswerState", () => {
  test("distinguishes unavailable historic selections from an unanswered question", () => {
    expect(selectedAnswerState(undefined)).toBe("unavailable");
    expect(selectedAnswerState(null)).toBe("unavailable");
    expect(selectedAnswerState([])).toBe("unanswered");
    expect(
      selectedAnswerState([{ label: "Chosen option", imageUrl: "" }]),
    ).toBe("selected");
  });
});

describe("questionVerdict", () => {
  test("distinguishes full, partial and zero credit", () => {
    expect(questionVerdict({ score: 1, isRight: true })).toBe("correct");
    expect(questionVerdict({ score: 0.999999, isRight: false })).toBe(
      "partial",
    );
    expect(questionVerdict({ score: 0.000001, isRight: false })).toBe(
      "partial",
    );
    expect(questionVerdict({ score: 0, isRight: false })).toBe("incorrect");
  });
});

describe("questionScore", () => {
  test("preserves the smallest earned fraction and trims trailing zeroes", () => {
    expect([0, 0.000001, 0.333333, 0.5, 1].map(questionScore)).toEqual([
      "0",
      "0.000001",
      "0.333333",
      "0.5",
      "1",
    ]);
  });
});
