<script setup lang="ts">
import { Badge } from "@jianyuelab-org/can-ui";
import { createTranslator } from "@/lib/i18n";
import type { QuestionResult } from "@/lib/exams";
import {
  questionScore,
  questionVerdict,
  selectedAnswerState,
} from "@/lib/questionResults";

const props = defineProps<{
  messages: Record<string, unknown>;
  results: QuestionResult[];
}>();
const t = createTranslator(props.messages);
</script>

<template>
  <ol class="space-y-3">
    <li
      v-for="(result, index) in results"
      :key="result.questionId"
      class="rounded-control border border-subtle bg-surface-raised p-4"
    >
      <div class="flex flex-wrap items-center justify-between gap-2">
        <p class="text-xs font-semibold text-faint">
          {{ t("sit.question", { number: index + 1 }) }}
        </p>
        <div class="flex items-center gap-3">
          <span class="tnum text-xs text-muted">
            {{ t("review.score", { score: questionScore(result.score) }) }}
          </span>
          <Badge
            :variant="
              result.isRight
                ? 'success'
                : result.score > 0
                  ? 'warning'
                  : 'danger'
            "
          >
            {{ t(`review.${questionVerdict(result)}`) }}
          </Badge>
        </div>
      </div>
      <p class="mt-2 whitespace-pre-line break-words text-sm text-ink">
        {{ result.prompt || t("review.unavailablePrompt") }}
      </p>
      <div class="mt-4 border-t border-subtle pt-3">
        <p class="text-xs font-semibold text-muted">
          {{ t("review.yourAnswer") }}
        </p>
        <p
          v-if="selectedAnswerState(result.selectedAnswers) === 'unavailable'"
          class="mt-2 text-sm text-muted"
        >
          {{ t("review.unavailableAnswer") }}
        </p>
        <p
          v-else-if="
            selectedAnswerState(result.selectedAnswers) === 'unanswered'
          "
          class="mt-2 text-sm text-muted"
        >
          {{ t("review.unanswered") }}
        </p>
        <ul v-else class="mt-2 space-y-2">
          <li
            v-for="(answer, answerIndex) in result.selectedAnswers"
            :key="answerIndex"
            class="rounded-control bg-surface-sunken p-3"
          >
            <p class="whitespace-pre-line break-words text-sm text-ink">
              {{ answer.label }}
            </p>
            <img
              v-if="answer.imageUrl"
              :src="answer.imageUrl"
              :alt="answer.label"
              loading="lazy"
              class="mt-2 max-h-48 w-auto max-w-full rounded-control border border-subtle"
            />
          </li>
        </ul>
      </div>
    </li>
  </ol>
</template>
