/**
 * 考试中心的形状，以及和本站转发层说话的那一小段代码。
 *
 * 这里的每一个类型都对应 can-api 的一段响应，而**有一个字段是刻意不存在的**：
 * 题目上没有 `isCorrect`，卷子上没有答案，成绩里没有 `results`。不是这里删
 * 的 —— can-api 根本不发。看到这些类型时值得记住这件事：想在页面上「顺便显示
 * 一下正确答案」，会发现无处可取，那正是设计。
 *
 * 唯一带答案的形状在 `admin.ts`，它只在管理页用。
 */

/** 考试分栏，和 can-api 的 ScopePilots / ScopeControllers 一致。 */
export type ExamScope = "pilots" | "controllers";

/** 列表里的一场考试。 */
export interface PaperSummary {
  id: number;
  slug: string;
  title: string;
  description: string;
  scope: ExamScope;
  /** 这一场**实际会考几题**（已经按题库大小夹过）。 */
  questionCount: number;
  /** 题库里有多少题可抽。大于 questionCount 时说明是随机抽的子集。 */
  bankSize: number;
  passMark: number;
  /** 分钟，0 表示不限时。 */
  timeLimit: number;
  /** 通过后提升到的等级，null 表示这场考试不改等级。 */
  promoteTo: number | null;
  eligible: boolean;
  /** 不可考的原因码。页面按自己的语言翻译，见 language/*.json 的 home.reason。 */
  reason: string;
  /** 手上有一张没交的卷子时是它的 token。 */
  openSitting: string | null;
}

/** 发到浏览器的一道题 —— 没有答案，也没有「哪个是对的」这种字段。 */
export interface SittingQuestion {
  id: number;
  prompt: string;
  category: string;
  /** 题干配图的地址，空字符串表示没有图。 */
  imageUrl: string;
  /**
   * 多选题：画复选框而不是单选框。
   *
   * 它只说「这题要选一组」，**不说要选几个** —— 上游允许一道多选题只有一个正确
   * 答案，那正是防止考生数复选框个数的手段。所以这里也没有「还差几个」这种提
   * 示可写，别去找。
   */
  multiple: boolean;
  options: { id: number; label: string; imageUrl: string }[];
}

/** 一张抽好的卷子。 */
export interface Sitting {
  token: string;
  paper: {
    id: number;
    slug: string;
    title: string;
    passMark: number;
    timeLimit: number;
    /** 通过后提升到的等级，null 表示这场考试不改等级。成绩页拿它写出等级名。 */
    promoteTo: number | null;
  };
  questions: SittingQuestion[];
  /**
   * 卷子上一共几题。
   *
   * 和 `questions.length` 可能不相等：一道题在发卷之后被删掉，它就不在
   * questions 里了，但**仍然算在总数里**（上游判卷时算它答错）。分母不会因为
   * 一道题消失而变小，否则「把一道题弄掉」就成了提分手段。
   */
  total: number;
  expiresAt: string;
}

/** 交卷之后拿到的东西。注意这里没有一道题的对错明细。 */
export interface SittingResult {
  /**
   * 答对的题数，**可能带小数**（11.5）。
   *
   * 多选题按 `右/对 − 错/错` 部分给分，所以一道题可以只得半分。写成「答对几
   * 题」的整数就会出现 10 题对上 77% 这种自相矛盾的一对数字；带小数的那个和
   * 百分比互相解释得通。
   */
  score: number;
  totalQuestions: number;
  percent: number;
  passed: boolean;
  passMark: number;
  promoted: boolean;
}

/** 成绩单里的一行。 */
export interface AttemptRecord {
  id: number;
  examId: number;
  score: number;
  passed: boolean;
  createdAt: string;
}

/** can-api 的信封：`{ status, data, timestamp }`。 */
interface Envelope<T> {
  data?: T;
}

/** 上游的错误体：`{ error, message }`，两个字段分工不同，见 httpx.Error。 */
export interface ApiError {
  error: string;
  message: string;
}

/**
 * 调用本站的转发层。
 *
 * 全部是同源的相对路径 —— 浏览器从头到尾没有和 api.ceruleanavi.net 说过话，所以
 * 不需要 CORS，也不需要 `credentials: "include"`（同源请求本来就带 cookie）。
 *
 * 抛出的是 `ApiError`，因为**错误码是要用的**：交卷可能回 409
 * `already_submitted`、410 `expired`、429 `rate_limited`，三种情况页面要说三
 * 句不同的话。把它们压成一句「失败了」，人就只能靠猜。
 */
export async function api<T>(
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<T> {
  const response = await fetch(path, {
    method: init?.method ?? "GET",
    headers:
      init?.body === undefined ? {} : { "Content-Type": "application/json" },
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
  });

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    // 空体或者非 JSON —— 502 转发失败时可能如此。下面按状态码处理。
  }

  if (!response.ok) {
    const body = (payload ?? {}) as Partial<ApiError>;
    throw {
      error: body.error || String(response.status),
      message: body.message || "",
    } satisfies ApiError;
  }

  return ((payload as Envelope<T>)?.data ?? payload) as T;
}

/** 等级表。和 can-api 的 `internal/store/rating.go` 是同一张，用来显示。 */
const RATINGS: Record<number, string> = {
  [-1]: "INAC",
  0: "SUS",
  1: "OBS",
  2: "S1",
  3: "S2",
  4: "S3",
  5: "C1",
  6: "C2",
  7: "C3",
  8: "I1",
  9: "I2",
  10: "I3",
  11: "SUP",
  12: "ADM",
};

/** 等级的简称。表里没有的值原样显示成数字，而不是显示成空 —— 空会把一个数据
 *  问题藏起来。 */
export function ratingName(id: number | null | undefined): string {
  if (id === null || id === undefined) return "";
  return RATINGS[id] ?? String(id);
}

/**
 * Division 的编码，和 can-api 的 `division.region` / `store.Region*` 同一套。
 *
 * **0 是「全网」，不是「没填」。** 入网测试就在 0 上，而 0 上的卷子只有 SUP/
 * ADM 能改 —— 某个 division 的教员不该能改让人进网络的那份考卷。把它当成缺省
 * 值处理（「没选就给 0 吧」）会把一份卷子交给另一批人。
 */
export const REGIONS: Record<number, string> = {
  0: "network",
  1: "prc",
  2: "usa",
  3: "jpn",
  4: "hk",
};

/** Division 的字典键，页面拿它到 `region.*` 下面取本地化的名字。 */
export function regionKey(region: number): string {
  return REGIONS[region] ?? "unknown";
}

/** 全部等级，给管理端的下拉用。 */
export function allRatings(): { id: number; name: string }[] {
  return Object.keys(RATINGS)
    .map(Number)
    .sort((a, b) => a - b)
    .map((id) => ({ id, name: RATINGS[id] }));
}

/**
 * 把剩余毫秒数写成 `1:02:03` 或 `02:03`。
 *
 * 到点了返回 `0:00` 而不是负数：倒计时走到头时页面已经在处理过期了，一个负号
 * 只会让人以为界面坏了。
 */
export function countdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return hours > 0
    ? `${hours}:${pad(minutes)}:${pad(seconds)}`
    : `${minutes}:${pad(seconds)}`;
}
