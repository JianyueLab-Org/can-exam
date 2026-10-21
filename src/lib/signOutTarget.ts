/**
 * 退出之后去哪：要登录的页面（考场、题库）回主站首页，其余原地刷新。
 * 只决定退出后的落点，不决定谁能看哪一页 —— 那在 can-api。
 */
const SIGNED_IN_PREFIXES = ["/sit/", "/admin", "/results/"] as const;

export function signOutTarget(pathname: string): "reload" | "web" {
  const gated = SIGNED_IN_PREFIXES.some((prefix) =>
    prefix.endsWith("/")
      ? pathname.startsWith(prefix)
      : pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
  return gated ? "web" : "reload";
}
