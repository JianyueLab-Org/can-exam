/**
 * 题库页被拒时，告诉人缺的是什么。
 *
 * 只在 can-api 已经答了 403 之后才调用：放不放行是上游判的，这里只挑说明文字。
 */
import type { NoAccessReason } from "@jianyuelab-org/can-ui";
import { RATING_INSTRUCTOR } from "@jianyuelab-org/can-ui/sites";
import type { Member } from "./member";

export function bankRefusal(
  member: Member,
  status: number,
  permission: string,
): NoAccessReason | null {
  if (status !== 403) return null;
  return member.rating < RATING_INSTRUCTOR
    ? { kind: "rating", required: RATING_INSTRUCTOR }
    : { kind: "permission", name: permission };
}
