/**
 * 分部管制规则的**索引副本**，只给 `/training/<分部>` 上的「本分部管制规则」卡片用。
 *
 * 规则本身在 can-controller（`controller.ceruleanavi.net/rules`），这里只存
 * 一份最小清单：哪个分部有规则、叫什么、什么语言。事实在 can-controller 的
 * `src/lib/atcRules.ts`，两边对不上时那边说了算。这里多写一行而那边没有对应的
 * MDX，点过去就是 404。
 *
 * Browser-safe: no astro:content import.
 */

import { siteUrl, originsFromEnv } from "@jianyuelab-org/can-ui";

export interface AtcRuleDoc {
  /** `division.region` the document governs — 1 PRC, 2 USA, 3 JPN, 4 HK. */
  region: number;
  /** can-controller 上 /rules 下的 URL 段，也是它 `rules` 集合里的 id。 */
  key: string;
  /** Title as written in the document's own language. */
  title: string;
  /**
   * BCP-47 tag of the document body, used for the `lang` attribute and to
   * label the language under `training.languages.<lang>`.
   */
  lang: string;
}

export const ATC_RULE_DOCS: AtcRuleDoc[] = [
  {
    region: 3,
    key: "jpn",
    title: "CAN JPN 管制規則（制定案）",
    lang: "ja",
  },
];

export function ruleHref(
  doc: AtcRuleDoc,
  origins?: ReturnType<typeof originsFromEnv>,
): string {
  return siteUrl("controller", `/rules/${doc.key}`, origins);
}
