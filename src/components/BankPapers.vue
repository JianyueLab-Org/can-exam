<script setup lang="ts">
/**
 * 题库管理的第一屏：卷子清单，以及新建/编辑一份卷子。
 *
 * 这一页上的每个字段都能改变「谁能拿到什么等级」，所以它不是一个 CRUD 表单，
 * 而是一个有几处硬规则的表单：
 *
 * - **地址（slug）** 会进 URL，所以只收小写字母、数字和连字符。上游也拦一遍，
 *   这里拦是为了让人当场看见，而不是提交完读一句英文的 400。
 * - **抽题数填 0 = 全抽。** 这是有意的语义而不是「没填」：从硬编码那份卷子迁
 *   过来的卷子就是 0，行为和以前一模一样。所以它必须能被显式设成 0，表单也就
 *   不能把 0 当成空值处理。
 * - **Division** 决定谁能改这份卷子。它不是分类标签：改它等于把这份卷子交给
 *   另一批人。「全网」（0）只有 SUP/ADM 能用 —— 入网测试就在那儿，某个
 *   division 的教员不该能改让人进网络的那份考卷。
 * - **通过后提升到的等级**有一个跟着人走的上限：你写的卷子不能授予你自己这一
 *   级或更高（教员如此，SUP/ADM 也一样 —— 谁都不能授予 SUP/ADM）。否则改一份
 *   授予 I3 的卷子的题目、把它改简单、自己去考，就是一条自助升级的路。
 *
 * 这两个下拉里的选项**都不是这里算出来的**，是上游随卷子清单一起给的
 * （`authority`）：能管哪些 division 要查 division 表，上限取决于调用者自己的
 * rating。两边各算一遍的话，两边会慢慢长得不一样，而更宽松的那一份就是实际生
 * 效的那一份。这里只负责画，不负责判。
 *
 * 题库里题目不够抽题数时会显示一行警告。那不是错误 —— 上游会自动夹到题库大小
 * ——但一份说着「考 20 题」实际只考 8 题的卷子，作者应该知道。
 */
import { computed, ref } from "vue";

import AlertBox from "@/components/ui/AlertBox.vue";
import BaseBadge from "@/components/ui/BaseBadge.vue";
import BaseButton from "@/components/ui/BaseButton.vue";
import BaseCard from "@/components/ui/BaseCard.vue";
import BaseDialog from "@/components/ui/BaseDialog.vue";
import BaseInput from "@/components/ui/BaseInput.vue";
import BaseSelect from "@/components/ui/BaseSelect.vue";
import BaseToggle from "@/components/ui/BaseToggle.vue";
import EmptyState from "@/components/ui/EmptyState.vue";
import Icon from "@/components/ui/Icon.vue";
import PageHeader from "@/components/ui/PageHeader.vue";
import { EMPTY_PAPER, type AdminPaper, type BankAuthority } from "@/lib/admin";
import {
  api,
  allRatings,
  ratingName,
  regionKey,
  type ExamScope,
} from "@/lib/exams";
import { createTranslator } from "@/lib/i18n";

const props = defineProps<{
  messages: Record<string, unknown>;
  papers: AdminPaper[];
  /**
   * 调用者能管哪些 division、最高能授予到哪一级。上游给的；读不到时是 null，
   * 那等同于 `forbidden`。
   */
  authority: BankAuthority | null;
  /**
   * 服务端读不到卷子清单：没登录、rating 不够、或者 rating 够了但在任何
   * division 里都没有 active 的 instructor 行。最后那一种是这次改动新长出来
   * 的，也是最容易让人困惑的一种 —— 所以它有自己的一句话。
   */
  forbidden: boolean;
}>();

const t = createTranslator(props.messages);

const papers = ref<AdminPaper[]>(props.papers);
/** 没有 authority 时给一个什么都不许的：默认必须是「不能」，不是「全能」。 */
const authority = computed<BankAuthority>(
  () => props.authority ?? { global: false, regions: [], maxGrant: -2 },
);
const error = ref<string | null>(null);
const saving = ref(false);
const editing = ref(false);
/** 编辑中的那一份。id 为 0 表示新建。 */
const draft = ref<AdminPaper>(blankPaper());

/**
 * 一份新卷子的初始状态。
 *
 * Division 默认落在**自己管理的第一个**上，而不是 0 —— 对教员来说 0 是个存不
 * 进去的值，让表单从一个上游会拒绝的状态开始，就是让人保存一次撞一次 403。
 * SUP/ADM 的第一个恰好就是「全网」，也正是他们多半想要的那个。
 */
function blankPaper(): AdminPaper {
  return {
    ...EMPTY_PAPER,
    id: 0,
    draw: 0,
    questionCount: 0,
    createdBy: "",
    region: authority.value.regions[0] ?? 0,
  };
}

const scopeOptions = computed(() => [
  { value: "pilots", label: t("home.pilots") },
  { value: "controllers", label: t("home.controllers") },
]);

const regionOptions = computed(() =>
  authority.value.regions.map((region) => ({
    value: String(region),
    label: t(`region.${regionKey(region)}`),
  })),
);

/**
 * 上限来自上游的 `maxGrant`，不是这里的常数。
 *
 * 一个 I1 看到的上限是 C3，一个 ADM 看到的是 I3 —— 同一份代码，两个下拉，因为
 * 那条规则里有「你是谁」这个变量。
 */
const promoteOptions = computed(() => [
  { value: "", label: t("admin.paper.promoteNone") },
  ...allRatings()
    .filter((rating) => rating.id <= authority.value.maxGrant)
    .map((rating) => ({ value: String(rating.id), label: rating.name })),
]);

function setPromoteTo(value: string | number) {
  draft.value.promoteTo = value === "" ? null : Number(value);
}

function open(paper?: AdminPaper) {
  error.value = null;
  draft.value = paper
    ? { ...paper, eligibleRatings: [...(paper.eligibleRatings ?? [])] }
    : blankPaper();
  editing.value = true;
}

/**
 * 等级门槛在界面上是一串复选框，在线上是一个逗号分隔的列。这里只管前者。
 * 空 = 谁都能考，那是上游的语义，不是「忘了填」。
 */
function toggleRating(id: number) {
  const current = draft.value.eligibleRatings ?? [];
  draft.value.eligibleRatings = current.includes(id)
    ? current.filter((value) => value !== id)
    : [...current, id].sort((a, b) => a - b);
}

/**
 * 把上游的拒绝翻成一句话。
 *
 * 权限相关的三个码用本地文案 —— 它们是这次改动最会撞上的三种，人需要读懂的是
 * 「为什么不行」而不是一句英文。其余的直接显示上游的 `message`：它是给人看
 * 的，而且指名了出问题的字段（重复的 slug、越界的及格线），换成一句自己的话反
 * 而更没用。
 */
function describe(err: unknown): string {
  const { error: code, message } = (err ?? {}) as {
    error?: string;
    message?: string;
  };
  if (code && ["wrong_region", "grant_too_high", "forbidden"].includes(code)) {
    return t(`admin.errors.${code}`);
  }
  return message || t("frame.error");
}

async function save() {
  saving.value = true;
  error.value = null;

  const body = {
    slug: draft.value.slug.trim(),
    title: draft.value.title.trim(),
    description: draft.value.description,
    scope: draft.value.scope,
    region: Number(draft.value.region) || 0,
    drawCount: Number(draft.value.drawCount) || 0,
    passMark: Number(draft.value.passMark) || 0,
    timeLimit: Number(draft.value.timeLimit) || 0,
    eligibleRatings: draft.value.eligibleRatings ?? [],
    // 「不提升」要说得明确：只是不发 promoteTo 的话，上游会把已有的值留着，而
    // 那正是想清掉它的人以为自己做到了的操作。
    promoteTo: draft.value.promoteTo,
    clearPromotion: draft.value.promoteTo === null,
    publish: draft.value.status === 1,
  };

  try {
    const saved = await api<{ paper: AdminPaper }>(
      draft.value.id
        ? `/api/v1/admin/papers/${draft.value.id}`
        : "/api/v1/admin/papers",
      { method: draft.value.id ? "PATCH" : "POST", body },
    );
    const index = papers.value.findIndex(
      (paper) => paper.id === saved.paper.id,
    );
    if (index >= 0) papers.value[index] = saved.paper;
    else papers.value = [...papers.value, saved.paper];
    editing.value = false;
  } catch (err) {
    error.value = describe(err);
  } finally {
    saving.value = false;
  }
}

async function remove(paper: AdminPaper) {
  if (!window.confirm(t("admin.papers.deleteConfirm", { title: paper.title })))
    return;
  error.value = null;
  try {
    await api(`/api/v1/admin/papers/${paper.id}`, { method: "DELETE" });
    papers.value = papers.value.filter((item) => item.id !== paper.id);
  } catch (err) {
    error.value = describe(err);
  }
}
</script>

<template>
  <div>
    <PageHeader
      :title="t('admin.title')"
      :description="t('admin.description')"
      icon="adjustments"
    >
      <template #actions>
        <BaseButton v-if="!forbidden" @click="open()">
          <template #icon><Icon name="plus" class="size-4" /></template>
          {{ t("admin.papers.new") }}
        </BaseButton>
      </template>
    </PageHeader>

    <AlertBox v-if="forbidden" variant="danger">
      {{ t("admin.forbidden") }}
    </AlertBox>

    <template v-else>
      <AlertBox v-if="error" variant="danger" class="mb-6">{{
        error
      }}</AlertBox>

      <EmptyState
        v-if="!papers.length"
        icon="documentText"
        :title="t('admin.papers.empty')"
      />

      <div v-else class="space-y-3">
        <BaseCard v-for="paper in papers" :key="paper.id" padding="lg">
          <div class="flex flex-wrap items-start justify-between gap-4">
            <div class="min-w-0 flex-1">
              <div class="flex flex-wrap items-center gap-2">
                <h3 class="text-base font-semibold text-ink">
                  {{ paper.title }}
                </h3>
                <BaseBadge
                  :variant="paper.status === 1 ? 'success' : 'neutral'"
                >
                  {{
                    paper.status === 1
                      ? t("admin.papers.published")
                      : t("admin.papers.draft")
                  }}
                </BaseBadge>
                <BaseBadge variant="info">
                  {{ t(`region.${regionKey(paper.region)}`) }}
                </BaseBadge>
                <code
                  class="rounded bg-surface-sunken px-1.5 py-0.5 text-xs text-muted"
                >
                  /{{ paper.slug }}
                </code>
              </div>

              <dl
                class="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted"
              >
                <dd class="tnum">
                  {{ t("admin.papers.bank") }} {{ paper.questionCount }}
                </dd>
                <dd class="tnum">
                  {{ t("admin.papers.draw") }}
                  {{ paper.drawCount || t("admin.papers.drawAll") }}
                </dd>
                <dd class="tnum">
                  {{ t("admin.papers.passMark") }} {{ paper.passMark }}%
                </dd>
                <dd v-if="paper.promoteTo !== null" class="text-airwaysn">
                  → {{ ratingName(paper.promoteTo) }}
                </dd>
              </dl>

              <p
                v-if="paper.drawCount > paper.questionCount"
                class="mt-2 text-xs text-warning-fg"
              >
                {{
                  t("admin.papers.shortBank", { count: paper.questionCount })
                }}
              </p>
            </div>

            <div class="flex shrink-0 items-center gap-2">
              <BaseButton
                as="a"
                :href="`/admin/${paper.id}`"
                variant="secondary"
                size="sm"
              >
                {{ t("admin.papers.manage") }}
              </BaseButton>
              <BaseButton variant="ghost" size="sm" @click="open(paper)">
                {{ t("admin.papers.edit") }}
              </BaseButton>
              <BaseButton variant="ghost" size="sm" @click="remove(paper)">
                {{ t("admin.papers.delete") }}
              </BaseButton>
            </div>
          </div>
        </BaseCard>
      </div>
    </template>

    <BaseDialog
      v-model:open="editing"
      :title="draft.id ? t('admin.paper.titleEdit') : t('admin.paper.titleNew')"
      :close-label="t('admin.paper.cancel')"
      size="lg"
    >
      <div class="space-y-4">
        <BaseInput
          v-model="draft.title"
          :label="t('admin.paper.name')"
          required
        />
        <BaseInput
          v-model="draft.slug"
          :label="t('admin.paper.slug')"
          :hint="t('admin.paper.slugHelp')"
          required
        />
        <BaseInput
          v-model="draft.description"
          :label="t('admin.paper.description')"
        />

        <div class="grid gap-4 sm:grid-cols-2">
          <div>
            <BaseSelect
              :model-value="String(draft.region)"
              :label="t('admin.paper.division')"
              :options="regionOptions"
              @update:model-value="
                (value: string | number) => (draft.region = Number(value))
              "
            />
            <p class="mt-1 text-xs text-muted">
              {{ t("admin.paper.divisionHelp") }}
            </p>
          </div>

          <BaseSelect
            :model-value="draft.scope"
            :label="t('admin.paper.scope')"
            :options="scopeOptions"
            @update:model-value="
              (value: string) => (draft.scope = value as ExamScope)
            "
          />

          <div>
            <BaseSelect
              :model-value="
                draft.promoteTo === null ? '' : String(draft.promoteTo)
              "
              :label="t('admin.paper.promoteTo')"
              :options="promoteOptions"
              @update:model-value="setPromoteTo"
            />
            <p class="mt-1 text-xs text-muted">
              {{ t("admin.paper.promoteHelp") }}
            </p>
          </div>

          <!-- 三个数字字段都走 :model-value + 显式 Number()，而不是 v-model：
               BaseInput 发出来的永远是 string，v-model 到一个 number 上会把
               draft 里的类型悄悄换掉，然后 `drawCount: 0` 和 `drawCount: "0"`
               在别处表现得不一样。 -->
          <BaseInput
            :model-value="draft.drawCount"
            type="number"
            :label="t('admin.paper.drawCount')"
            :hint="t('admin.paper.drawHelp')"
            @update:model-value="
              (value: string) => (draft.drawCount = Number(value) || 0)
            "
          />
          <BaseInput
            :model-value="draft.passMark"
            type="number"
            :label="t('admin.paper.passMark')"
            @update:model-value="
              (value: string) => (draft.passMark = Number(value) || 0)
            "
          />
          <BaseInput
            :model-value="draft.timeLimit"
            type="number"
            :label="t('admin.paper.timeLimit')"
            :hint="t('admin.paper.timeLimitHelp')"
            @update:model-value="
              (value: string) => (draft.timeLimit = Number(value) || 0)
            "
          />
        </div>

        <fieldset>
          <legend class="text-sm font-medium text-ink">
            {{ t("admin.paper.eligibleRatings") }}
          </legend>
          <p class="mt-0.5 text-xs text-muted">
            {{ t("admin.paper.eligibleHelp") }}
          </p>
          <div class="mt-2 flex flex-wrap gap-1.5">
            <label
              v-for="rating in allRatings()"
              :key="rating.id"
              :class="[
                'cursor-pointer rounded-control border px-2.5 py-1 text-xs transition-colors',
                (draft.eligibleRatings ?? []).includes(rating.id)
                  ? 'border-airwaysn bg-info-bg text-ink'
                  : 'border-subtle text-muted hover:border-strong',
              ]"
            >
              <input
                type="checkbox"
                class="sr-only"
                :checked="(draft.eligibleRatings ?? []).includes(rating.id)"
                @change="toggleRating(rating.id)"
              />
              {{ rating.name }}
            </label>
          </div>
        </fieldset>

        <BaseToggle
          :model-value="draft.status === 1"
          :label="t('admin.paper.publish')"
          @update:model-value="
            (value: boolean) => (draft.status = value ? 1 : 0)
          "
        />
      </div>

      <template #footer>
        <BaseButton variant="ghost" @click="editing = false">
          {{ t("admin.paper.cancel") }}
        </BaseButton>
        <BaseButton :loading="saving" @click="save">
          {{ saving ? t("admin.paper.saving") : t("admin.paper.save") }}
        </BaseButton>
      </template>
    </BaseDialog>
  </div>
</template>
