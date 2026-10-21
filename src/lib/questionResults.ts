import type { QuestionResult } from "./exams";

export function questionVerdict(
  result: Pick<QuestionResult, "score" | "isRight">,
) {
  return result.isRight
    ? "correct"
    : result.score > 0
      ? "partial"
      : "incorrect";
}

export function questionScore(score: number): string {
  return String(Number(score.toFixed(6)));
}
