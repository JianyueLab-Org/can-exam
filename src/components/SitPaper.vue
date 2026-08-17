<script setup lang="ts">
/**
 * 考场。
 *
 * 这一页上的每一个决定都绕着同一件事：**一张卷子只能交一次**。上游在同一个事
 * 务里把卷子标记为已用、写成绩、必要时提等级，所以「再交一次」不是重试，是
 * 409。于是：
 *
 * - 交卷前弹一次确认。这是全站唯一一个确认框，因为它是全站唯一不可撤销的动作。
 * - 交卷成功后**立刻**把 `submitted` 置上，按钮从此不再可按 —— 网络慢的时候
 *   连点两下是最常见的用户行为，而第二下会拿到一个看起来像失败的 409。
 * - 收到 409 时不报错，直接当成「已经交过了」，因为事实就是如此。
 *
 * 另外两件反直觉但必要的事：
 *
 * **答案是选项 id，不是选项文字。** 上游按 id 判卷，所以选项顺序随便打乱都不
 * 影响对错。老实现比的是文字，于是一个错字（「近进」对「进近」）让一道题谁都
 * 答不对，而 15 题错 1 题仍然过线，所以没人发现。
 *
 * **每一题的答案都是一组 id，哪怕是单选题。** 单选存成 `[id]` 而不是 `id`，是
 * 为了让这一页只有一条选答案的路：两种形状并存的话，「已答几题」「能不能交卷」
 * 「存进 sessionStorage 的是什么」每一处都要分两种情况写，而分叉的那两支迟早
 * 会走散。上游两种都收（部署有先后，交卷又不能重来），但这边只发新的那一种。
 *
 * **多选题按题目说了算，不按选了几个。** `question.multiple` 是上游发下来的，
 * 单选题上多勾一个不是「对的加噪音」，上游直接判 0 分 —— 所以这一页在单选题上
 * 严格只留一个，不给人制造一个自己都不知道踩了的坑。
 *
 * **刷新是安全的。** 卷子按 token 从上游重新取，题目和选项顺序都是记下来的那
 * 一份。但**已选的答案不在上游** —— 那只在这一页的内存里，刷新会丢。所以下面
 * 把它存进 sessionStorage：一次误触 F5 不该让人重答二十道题。
 */
import { computed, onBeforeUnmount, onMounted, ref, useId } from "vue";

import {
  AlertBox,
  Button,
  Card,
  Dialog,
  Icon,
  Skeleton,
} from "@jianyuelab-org/can-ui";
import { createTranslator } from "@/lib/i18n";
import {
  api,
  countdown,
  ratingName,
  type Sitting,
  type SittingResult,
} from "@/lib/exams";

const props = defineProps<{
  messages: Record<string, unknown>;
  slug: string;
  /** 服务端读到的卷子；读不到（没登录、token 无效）时为 null。 */
  sitting: Sitting | null;
  /** 服务端读卷子时上游给的错误码。 */
  loadError: string | null;
}>();

const t = createTranslator(props.messages);

// SSR 稳定的 id：进度条和每道题的选项组都要有一个能被读屏软件念出来的名字，而
// 这个名字必须在 hydration 前后一致。
const progressLabelId = useId();
const questionPrefix = useId();

const sitting = ref<Sitting | null>(props.sitting);
/** 题号 -> 选中的选项 id。单选题也是一组，只是长度恒为 1。 */
const answers = ref<Record<number, number[]>>({});
const error = ref<string | null>(
  props.loadError ? errorText(props.loadError) : null,
);
const loading = ref(false);
const submitting = ref(false);
const submitted = ref(false);
const confirming = ref(false);
const result = ref<SittingResult | null>(null);
const now = ref(Date.now());

let ticker: ReturnType<typeof setInterval> | undefined;

const total = computed(() => sitting.value?.total ?? 0);
/** 「已答」= 至少勾了一个。空数组是取消了最后一个勾，那和没答一样。 */
const answeredCount = computed(
  () =>
    Object.values(answers.value).filter((chosen) => chosen.length > 0).length,
);
const allAnswered = computed(
  () =>
    !!sitting.value &&
    sitting.value.questions.length > 0 &&
    answeredCount.value >= sitting.value.questions.length,
);

/** 这道题勾了没有 —— 模板里问了好几处，写成函数免得每处都重复一次长度判断。 */
function answered(questionId: number): boolean {
  return (answers.value[questionId]?.length ?? 0) > 0;
}

function chosen(questionId: number, optionId: number): boolean {
  return answers.value[questionId]?.includes(optionId) ?? false;
}
const progress = computed(() =>
  total.value ? Math.round((answeredCount.value / total.value) * 100) : 0,
);

const remainingMs = computed(() => {
  if (!sitting.value) return 0;
  return new Date(sitting.value.expiresAt).getTime() - now.value;
});
/** 只在这场考试**限时**的时候显示倒计时。不限时的卷子也有过期时间（三小时的
 *  卫生上限），但把它显示成倒计时会让人以为自己在跟表赛跑。 */
const showClock = computed(() => !!sitting.value?.paper.timeLimit);
const expired = computed(() => !!sitting.value && remainingMs.value <= 0);

/** 存答案的键带上 token：换一张卷子就是另一套答案，不该串。 */
const storageKey = computed(() =>
  sitting.value ? `can-exam:answers:${sitting.value.token}` : "",
);

function errorText(code: string): string {
  const message = t(`sit.error.${code}`);
  // t() 找不到键会原样返回键本身 —— 那说明这是个没预料到的码。
  return message.startsWith("sit.error.") ? t("frame.error") : message;
}

/** 单选：换成这一个。 */
function choose(questionId: number, optionId: number) {
  if (submitted.value || expired.value) return;
  answers.value = { ...answers.value, [questionId]: [optionId] };
  persist();
}

/**
 * 多选：勾上或取消。
 *
 * 取消最后一个之后留下的是空数组而不是删掉这个键 —— 两者在「已答几题」上等价
 * （上面按长度算），但留着空数组让 `restore()` 之后的形状和这里写出来的形状始
 * 终一致，少一种要照顾的状态。
 */
function toggleChoice(questionId: number, optionId: number) {
  if (submitted.value || expired.value) return;
  const current = answers.value[questionId] ?? [];
  const next = current.includes(optionId)
    ? current.filter((id) => id !== optionId)
    : [...current, optionId];
  answers.value = { ...answers.value, [questionId]: next };
  persist();
}

function persist() {
  if (!storageKey.value) return;
  try {
    sessionStorage.setItem(storageKey.value, JSON.stringify(answers.value));
  } catch {
    // 隐私模式下 sessionStorage 会抛。丢的只是「刷新之后还在」这一层便利。
  }
}

function restore() {
  if (!storageKey.value) return;
  try {
    const saved = sessionStorage.getItem(storageKey.value);
    if (!saved) return;
    const parsed = JSON.parse(saved) as Record<string, number | number[]>;

    // 只认这张卷子上真的有的题和真的有的选项。旧数据、或者一个手改过
    // sessionStorage 的人，都不该能把一个不存在的 id 带进提交里 —— 上游也会
    // 再挡一次（不是这张卷子发出去的选项一律不计分），这里挡是为了让屏幕上显示
    // 的和将要提交的是同一回事。
    const options = new Map<number, Set<number>>();
    for (const question of sitting.value?.questions ?? []) {
      options.set(question.id, new Set(question.options.map((o) => o.id)));
    }

    const restored: Record<number, number[]> = {};
    for (const [key, value] of Object.entries(parsed)) {
      const questionId = Number(key);
      const valid = options.get(questionId);
      if (!valid) continue;
      // 上一版存的是单个数字。刷新之后不该因为换了个版本就丢掉已经答好的题。
      const ids = Array.isArray(value) ? value : [value];
      const kept = [...new Set(ids)].filter((id) => valid.has(id));
      if (kept.length) restored[questionId] = kept;
    }
    answers.value = restored;
  } catch {
    // 存坏了就当没存过。
  }
}

/** 服务端没能把卷子读出来时（多半是直接访问了没有 token 的地址），这里抽一张。 */
async function draw() {
  loading.value = true;
  error.value = null;
  try {
    sitting.value = await api<Sitting>(
      `/api/v1/sit/${encodeURIComponent(props.slug)}`,
      { method: "POST" },
    );
    // 地址栏补上 token，这样刷新才拿得回同一张卷子。
    const url = new URL(window.location.href);
    url.searchParams.set("token", sitting.value.token);
    window.history.replaceState({}, "", url);
    restore();
  } catch (err) {
    error.value = errorText((err as { error?: string }).error ?? "");
  } finally {
    loading.value = false;
  }
}

async function submit() {
  if (submitting.value || submitted.value) return;
  confirming.value = false;
  submitting.value = true;
  error.value = null;

  try {
    result.value = await api<SittingResult>(
      `/api/v1/sittings/${encodeURIComponent(sitting.value!.token)}`,
      { method: "POST", body: { answers: answers.value } },
    );
    submitted.value = true;
    try {
      sessionStorage.removeItem(storageKey.value);
    } catch {
      // 同上。
    }
  } catch (err) {
    const code = (err as { error?: string }).error ?? "";
    if (code === "already_submitted") {
      // 不是错误 —— 事实就是交过了。多半是网络慢的时候点了两下，第一下其实成
      // 功了。分数取不回来（上游不会重发），所以让人回列表去看。
      submitted.value = true;
    } else {
      error.value = errorText(code);
    }
  } finally {
    submitting.value = false;
  }
}

onMounted(() => {
  if (sitting.value) {
    restore();
  } else if (!props.loadError) {
    void draw();
  }
  ticker = setInterval(() => (now.value = Date.now()), 1000);
});

onBeforeUnmount(() => clearInterval(ticker));
</script>

<template>
  <div class="mx-auto max-w-3xl">
    <div class="mb-6 flex items-center justify-between gap-4">
      <a
        href="/"
        class="flex items-center gap-1.5 text-sm text-muted hover:text-ink"
      >
        <Icon name="arrowLeft" class="size-4" />
        {{ t("sit.back") }}
      </a>
      <span
        v-if="showClock && !submitted"
        class="tnum rounded-control bg-surface-sunken px-3 py-1 text-sm font-semibold"
        :class="remainingMs < 5 * 60 * 1000 ? 'text-danger-fg' : 'text-ink'"
      >
        {{ t("sit.deadline", { time: countdown(remainingMs) }) }}
      </span>
    </div>

    <!-- 成绩。交完卷之后这一页就只剩它了 —— 题目留在屏幕上只会让人去核对，
         而核对不出任何东西：上游不发正确答案。 -->
    <BaseCard v-if="submitted" padding="lg">
      <div class="text-center">
        <span
          class="mx-auto flex size-14 items-center justify-center rounded-full"
          :class="
            result?.passed
              ? 'bg-success-bg text-success-fg'
              : 'bg-danger-bg text-danger-fg'
          "
        >
          <Icon
            :name="result?.passed ? 'checkCircle' : 'xCircle'"
            class="size-7"
          />
        </span>

        <h1 class="mt-4 text-xl font-semibold text-ink">
          {{ result?.passed ? t("sit.result.passed") : t("sit.result.failed") }}
        </h1>

        <p v-if="result" class="tnum mt-2 text-3xl font-bold text-ink">
          {{ t("sit.result.percent", { percent: result.percent }) }}
        </p>
        <p v-if="result" class="mt-1 text-sm text-muted">
          {{
            t("sit.result.score", {
              correct: result.score,
              total: result.totalQuestions,
            })
          }}
          · {{ t("sit.result.passMark", { mark: result.passMark }) }}
        </p>

        <AlertBox
          v-if="result?.promoted"
          variant="success"
          class="mt-5 text-left"
        >
          {{
            t("sit.result.promoted", {
              rating: ratingName(sitting?.paper.promoteTo),
            })
          }}
        </AlertBox>
        <p v-else-if="result && !result.passed" class="mt-3 text-sm text-muted">
          {{ t("sit.result.retry") }}
        </p>

        <BaseButton as="a" href="/?done=1" class="mt-6">
          {{ t("sit.result.back") }}
        </BaseButton>
      </div>
    </BaseCard>

    <template v-else>
      <AlertBox v-if="error" variant="danger" class="mb-6">{{
        error
      }}</AlertBox>
      <AlertBox v-else-if="expired" variant="warning" class="mb-6">
        {{ t("sit.expired") }}
      </AlertBox>

      <Skeleton
        v-if="loading"
        variant="text"
        :count="6"
        :label="t('sit.loading')"
      />

      <template v-else-if="sitting">
        <h1 class="text-lg font-semibold text-ink">
          {{ sitting.paper.title }}
        </h1>
        <p class="mt-1 text-xs text-faint">{{ t("sit.shuffled") }}</p>

        <!-- 进度。粘在顶上，因为一张二十题的卷子滚起来看不见头。 -->
        <div
          class="sticky top-2 z-30 mb-6 mt-4 rounded-card border border-subtle bg-chrome px-4 py-3"
        >
          <div class="flex items-center justify-between gap-4">
            <p :id="progressLabelId" class="text-sm font-medium text-ink">
              {{ t("sit.progress", { answered: answeredCount, total }) }}
            </p>
            <span class="tnum text-sm font-semibold text-can">
              {{ progress }}%
            </span>
          </div>
          <div
            class="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-sunken"
            role="progressbar"
            :aria-labelledby="progressLabelId"
            :aria-valuenow="progress"
            aria-valuemin="0"
            aria-valuemax="100"
          >
            <div
              class="h-full rounded-full bg-can transition-[width] duration-300"
              :style="{ width: `${progress}%` }"
            ></div>
          </div>
        </div>

        <div class="space-y-4">
          <BaseCard
            v-for="(question, index) in sitting.questions"
            :key="question.id"
            padding="lg"
          >
            <div class="flex items-start justify-between gap-3">
              <p
                class="text-xs font-semibold uppercase tracking-widest text-faint"
              >
                {{ t("sit.question", { number: index + 1 }) }}
                <span
                  v-if="question.category"
                  class="ml-2 normal-case text-faint"
                >
                  {{ question.category }}
                </span>
              </p>
              <span
                v-if="question.multiple"
                class="badge badge-info shrink-0"
                :title="t('sit.multipleHint')"
              >
                {{ t("sit.multiple") }}
              </span>
              <span
                v-if="!answered(question.id)"
                class="badge badge-warning shrink-0"
              >
                {{ t("sit.unanswered") }}
              </span>
            </div>

            <h2
              :id="`${questionPrefix}-${question.id}`"
              class="mt-2 text-base font-semibold leading-relaxed text-ink"
            >
              {{ question.prompt }}
            </h2>

            <!-- 题干配图。alt 指回题号而不是描述图的内容 —— 内容是题目问的东西，
                 替读屏软件把它说出来等于把题做了。loading=lazy 因为一张二十题的
                 卷子可能带二十张图，而屏幕上一次只看得见一题。 -->
            <img
              v-if="question.imageUrl"
              :src="question.imageUrl"
              :alt="t('sit.figure', { number: index + 1 })"
              loading="lazy"
              class="mt-3 max-h-96 w-auto max-w-full rounded-control border border-subtle"
            />

            <p v-if="question.multiple" class="mt-2 text-xs text-muted">
              {{ t("sit.multipleHint") }}
            </p>

            <!-- 单选是 radiogroup，多选是 group，两边都要 aria-labelledby，否则
                 读屏软件在表单模式下念出的是四个光秃秃的选项，不知道题目问的是
                 什么。多选不能用 radiogroup：那个角色本身就在说「只能选一个」。 -->
            <div
              class="mt-4 space-y-2"
              :role="question.multiple ? 'group' : 'radiogroup'"
              :aria-labelledby="`${questionPrefix}-${question.id}`"
            >
              <label
                v-for="option in question.options"
                :key="option.id"
                :class="[
                  'flex items-start gap-3 rounded-control border p-3 text-sm transition-colors',
                  expired ? 'cursor-not-allowed opacity-60' : 'cursor-pointer',
                  chosen(question.id, option.id)
                    ? 'border-can bg-info-bg text-ink'
                    : 'border-subtle hover:border-strong hover:bg-surface-sunken',
                ]"
              >
                <input
                  :type="question.multiple ? 'checkbox' : 'radio'"
                  :name="`question-${question.id}`"
                  :value="option.id"
                  :checked="chosen(question.id, option.id)"
                  :disabled="expired"
                  :class="[
                    'mt-0.5 size-4 shrink-0 accent-[var(--color-can)]',
                    question.multiple ? 'rounded-sm' : '',
                  ]"
                  @change="
                    question.multiple
                      ? toggleChoice(question.id, option.id)
                      : choose(question.id, option.id)
                  "
                />
                <span class="min-w-0 flex-1">
                  <span class="block text-ink">{{ option.label }}</span>
                  <!-- 选项配图的 alt 就是选项文字：图是那句话的图示，不是另一条
                       信息。上游也要求有图的选项必须有文字，正是为了这里有话可说。 -->
                  <img
                    v-if="option.imageUrl"
                    :src="option.imageUrl"
                    :alt="option.label"
                    loading="lazy"
                    class="mt-2 max-h-48 w-auto max-w-full rounded-control border border-subtle"
                  />
                </span>
              </label>
            </div>
          </BaseCard>
        </div>

        <div
          class="sticky bottom-0 mt-6 rounded-card border border-subtle bg-chrome p-4"
        >
          <BaseButton
            block
            size="lg"
            :loading="submitting"
            :disabled="!allAnswered || expired"
            @click="confirming = true"
          >
            {{ submitting ? t("sit.submitting") : t("sit.submit") }}
          </BaseButton>
          <p
            v-if="!allAnswered && !expired"
            class="mt-2 text-center text-xs text-muted"
          >
            {{ t("sit.answerAll") }}
          </p>
        </div>
      </template>
    </template>

    <BaseDialog
      v-model:open="confirming"
      :title="t('sit.confirmTitle')"
      :close-label="t('sit.confirmNo')"
      size="sm"
    >
      <p class="text-sm text-muted">{{ t("sit.confirmBody") }}</p>
      <template #footer>
        <BaseButton variant="ghost" @click="confirming = false">
          {{ t("sit.confirmNo") }}
        </BaseButton>
        <BaseButton :loading="submitting" @click="submit">
          {{ t("sit.confirmYes") }}
        </BaseButton>
      </template>
    </BaseDialog>
  </div>
</template>
