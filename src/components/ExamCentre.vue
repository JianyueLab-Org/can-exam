<script setup lang="ts">
/**
 * 考试中心首页：能考什么，以及考过什么。
 *
 * 两份数据都是**服务端**读好传进来的，岛屿挂载后不再重读 —— 这一页上没有一个
 * 元素是先画个骨架再填内容的。重读只发生在从考场回来之后（`?done=`），因为那
 * 时成绩和资格都变了。
 *
 * 不可考的卷子**照样列出来**，只是按不动。把它们藏起来的话，「你已经通过了这
 * 场考试」和「这场考试不存在」在屏幕上长得一模一样，而前者是每个考生都会遇到
 * 的那一种。
 */
import { computed, onMounted, ref } from "vue";

import {
  AlertBox,
  Badge,
  Button,
  Card,
  EmptyState,
  Icon,
  PageHeader,
} from "@jianyuelab-org/can-ui";
import { createTranslator } from "@/lib/i18n";
import {
  api,
  ratingName,
  type AttemptRecord,
  type ExamScope,
  type PaperSummary,
} from "@/lib/exams";

const props = defineProps<{
  messages: Record<string, unknown>;
  papers: PaperSummary[];
  records: AttemptRecord[];
  /** 服务端读不到会话时为 true。这一页没有匿名用途。 */
  signedOut: boolean;
  signInHref: string;
}>();

const t = createTranslator(props.messages);

const papers = ref<PaperSummary[]>(props.papers);
const records = ref<AttemptRecord[]>(props.records);
const error = ref<string | null>(null);
const busy = ref<string | null>(null);

const SCOPES: ExamScope[] = ["pilots", "controllers"];

/** 只画有卷子的那一栏 —— 一个空的「管制员」标题下面什么都没有，比不画更糟。 */
const sections = computed(() =>
  SCOPES.map((scope) => ({
    scope,
    label: t(`home.${scope}`),
    papers: papers.value.filter((paper) => paper.scope === scope),
  })).filter((section) => section.papers.length > 0),
);

/** 成绩单上的一行属于哪场考试。`examId` 就是卷子的 id。 */
function paperFor(record: AttemptRecord): PaperSummary | undefined {
  return papers.value.find((paper) => paper.id === record.examId);
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

/**
 * 开始或者继续一场考试。
 *
 * 手上已经有一张没交的卷子时（`openSitting`），直接跳过去而**不发新请求** ——
 * 上游会返回同一张卷子，但少一次往返也少一次「万一它这次给了新的」的疑虑。
 */
async function start(paper: PaperSummary) {
  if (!paper.eligible || busy.value) return;

  if (paper.openSitting) {
    window.location.href = `/sit/${paper.slug}?token=${encodeURIComponent(paper.openSitting)}`;
    return;
  }

  busy.value = paper.slug;
  error.value = null;
  try {
    const sitting = await api<{ token: string }>(
      `/api/v1/sit/${encodeURIComponent(paper.slug)}`,
      { method: "POST" },
    );
    window.location.href = `/sit/${paper.slug}?token=${encodeURIComponent(sitting.token)}`;
  } catch (err) {
    const code = (err as { error?: string }).error ?? "";
    error.value = t(`sit.error.${code}`) || t("frame.error");
    // t() 找不到键时会把键原样返回，那正好说明这是个没预料到的码 —— 用通用文案。
    if (error.value.startsWith("sit.error.")) error.value = t("frame.error");
    busy.value = null;
  }
}

/** 从考场回来之后重读一次：成绩多了一行，资格可能也变了。 */
onMounted(async () => {
  if (!new URLSearchParams(window.location.search).has("done")) return;
  try {
    const [fresh, history] = await Promise.all([
      api<{ papers: PaperSummary[] }>("/api/v1/papers"),
      api<{ records: AttemptRecord[] }>("/api/v1/history"),
    ]);
    papers.value = fresh.papers;
    records.value = history.records;
  } catch {
    // 重读失败就让服务端那份留在屏幕上 —— 它只是旧了一点，不是错的。
  }
});
</script>

<template>
  <div>
    <PageHeader
      :title="t('home.title')"
      :description="t('home.description')"
      icon="academicCap"
    />

    <AlertBox v-if="signedOut" variant="info" class="mb-6">
      <p class="font-medium">{{ t("frame.signInRequired") }}</p>
      <p class="mt-1 text-sm">{{ t("frame.signInHint") }}</p>
      <Button as="a" :href="signInHref" size="sm" class="mt-3">
        {{ t("frame.signIn") }}
      </Button>
    </AlertBox>

    <template v-else>
      <AlertBox v-if="error" variant="danger" class="mb-6">{{
        error
      }}</AlertBox>

      <EmptyState
        v-if="!sections.length"
        icon="academicCap"
        :title="t('home.empty')"
        :description="t('home.emptyHint')"
      />

      <section v-for="section in sections" :key="section.scope" class="mb-8">
        <h2
          class="mb-3 text-xs font-semibold uppercase tracking-widest text-faint"
        >
          {{ section.label }}
        </h2>

        <div class="space-y-3">
          <Card v-for="paper in section.papers" :key="paper.id" padding="lg">
            <div class="flex flex-wrap items-start justify-between gap-4">
              <div class="min-w-0 flex-1">
                <div class="flex flex-wrap items-center gap-2">
                  <h3 class="text-base font-semibold text-ink">
                    {{ paper.title }}
                  </h3>
                  <Badge v-if="paper.openSitting" variant="warning">
                    {{ t("home.resumeHint") }}
                  </Badge>
                </div>

                <p v-if="paper.description" class="mt-1 text-sm text-muted">
                  {{ paper.description }}
                </p>

                <dl
                  class="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted"
                >
                  <dd class="flex items-center gap-1">
                    <Icon name="documentText" class="size-3.5" />
                    {{ t("home.questions", { count: paper.questionCount }) }}
                    <!-- 抽的是子集时把题库大小说出来：那是「每次都不一样」这件
                         事唯一看得见的证据。 -->
                    <span v-if="paper.bankSize > paper.questionCount">
                      · {{ t("home.drawnFrom", { total: paper.bankSize }) }}
                    </span>
                  </dd>
                  <dd class="flex items-center gap-1">
                    <Icon name="checkCircle" class="size-3.5" />
                    {{ t("home.passMark", { mark: paper.passMark }) }}
                  </dd>
                  <dd class="flex items-center gap-1">
                    <Icon name="clock" class="size-3.5" />
                    {{
                      paper.timeLimit
                        ? t("home.timeLimit", { minutes: paper.timeLimit })
                        : t("home.noTimeLimit")
                    }}
                  </dd>
                  <dd
                    v-if="paper.promoteTo !== null"
                    class="flex items-center gap-1 text-can"
                  >
                    <Icon name="sparkles" class="size-3.5" />
                    {{
                      t("home.promotes", {
                        rating: ratingName(paper.promoteTo),
                      })
                    }}
                  </dd>
                </dl>

                <p v-if="!paper.eligible" class="mt-3 text-xs text-warning-fg">
                  {{ t(`home.reason.${paper.reason}`) }}
                </p>
              </div>

              <Button
                :disabled="!paper.eligible"
                :loading="busy === paper.slug"
                :variant="paper.openSitting ? 'primary' : 'secondary'"
                @click="start(paper)"
              >
                {{
                  !paper.eligible
                    ? t("home.ineligible")
                    : paper.openSitting
                      ? t("home.resume")
                      : t("home.start")
                }}
              </Button>
            </div>
          </Card>
        </div>
      </section>

      <section class="mt-10">
        <h2
          class="mb-3 text-xs font-semibold uppercase tracking-widest text-faint"
        >
          {{ t("home.history.title") }}
        </h2>

        <Card v-if="!records.length" padding="lg">
          <p class="text-sm text-muted">{{ t("home.history.empty") }}</p>
        </Card>

        <ul v-else class="space-y-2">
          <li
            v-for="record in records"
            :key="record.id"
            class="flex items-center justify-between gap-4 rounded-card border border-subtle bg-surface-raised px-4 py-3"
          >
            <div class="min-w-0">
              <p class="truncate text-sm font-medium text-ink">
                {{ paperFor(record)?.title || t("home.history.unknownExam") }}
              </p>
              <p class="tnum mt-0.5 text-xs text-faint">
                {{ formatDate(record.createdAt) }}
              </p>
            </div>
            <div class="flex shrink-0 items-center gap-3">
              <span class="tnum text-sm font-semibold text-ink">
                {{ record.score }}%
              </span>
              <Badge :variant="record.passed ? 'success' : 'danger'">
                {{
                  record.passed
                    ? t("home.history.passed")
                    : t("home.history.failed")
                }}
              </Badge>
            </div>
          </li>
        </ul>
      </section>
    </template>
  </div>
</template>
