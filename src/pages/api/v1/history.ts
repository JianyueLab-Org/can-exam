import type { APIContext } from "astro";

import { LIMITS, clientIp, enforce } from "@/server/rateLimit";
import { callApi, relay } from "@/server/upstream";

/**
 * Relay the member's exam history.
 * Upstream projects safe question scores and verdicts from stored results.
 * Raw stored results and correct options are excluded.
 */
export const GET = async (context: APIContext) => {
  const limited = enforce([[`papers:ip:${clientIp(context)}`, LIMITS.papers]]);
  if (limited) return limited;

  return relay(await callApi(context, "/api/v1/pilot/exam"));
};
