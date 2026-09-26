<script setup lang="ts">
/**
 * 页眉 —— can-ui `SiteHeader` 外面一层，只装这个站自己才知道的三件事。
 *
 * 从前这里是一整份页眉：没有手机抽屉、没有跳转链接、品牌是一张只有本站才有的
 * `/logo.png`。外形和行为现在来自 can-ui，和主站、开发者中心、雷达是同一份。
 * 留在这里的：
 *
 * - **登录链接指向主站，并带上回跳地址。** 这个站没有密码输入框，也不该有。跨
 *   站链接都必须带上 `siteOrigin` —— 写 `/signin` 会打在考试中心自己的域名上然
 *   后 404，而开发机上主站和本站都在 localhost，所以这一条在那里不会暴露。
 * - **会话是一份可变的副本。** 人在另一个标签页登录完切回来，这一页还是十分钟
 *   前那份 HTML，于是标签页重新可见时问一次 `/api/v1/session`。
 * - **退出登录打的是本站的 `/api/v1/signout`。** Astro 的模板上挂不了 Vue 的事
 *   件监听器，`@signout` 只能在一个 Vue 组件里接。
 */
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { SiteHeader, type NavChild } from "@jianyuelab-org/can-ui";
import { createTranslator } from "@/lib/i18n";
import { canManageBank, type Member } from "@/lib/member";

const props = defineProps<{
  messages: Record<string, unknown>;
  locale: string;
  member: Member | null;
  /** 当前路径，决定哪一项亮。 */
  pathname: string;
  siteOrigin: string;
}>();

const t = createTranslator(props.messages);

const member = ref<Member | null>(props.member);

const signInHref = computed(() => {
  const here = typeof window === "undefined" ? "" : window.location.href;
  return `${props.siteOrigin}/signin?callbackUrl=${encodeURIComponent(here)}`;
});

const nav = computed<NavChild[]>(() => {
  const items: NavChild[] = [{ name: t("examCentre"), href: "/" }];
  // 这个判断只决定**画不画**这个链接。真正的门在 can-api 的 WithSup 上，见
  // lib/member.ts。
  if (canManageBank(member.value)) {
    items.push({ name: t("admin"), href: "/admin" });
  }
  return items;
});

const labels = computed(() => ({
  skip: t("skipToContent"),
  menu: t("openMenu"),
  close: t("closeMenu"),
  signIn: t("signIn"),
  signOut: t("signOut"),
}));

/**
 * 标签页重新获得焦点、而且这一页还认为你没登录时，问一次「我现在是谁」。
 *
 * 只在没登录时问，是因为反过来的情况（这一页以为你登录着、其实会话已经过期）
 * 会在下一次真正的调用上以 401 的形式出现，而那时页面本来就要处理它。
 */
async function refreshSession() {
  if (member.value || document.visibilityState !== "visible") return;
  try {
    const response = await fetch("/api/v1/session");
    if (!response.ok) return;
    const body = (await response.json()) as { user: Member | null };
    if (body.user) member.value = body.user;
  } catch {
    // 问不到就当没登录，和服务端那一侧同一个态度。
  }
}

async function signOut() {
  try {
    await fetch("/api/v1/signout", { method: "POST" });
  } finally {
    // 无条件回首页刷新一次：登出之后这一页上的每一样东西都不再属于任何人。
    window.location.href = "/";
  }
}

onMounted(() => document.addEventListener("visibilitychange", refreshSession));
onBeforeUnmount(() =>
  document.removeEventListener("visibilitychange", refreshSession),
);
</script>

<template>
  <SiteHeader
    current="exam"
    :locale="locale"
    :pathname="pathname"
    :nav="nav"
    :signed-in="!!member"
    :rating="member?.rating"
    :sign-in-href="signInHref"
    :labels="labels"
    @signout="signOut"
  >
    <template v-if="member" #account>
      <span class="hidden text-sm text-muted md:inline">
        {{ member.name }}
        <span class="tnum text-faint">({{ member.username }})</span>
      </span>
      <button
        type="button"
        class="focus-ring rounded-control px-3 py-1.5 text-sm text-muted transition-colors hover:bg-surface-sunken hover:text-ink"
        @click="signOut"
      >
        {{ t("signOut") }}
      </button>
    </template>
  </SiteHeader>
</template>
