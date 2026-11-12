export function installGracefulShutdown(httpServer) {
  let shuttingDown = false;

  httpServer.on("request", (_request, response) => {
    response.once("finish", () => {
      if (shuttingDown) httpServer.closeIdleConnections();
    });
  });

  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;

    const deadline = setTimeout(() => {
      console.error("Graceful shutdown timed out after 15 seconds.");
      httpServer.closeAllConnections();
      process.exit(1);
    }, 15_000);
    deadline.unref();

    httpServer.close((error) => {
      clearTimeout(deadline);
      if (error) {
        console.error("Graceful shutdown failed:", error);
        process.exit(1);
      }
      process.exit(0);
    });
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}
