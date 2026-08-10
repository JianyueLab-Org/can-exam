import type { APIContext } from "astro";

/**
 * In-process fixed-window rate limiting.
 *
 * Deliberately kept to a plain `Map` rather than Redis: the app is deployed
 * as a single standalone Node process, so one shared map is the whole story.
 * If it is ever scaled to more than one replica each replica gets its own
 * counters and the effective limits multiply by the replica count — swap the
 * three primitives below for a shared store at that point, not the call
 * sites, which is why they are the only thing this module exports.
 */

export type RateLimitRule = { limit: number; windowMs: number };

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

/**
 * Every limit in the app, in one place.
 *
 * The email-sending flows are limited twice: once per client IP, and once
 * per target address. The per-address limit is the one that matters — it
 * stops a spammer rotating IPs to flood one member's inbox, and it caps how
 * much mail a stranger can cause to be sent in someone else's name.
 */
export const LIMITS = {
  /** 「我现在是谁」。按 IP 计。
   *
   *  首屏不走这条路（会话是服务端读好传进岛屿的），它只在标签页重新获得焦点、
   *  而且这一页还认为你没登录的时候问一次 —— 也就是「刚在另一个标签页登录完」
   *  那一刻。 */
  session: { limit: 240, windowMs: HOUR },
  /** 登出。按 IP 计。一个人一小时点不了 60 次退出。 */
  signout: { limit: 60, windowMs: HOUR },
  /** 能考什么。按 IP 计，宽松：它是首页，而且每次进考试中心都要读一遍。 */
  papers: { limit: 300, windowMs: HOUR },
  /** 发卷和交卷。按 IP 计。
   *
   *  这一桶**不是**真正的门 —— 真正的门在 can-api：一张抽出去的卷子只能交一
   *  次（交卷时在同一个事务里 consume 掉），加上它自己按成员和按 IP 的两桶。
   *  这里这一桶挡的只是打到我们这台机器上的量，免得一个脚本把转发本身刷成
   *  DoS。把它调松不会放宽考试规则，把它调紧会先伤到共用出口 IP 的正常考生。 */
  sitting: { limit: 120, windowMs: HOUR },
  /** 题库管理。按 IP 计，很松：批量录四十道题是一个正常的下午。真正的授权在
   *  can-api 的 WithSup 上，这里只是一层量的上限。 */
  admin: { limit: 900, windowMs: HOUR },
} as const satisfies Record<string, RateLimitRule>;

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

// Expired buckets are only dropped on a periodic sweep, so the map stays
// bounded by traffic in the current window rather than growing forever.
const SWEEP_INTERVAL_MS = 5 * MINUTE;
let lastSweep = 0;

function sweep(now: number) {
  if (now - lastSweep < SWEEP_INTERVAL_MS) return;
  lastSweep = now;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

/** Seconds until `key`'s window resets, or 0 if it is not currently limited. */
export function retryAfter(key: string, rule: RateLimitRule): number {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now || bucket.count < rule.limit) return 0;
  return Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
}

/** Count one attempt against `key` without inspecting the limit. */
export function record(key: string, rule: RateLimitRule): void {
  const now = Date.now();
  sweep(now);

  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + rule.windowMs });
    return;
  }
  bucket.count++;
}

/** Forget `key` entirely — call after a success so a legitimate user who
 *  fat-fingered their password a few times is not left throttled. */
export function clear(key: string): void {
  buckets.delete(key);
}

/* ------------------------------------------------------------------ *
 * Who is this request from?
 *
 * This used to be `context.clientAddress` and nothing else, which in the
 * real deployment resolved to the same string for every request on the
 * network — so every `…:ip:` bucket below was one shared global counter.
 * At most five people could sign up in an hour, between them.
 *
 * The reason is worth writing down, because it is not obvious from the
 * call site. The app runs in a container behind a reverse proxy, so the
 * socket peer is the proxy. Astro's Node adapter *can* read the forwarded
 * address, but only once the Host header has been validated:
 *
 *     const hostValidated = validated.host !== undefined
 *                        || validatedHostname !== undefined;
 *     const forwardedClientIp = hostValidated
 *       ? getFirstForwardedValue(req.headers["x-forwarded-for"]) : undefined;
 *
 * and `validateHost` returns undefined the moment `allowedDomains` is
 * empty. That list comes from `security.allowedDomains` in the Astro
 * config, which is unset here — so the forwarded address was never read
 * and the peer address always won.
 * ------------------------------------------------------------------ */

/** Strip brackets, a port and the IPv4-mapped IPv6 prefix. */
function normalizeIp(value: string): string {
  let ip = value.trim().toLowerCase();
  if (ip.startsWith("["))
    ip = ip.slice(1, ip.indexOf("]") < 0 ? undefined : ip.indexOf("]"));
  // `1.2.3.4:5678` — but not `::1`, where the colons are the address.
  else if (ip.split(":").length === 2) ip = ip.slice(0, ip.indexOf(":"));
  if (ip.startsWith("::ffff:")) ip = ip.slice(7);
  return ip;
}

/**
 * Is this address on our own side of the proxy?
 *
 * The gate that makes reading the headers below safe. A request whose peer
 * is loopback or an RFC1918 / unique-local address cannot have come
 * straight off the internet — it came through something on our network,
 * and that something is the only party who knows who the caller was. A
 * request arriving from a *public* peer is talking to us directly, so its
 * headers are the caller's own claims and are ignored.
 *
 * Carrier-grade NAT (100.64/10) is deliberately not in here: as a *peer*
 * address it would mean we are exposed to the internet behind someone
 * else's NAT, which is not a proxy we control.
 */
function isLocalPeer(ip: string): boolean {
  if (!ip) return false;
  if (ip === "::1" || ip === "localhost") return true;
  // Unique-local (fc00::/7) and link-local (fe80::/10).
  if (/^f[cd][0-9a-f]{2}:/.test(ip) || /^fe[89ab][0-9a-f]:/.test(ip))
    return true;

  const parts = ip.split(".");
  if (parts.length !== 4) return false;
  const [a, b] = parts.map((p) => Number.parseInt(p, 10));
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  return (
    a === 127 ||
    a === 10 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254)
  );
}

/** Roughly an IP — enough to reject a header full of junk. */
function looksLikeIp(ip: string): boolean {
  return /^[0-9.]+$/.test(ip)
    ? /^(\d{1,3}\.){3}\d{1,3}$/.test(ip)
    : ip.includes(":");
}

/**
 * The headers a proxy may speak for the caller through, best first.
 *
 * `CF-Connecting-IP` leads because Cloudflare *overwrites* it on every
 * request, so a caller cannot forge it — see the note about Cloudflare in
 * front of this app in CLAUDE.md. `X-Real-IP` is set rather than appended
 * by nginx-style proxies, so it carries one value and no ambiguity about
 * which end of the list to read. `X-Forwarded-For` is last and is the
 * weakest: it is a list the caller can prepend to, so its leftmost entry
 * is a claim, not a fact. It is only reached when neither of the other two
 * is present, and only ever decides which bucket a request is counted in.
 */
function forwardedIp(headers: Headers): string {
  const direct = headers.get("cf-connecting-ip") || headers.get("x-real-ip");
  if (direct) {
    const ip = normalizeIp(direct);
    if (looksLikeIp(ip)) return ip;
  }

  for (const entry of (headers.get("x-forwarded-for") || "").split(",")) {
    const ip = normalizeIp(entry);
    if (ip && looksLikeIp(ip)) return ip;
  }
  return "";
}

/**
 * The address to bucket a request against.
 *
 * Takes an `APIContext` or a bare `Request` — `auth.config.ts` only ever
 * gets the latter, and used to carry its own weaker copy of this. With no
 * context there is no peer to check, so the headers are taken at face
 * value; that is why sign-in also buckets by identifier, which cannot be
 * forged and is the key that actually stops one account being guessed at.
 *
 * Requests we cannot attribute at all share the "unknown" bucket, which is
 * the safe direction to fail.
 */
export function clientIp(source: APIContext | Request): string {
  const request = source instanceof Request ? source : source.request;

  let peer = "";
  if (!(source instanceof Request)) {
    // `clientAddress` throws on a prerendered route rather than returning "".
    try {
      peer = normalizeIp(source.clientAddress || "");
    } catch {
      peer = "";
    }
  }

  if (!peer || isLocalPeer(peer)) {
    const forwarded = forwardedIp(request.headers);
    if (forwarded) return forwarded;
  }

  return peer || "unknown";
}

/** 429 in the shape both `/api/email/*` and `/api/v1/*` callers expect. */
export function tooManyRequests(seconds: number): Response {
  return Response.json(
    {
      status: 429,
      error: "Too many requests. Please wait a while and try again.",
      timestamp: new Date().toISOString(),
    },
    { status: 429, headers: { "Retry-After": String(seconds) } },
  );
}

/**
 * Check every `[key, rule]` pair and count an attempt against all of them.
 * Returns a ready-to-return 429 when any is exhausted, otherwise null.
 *
 * All limits are checked before any is incremented, so one exhausted bucket
 * does not silently consume budget from the others.
 */
export function enforce(
  entries: Array<[string, RateLimitRule]>,
): Response | null {
  for (const [key, rule] of entries) {
    const wait = retryAfter(key, rule);
    if (wait > 0) return tooManyRequests(wait);
  }
  for (const [key, rule] of entries) record(key, rule);
  return null;
}
