<script setup lang="ts">
/**
 * 一份卷子的题库：读、加、改、删、停用。
 *
 * **这是整个仓库里唯一显示正确答案的界面。** 它能这么做，是因为拿到这些数据的
 * 那条路（`/api/v1/admin/*`）在上游挂在 `WithSup` 后面。类型也是分开的
 * （`lib/admin.ts` 而不是 `lib/exams.ts`），这样「在考生页面上顺手读一下
 * isCorrect」会直接编译不过，而不是在运行时悄悄拿到 undefined。
 *
 * 两个会让人踩坑的行为，都写在界面上而不是只写在这里：
 *
 * **停用不是删除。** 停用的题不会被抽中，但一张已经发出去、人正在答的卷子上
 * 如果有它，那道题仍然算数。要的就是这个 —— 否则改一次题库就能让正在考试的人
 * 手里的卷子判不了。
 *
 * **改题会给选项换新 id。** 上游是整组重写选项的，所以改动之前发出去的那些卷
 * 子，那道题会解析不到答案、判为答错。这是有意的方向（题面刚改过，不该把旧答
 * 案当没事发生），但改一道正在被人作答的题之前值得知道。
 */
import { computed, ref } from "vue";

import AlertBox from "@/components/ui/AlertBox.vue";
import BaseBadge from "@/components/ui/BaseBadge.vue";
import BaseButton from "@/components/ui/BaseButton.vue";
import BaseCard from "@/components/ui/BaseCard.vue";
import BaseInput from "@/components/ui/BaseInput.vue";
import BaseToggle from "@/components/ui/BaseToggle.vue";
import EmptyState from "@/components/ui/EmptyState.vue";
import Icon from "@/components/ui/Icon.vue";
import PageHeader from "@/components/ui/PageHeader.vue";
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
const saving = ref(false);

/** 正在编辑的题的 id；0 表示正在新建；null 表示没在编辑。 */
const editingId = ref<number | null>(null);
const draft = ref<QuestionDraft>(emptyQuestion());

/** 按知识点分组，未填的归到「未分类」。纯粹是给人看的，抽题不看分组。 */
const grouped = computed(() => {
  const groups = new Map<string, AdminQuestion[]>();
  for (const question of questions.value) {
    const key = question.category || t("admin.questions.uncategorised");
    groups.set(key, [...(groups.get(key) ?? []), question]);
  }
  return [...groups.entries()].map(([category, items]) => ({
    category,
    items,
  }));
});

const enabledCount = computed(
  () => questions.value.filter((question) => question.status === 1).length,
);

function edit(question: AdminQuestion) {
  error.value = null;
  editingId.value = question.id;
  draft.value = toDraft(question);
}

function add() {
  error.value = null;
  editingId.value = 0;
  draft.value = emptyQuestion();
}

function cancel() {
  editingId.value = null;
  error.value = null;
}

/** 单选题，所以标一个正确就等于取消其他的。 */
function markCorrect(index: number) {
  draft.value.options = draft.value.options.map((option, i) => ({
    ...option,
    isCorrect: i === index,
  }));
}

function addOption() {
  draft.value.options = [
    ...draft.value.options,
    { label: "", isCorrect: false },
  ];
}

function removeOption(index: number) {
  const remaining = draft.value.options.filter((_, i) => i !== index);
  // 删掉的正好是标着正确的那个时，把正确移到第一个 —— 让草稿始终停在一个上游
  // 会接受的状态上，比让人保存一次撞一次 400 好。
  if (!remaining.some((option) => option.isCorrect) && remaining.length) {
    remaining[0] = { ...remaining[0], isCorrect: true };
  }
  draft.value.options = remaining;
}

async function save() {
  // 本地先挡一遍。上游会再判一次，而**那一次才算数** —— 这里挡只是为了让人当场
  // 看见，而不是提交完等一个来回、读一句英文的 400。
  const problem = draftProblem(draft.value);
  if (problem) {
    error.value = t(
      {
        prompt: "admin.questions.needPrompt",
        options: "admin.questions.needOptions",
        markOne: "admin.questions.markOne",
      }[problem] ?? "frame.error",
    );
    return;
  }

  saving.value = true;
  error.value = null;

  const body = {
    prompt: draft.value.prompt.trim(),
    category: draft.value.category.trim(),
    explanation: draft.value.explanation,
    enabled: draft.value.enabled,
    // 空白的选项行是编辑时留下的痕迹，不是选项。
    options: draft.value.options
      .filter((option) => option.label.trim())
      .map((option) => ({
        label: option.label.trim(),
        isCorrect: option.isCorrect,
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
    editingId.value = null;
  } catch (err) {
    error.value = (err as { message?: string }).message || t("frame.error");
  } finally {
    saving.value = false;
  }
}

async function remove(question: AdminQuestion) {
  if (!window.confirm(t("admin.questions.deleteConfirm"))) return;
  error.value = null;
  try {
    await api(`/api/v1/admin/questions/${question.id}`, { method: "DELETE" });
    questions.value = questions.value.filter((item) => item.id !== question.id);
  } catch (err) {
    error.value = (err as { message?: string }).message || t("frame.error");
  }
}

/**
 * 保存之后整表重读，而不是就地改一行。
 *
 * 选项在上游是整组重写的，新的 id 只有重读才知道 —— 而 id 正是这一页显示对错
 * 所依赖的东西。就地拼一份出来，屏幕上就会是一份和库里不一样的题。
 */
async function reload() {
  const fresh = await api<{ questions: AdminQuestion[] }>(
    `/api/v1/admin/papers/${props.paper!.id}/questions`,
  );
  questions.value = fresh.questions;
}
</script>

<template>
  <div>
    <AlertBox v-if="forbidden || !paper" variant="danger">
      {{ t("admin.forbidden") }}
    </AlertBox>

    <template v-else>
      <PageHeader
        :title="paper.title"
        :description="t('admin.questions.title')"
        icon="documentText"
      >
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

      <p class="tnum -mt-4 mb-6 text-xs text-muted">
        {{ t("admin.papers.bank") }} {{ enabledCount }} ·
        {{ t("admin.papers.draw") }}
        {{ paper.drawCount || t("admin.papers.drawAll") }}
      </p>

      <AlertBox v-if="error" variant="danger" class="mb-6">{{
        error
      }}</AlertBox>

      <!-- 编辑器。新建时在最上面，改题时也在最上面 —— 一份五十题的卷子里就地
           展开的表单，人滚两下就找不到自己在改哪一道了。 -->
      <BaseCard v-if="editingId !== null" padding="lg" class="mb-6">
        <div class="space-y-4">
          <BaseInput
            :model-value="draft.prompt"
            :label="t('admin.questions.prompt')"
            required
            @update:model-value="(value: string) => (draft.prompt = value)"
          />

          <div class="grid gap-4 sm:grid-cols-2">
            <BaseInput
              :model-value="draft.category"
              :label="t('admin.questions.category')"
              :hint="t('admin.questions.categoryHelp')"
              @update:model-value="(value: string) => (draft.category = value)"
            />
            <BaseInput
              :model-value="draft.explanation"
              :label="t('admin.questions.explanation')"
              :hint="t('admin.questions.explanationHelp')"
              @update:model-value="
                (value: string) => (draft.explanation = value)
              "
            />
          </div>

          <fieldset>
            <legend class="text-sm font-medium text-ink">
              {{ t("admin.questions.options") }}
            </legend>
            <p class="mt-0.5 text-xs text-muted">
              {{ t("admin.questions.markOne") }}
            </p>

            <div class="mt-2 space-y-2">
              <div
                v-for="(option, index) in draft.options"
                :key="index"
                class="flex items-center gap-2"
              >
                <label
                  class="flex shrink-0 cursor-pointer items-center gap-1.5 text-xs text-muted"
                >
                  <input
                    type="radio"
                    name="correct-option"
                    :checked="option.isCorrect"
                    class="size-4 accent-[var(--color-airwaysn)]"
                    @change="markCorrect(index)"
                  />
                  {{ t("admin.questions.correct") }}
                </label>
                <input
                  :value="option.label"
                  class="input flex-1"
                  :placeholder="`${index + 1}`"
                  @input="
                    (event) =>
                      (draft.options[index].label = (
                        event.target as HTMLInputElement
                      ).value)
                  "
                />
                <button
                  v-if="draft.options.length > 2"
                  type="button"
                  class="rounded-control p-1.5 text-faint hover:bg-surface-sunken hover:text-ink"
                  :aria-label="t('admin.questions.removeOption')"
                  @click="removeOption(index)"
                >
                  <Icon name="xMark" class="size-4" />
                </button>
              </div>
            </div>

            <BaseButton
              variant="ghost"
              size="sm"
              class="mt-2"
              @click="addOption"
            >
              {{ t("admin.questions.addOption") }}
            </BaseButton>
          </fieldset>

          <BaseToggle
            :model-value="draft.enabled"
            :label="t('admin.questions.enabled')"
            :description="t('admin.questions.enabledHelp')"
            @update:model-value="(value: boolean) => (draft.enabled = value)"
          />

          <div class="flex justify-end gap-2">
            <BaseButton variant="ghost" @click="cancel">
              {{ t("admin.paper.cancel") }}
            </BaseButton>
            <BaseButton :loading="saving" @click="save">
              {{ t("admin.questions.save") }}
            </BaseButton>
          </div>
        </div>
      </BaseCard>

      <EmptyState
        v-if="!questions.length"
        icon="documentText"
        :title="t('admin.questions.empty')"
      />

      <section v-for="group in grouped" :key="group.category" class="mb-8">
        <h2
          class="mb-3 text-xs font-semibold uppercase tracking-widest text-faint"
        >
          {{ group.category }}
        </h2>

        <ul class="space-y-2">
          <li
            v-for="question in group.items"
            :key="question.id"
            class="rounded-card border border-subtle bg-surface-raised px-4 py-3"
          >
            <div class="flex items-start justify-between gap-4">
              <div class="min-w-0 flex-1">
                <p class="text-sm font-medium text-ink">
                  {{ question.prompt }}
                </p>
                <ul class="mt-2 space-y-1">
                  <li
                    v-for="option in question.options"
                    :key="option.id"
                    class="flex items-start gap-2 text-xs"
                    :class="option.isCorrect ? 'text-success-fg' : 'text-muted'"
                  >
                    <Icon
                      v-if="option.isCorrect"
                      name="checkCircle"
                      class="mt-0.5 size-3.5 shrink-0"
                    />
                    <span v-else class="mt-0.5 size-3.5 shrink-0"></span>
                    {{ option.label }}
                  </li>
                </ul>
                <p v-if="question.explanation" class="mt-2 text-xs text-faint">
                  {{ question.explanation }}
                </p>
              </div>

              <div class="flex shrink-0 flex-col items-end gap-2">
                <BaseBadge v-if="question.status !== 1" variant="neutral">
                  {{ t("admin.questions.disabled") }}
                </BaseBadge>
                <div class="flex gap-1">
                  <BaseButton variant="ghost" size="sm" @click="edit(question)">
                    {{ t("admin.papers.edit") }}
                  </BaseButton>
                  <BaseButton
                    variant="ghost"
                    size="sm"
                    @click="remove(question)"
                  >
                    {{ t("admin.questions.delete") }}
                  </BaseButton>
                </div>
              </div>
            </div>
          </li>
        </ul>
      </section>
    </template>
  </div>
</template>
