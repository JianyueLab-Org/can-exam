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
 * - **通过后提升到的等级**不能选 SUP/ADM。那两个等级能编辑这一页，一份能授予
 *   它们的卷子就是一条通往「自己发卷子给自己升级」的路。上游会拒绝，下拉里干
 *   脆不列。
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
import { EMPTY_PAPER, type AdminPaper } from "@/lib/admin";
import { api, allRatings, ratingName, type ExamScope } from "@/lib/exams";
import { createTranslator } from "@/lib/i18n";

const props = defineProps<{
  messages: Record<string, unknown>;
  papers: AdminPaper[];
  /** 服务端读不到卷子清单（没登录，或者不是 SUP/ADM）。 */
  forbidden: boolean;
}>();

const t = createTranslator(props.messages);

const papers = ref<AdminPaper[]>(props.papers);
const error = ref<string | null>(null);
const saving = ref(false);
const editing = ref(false);
/** 编辑中的那一份。id 为 0 表示新建。 */
const draft = ref<AdminPaper>({
  ...EMPTY_PAPER,
  id: 0,
  draw: 0,
  questionCount: 0,
  createdBy: "",
});

const scopeOptions = computed(() => [
  { value: "pilots", label: t("home.pilots") },
  { value: "controllers", label: t("home.controllers") },
]);

/** SUP/ADM 不进这个下拉，理由见文件头。 */
const promoteOptions = computed(() => [
  { value: "", label: t("admin.paper.promoteNone") },
  ...allRatings()
    .filter((rating) => rating.id < 11)
    .map((rating) => ({ value: String(rating.id), label: rating.name })),
]);

function setPromoteTo(value: string | number) {
  draft.value.promoteTo = value === "" ? null : Number(value);
}

function open(paper?: AdminPaper) {
  error.value = null;
  draft.value = paper
    ? { ...paper, eligibleRatings: [...(paper.eligibleRatings ?? [])] }
    : { ...EMPTY_PAPER, id: 0, draw: 0, questionCount: 0, createdBy: "" };
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

async function save() {
  saving.value = true;
  error.value = null;

  const body = {
    slug: draft.value.slug.trim(),
    title: draft.value.title.trim(),
    description: draft.value.description,
    scope: draft.value.scope,
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
    // 上游的 message 是给人看的、而且指名了出问题的字段（重复的 slug、越界的
    // 及格线），所以直接显示它比换成一句自己的话更有用。
    error.value = (err as { message?: string }).message || t("frame.error");
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
    error.value = (err as { message?: string }).message || t("frame.error");
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
