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
 * 能编辑题库的最低 rating —— SUP。
 *
 * 和 can-api 的 `store.MinSupRating` 是同一个数字，抄在这里是为了决定**要不要
 * 画出管理入口**，仅此而已。真正的门在 can-api 的 `WithSup` 上：把这个常数改
 * 成 0 只会让每个人都看到一个点进去就 403 的链接，改不动任何一行题目。
 *
 * 这是 can-web 的 middleware 那条注释的同一条规矩：前端的判断是便利，不是边
 * 界。
 */
export const MIN_ADMIN_RATING = 11;

/** 这个人能不能进题库管理。 */
export function canManageBank(member: Member | null): boolean {
  return !!member && member.rating >= MIN_ADMIN_RATING;
}
