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
 * 按**分部**分组，不是按分栏。
 *
 * 分部是这一页真正的组织轴：它决定谁能改哪份卷子，而这份清单本身就是上游按分部
 * 过滤过的。按它分组，section 的标题恰好就是「你管得着的这一片」。分栏（飞行员
 * / 管制员）留在卡片上做徽章 —— 那是给考生分的，考试中心首页已经按它分栏了。
 *
 * 「全网」永远排在最前：它只有 SUP/ADM 能碰，而对他们来说那一组是最要紧的。其
 * 余按 region 编码排，顺序稳定。
 */
const sections = computed(() => {
  const groups = new Map<number, AdminPaper[]>();
  for (const paper of papers.value) {
    groups.set(paper.region, [...(groups.get(paper.region) ?? []), paper]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a - b)
    .map(([region, items]) => ({
      region,
      label: t(`region.${regionKey(region)}`),
      papers: items.sort((a, b) => a.id - b.id),
    }));
});

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

/**
 * 删一份卷子要过一个真的确认框，而不是 `window.confirm`。
 *
 * 它比删一道题重得多：卷子没了，它下面所有题目和选项跟着没，正在作答的卷子也一
 * 起清掉（成绩会留着 —— 一场考试下线不该抹掉当初有人通过了它）。而
 * `window.confirm` 用不上本站的语言和样式，也写不下这句话。
 */
const deleting = ref<AdminPaper | null>(null);
const removing = ref(false);

async function confirmDelete() {
  const paper = deleting.value;
  if (!paper) return;

  removing.value = true;
  error.value = null;
  try {
    await api(`/api/v1/admin/papers/${paper.id}`, { method: "DELETE" });
    papers.value = papers.value.filter((item) => item.id !== paper.id);
    deleting.value = null;
  } catch (err) {
    error.value = describe(err);
  } finally {
    removing.value = false;
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

      <!-- 一份卷子一张卡，按分部分组。列数跟着宽度走：窄屏一列，sm 起两列，
           lg 三列，2xl 四列 —— 再多列每张就窄到标题要折三行了。 -->
      <section
        v-for="section in sections"
        :key="section.region"
        class="mb-8 last:mb-0"
      >
        <div class="mb-3 flex items-baseline gap-2">
          <h2
            class="text-xs font-semibold uppercase tracking-widest text-faint"
          >
            {{ section.label }}
          </h2>
          <span class="tnum text-xs text-faint">{{
            section.papers.length
          }}</span>
        </div>

        <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          <BaseCard
            v-for="paper in section.papers"
            :key="paper.id"
            padding="md"
          >
            <!-- 卡片是一个纵向的三段式：头部标识、中间数据、底部操作。用
                 flex-col + flex-1 让中段撑开，同一行里高矮不齐的卡片底部按钮
                 仍然对齐 —— 网格里这一点比在列表里明显得多。 -->
            <div class="flex h-full flex-col">
              <div class="flex flex-wrap items-center gap-1.5">
                <BaseBadge
                  :variant="paper.status === 1 ? 'success' : 'neutral'"
                  size="sm"
                >
                  {{
                    paper.status === 1
                      ? t("admin.papers.published")
                      : t("admin.papers.draft")
                  }}
                </BaseBadge>
                <!-- 分部已经是 section 的标题了，卡片上换成分栏（飞行员/管制
                     员）—— 那是这里唯一还看不出来的维度。 -->
                <BaseBadge variant="info" size="sm">
                  {{
                    paper.scope === "controllers"
                      ? t("home.controllers")
                      : t("home.pilots")
                  }}
                </BaseBadge>
              </div>

              <h3 class="mt-2 line-clamp-2 text-sm font-semibold text-ink">
                {{ paper.title }}
              </h3>
              <code class="mt-1 block truncate text-xs text-faint">
                /sit/{{ paper.slug }}
              </code>

              <dl class="mt-3 space-y-1 text-xs text-muted">
                <div class="flex justify-between gap-2">
                  <dt>{{ t("admin.papers.bank") }}</dt>
                  <dd class="tnum text-ink">{{ paper.questionCount }}</dd>
                </div>
                <div class="flex justify-between gap-2">
                  <dt>{{ t("admin.papers.draw") }}</dt>
                  <dd class="tnum text-ink">
                    {{ paper.drawCount || t("admin.papers.drawAll") }}
                  </dd>
                </div>
                <div class="flex justify-between gap-2">
                  <dt>{{ t("admin.papers.passMark") }}</dt>
                  <dd class="tnum text-ink">{{ paper.passMark }}%</dd>
                </div>
                <div
                  v-if="paper.promoteTo !== null"
                  class="flex justify-between gap-2"
                >
                  <dt>{{ t("admin.paper.promoteTo") }}</dt>
                  <dd class="text-airwaysn">
                    {{ ratingName(paper.promoteTo) }}
                  </dd>
                </div>
              </dl>

              <p
                v-if="paper.drawCount > paper.questionCount"
                class="mt-2 flex items-start gap-1 text-xs text-warning-fg"
              >
                <Icon
                  name="exclamationTriangle"
                  class="mt-0.5 size-3.5 shrink-0"
                />
                {{
                  t("admin.papers.shortBank", { count: paper.questionCount })
                }}
              </p>

              <!-- mt-auto 把这一条压到卡片底部，不管上面有多少行。 -->
              <div
                class="mt-auto flex items-center gap-1 border-t border-subtle pt-3"
              >
                <BaseButton
                  as="a"
                  :href="`/admin/${paper.id}`"
                  variant="secondary"
                  size="sm"
                  class="flex-1"
                >
                  {{ t("admin.papers.manage") }}
                </BaseButton>
                <BaseButton
                  variant="ghost"
                  size="sm"
                  icon-only
                  :title="t('admin.papers.edit')"
                  @click="open(paper)"
                >
                  <template #icon>
                    <Icon name="pencilSquare" class="size-4" />
                  </template>
                </BaseButton>
                <BaseButton
                  variant="ghost"
                  size="sm"
                  icon-only
                  :title="t('admin.papers.delete')"
                  @click="deleting = paper"
                >
                  <template #icon
                    ><Icon name="xMark" class="size-4"
                  /></template>
                </BaseButton>
              </div>
            </div>
          </BaseCard>
        </div>
      </section>
    </template>

    <BaseDialog
      v-model:open="editing"
      :title="draft.id ? t('admin.paper.titleEdit') : t('admin.paper.titleNew')"
      :close-label="t('admin.paper.cancel')"
      size="lg"
    >
      <!-- 十二个字段一列排下来，人得读完才知道哪几个是一组的。切成四节之后，
           「这份卷子叫什么」「谁能改、谁能考」「怎么抽怎么判」「发不发」各自成
           块，找一个设置不用从头看。 -->
      <div class="space-y-7">
        <section class="space-y-4">
          <h3
            class="text-xs font-semibold uppercase tracking-widest text-faint"
          >
            {{ t("admin.paper.sectionBasics") }}
          </h3>

          <BaseInput
            v-model="draft.title"
            :label="t('admin.paper.name')"
            required
          />
          <div class="grid gap-4 sm:grid-cols-2">
            <BaseInput
              v-model="draft.slug"
              :label="t('admin.paper.slug')"
              :hint="t('admin.paper.slugHelp')"
              required
            />
            <BaseSelect
              :model-value="draft.scope"
              :label="t('admin.paper.scope')"
              :options="scopeOptions"
              :hint="t('admin.paper.scopeHelp')"
              @update:model-value="
                (value: string) => (draft.scope = value as ExamScope)
              "
            />
          </div>
          <BaseInput
            v-model="draft.description"
            :label="t('admin.paper.description')"
            :hint="t('admin.paper.descriptionHelp')"
          />
        </section>

        <section class="space-y-4">
          <h3
            class="text-xs font-semibold uppercase tracking-widest text-faint"
          >
            {{ t("admin.paper.sectionAccess") }}
          </h3>

          <!-- 每个字段的说明都由控件自己渲染（BaseSelect 现在有 hint 了）。
               之前 division 的说明是挂在控件外面的一个 <p>，于是这一格比隔壁高
               出两行，两列就错开了。 -->
          <div class="grid gap-4 sm:grid-cols-2">
            <BaseSelect
              :model-value="String(draft.region)"
              :label="t('admin.paper.division')"
              :options="regionOptions"
              :hint="t('admin.paper.divisionHelp')"
              @update:model-value="
                (value: string | number) => (draft.region = Number(value))
              "
            />
            <BaseSelect
              :model-value="
                draft.promoteTo === null ? '' : String(draft.promoteTo)
              "
              :label="t('admin.paper.promoteTo')"
              :options="promoteOptions"
              :hint="t('admin.paper.promoteHelp')"
              @update:model-value="setPromoteTo"
            />
          </div>

          <fieldset>
            <div class="flex flex-wrap items-baseline justify-between gap-2">
              <legend class="text-sm font-medium text-ink">
                {{ t("admin.paper.eligibleRatings") }}
              </legend>
              <button
                v-if="(draft.eligibleRatings ?? []).length"
                type="button"
                class="link text-xs"
                @click="draft.eligibleRatings = []"
              >
                {{ t("admin.paper.eligibleClear") }}
              </button>
            </div>

            <!-- 一排全未选中的描边药丸看不出是可点的，所以把当前状态用一句话说
                 出来：留空时明说「任何成员都能考」，选了就把选中的列出来。 -->
            <p class="mt-0.5 text-xs text-muted">
              {{
                (draft.eligibleRatings ?? []).length
                  ? t("admin.paper.eligibleSome", {
                      ratings: (draft.eligibleRatings ?? [])
                        .map((id) => ratingName(id))
                        .join(" / "),
                    })
                  : t("admin.paper.eligibleHelp")
              }}
            </p>

            <div class="mt-2 flex flex-wrap gap-1.5">
              <label
                v-for="rating in allRatings()"
                :key="rating.id"
                :class="[
                  'flex cursor-pointer items-center gap-1 rounded-control border px-2.5 py-1 text-xs transition-colors',
                  (draft.eligibleRatings ?? []).includes(rating.id)
                    ? 'border-airwaysn bg-info-bg font-medium text-ink'
                    : 'border-subtle text-muted hover:border-strong hover:bg-surface-sunken hover:text-ink',
                ]"
              >
                <input
                  type="checkbox"
                  class="sr-only"
                  :checked="(draft.eligibleRatings ?? []).includes(rating.id)"
                  @change="toggleRating(rating.id)"
                />
                <Icon
                  v-if="(draft.eligibleRatings ?? []).includes(rating.id)"
                  name="checkCircle"
                  class="size-3.5"
                />
                {{ rating.name }}
              </label>
            </div>
          </fieldset>
        </section>

        <section class="space-y-4">
          <h3
            class="text-xs font-semibold uppercase tracking-widest text-faint"
          >
            {{ t("admin.paper.sectionDrawing") }}
          </h3>

          <!-- 三个数字字段都走 :model-value + 显式 Number()，而不是 v-model：
               BaseInput 发出来的永远是 string，v-model 到一个 number 上会把
               draft 里的类型悄悄换掉，然后 `drawCount: 0` 和 `drawCount: "0"`
               在别处表现得不一样。 -->
          <div class="grid gap-4 sm:grid-cols-3">
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
              :hint="t('admin.paper.passMarkHelp')"
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
        </section>

        <!-- 开关自己是 justify-between 的，在这么宽的对话框里 label 和滑块会被
             甩到两头、读起来像两件事。装进一个框里它们才是一个控件。 -->
        <section class="rounded-card border border-subtle p-4">
          <BaseToggle
            :model-value="draft.status === 1"
            :label="t('admin.paper.publish')"
            :description="t('admin.paper.publishHelp')"
            @update:model-value="
              (value: boolean) => (draft.status = value ? 1 : 0)
            "
          />
        </section>
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

    <!-- 删一份卷子比删一道题重得多：题目、选项、正在作答的卷子都跟着走（成绩
         留着 —— 一场考试下线不该抹掉当初有人通过了它）。值得一个能把卷子名字
         写出来的框。 -->
    <BaseDialog
      :open="!!deleting"
      :title="t('admin.papers.deleteTitle')"
      :close-label="t('admin.paper.cancel')"
      size="sm"
      @update:open="
        (open: boolean) => {
          if (!open) deleting = null;
        }
      "
    >
      <p v-if="deleting" class="text-sm text-muted">
        {{ t("admin.papers.deleteConfirm", { title: deleting.title }) }}
      </p>
      <p
        v-if="deleting && deleting.questionCount"
        class="mt-2 text-sm text-warning-fg"
      >
        {{
          t("admin.papers.deleteQuestions", { count: deleting.questionCount })
        }}
      </p>
      <template #footer>
        <BaseButton variant="ghost" @click="deleting = null">
          {{ t("admin.paper.cancel") }}
        </BaseButton>
        <BaseButton variant="danger" :loading="removing" @click="confirmDelete">
          {{ t("admin.papers.delete") }}
        </BaseButton>
      </template>
    </BaseDialog>
  </div>
</template>
