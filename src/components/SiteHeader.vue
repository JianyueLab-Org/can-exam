<script setup lang="ts">
/**
 * 页眉。三个去处、一个主题/语言开关、一格身份。
 *
 * 两件事值得先读：
 *
 * **每个跨站链接都必须带上 `siteOrigin`。** 这里是 exam.ceruleanavi.net，写
 * `href="/roster"` 会打在考试中心自己的域名上然后 404。这条坑 can-radar 的
 * CLAUDE.md 专门列成了一条，因为它在开发机上不会暴露 —— 开发机上主站和这个站
 * 都在 localhost。
 *
 * **「登录」是一个链接，不是一个表单。** 这个站点没有密码输入框，也不该有：
 * 登录入口只有主站一个。回跳地址带上本页，人登录完就回到他原本在的地方。
 */
import { computed, onBeforeUnmount, onMounted, ref } from "vue";

import { Button, Icon, ThemeLangControls } from "@jianyuelab-org/can-ui";
import { createTranslator } from "@/lib/i18n";
import { canManageBank, type Member } from "@/lib/member";

const props = defineProps<{
  messages: Record<string, unknown>;
  locale: string;
  member: Member | null;
  active: "exams" | "admin";
  siteOrigin: string;
  /** 跟着 BaseLayout 的容器宽度走，否则页眉和正文左右对不齐。 */
  wide?: boolean;
}>();

const t = createTranslator(props.messages);

/**
 * 会话是 prop 传进来的，但它可以在这一页活着的时候**变**：人在另一个标签页登
 * 录完再切回来，这一页还是十分钟前那份 HTML。所以本地保留一份可变的副本。
 */
const member = ref<Member | null>(props.member);

const signInHref = computed(() => {
  const here = typeof window === "undefined" ? "" : window.location.href;
  return `${props.siteOrigin}/signin?callbackUrl=${encodeURIComponent(here)}`;
});

type NavKey = "exams" | "admin";

const nav = computed(() => {
  const items: { key: NavKey; name: string; href: string }[] = [
    { key: "exams", name: t("examCentre"), href: "/" },
  ];
  // 这个判断只决定**画不画**这个链接。真正的门在 can-api 的 WithSup 上，见
  // lib/member.ts。
  if (canManageBank(member.value)) {
    items.push({ key: "admin", name: t("admin"), href: "/admin" });
  }
  return items;
});

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
  <header class="border-b border-subtle bg-chrome">
    <div
      :class="[
        'mx-auto flex items-center gap-4 px-4 py-3 sm:px-6 lg:px-8',
        wide ? 'max-w-7xl' : 'max-w-5xl',
      ]"
    >
      <a href="/" class="flex items-center gap-2.5">
        <img src="/logo.png" alt="" class="size-7" />
        <span class="flex flex-col leading-tight">
          <span class="text-sm font-semibold text-ink">{{ t("title") }}</span>
          <span class="hidden text-[11px] text-faint sm:block">
            {{ t("subtitle") }}
          </span>
        </span>
      </a>

      <nav class="ml-2 flex items-center gap-1">
        <a
          v-for="item in nav"
          :key="item.key"
          :href="item.href"
          :class="[
            'rounded-control px-3 py-1.5 text-sm transition-colors',
            active === item.key
              ? 'bg-surface-sunken font-medium text-ink'
              : 'text-muted hover:bg-surface-sunken hover:text-ink',
          ]"
          :aria-current="active === item.key ? 'page' : undefined"
        >
          {{ item.name }}
        </a>
      </nav>

      <div class="ml-auto flex items-center gap-2">
        <a
          :href="siteOrigin"
          class="hidden items-center gap-1.5 rounded-control px-3 py-1.5 text-sm text-muted transition-colors hover:bg-surface-sunken hover:text-ink sm:flex"
        >
          <Icon name="arrowTopRight" class="size-4" />
          {{ t("mainSite") }}
        </a>

        <ThemeLangControls :locale="locale" />

        <template v-if="member">
          <span class="hidden text-sm text-muted md:inline">
            {{ member.name }}
            <span class="tnum text-faint">({{ member.username }})</span>
          </span>
          <button
            type="button"
            class="rounded-control px-3 py-1.5 text-sm text-muted transition-colors hover:bg-surface-sunken hover:text-ink"
            @click="signOut"
          >
            {{ t("signOut") }}
          </button>
        </template>
        <BaseButton v-else as="a" :href="signInHref" size="sm">
          {{ t("signIn") }}
        </BaseButton>
      </div>
    </div>
  </header>
</template>
