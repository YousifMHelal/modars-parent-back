import { promisify } from "node:util";
import config from "./config/index.js";
import { connect, disconnect } from "./db/prisma.js";
import { createRedisClient } from "./db/redis.js";
import { createApp } from "./app.js";
import pino from "pino";

const logger = pino({
  name: "server",
  level: config.LOG_LEVEL,
  ...(config.NODE_ENV === "development" && {
    transport: { target: "pino-pretty" },
  }),
});

async function main() {
  logger.info("Starting server...");

  await connect();
  logger.info("Prisma connected");

  createRedisClient(config.REDIS_URL);

  const app = createApp();

  const server = app.listen(config.PORT, () => {
    logger.info(`Listening on :${config.PORT}`);
  });

  const closeServer = promisify(server.close.bind(server));

  const shutdown = async (signal: string) => {
    logger.info({ signal }, "Shutting down...");
    await closeServer();
    await disconnect();
    logger.info("Server closed");
    process.exit(0);
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`Fatal: ${message}\n`);
  process.exit(1);
});
