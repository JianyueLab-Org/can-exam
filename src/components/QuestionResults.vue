<script setup lang="ts">
import { Badge } from "@jianyuelab-org/can-ui";
import { createTranslator } from "@/lib/i18n";
import type { QuestionResult } from "@/lib/exams";
import { questionScore, questionVerdict } from "@/lib/questionResults";

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
    </li>
  </ol>
</template>
