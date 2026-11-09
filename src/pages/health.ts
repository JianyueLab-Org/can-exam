import { health } from "../server/health";

export const prerender = false;

export const GET = async () => {
  const result = await health();
  return new Response(JSON.stringify(result.body), {
    status: result.ok ? 200 : 503,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
    },
  });
};
