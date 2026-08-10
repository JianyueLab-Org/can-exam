/**
 * 登录着的那个人。
 *
 * 放在 `lib/` 而不是 `server/`：服务端读会话和岛屿判断「这个人能不能看见管理
 * 入口」，用的是同一个形状。
 */

/** can-api 愿意告诉前端的那份成员身份（它的 `memberIdentity`）。 */
export interface Member {
  /** ASN ID。 */
  username: string;
  name: string;
  rating: number;
}

/**
 * 能进题库管理的最低 rating —— I1（教员）。
 *
 * 和 can-api 的 `store.RatingInstructor` 是同一个数字，抄在这里只为决定**要不
 * 要画出管理入口**。真正的门有两道，都在 can-api：路由上的 `WithSuper`，以及
 * 每个 handler 里按 division 判的 `exam.Authority`。把这个常数改成 0，只会让
 * 每个人都看到一个点进去就 403 的链接，改不动任何一行题目。
 *
 * 它曾经是 11（SUP）。放到 8 是这次改动本身：每个 division 的教员写自己
 * division 的题库，而不是全网两个人写所有卷子。
 */
export const MIN_ADMIN_RATING = 8;

/**
 * 这个人有没有可能进题库管理。
 *
 * 「有没有可能」是准确的措辞：rating 够了不代表真的能管到什么 —— 一个教员如果
 * 在任何 division 里都没有 active 的 instructor 行，上游会答 403，管理页显示
 * 一句「你不管理任何 division」。那个判断需要查库，只有 can-api 做得了。
 */
export function canManageBank(member: Member | null): boolean {
  return !!member && member.rating >= MIN_ADMIN_RATING;
}
