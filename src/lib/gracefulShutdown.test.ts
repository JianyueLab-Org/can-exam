import { describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { get, type IncomingMessage } from "node:http";

const helperUrl = new URL(
  "../../scripts/graceful-shutdown.mjs",
  import.meta.url,
);
const childSource = `
  import { createServer } from "node:http";
  import { installGracefulShutdown } from ${JSON.stringify(helperUrl.href)};

  let response;
  const server = createServer((_request, outgoing) => {
    response = outgoing;
    outgoing.writeHead(200, { "Content-Type": "text/plain" });
    outgoing.write("started\\n");
  });
  server.keepAliveTimeout = 60_000;
  installGracefulShutdown(server);
  let signals = 0;
  for (const signal of ["SIGTERM", "SIGINT"]) {
    process.on(signal, () => process.send({ type: "signal", count: ++signals }));
  }
  process.on("message", (message) => {
    if (message === "finish") response.end("finished\\n");
  });
  server.listen(0, "127.0.0.1", () => {
    process.send({ type: "ready", port: server.address().port });
  });
`;

type Message = { type: string; port?: number; count?: number };
type Exit = { code: number | null; signal: NodeJS.Signals | null };

async function withServer(
  run: (server: {
    port: number;
    signal: (signal: NodeJS.Signals) => void;
    finish: () => void;
    nextSignal: () => Promise<Message>;
    exited: Promise<Exit>;
  }) => Promise<void>,
  timeout = 20_000,
) {
  const child = spawn("node", ["--input-type=module", "--eval", childSource], {
    stdio: ["ignore", "ignore", "pipe", "ipc"],
  });
  const messages: Message[] = [];
  const waiting = new Map<
    string,
    { resolve: (message: Message) => void; reject: (error: Error) => void }
  >();
  let stderr = "";
  let closed = false;
  child.stderr!.setEncoding("utf8").on("data", (text) => (stderr += text));
  child.on("error", (error) => (stderr += error.message));
  child.on("message", (value) => {
    const message = value as Message;
    const waiter = waiting.get(message.type);
    if (waiter) {
      waiting.delete(message.type);
      waiter.resolve(message);
    } else {
      messages.push(message);
    }
  });
  const exit = Promise.withResolvers<Exit>();
  child.once("close", (code, signal) => {
    closed = true;
    for (const waiter of waiting.values()) {
      waiter.reject(new Error(`Child exited before its message: ${stderr}`));
    }
    waiting.clear();
    exit.resolve({ code, signal });
  });
  function nextMessage(type: string): Promise<Message> {
    const index = messages.findIndex((message) => message.type === type);
    if (index !== -1) return Promise.resolve(messages.splice(index, 1)[0]!);
    if (closed) return Promise.reject(new Error(`Child exited: ${stderr}`));
    const message = Promise.withResolvers<Message>();
    waiting.set(type, message);
    return message.promise;
  }
  // Real child-process signals and the production deadline cannot use fake timers.
  // This watchdog only bounds failures; successful tests synchronize through IPC.
  const watchdog = Promise.withResolvers<never>();
  const timer = setTimeout(() => {
    watchdog.reject(new Error(`Child shutdown test timed out: ${stderr}`));
  }, timeout);
  try {
    await Promise.race([
      (async () => {
        const { port } = await nextMessage("ready");
        await run({
          port: port!,
          signal: (signal) => {
            if (!child.kill(signal))
              throw new Error(`Could not send ${signal}`);
          },
          finish: () => child.send("finish"),
          nextSignal: () => nextMessage("signal"),
          exited: exit.promise,
        });
      })(),
      watchdog.promise,
    ]);
  } finally {
    clearTimeout(timer);
    if (!closed) child.kill("SIGKILL");
    await exit.promise;
  }
}

function openResponse(port: number): Promise<{
  response: IncomingMessage;
  completed: Promise<{ body: string; complete: boolean }>;
}> {
  const opened = Promise.withResolvers<{
    response: IncomingMessage;
    completed: Promise<{ body: string; complete: boolean }>;
  }>();
  const request = get({ host: "127.0.0.1", port, agent: false });
  request.once("error", opened.reject);
  request.once("response", (response) => {
    let body = "";
    const completed = Promise.withResolvers<{
      body: string;
      complete: boolean;
    }>();
    response.setEncoding("utf8");
    response.on("data", (chunk) => (body += chunk));
    response.once("end", () => completed.resolve({ body, complete: true }));
    response.once("error", () => completed.resolve({ body, complete: false }));
    opened.resolve({ response, completed: completed.promise });
  });
  return opened.promise;
}

describe("graceful shutdown", () => {
  test("SIGTERM drains an active response and refuses new connections", async () => {
    await withServer(async (server) => {
      const { response, completed } = await openResponse(server.port);
      try {
        server.signal("SIGTERM");
        await server.nextSignal();
        const connection = await openResponse(server.port).catch(
          (error: unknown) => error,
        );
        expect(connection).toMatchObject({ code: "ECONNREFUSED" });
        server.finish();
        expect(await completed).toEqual({
          body: "started\nfinished\n",
          complete: true,
        });
        expect(await server.exited).toEqual({ code: 0, signal: null });
      } finally {
        response.destroy();
      }
    });
  }, 25_000);

  test("duplicate signals do not destroy an active response", async () => {
    await withServer(async (server) => {
      const { response, completed } = await openResponse(server.port);
      try {
        server.signal("SIGTERM");
        expect((await server.nextSignal()).count).toBe(1);
        server.signal("SIGTERM");
        expect((await server.nextSignal()).count).toBe(2);
        server.signal("SIGINT");
        expect((await server.nextSignal()).count).toBe(3);
        server.finish();
        expect(await completed).toEqual({
          body: "started\nfinished\n",
          complete: true,
        });
        expect(await server.exited).toEqual({ code: 0, signal: null });
      } finally {
        response.destroy();
      }
    });
  }, 25_000);

  test("completed keep-alive responses close promptly during shutdown", async () => {
    await withServer(async (server) => {
      const client = spawn(
        "node",
        [
          "--input-type=module",
          "--eval",
          `
            import { Agent, get } from "node:http";
            const agent = new Agent({ keepAlive: true });
            get({
              host: "127.0.0.1",
              port: ${server.port},
              agent,
            }, (response) => {
              let body = "";
              response.setEncoding("utf8");
              response.on("data", (chunk) => { body += chunk; });
              response.once("end", () => {
                process.send({ type: "completed", body, complete: true });
              });
              response.once("error", () => {
                process.send({ type: "completed", body, complete: false });
              });
              process.send({ type: "started" });
            }).on("error", (error) => {
              console.error(error);
              process.exit(1);
            });
            process.on("disconnect", () => agent.destroy());
          `,
        ],
        { stdio: ["ignore", "ignore", "inherit", "ipc"] },
      );
      const started = Promise.withResolvers<void>();
      const completed = Promise.withResolvers<{
        body: string;
        complete: boolean;
      }>();
      const closed = Promise.withResolvers<void>();
      client.on("message", (value) => {
        const message = value as {
          type: string;
          body: string;
          complete: boolean;
        };
        if (message.type === "started") started.resolve();
        if (message.type === "completed") {
          completed.resolve({
            body: message.body,
            complete: message.complete,
          });
        }
      });
      client.once("error", started.reject);
      client.once("close", () => {
        started.reject(
          new Error("Keep-alive client exited before its response"),
        );
        completed.reject(
          new Error("Keep-alive client exited before completion"),
        );
        closed.resolve();
      });
      // Attach the completion rejection handler before waiting for startup.
      const result = completed.promise.catch((error: unknown) => error);
      try {
        await started.promise;
        server.signal("SIGTERM");
        await server.nextSignal();
        server.finish();
        expect(await result).toEqual({
          body: "started\nfinished\n",
          complete: true,
        });
        expect(await server.exited).toEqual({ code: 0, signal: null });
      } finally {
        if (client.connected) client.disconnect();
        if (client.exitCode === null && client.signalCode === null) {
          client.kill("SIGKILL");
        }
        await closed.promise;
      }
    }, 3_000);
  }, 5_000);

  test("a hung response forces a nonzero exit at the 15-second deadline", async () => {
    await withServer(async (server) => {
      const { response, completed } = await openResponse(server.port);
      try {
        const started = performance.now();
        server.signal("SIGTERM");
        await server.nextSignal();
        const result = await server.exited;
        const elapsed = performance.now() - started;
        expect(result.signal).toBeNull();
        expect(result.code).toBe(1);
        expect(elapsed).toBeGreaterThanOrEqual(14_500);
        expect(elapsed).toBeLessThan(17_000);
        expect((await completed).complete).toBe(false);
      } finally {
        response.destroy();
      }
    });
  }, 25_000);
});
