import type { AttemptResult } from "./exams";

type AttemptPageState =
  | { kind: "signin" | "notFound" | "unavailable" }
  | { kind: "ready"; result: AttemptResult };

/** Keep authentication, privacy-preserving 404s, and upstream outages distinct. */
export function attemptPageState(
  status: number,
  body: string,
): AttemptPageState {
  if (status === 401) return { kind: "signin" };
  if (status === 404) return { kind: "notFound" };
  if (status < 200 || status >= 300) return { kind: "unavailable" };
  try {
    const result = JSON.parse(body)?.data;
    if (
      result &&
      Number.isSafeInteger(result.id) &&
      result.id > 0 &&
      typeof result.score === "number" &&
      (typeof result.passed === "boolean" || result.passed === null) &&
      typeof result.createdAt === "string"
    )
      return { kind: "ready", result };
  } catch {
    // A malformed upstream success is an unavailable result, not a page error.
  }
  return { kind: "unavailable" };
}
