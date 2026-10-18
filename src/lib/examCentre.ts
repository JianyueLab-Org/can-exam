import type { AttemptRecord, ExamScope, PaperSummary } from "@/lib/exams";

/**
 * 考试中心首页的两栏：飞行员 / 管制员。地址上是 `?scope=`，服务端读它，
 * 所以从主站转发过来的链接直接落在对的那一栏。
 */

/** `examId` 写进 `exam` 表之前的旧记录是 0，它们都是入网测试（卷子 1）。 */
export const LEGACY_EXAM_IDS: Readonly<Record<number, number>> = { 0: 1 };

export function parseScope(value: string | null | undefined): ExamScope {
  return value === "controllers" ? "controllers" : "pilots";
}

export function scopeHref(scope: ExamScope): string {
  return scope === "controllers" ? "/?scope=controllers" : "/";
}

/** 考完回来的落点：回到交卷时所在的那一栏，并带 `done=1` 触发重读。 */
export function doneHref(scope: ExamScope): string {
  return scope === "controllers" ? "/?scope=controllers&done=1" : "/?done=1";
}

/** 考场地址。只有管制员栏带 `scope`，规则同 `scopeHref`。 */
export function sitHref(slug: string, token: string, scope: ExamScope): string {
  const base = `/sit/${slug}?token=${encodeURIComponent(token)}`;
  return scope === "controllers" ? `${base}&scope=controllers` : base;
}

export function paperForRecord(
  record: AttemptRecord,
  papers: PaperSummary[],
): PaperSummary | undefined {
  const id = Object.hasOwn(LEGACY_EXAM_IDS, record.examId)
    ? LEGACY_EXAM_IDS[record.examId]
    : record.examId;
  return papers.find((paper) => paper.id === id);
}

/** 一条成绩属于它那张卷子的栏；卷子已经不在清单上的，放在飞行员栏。 */
export function recordsForScope(
  records: AttemptRecord[],
  papers: PaperSummary[],
  scope: ExamScope,
): AttemptRecord[] {
  return records.filter(
    (record) => (paperForRecord(record, papers)?.scope ?? "pilots") === scope,
  );
}
