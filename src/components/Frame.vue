<script setup lang="ts">
/**
 * 外壳：can-ui `CanFrame` 的 content 布局。
 *
 * 留在这里的：本站导航（管理入口只画给可能进得去的人）、登录地址、以及标签页
 * 重新可见时问一次 `/api/v1/session`。
 */
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import {
  CanFrame,
  originsFromEnv,
  type FrameUser,
  type NavItem,
} from "@jianyuelab-org/can-ui";
import { createTranslator } from "@/lib/i18n";
import { canManageBank, type Member } from "@/lib/member";

const props = defineProps<{
  /** `frame` 命名空间。 */
  messages: Record<string, unknown>;
  locale: string;
  member: Member | null;
  pathname: string;
  /** 服务端用 `signInUrl()` 拼好。 */
  signInHref: string;
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

const nav = computed<NavItem[]>(() => {
  const items: NavItem[] = [
    { name: t("examCentre"), href: "/", icon: "academicCap" },
  ];
  // 只决定画不画。门在 can-api。
  if (canManageBank(member.value)) {
    items.push({ name: t("admin"), href: "/admin", icon: "clipboardCheck" });
  }
  return items;
});

/** `/admin` 之外的每一页都点亮「考试」。 */
const navPathname = computed(() =>
  props.pathname.startsWith("/admin") ? props.pathname : "/",
);

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
    layout="content"
    current="exam"
    :locale="locale"
    :pathname="navPathname"
    :nav="nav"
    :user="user"
    :sign-in-href="signInHref"
    after-sign-out="reload"
    :messages="messages"
    :origins="origins"
  >
    <slot />
  </CanFrame>
</template>
