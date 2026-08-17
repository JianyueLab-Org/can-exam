<script setup lang="ts">
/**
 * 一个配图位：选文件、上传、预览、移除。
 *
 * 题干用一个，每个选项各用一个，所以它是组件而不是写在编辑器里的一段 markup。
 *
 * ## 上传和保存是两步，这是有意的
 *
 * 选完文件立刻上传，拿回一个 cdn.ceruleanavi.net 的地址，**但那时候题还没保存**。
 * 于是有两种「白花的」情况：上传完不点保存，或者上传完把图换掉。两种都会在桶里
 * 留一个没人引用的对象。
 *
 * 那是故意选的一头。另一头是「保存的时候才上传」—— 那意味着这个组件要一直攥着
 * 一个 File 对象、编辑器的保存要变成两段式、而中间任何一步失败都会让人对着一个
 * 保存了一半的表单。一个孤儿对象几十 KB，上游也从不删除任何对象（正在作答的卷
 * 子可能还引着它），所以这笔交易是划算的。
 *
 * ## 为什么不预览成 data: URL
 *
 * 上传成功之后预览的就是**真实的那个 URL**，不是本地的 blob。这样「图传上去了
 * 但 CDN 域名配错了」当场就看得见，而不是等考生打开卷子才发现一片裂图。
 */
import { ref } from "vue";

import { Button, Icon } from "@jianyuelab-org/can-ui";

const props = withDefaults(
  defineProps<{
    /** 当前的图片地址，空表示没有。 */
    modelValue: string;
    /** 上传按钮上的字。 */
    label: string;
    /** 移除按钮的无障碍名字。 */
    removeLabel: string;
    /** 「上传中…」。 */
    uploadingLabel: string;
    /** 预览图的 alt。 */
    alt: string;
    /** 一句能翻译的兜底错误，上游没给 message 时用。 */
    fallbackError: string;
    /** 小一号：选项行里用，题干下面不用。 */
    compact?: boolean;
  }>(),
  { compact: false },
);

const emit = defineEmits<{
  "update:modelValue": [string];
  /** 上传失败时把话递给编辑器去显示，这个组件自己不画整块的错误框。 */
  error: [string];
}>();

const input = ref<HTMLInputElement | null>(null);
const uploading = ref(false);

function choose() {
  input.value?.click();
}

async function upload(event: Event) {
  const target = event.target as HTMLInputElement;
  const file = target.files?.[0];
  // 无论成败都把 input 清空：不清的话，删掉图之后再选**同一个文件**不会触发
  // change 事件，看起来就像按钮坏了。
  target.value = "";
  if (!file) return;

  uploading.value = true;
  try {
    // body 就是文件本身，不是 multipart。只有一个字段，包一层 multipart 等于多
    // 一个边界要拼对，换不来任何东西。
    const response = await fetch("/api/v1/admin/images", {
      method: "POST",
      headers: { "Content-Type": file.type || "application/octet-stream" },
      body: file,
    });

    let payload: unknown = null;
    try {
      payload = await response.json();
    } catch {
      // 空体或者非 JSON —— 下面按状态码处理。
    }

    if (!response.ok) {
      const body = (payload ?? {}) as { message?: string };
      emit("error", body.message || props.fallbackError);
      return;
    }

    const data = (payload as { data?: { url?: string }; url?: string }) ?? {};
    const url = data.data?.url ?? data.url;
    if (!url) {
      emit("error", props.fallbackError);
      return;
    }
    emit("update:modelValue", url);
  } catch {
    emit("error", props.fallbackError);
  } finally {
    uploading.value = false;
  }
}
</script>

<template>
  <div>
    <!-- accept 只是给文件选择器一个默认筛选，不是校验：真正认不认在上游，它 sniff
         字节而不是看扩展名。这里写上只是为了不让人从一堆文件里挑出一个注定被拒
         的 PDF。 -->
    <input
      ref="input"
      type="file"
      class="hidden"
      accept="image/png,image/jpeg,image/gif,image/webp"
      @change="upload"
    />

    <div v-if="modelValue" class="flex items-start gap-2">
      <img
        :src="modelValue"
        :alt="alt"
        :class="[
          'rounded-control border border-subtle object-contain',
          compact ? 'max-h-16 max-w-24' : 'max-h-40 max-w-full',
        ]"
      />
      <button
        type="button"
        class="rounded-control p-1.5 text-faint hover:bg-surface-sunken hover:text-ink"
        :aria-label="removeLabel"
        :title="removeLabel"
        @click="emit('update:modelValue', '')"
      >
        <Icon name="xMark" class="size-4" />
      </button>
    </div>

    <Button
      v-else
      variant="ghost"
      :size="compact ? 'sm' : 'sm'"
      :loading="uploading"
      @click="choose"
    >
      <template #icon><Icon name="photo" class="size-4" /></template>
      {{ uploading ? uploadingLabel : label }}
    </Button>
  </div>
</template>
