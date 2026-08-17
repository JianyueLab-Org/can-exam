<script setup lang="ts">
/**
 * 一份卷子的题库：读、加、改、删、停用、复制。
 *
 * **这是整个仓库里唯一显示正确答案的界面。** 它能这么做，是因为拿到这些数据的
 * 那条路（`/api/v1/admin/*`）在上游挂在 `WithSuper` 后面、再按 division 过滤。
 * 类型也是分开的（`lib/admin.ts` 而不是 `lib/exams.ts`），这样「在考生页面上顺
 * 手读一下 isCorrect」会直接编译不过，而不是在运行时悄悄拿到 undefined。
 *
 * ## 三条改题的规矩，界面要替人记住
 *
 * **改题会给选项换新 id。** 上游是整组重写选项的，所以改动之前发出去的卷子，那
 * 道题会解析不到答案、判为答错。这是有意的方向（题面刚改过，不该把旧答案当没事
 * 发生），但它意味着「改」不是免费的 —— 编辑一道**启用中**的题时会说这句话。
 *
 * **停用和改分类是免费的。** 上游不带 `options` 的 PATCH 不动选项，所以内联的
 * 启用/停用开关不会碰任何人正在答的卷子。这也是它敢做成一键开关、而不是「进编
 * 辑框再保存」的原因 —— 后者会连带重写选项。
 *
 * **停用不是删除。** 停用的题不再被抽中，但已经发出去、正在作答的卷子上如果有
 * 它，那道题仍然算数。要的就是这个：否则改一次题库就能让正在考试的人手里的卷子
 * 判不了。
 *
 * ## 多选题的两条边界
 *
 * **允许只有一个正确答案的多选题**，而且那不是漏判。考生端只知道「这题是多
 * 选」，不知道要选几个 —— 如果多选题一律至少两个答案，那「它是复选框」本身就
 * 泄露了答案的个数。
 *
 * **不允许全部正确。** 上游按 `右/对 − 错/错` 给分，一个错的都没有的话扣分项
 * 消失，全勾就是满分。
 *
 * ## 图片是先传后存的
 *
 * 选完文件当场就上传到 R2，拿回一个 cdn 地址填进草稿；点保存才把地址写进题里。
 * 所以传了图不保存、或者传了又换掉，桶里会留一个没人引的对象。上游从不删除任何
 * 对象（正在作答的卷子可能还引着它），孤儿就一直留着 —— 几十 KB 换一个不会存到
 * 一半的表单，这笔账是划算的。
 *
 * ## 排序为什么只是这一页的事
 *
 * 列表能按分类或题面排，但那**只影响这一页**。发卷时 `exam.Draw` 无论如何都会
 * 洗一遍顺序（哪怕是全抽），所以 `position` 对考生完全不可见。既然如此，排序就
 * 做成纯客户端的：没有写库、没有选项 id 变动、代价为零。想调考生看到的题序是做
 * 不到的，那正是设计。
 */
import { computed, ref, watch } from "vue";

import {
  AlertBox,
  Badge,
  Button,
  Card,
  Dialog,
  EmptyState,
  Icon,
  Input,
  PageHeader,
  Select,
  Textarea,
  Toggle,
} from "@jianyuelab-org/can-ui";
import ImageUpload from "@/components/ImageUpload.vue";
import {
  draftProblem,
  emptyQuestion,
  toDraft,
  type AdminPaper,
  type AdminQuestion,
  type QuestionDraft,
} from "@/lib/admin";
import { api } from "@/lib/exams";
import { createTranslator } from "@/lib/i18n";

const props = defineProps<{
  messages: Record<string, unknown>;
  paper: AdminPaper | null;
  questions: AdminQuestion[];
  forbidden: boolean;
}>();

const t = createTranslator(props.messages);

const questions = ref<AdminQuestion[]>(props.questions);
const error = ref<string | null>(null);
const notice = ref<string | null>(null);
const saving = ref(false);
/** 正在做单项操作（开关/复制/删除）的题号，用来只转那一行的按钮。 */
const busyId = ref<number | null>(null);

/* ------------------------------------------------------------------ *
 * 筛选
 * ------------------------------------------------------------------ */

const search = ref("");
const categoryFilter = ref("");
const statusFilter = ref("");
const sortBy = ref("default");

/** 「未分类」在筛选下拉里的值。带个空格，不可能和真实分类撞上。 */
const NO_CATEGORY = " none";

/** 题库里已经用过的分类，筛选下拉和编辑框的候选都用它。 */
const categories = computed(() => {
  const seen = new Set<string>();
  for (const question of questions.value) {
    if (question.category) seen.add(question.category);
  }
  return [...seen].sort((a, b) => a.localeCompare(b));
});

const categoryOptions = computed(() => [
  { value: "", label: t("admin.questions.filterAllCategories") },
  ...categories.value.map((category) => ({ value: category, label: category })),
  { value: NO_CATEGORY, label: t("admin.questions.uncategorised") },
]);

const statusOptions = computed(() => [
  { value: "", label: t("admin.questions.filterAllStatus") },
  { value: "enabled", label: t("admin.questions.enabled") },
  { value: "disabled", label: t("admin.questions.disabled") },
]);

const sortOptions = computed(() => [
  { value: "default", label: t("admin.questions.sortDefault") },
  { value: "category", label: t("admin.questions.sortCategory") },
  { value: "prompt", label: t("admin.questions.sortPrompt") },
]);

/**
 * 搜索匹配题面、选项、解析和分类。
 *
 * 选项也在内 —— 找一道题时记得住的往往是某个选项的措辞（「有『以上所有』的那
 * 道」），而不是题面的头几个字。
 */
function matches(question: AdminQuestion, needle: string): boolean {
  if (!needle) return true;
  return [
    question.prompt,
    question.category,
    question.explanation,
    ...question.options.map((option) => option.label),
  ]
    .join("\n")
    .toLowerCase()
    .includes(needle);
}

const visible = computed(() => {
  const needle = search.value.trim().toLowerCase();

  const filtered = questions.value.filter((question) => {
    if (!matches(question, needle)) return false;
    if (categoryFilter.value === NO_CATEGORY && question.category) return false;
    if (
      categoryFilter.value &&
      categoryFilter.value !== NO_CATEGORY &&
      question.category !== categoryFilter.value
    ) {
      return false;
    }
    if (statusFilter.value === "enabled" && question.status !== 1) return false;
    if (statusFilter.value === "disabled" && question.status === 1)
      return false;
    return true;
  });

  const sorted = [...filtered];
  if (sortBy.value === "prompt") {
    sorted.sort((a, b) => a.prompt.localeCompare(b.prompt));
  } else if (sortBy.value === "category") {
    // 未分类的排到最后：U+FFFF 比任何真实字符都大。
    sorted.sort(
      (a, b) =>
        (a.category || "￿").localeCompare(b.category || "￿") ||
        a.position - b.position,
    );
  }
  return sorted;
});

const filtering = computed(
  () => !!search.value.trim() || !!categoryFilter.value || !!statusFilter.value,
);

function clearFilters() {
  search.value = "";
  categoryFilter.value = "";
  statusFilter.value = "";
}

/* ------------------------------------------------------------------ *
 * 题库概况
 * ------------------------------------------------------------------ */

const enabledCount = computed(
  () => questions.value.filter((question) => question.status === 1).length,
);

/**
 * 值得说给作者听的几件事。
 *
 * 都不是错误 —— 上游会把抽题数自动夹到题库大小，没有解析的题也照样能考。写出来
 * 是因为它们都属于「一份跑得起来但不太对劲的卷子」，而那种问题不会自己浮出来。
 */
const warnings = computed(() => {
  const out: string[] = [];
  if (!props.paper) return out;

  if (props.paper.drawCount > enabledCount.value) {
    out.push(
      t("admin.questions.warnShortBank", {
        draw: props.paper.drawCount,
        count: enabledCount.value,
      }),
    );
  }
  if (enabledCount.value === 0 && questions.value.length > 0) {
    out.push(t("admin.questions.warnAllDisabled"));
  }
  const missing = questions.value.filter(
    (question) => question.status === 1 && !question.explanation.trim(),
  ).length;
  if (missing > 0) {
    out.push(t("admin.questions.warnNoExplanation", { count: missing }));
  }
  return out;
});

/* ------------------------------------------------------------------ *
 * 编辑
 * ------------------------------------------------------------------ */

const editorOpen = ref(false);
/** 正在编辑的题的 id；0 表示新建。 */
const editingId = ref(0);
const draft = ref<QuestionDraft>(emptyQuestion());
const previewing = ref(false);

const editingQuestion = computed(() =>
  questions.value.find((question) => question.id === editingId.value),
);

function edit(question: AdminQuestion) {
  error.value = null;
  editingId.value = question.id;
  draft.value = toDraft(question);
  previewing.value = false;
  editorOpen.value = true;
}

function add() {
  error.value = null;
  editingId.value = 0;
  draft.value = emptyQuestion();
  // 正在按某个分类筛选时，新题默认落进那个分类 —— 连着录十道同一知识点的题是真
  // 实用法，每道都重打一遍分类不是。
  if (categoryFilter.value && categoryFilter.value !== NO_CATEGORY) {
    draft.value.category = categoryFilter.value;
  }
  previewing.value = false;
  editorOpen.value = true;
}

/** 单选题，所以标一个正确就等于取消其他的。 */
function markCorrect(index: number) {
  draft.value.options = draft.value.options.map((option, i) => ({
    ...option,
    isCorrect: i === index,
  }));
}

/** 多选题：这一个正确与否，各管各的。 */
function toggleCorrect(index: number) {
  draft.value.options = draft.value.options.map((option, i) =>
    i === index ? { ...option, isCorrect: !option.isCorrect } : option,
  );
}

/**
 * 单选 / 多选之间切换。
 *
 * 切回单选时**只留第一个正确答案**。不整理的话，一道标了三个正确的题会变成一道
 * 上游拒收的单选题，而人看到的只是保存时弹出的一句 400 —— 让草稿始终停在一个合
 * 法状态上，比让人自己去猜哪里不对好。
 *
 * 反方向（单选 → 多选）什么都不用动：一个正确答案的多选题是合法的，而且是有用
 * 的。
 */
function setMultiple(multiple: boolean) {
  draft.value.multiple = multiple;
  if (multiple) return;

  let kept = false;
  draft.value.options = draft.value.options.map((option) => {
    if (option.isCorrect && !kept) {
      kept = true;
      return option;
    }
    return { ...option, isCorrect: false };
  });
  if (!kept && draft.value.options.length) {
    draft.value.options = draft.value.options.map((option, i) => ({
      ...option,
      isCorrect: i === 0,
    }));
  }
}

function setOption(index: number, label: string) {
  draft.value.options = draft.value.options.map((option, i) =>
    i === index ? { ...option, label } : option,
  );
}

function setOptionImage(index: number, imageUrl: string) {
  draft.value.options = draft.value.options.map((option, i) =>
    i === index ? { ...option, imageUrl } : option,
  );
}

function addOption() {
  draft.value.options = [
    ...draft.value.options,
    { label: "", isCorrect: false, imageUrl: "" },
  ];
}

function removeOption(index: number) {
  const remaining = draft.value.options.filter((_, i) => i !== index);
  // 删掉的正好是标着正确的那个时，把正确移到第一个 —— 让草稿始终停在一个上游会
  // 接受的状态上，比让人保存一次撞一次 400 好。多选题只在**一个正确的都不剩**
  // 时才补，因为多选本来就可以有好几个。
  if (!remaining.some((option) => option.isCorrect) && remaining.length) {
    remaining[0] = { ...remaining[0], isCorrect: true };
  }
  draft.value.options = remaining;
}

/**
 * 考生会看到的样子：没有答案，选项顺序洗过。
 *
 * 洗这一遍不是装饰。作者几乎总把正确答案放在第一个（新题的默认就是），因而很容
 * 易忘记考生看到的不是这个顺序 —— 预览把它直接摆出来。这里的洗牌只是示意，真正
 * 那一次在 can-api 的 `exam.Draw` 里，每次发卷都重洗。
 */
const previewSeed = ref(0);
const previewOptions = computed(() => {
  void previewSeed.value; // 重洗按钮的依赖
  // 洗的是**去掉 isCorrect 之后**的那一份，和考生真正拿到的一样。留着那个字段
  // 再在模板里不去读它，就等着某天有人读了。
  const shown = draft.value.options
    .filter((option) => option.label.trim())
    .map((option) => ({
      label: option.label.trim(),
      imageUrl: option.imageUrl,
    }));
  for (let i = shown.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shown[i], shown[j]] = [shown[j], shown[i]];
  }
  return shown;
});

const draftIssue = computed(() => {
  const problem = draftProblem(draft.value);
  if (!problem) return null;
  return t(
    {
      prompt: "admin.questions.needPrompt",
      options: "admin.questions.needOptions",
      markOne: "admin.questions.markOne",
      markSome: "admin.questions.markSome",
      markNotAll: "admin.questions.markNotAll",
    }[problem] ?? "frame.error",
  );
});

async function save() {
  if (draftIssue.value) {
    error.value = draftIssue.value;
    return;
  }

  saving.value = true;
  error.value = null;

  const body = {
    prompt: draft.value.prompt.trim(),
    category: draft.value.category.trim(),
    explanation: draft.value.explanation,
    enabled: draft.value.enabled,
    multiple: draft.value.multiple,
    imageUrl: draft.value.imageUrl,
    // 空白的选项行是编辑时留下的痕迹，不是选项。按**文字**过滤而不是按有没有
    // 图：上游要求有图的选项也必须有文字，一个只传了图的行在这里就该当成没填完。
    options: draft.value.options
      .filter((option) => option.label.trim())
      .map((option) => ({
        label: option.label.trim(),
        isCorrect: option.isCorrect,
        imageUrl: option.imageUrl,
      })),
  };

  try {
    if (editingId.value) {
      await api(`/api/v1/admin/questions/${editingId.value}`, {
        method: "PATCH",
        body,
      });
    } else {
      await api(`/api/v1/admin/papers/${props.paper!.id}/questions`, {
        method: "POST",
        body,
      });
    }
    await reload();
    editorOpen.value = false;
    flash(t("admin.questions.saved"));
  } catch (err) {
    error.value = describe(err);
  } finally {
    saving.value = false;
  }
}

/* ------------------------------------------------------------------ *
 * 单项操作
 * ------------------------------------------------------------------ */

/**
 * 启用 / 停用，一键。
 *
 * **只发 `enabled`，不发 `options`。** 上游不带选项的 PATCH 不动选项，所以这个
 * 开关不会给选项换 id，也就不会弄坏任何人正在答的卷子。图省事复用 `save()` 那
 * 个 body 就会弄坏，而且不会有任何报错 —— 那正是这段注释存在的理由。
 */
async function toggle(question: AdminQuestion) {
  busyId.value = question.id;
  error.value = null;
  try {
    await api(`/api/v1/admin/questions/${question.id}`, {
      method: "PATCH",
      body: { enabled: question.status !== 1 },
    });
    await reload();
  } catch (err) {
    error.value = describe(err);
  } finally {
    busyId.value = null;
  }
}

/** 复制一道题。连着录一组相似的题是真实用法，从头打一遍不是。 */
async function duplicate(question: AdminQuestion) {
  busyId.value = question.id;
  error.value = null;
  try {
    await api(`/api/v1/admin/papers/${props.paper!.id}/questions`, {
      method: "POST",
      body: {
        prompt: t("admin.questions.copyOf", { prompt: question.prompt }),
        category: question.category,
        explanation: question.explanation,
        multiple: question.multiple,
        // 副本和原题指向**同一张图**。复制一份对象出来也可以，但那要么在上游加
        // 一条复制路由、要么把图拉下来再传一遍，换来的只是「删掉原题的图不影响
        // 副本」—— 而上游从不删除任何对象，那件事本来就不会发生。
        imageUrl: question.imageUrl,
        // 副本默认**停用**：它标题里带着「副本」，直接进抽题池等于把一道半成品
        // 发给考生。
        enabled: false,
        options: question.options.map((option) => ({
          label: option.label,
          isCorrect: option.isCorrect,
          imageUrl: option.imageUrl,
        })),
      },
    });
    await reload();
    flash(t("admin.questions.duplicated"));
  } catch (err) {
    error.value = describe(err);
  } finally {
    busyId.value = null;
  }
}

const deleting = ref<AdminQuestion | null>(null);

async function confirmDelete() {
  const question = deleting.value;
  if (!question) return;

  busyId.value = question.id;
  error.value = null;
  try {
    await api(`/api/v1/admin/questions/${question.id}`, { method: "DELETE" });
    questions.value = questions.value.filter((item) => item.id !== question.id);
    deleting.value = null;
    flash(t("admin.questions.deleted"));
  } catch (err) {
    error.value = describe(err);
  } finally {
    busyId.value = null;
  }
}

/* ------------------------------------------------------------------ *
 * 杂项
 * ------------------------------------------------------------------ */

/**
 * 保存之后整表重读，而不是就地改一行。
 *
 * 选项在上游是整组重写的，新的 id 只有重读才知道 —— 而 id 正是这一页显示对错所
 * 依赖的东西。就地拼一份出来，屏幕上就会是一份和库里不一样的题。
 */
async function reload() {
  const fresh = await api<{ questions: AdminQuestion[] }>(
    `/api/v1/admin/papers/${props.paper!.id}/questions`,
  );
  questions.value = fresh.questions;
}

let flashTimer: ReturnType<typeof setTimeout> | undefined;
function flash(message: string) {
  notice.value = message;
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => (notice.value = null), 2500);
}

/**
 * 把上游的拒绝翻成一句话。权限相关的几个码用本地文案，其余显示上游的
 * `message` —— 它是给人看的，而且指名了出问题的字段。
 */
function describe(err: unknown): string {
  const { error: code, message } = (err ?? {}) as {
    error?: string;
    message?: string;
  };
  if (code && ["wrong_region", "grant_too_high", "forbidden"].includes(code)) {
    return t(`admin.errors.${code}`);
  }
  if (code === "not_found") return t("admin.errors.gone");
  return message || t("frame.error");
}

// 关掉编辑框就把错误一起收走，否则下次打开还挂着上一次的红字。
watch(editorOpen, (open) => {
  if (!open) error.value = null;
});
</script>

<template>
  <div>
    <AlertBox v-if="forbidden || !paper" variant="danger">
      {{ t("admin.forbidden") }}
    </AlertBox>

    <template v-else>
      <PageHeader :title="paper.title" icon="documentText">
        <template #actions>
          <BaseButton as="a" href="/admin" variant="ghost" size="sm">
            <template #icon><Icon name="arrowLeft" class="size-4" /></template>
            {{ t("admin.back") }}
          </BaseButton>
          <BaseButton @click="add">
            <template #icon><Icon name="plus" class="size-4" /></template>
            {{ t("admin.questions.add") }}
          </BaseButton>
        </template>
      </PageHeader>

      <!-- 概况。抽题数和题库大小放在一起，因为它们只有对照着看才有意义。 -->
      <BaseCard padding="md" class="-mt-4 mb-4">
        <dl class="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
          <div class="flex items-baseline gap-1.5">
            <dt class="text-muted">{{ t("admin.questions.statBank") }}</dt>
            <dd class="tnum font-semibold text-ink">{{ questions.length }}</dd>
          </div>
          <div class="flex items-baseline gap-1.5">
            <dt class="text-muted">{{ t("admin.questions.statEnabled") }}</dt>
            <dd class="tnum font-semibold text-ink">{{ enabledCount }}</dd>
          </div>
          <div class="flex items-baseline gap-1.5">
            <dt class="text-muted">{{ t("admin.questions.statDraw") }}</dt>
            <dd class="tnum font-semibold text-ink">
              {{ paper.drawCount || t("admin.papers.drawAll") }}
            </dd>
          </div>
          <div class="flex items-baseline gap-1.5">
            <dt class="text-muted">
              {{ t("admin.questions.statCategories") }}
            </dt>
            <dd class="tnum font-semibold text-ink">{{ categories.length }}</dd>
          </div>
        </dl>

        <ul
          v-if="warnings.length"
          class="mt-3 space-y-1 border-t border-subtle pt-3"
        >
          <li
            v-for="warning in warnings"
            :key="warning"
            class="flex items-start gap-1.5 text-xs text-warning-fg"
          >
            <Icon name="exclamationTriangle" class="mt-0.5 size-3.5 shrink-0" />
            {{ warning }}
          </li>
        </ul>
      </BaseCard>

      <AlertBox v-if="error" variant="danger" class="mb-4">{{
        error
      }}</AlertBox>
      <AlertBox v-if="notice" variant="success" class="mb-4">
        {{ notice }}
      </AlertBox>

      <!-- 筛选条。粘在顶上：一份五十题的卷子滚到一半想换个筛选，不该先滚回去。 -->
      <div
        class="sticky top-2 z-30 mb-4 rounded-card border border-subtle bg-chrome p-3"
      >
        <div class="flex flex-wrap items-end gap-3">
          <div class="min-w-[12rem] flex-1">
            <BaseInput
              :model-value="search"
              :label="t('admin.questions.search')"
              :placeholder="t('admin.questions.searchPlaceholder')"
              @update:model-value="(value: string) => (search = value)"
            />
          </div>
          <BaseSelect
            :model-value="categoryFilter"
            :label="t('admin.questions.category')"
            :options="categoryOptions"
            @update:model-value="
              (value: string | number) => (categoryFilter = String(value))
            "
          />
          <BaseSelect
            :model-value="statusFilter"
            :label="t('admin.questions.status')"
            :options="statusOptions"
            @update:model-value="
              (value: string | number) => (statusFilter = String(value))
            "
          />
          <BaseSelect
            :model-value="sortBy"
            :label="t('admin.questions.sort')"
            :options="sortOptions"
            @update:model-value="
              (value: string | number) => (sortBy = String(value))
            "
          />
        </div>

        <p
          v-if="filtering"
          class="mt-2 flex items-center gap-2 text-xs text-muted"
        >
          {{
            t("admin.questions.showing", {
              shown: visible.length,
              total: questions.length,
            })
          }}
          <button type="button" class="link" @click="clearFilters">
            {{ t("admin.questions.clearFilters") }}
          </button>
        </p>
      </div>

      <EmptyState
        v-if="!questions.length"
        icon="documentText"
        :title="t('admin.questions.empty')"
      />
      <EmptyState
        v-else-if="!visible.length"
        icon="magnifyingGlass"
        :title="t('admin.questions.noMatches')"
        :description="t('admin.questions.noMatchesHint')"
      />

      <ul v-else class="space-y-2">
        <li
          v-for="question in visible"
          :key="question.id"
          class="rounded-card border border-subtle bg-surface-raised px-4 py-3"
          :class="question.status !== 1 ? 'opacity-60' : ''"
        >
          <div class="flex items-start justify-between gap-4">
            <div class="min-w-0 flex-1">
              <div
                v-if="question.category || question.status !== 1"
                class="mb-1.5 flex flex-wrap items-center gap-1.5"
              >
                <BaseBadge v-if="question.category" variant="info" size="sm">
                  {{ question.category }}
                </BaseBadge>
                <BaseBadge v-if="question.multiple" variant="warning" size="sm">
                  {{ t("admin.questions.multiple") }}
                </BaseBadge>
                <BaseBadge
                  v-if="question.status !== 1"
                  variant="neutral"
                  size="sm"
                >
                  {{ t("admin.questions.disabled") }}
                </BaseBadge>
              </div>

              <p class="whitespace-pre-wrap text-sm font-medium text-ink">
                {{ question.prompt }}
              </p>

              <!-- 缩略图而不是原图：这一页是一份五十题的清单，二十张全尺寸的
                   航图会把它变成一条滚不到底的带子。 -->
              <img
                v-if="question.imageUrl"
                :src="question.imageUrl"
                :alt="t('admin.questions.figureAlt')"
                loading="lazy"
                class="mt-2 max-h-24 w-auto rounded-control border border-subtle"
              />

              <ul class="mt-2 space-y-1">
                <li
                  v-for="option in question.options"
                  :key="option.id"
                  class="flex items-start gap-2 text-xs"
                  :class="
                    option.isCorrect
                      ? 'font-medium text-success-fg'
                      : 'text-muted'
                  "
                >
                  <Icon
                    v-if="option.isCorrect"
                    name="checkCircle"
                    class="mt-0.5 size-3.5 shrink-0"
                  />
                  <span v-else class="mt-0.5 size-3.5 shrink-0"></span>
                  <span class="min-w-0">
                    <span class="whitespace-pre-wrap">{{ option.label }}</span>
                    <img
                      v-if="option.imageUrl"
                      :src="option.imageUrl"
                      :alt="option.label"
                      loading="lazy"
                      class="mt-1 max-h-16 w-auto rounded-control border border-subtle"
                    />
                  </span>
                </li>
              </ul>

              <p
                v-if="question.explanation"
                class="mt-2 whitespace-pre-wrap border-l-2 border-subtle pl-2 text-xs text-faint"
              >
                {{ question.explanation }}
              </p>
            </div>

            <div class="flex shrink-0 items-center gap-0.5">
              <BaseButton
                variant="ghost"
                size="sm"
                icon-only
                :loading="busyId === question.id"
                :title="
                  question.status === 1
                    ? t('admin.questions.disable')
                    : t('admin.questions.enable')
                "
                @click="toggle(question)"
              >
                <template #icon>
                  <Icon
                    :name="question.status === 1 ? 'checkCircle' : 'xCircle'"
                    class="size-4"
                  />
                </template>
              </BaseButton>
              <BaseButton
                variant="ghost"
                size="sm"
                icon-only
                :title="t('admin.questions.duplicate')"
                @click="duplicate(question)"
              >
                <template #icon><Icon name="plus" class="size-4" /></template>
              </BaseButton>
              <BaseButton
                variant="ghost"
                size="sm"
                icon-only
                :title="t('admin.papers.edit')"
                @click="edit(question)"
              >
                <template #icon>
                  <Icon name="pencilSquare" class="size-4" />
                </template>
              </BaseButton>
              <BaseButton
                variant="ghost"
                size="sm"
                icon-only
                :title="t('admin.questions.delete')"
                @click="deleting = question"
              >
                <template #icon><Icon name="xMark" class="size-4" /></template>
              </BaseButton>
            </div>
          </div>
        </li>
      </ul>
    </template>

    <!-- 编辑器做成对话框而不是就地展开：一份五十题的卷子里就地展开的表单，人滚
         两下就找不到自己在改哪一道了。 -->
    <BaseDialog
      v-model:open="editorOpen"
      :title="
        editingId
          ? t('admin.questions.editTitle')
          : t('admin.questions.addTitle')
      "
      :close-label="t('admin.paper.cancel')"
      size="lg"
    >
      <div class="space-y-4">
        <AlertBox v-if="error" variant="danger">{{ error }}</AlertBox>

        <!-- 改一道**启用中**的题会给选项换新 id，正在作答的人那道题会判错。新建
             和改停用的题都没有这个问题，所以只在这一种情况下说。 -->
        <AlertBox
          v-if="editingId && editingQuestion?.status === 1"
          variant="warning"
        >
          {{ t("admin.questions.editWarning") }}
        </AlertBox>

        <BaseTextarea
          :model-value="draft.prompt"
          :label="t('admin.questions.prompt')"
          :placeholder="t('admin.questions.promptPlaceholder')"
          required
          :rows="3"
          @update:model-value="(value: string) => (draft.prompt = value)"
        />

        <div>
          <span class="mb-1.5 block text-sm font-medium text-ink">
            {{ t("admin.questions.image") }}
          </span>
          <ImageUpload
            :model-value="draft.imageUrl"
            :label="t('admin.questions.imageAdd')"
            :remove-label="t('admin.questions.imageRemove')"
            :uploading-label="t('admin.questions.imageUploading')"
            :alt="t('admin.questions.figureAlt')"
            :fallback-error="t('admin.questions.imageFailed')"
            @update:model-value="(value: string) => (draft.imageUrl = value)"
            @error="(message: string) => (error = message)"
          />
          <p class="mt-1 text-xs text-muted">
            {{ t("admin.questions.imageHelp") }}
          </p>
        </div>

        <div>
          <label
            for="question-category"
            class="mb-1.5 block text-sm font-medium text-ink"
          >
            {{ t("admin.questions.category") }}
          </label>
          <!-- datalist 而不是纯下拉：既要能选已有的，也要能打一个新的。纯下拉挡
               住后者；纯文本框会让「无线电」和「无线电通话」变成两个分类。 -->
          <input
            id="question-category"
            class="input w-full"
            list="bank-categories"
            :value="draft.category"
            :placeholder="t('admin.questions.categoryPlaceholder')"
            @input="
              (event) =>
                (draft.category = (event.target as HTMLInputElement).value)
            "
          />
          <datalist id="bank-categories">
            <option
              v-for="category in categories"
              :key="category"
              :value="category"
            ></option>
          </datalist>
          <p class="mt-1 text-xs text-muted">
            {{ t("admin.questions.categoryHelp") }}
          </p>
        </div>

        <BaseToggle
          :model-value="draft.multiple"
          :label="t('admin.questions.multiple')"
          :description="t('admin.questions.multipleHelp')"
          @update:model-value="setMultiple"
        />

        <fieldset>
          <legend class="text-sm font-medium text-ink">
            {{ t("admin.questions.options") }}
          </legend>
          <p class="mt-0.5 text-xs text-muted">
            {{
              draft.multiple
                ? t("admin.questions.markSome")
                : t("admin.questions.markOne")
            }}
          </p>

          <div class="mt-2 space-y-3">
            <div
              v-for="(option, index) in draft.options"
              :key="index"
              class="flex items-start gap-2"
            >
              <label
                class="mt-2 flex shrink-0 cursor-pointer items-center gap-1.5 text-xs text-muted"
              >
                <!-- 单选是 radio，多选是 checkbox。`name` 只在单选时给：一组同名
                     的 radio 才会互斥，而多选恰恰不该互斥。 -->
                <input
                  :type="draft.multiple ? 'checkbox' : 'radio'"
                  :name="draft.multiple ? undefined : 'correct-option'"
                  :checked="option.isCorrect"
                  :class="[
                    'size-4 accent-[var(--color-can)]',
                    draft.multiple ? 'rounded-sm' : '',
                  ]"
                  @change="
                    draft.multiple ? toggleCorrect(index) : markCorrect(index)
                  "
                />
                {{ t("admin.questions.correct") }}
              </label>
              <div class="min-w-0 flex-1 space-y-1.5">
                <!-- textarea 而不是 input：选项也会长（「以上所有」很短，但整句的
                     程序名和高度限制不短），单行框里只看得见结尾。 -->
                <textarea
                  :value="option.label"
                  class="input w-full resize-y"
                  rows="1"
                  :placeholder="
                    t('admin.questions.optionPlaceholder', {
                      number: index + 1,
                    })
                  "
                  @input="
                    (event) =>
                      setOption(
                        index,
                        (event.target as HTMLTextAreaElement).value,
                      )
                  "
                ></textarea>
                <ImageUpload
                  compact
                  :model-value="option.imageUrl"
                  :label="t('admin.questions.imageAdd')"
                  :remove-label="t('admin.questions.imageRemove')"
                  :uploading-label="t('admin.questions.imageUploading')"
                  :alt="option.label"
                  :fallback-error="t('admin.questions.imageFailed')"
                  @update:model-value="
                    (value: string) => setOptionImage(index, value)
                  "
                  @error="(message: string) => (error = message)"
                />
              </div>
              <button
                v-if="draft.options.length > 2"
                type="button"
                class="mt-1.5 rounded-control p-1.5 text-faint hover:bg-surface-sunken hover:text-ink"
                :aria-label="t('admin.questions.removeOption')"
                @click="removeOption(index)"
              >
                <Icon name="xMark" class="size-4" />
              </button>
            </div>
          </div>

          <BaseButton variant="ghost" size="sm" class="mt-2" @click="addOption">
            <template #icon><Icon name="plus" class="size-4" /></template>
            {{ t("admin.questions.addOption") }}
          </BaseButton>
        </fieldset>

        <BaseTextarea
          :model-value="draft.explanation"
          :label="t('admin.questions.explanation')"
          :hint="t('admin.questions.explanationHelp')"
          :rows="2"
          @update:model-value="(value: string) => (draft.explanation = value)"
        />

        <BaseToggle
          :model-value="draft.enabled"
          :label="t('admin.questions.enabled')"
          :description="t('admin.questions.enabledHelp')"
          @update:model-value="(value: boolean) => (draft.enabled = value)"
        />

        <!-- 预览。作者总把正确答案放在第一个，很容易忘记考生看到的不是这个顺序。 -->
        <div class="rounded-card border border-subtle">
          <button
            type="button"
            class="flex w-full items-center justify-between px-3 py-2 text-sm text-muted hover:text-ink"
            @click="previewing = !previewing"
          >
            <span class="flex items-center gap-1.5">
              <Icon name="sparkles" class="size-4" />
              {{ t("admin.questions.preview") }}
            </span>
            <Icon
              :name="previewing ? 'chevronDown' : 'chevronRight'"
              class="size-4"
            />
          </button>

          <div v-if="previewing" class="border-t border-subtle p-3">
            <div class="mb-2 flex items-center justify-between gap-2">
              <p class="text-xs text-faint">
                {{ t("admin.questions.previewHint") }}
              </p>
              <button
                type="button"
                class="link shrink-0 text-xs"
                @click="previewSeed++"
              >
                {{ t("admin.questions.reshuffle") }}
              </button>
            </div>
            <p class="whitespace-pre-wrap text-sm font-semibold text-ink">
              {{ draft.prompt || t("admin.questions.promptPlaceholder") }}
            </p>
            <img
              v-if="draft.imageUrl"
              :src="draft.imageUrl"
              :alt="t('admin.questions.figureAlt')"
              class="mt-2 max-h-56 w-auto max-w-full rounded-control border border-subtle"
            />
            <p v-if="draft.multiple" class="mt-2 text-xs text-muted">
              {{ t("sit.multipleHint") }}
            </p>
            <div class="mt-3 space-y-2">
              <div
                v-for="(shown, index) in previewOptions"
                :key="index"
                class="flex items-start gap-3 rounded-control border border-subtle p-2.5 text-sm"
              >
                <!-- 方框还是圆框，跟着单选/多选走：作者要看见的正是考生看见的那
                     一个形状。 -->
                <span
                  :class="[
                    'mt-0.5 size-4 shrink-0 border border-strong',
                    draft.multiple ? 'rounded-sm' : 'rounded-full',
                  ]"
                ></span>
                <span class="min-w-0">
                  <span class="block whitespace-pre-wrap text-ink">
                    {{ shown.label }}
                  </span>
                  <img
                    v-if="shown.imageUrl"
                    :src="shown.imageUrl"
                    :alt="shown.label"
                    class="mt-1.5 max-h-32 w-auto max-w-full rounded-control border border-subtle"
                  />
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <template #footer>
        <p v-if="draftIssue" class="mr-auto text-xs text-warning-fg">
          {{ draftIssue }}
        </p>
        <BaseButton variant="ghost" @click="editorOpen = false">
          {{ t("admin.paper.cancel") }}
        </BaseButton>
        <BaseButton :loading="saving" :disabled="!!draftIssue" @click="save">
          {{ saving ? t("admin.paper.saving") : t("admin.questions.save") }}
        </BaseButton>
      </template>
    </BaseDialog>

    <!-- 删除确认。window.confirm 用不上本站的语言和样式，而这是一个不可撤销的
         动作，值得一个能把题面写出来的框 —— 删错一道题的代价是重打一遍。 -->
    <BaseDialog
      :open="!!deleting"
      :title="t('admin.questions.deleteTitle')"
      :close-label="t('admin.paper.cancel')"
      size="sm"
      @update:open="
        (open: boolean) => {
          if (!open) deleting = null;
        }
      "
    >
      <p class="text-sm text-muted">{{ t("admin.questions.deleteConfirm") }}</p>
      <p
        v-if="deleting"
        class="mt-3 whitespace-pre-wrap rounded-control bg-surface-sunken p-3 text-sm text-ink"
      >
        {{ deleting.prompt }}
      </p>
      <template #footer>
        <BaseButton variant="ghost" @click="deleting = null">
          {{ t("admin.paper.cancel") }}
        </BaseButton>
        <BaseButton
          variant="danger"
          :loading="busyId === deleting?.id"
          @click="confirmDelete"
        >
          {{ t("admin.questions.delete") }}
        </BaseButton>
      </template>
    </BaseDialog>
  </div>
</template>
