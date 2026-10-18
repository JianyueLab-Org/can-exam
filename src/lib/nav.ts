import type { NavItem } from "@jianyuelab-org/can-ui";
import { canManageBank, type Member } from "@/lib/member";

/**
 * 本站导航：考试（页内分飞行员 / 管制员两栏）· 培训资料；题库管理只画给 I1 及以上。
 * 只决定画不画，门在 can-api。
 */
export function examNav(
  t: (key: string) => string,
  member: Member | null,
): NavItem[] {
  const items: NavItem[] = [
    { name: t("examCentre"), href: "/", icon: "academicCap" },
    { name: t("training"), href: "/training", icon: "bookOpen" },
  ];
  if (canManageBank(member)) {
    items.push({ name: t("admin"), href: "/admin", icon: "clipboardCheck" });
  }
  return items;
}

/** 考场页点亮「考试」；培训资料和题库按自己的路径点亮。 */
export function navPathname(pathname: string): string {
  return pathname.startsWith("/sit/") ? "/" : pathname;
}
