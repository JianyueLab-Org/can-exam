import type { QuestionResult } from "./exams";

/** Missing historical data must not be presented as an unanswered question. */
export function selectedAnswerState(
  answers: QuestionResult["selectedAnswers"],
) {
  return answers == null
    ? "unavailable"
    : answers.length
      ? "selected"
      : "unanswered";
}

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
