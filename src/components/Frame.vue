<script setup lang="ts">
/**
 * 外壳：can-ui `CanFrame`。考生那侧用 content 布局，`/admin` 用 tool 布局。
 *
 * 留在这里的：本站导航（管理入口只画给可能进得去的人）、登录地址、以及标签页
 * 重新可见时问一次 `/api/v1/session`。
 */
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import {
  CanFrame,
  originsFromEnv,
  type FrameUser,
} from "@jianyuelab-org/can-ui";
import { createTranslator } from "@/lib/i18n";
import type { Member } from "@/lib/member";
import { examNav, navPathname as toNavPathname } from "@/lib/nav";

const props = defineProps<{
  /** `frame` 命名空间。 */
  messages: Record<string, unknown>;
  locale: string;
  member: Member | null;
  pathname: string;
  /** 服务端用 `signInUrl()` 拼好。 */
  signInHref: string;
  layout: "content" | "tool";
  afterSignOut: "reload" | "web";
}>();

const t = createTranslator(props.messages);
const origins = originsFromEnv(import.meta.env);

const member = ref<Member | null>(props.member);

const user = computed<FrameUser | null>(() =>
  member.value
    ? {
        name: member.value.name,
        id: member.value.username,
        rating: member.value.rating,
      }
    : null,
);

const nav = computed(() => examNav(t, member.value));

const navPathname = computed(() => toNavPathname(props.pathname));

async function refreshSession() {
  if (member.value || document.visibilityState !== "visible") return;
  try {
    const response = await fetch("/api/v1/session");
    if (!response.ok) return;
    const body = (await response.json()) as { user: Member | null };
    if (body.user) member.value = body.user;
  } catch {
    // 问不到就当没登录。
  }
}

onMounted(() => document.addEventListener("visibilitychange", refreshSession));
onBeforeUnmount(() =>
  document.removeEventListener("visibilitychange", refreshSession),
);
</script>

<template>
  <CanFrame
    :layout="layout"
    current="exam"
    :locale="locale"
    :pathname="navPathname"
    :nav="nav"
    :user="user"
    notifications
    :sign-in-href="signInHref"
    :after-sign-out="afterSignOut"
    :messages="messages"
    :origins="origins"
  >
    <slot />
  </CanFrame>
</template>
