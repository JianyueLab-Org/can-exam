<script setup lang="ts">
import { computed, useId } from "vue";
import Icon from "@/components/ui/Icon.vue";

interface Option {
  value: string | number;
  label: string;
}

const props = withDefaults(
  defineProps<{
    modelValue?: string | number;
    options: Option[];
    label?: string;
    name?: string;
    id?: string;
    required?: boolean;
    disabled?: boolean;
    placeholder?: string;
    /**
     * Helper text below the field; hidden while `error` is set.
     *
     * Same contract as BaseInput's, and it exists for a layout reason as much
     * as a tidiness one: without it a caller has to hang its own `<p>` beside
     * the component, and in a two-column grid that stray paragraph is what
     * makes the rows sit at different heights.
     */
    hint?: string;
    error?: string;
  }>(),
  {
    required: false,
    disabled: false,
  },
);

defineEmits<{ (e: "update:modelValue", value: string): void }>();

/**
 * 自己兜一个 id，而不是只认调用方传的。
 *
 * 之前是 `props.id ?? props.name`，两个都不传时就是 undefined —— 于是 `<label
 * for>` 指向空，点标签不会聚焦到下拉，读屏软件也念不出这个下拉叫什么。本仓库里
 * 每一处 BaseSelect 都没传这两个 prop，所以每一处都是这样。
 *
 * `useId()`（Vue 3.5+）在 SSR 和 hydration 之间是稳定的；随机 id 会让两边对不
 * 上，那是 BaseToggle 的注释里已经写过一次的坑。
 */
const generatedId = useId();
const selectId = computed(() => props.id ?? props.name ?? generatedId);
const noteId = computed(() => `${selectId.value}-note`);
</script>

<template>
  <div>
    <label
      v-if="label"
      :for="selectId"
      class="block text-sm font-medium text-ink"
    >
      {{ label }}
      <span v-if="required" class="text-danger-fg" aria-hidden="true">*</span>
    </label>
    <div :class="['relative', label ? 'mt-1.5' : '']">
      <select
        :id="selectId"
        :name="name"
        :value="modelValue"
        :required="required"
        :disabled="disabled"
        :aria-invalid="error ? 'true' : undefined"
        :aria-describedby="error || hint ? noteId : undefined"
        :class="[
          'input w-full cursor-pointer appearance-none pr-9',
          error ? 'border-danger-fg' : '',
          disabled ? 'cursor-not-allowed opacity-50' : '',
        ]"
        @change="
          $emit('update:modelValue', ($event.target as HTMLSelectElement).value)
        "
      >
        <option v-if="placeholder" value="" disabled>{{ placeholder }}</option>
        <option v-for="opt in options" :key="opt.value" :value="opt.value">
          {{ opt.label }}
        </option>
      </select>
      <Icon
        name="chevronUpDown"
        class="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-faint"
      />
    </div>
    <p
      v-if="error || hint"
      :id="noteId"
      class="mt-1 text-xs"
      :class="error ? 'text-danger-fg' : 'text-muted'"
    >
      {{ error || hint }}
    </p>
  </div>
</template>
