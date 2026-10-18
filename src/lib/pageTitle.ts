import { siteLabel } from "@jianyuelab-org/can-ui/sites";

/**
 * 页面标题：`<页面> · <站名>`。站名取 can-ui 的 `siteLabel(locale, "exam").name`。
 * 首页不带页面名，只有站名。
 */
export function pageTitle(page: string | undefined, locale: string): string {
  const site = siteLabel(locale, "exam").name;
  return page ? `${page} · ${site}` : site;
}
