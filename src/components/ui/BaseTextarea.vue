<script setup lang="ts">
/**
 * 多行输入。`BaseInput` 的同胞，API 刻意一致（label / hint / error / required）。
 *
 * 存在的理由很朴素：题面是多行的。之前题面和解析都用 `BaseInput`，也就是一个
 * 单行 `<input>` —— 一道两行的中文题写进去只能看见结尾那半句，光标一动就丢失
 * 上下文。这不是审美问题，是写不了题。
 *
 * 样式挂在 `globals.css` 的 `textarea.input` 上，不自带一套 —— 那条规则本来就
 * 是为这种手写 textarea 准备的（can-web 里有三处），这里只是把它包成组件，免
 * 得第四处、第五处又各写一遍焦点环和圆角。
 *
 * `autoGrow` 默认开着：一个固定四行的框，写长题时要在里面滚动，而写短题时又空
 * 着一半。跟着内容长就都合适了。
 */
import { nextTick, onMounted, ref, useId, watch } from "vue";

const props = withDefaults(
  defineProps<{
    modelValue?: string;
    label?: string;
    placeholder?: string;
    id?: string;
    required?: boolean;
    disabled?: boolean;
    error?: string;
    /** 提示文字，`error` 出现时让位。 */
    hint?: string;
    /** 最少显示几行。 */
    rows?: number;
    /** 长到多少行就不再长了，之后内部滚动。 */
    maxRows?: number;
    autoGrow?: boolean;
  }>(),
  { rows: 3, maxRows: 16, required: false, disabled: false, autoGrow: true },
);

const emit = defineEmits<{ (e: "update:modelValue", value: string): void }>();

const generatedId = useId();
const fieldId = props.id ?? generatedId;
const el = ref<HTMLTextAreaElement | null>(null);

/**
 * 高度跟着内容走。
 *
 * 先把 height 清成 auto 再读 scrollHeight —— 不清的话读到的是**当前**高度，框
 * 只会变高不会变矮，删掉几行之后底下留一片空白。
 */
function resize() {
  const node = el.value;
  if (!node || !props.autoGrow) return;

  node.style.height = "auto";
  const line = parseFloat(getComputedStyle(node).lineHeight) || 20;
  const max = line * props.maxRows;
  node.style.height = `${Math.min(node.scrollHeight, max)}px`;
  node.style.overflowY = node.scrollHeight > max ? "auto" : "hidden";
}

function onInput(event: Event) {
  emit("update:modelValue", (event.target as HTMLTextAreaElement).value);
  resize();
}

// 外部改值（切到另一道题去编辑）也要重算，否则新内容套着旧高度。
watch(
  () => props.modelValue,
  () => nextTick(resize),
);
onMounted(resize);
</script>

<template>
  <div>
    <label
      v-if="label"
      :for="fieldId"
      class="mb-1.5 block text-sm font-medium text-ink"
    >
      {{ label }}
      <span v-if="required" class="text-danger-fg" aria-hidden="true">*</span>
    </label>

    <textarea
      :id="fieldId"
      ref="el"
      class="input w-full resize-none"
      :class="error ? 'border-danger-fg' : ''"
      :value="modelValue"
      :rows="rows"
      :placeholder="placeholder"
      :required="required"
      :disabled="disabled"
      :aria-invalid="error ? 'true' : undefined"
      :aria-describedby="error || hint ? `${fieldId}-note` : undefined"
      @input="onInput"
    ></textarea>

    <p
      v-if="error || hint"
      :id="`${fieldId}-note`"
      class="mt-1 text-xs"
      :class="error ? 'text-danger-fg' : 'text-muted'"
    >
      {{ error || hint }}
    </p>
  </div>
</template>
