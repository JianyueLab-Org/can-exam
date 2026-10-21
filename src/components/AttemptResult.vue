<script setup lang="ts">
import { Card, Icon } from "@jianyuelab-org/can-ui";
import { createTranslator } from "@/lib/i18n";
import type { AttemptResult, ExamScope } from "@/lib/exams";
import { doneHref } from "@/lib/examCentre";
import { questionScore } from "@/lib/questionResults";
import QuestionResults from "./QuestionResults.vue";

const props = defineProps<{
  messages: Record<string, unknown>;
  result: AttemptResult | null;
  scope: ExamScope;
  locale: string;
}>();
const t = createTranslator(props.messages);
</script>

<template>
  <div>
    <a
      :href="doneHref(scope)"
      class="mb-6 inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink"
    >
      <Icon name="arrowLeft" class="size-4" />
      {{ t("sit.back") }}
    </a>
    <Card v-if="result" padding="lg">
      <div class="text-center">
        <h1 class="text-xl font-semibold text-ink">
          {{
            result.passed === null
              ? t("results.title")
              : result.passed
                ? t("sit.result.passed")
                : t("sit.result.failed")
          }}
        </h1>
        <p class="tnum mt-3 text-3xl font-bold text-ink">
          {{ t("sit.result.percent", { percent: result.score }) }}
        </p>
        <p
          v-if="result.earnedScore != null && result.totalQuestions != null"
          class="tnum mt-2 text-sm text-muted"
        >
          {{
            t("results.earnedScore", {
              score: questionScore(result.earnedScore),
              total: result.totalQuestions,
            })
          }}
        </p>
        <p v-if="result.passMark != null" class="mt-2 text-sm text-muted">
          {{ t("sit.result.passMark", { mark: result.passMark }) }}
        </p>
        <p class="mt-3 text-sm text-muted">
          {{ t("results.submittedAt") }}
          <time :datetime="result.createdAt">{{
            new Date(result.createdAt).toLocaleString(locale)
          }}</time>
        </p>
      </div>
    </Card>
    <Card v-else padding="lg">
      <h1 class="text-xl font-semibold text-ink">{{ t("results.title") }}</h1>
      <p class="mt-3 text-sm text-muted">{{ t("results.unavailable") }}</p>
    </Card>
    <section v-if="result" class="mt-6">
      <h2 class="mb-3 text-lg font-semibold text-ink">
        {{ t("review.title") }}
      </h2>
      <QuestionResults
        v-if="result.questionResults?.length"
        :messages="messages"
        :results="result.questionResults"
      />
      <Card v-else padding="lg"
        ><p class="text-sm text-muted">{{ t("results.noDetails") }}</p></Card
      >
    </section>
  </div>
</template>
