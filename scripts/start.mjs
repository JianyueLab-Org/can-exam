import { installGracefulShutdown } from "./graceful-shutdown.mjs";

process.env.ASTRO_NODE_AUTOSTART = "disabled";

try {
  const { startServer } = await import("../dist/server/entry.mjs");
  const { server, done } = startServer();
  installGracefulShutdown(server.server);
  done.catch((error) => {
    console.error("HTTP server failed:", error);
    process.exit(1);
  });
} catch (error) {
  console.error("Server startup failed:", error);
  process.exit(1);
}
