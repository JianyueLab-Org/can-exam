/**
 * 题库管理端的形状 —— 这个仓库里**唯一**带正确答案的类型。
 *
 * 和 `exams.ts` 分开放，不是为了整洁：两边共用一个 `Question` 类型的话，某天
 * 有人在考生页面上写 `q.options[i].isCorrect`，TypeScript 会愉快地放行，而那
 * 个字段在运行时恰好是 undefined —— 于是没有人发现这行代码写错了，直到某次上
 * 游多发了一个字段。类型不共享，那行代码就编译不过。
 *
 * can-api 那边做了同样的切分：`exambank.go`（考生）和 `superexam.go`（管理）
 * 不共享任何响应结构体。
 */

import type { ExamScope } from "./exams";

/** 管理端看到的一份卷子。比考生那份多了草稿、抽题数、等级门槛这些设置。 */
export interface AdminPaper {
  id: number;
  slug: string;
  title: string;
  description: string;
  scope: ExamScope;
  /**
   * 这份卷子归哪个 division，编码见 `exams.ts` 的 `REGIONS`。
   *
   * 它不是分类标签，是一条权限边界：改它等于把这份卷子交给另一批人。0（全网）
   * 只有 SUP/ADM 能用。
   */
  region: number;
  /** 设置值。0 表示「题库里启用的题全抽」。 */
  drawCount: number;
  /** 实际会抽几题（drawCount 按题库大小夹过之后）。 */
  draw: number;
  /** 题库里启用的题有几道。 */
  questionCount: number;
  passMark: number;
  eligibleRatings: number[] | null;
  promoteTo: number | null;
  timeLimit: number;
  /** 0 草稿, 1 已发布。 */
  status: number;
  createdBy: string;
}

/**
 * 调用者自己能做什么 —— 上游随卷子清单一起给的。
 *
 * 前端**不自己算**这个。能管哪些 division 要查 `division` 表，能授予到哪一级
 * 取决于调用者自己的 rating 和一条「不能授予自己这一级」的规则；两边各算一遍
 * 的话，两边会慢慢长得不一样，而更宽松的那一份就是实际生效的那一份。这里只是
 * 拿它来画下拉框。
 */
export interface BankAuthority {
  /** SUP/ADM：所有 division，包括全网级的那些。 */
  global: boolean;
  /** 能给卷子选哪些 division。SUP/ADM 拿到全部（含 0）。 */
  regions: number[];
  /** 卷子最高能授予到哪一级。-2 表示一级都不能授予。 */
  maxGrant: number;
}

/** 一道题，**带答案**。 */
export interface AdminQuestion {
  id: number;
  paperId: number;
  prompt: string;
  category: string;
  explanation: string;
  position: number;
  /** 0 停用, 1 启用。停用的题不会被抽中。 */
  status: number;
  options: { id: number; label: string; isCorrect: boolean }[];
}

/** 写一道题时发上去的形状。选项整组重写，没有「改第三个选项」这种操作。 */
export interface QuestionDraft {
  prompt: string;
  category: string;
  explanation: string;
  enabled: boolean;
  options: { label: string; isCorrect: boolean }[];
}

/** 卷子草稿是空的样子。 */
export const EMPTY_PAPER: Omit<
  AdminPaper,
  "id" | "draw" | "questionCount" | "createdBy" | "region"
> = {
  slug: "",
  title: "",
  description: "",
  scope: "pilots",
  drawCount: 0,
  passMark: 80,
  eligibleRatings: [],
  promoteTo: null,
  timeLimit: 0,
  status: 0,
};

/**
 * 一道新题的样子：四个空选项，第一个标为正确。
 *
 * 四个而不是两个，因为这个网络的题几乎都是四选一；预先标一个正确，因为「必须
 * 且只能有一个正确答案」是上游会拒绝的硬规则，让表单从一个合法状态出发，比让
 * 人保存一次撞一次 400 要好。
 */
export function emptyQuestion(): QuestionDraft {
  return {
    prompt: "",
    category: "",
    explanation: "",
    enabled: true,
    options: [
      { label: "", isCorrect: true },
      { label: "", isCorrect: false },
      { label: "", isCorrect: false },
      { label: "", isCorrect: false },
    ],
  };
}

/** 把一道已有的题读成可编辑的草稿。 */
export function toDraft(question: AdminQuestion): QuestionDraft {
  return {
    prompt: question.prompt,
    category: question.category,
    explanation: question.explanation,
    enabled: question.status === 1,
    options: question.options.map((option) => ({
      label: option.label,
      isCorrect: option.isCorrect,
    })),
  };
}

/**
 * 保存之前先在本地挡一遍。
 *
 * 上游会再判一次，而且**那一次才算数** —— 这里挡的目的只是让人当场看见问题，
 * 而不是提交一次、等一个来回、读一句英文的 400。返回原因码，页面用自己的语言
 * 翻译。
 */
export function draftProblem(draft: QuestionDraft): string | null {
  if (!draft.prompt.trim()) return "prompt";
  const filled = draft.options.filter((option) => option.label.trim());
  if (filled.length < 2) return "options";
  if (filled.filter((option) => option.isCorrect).length !== 1)
    return "markOne";
  return null;
}
