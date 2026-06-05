import { pinoHttp } from "pino-http";
import pino, { type LoggerOptions } from "pino";
import type { IncomingMessage, ServerResponse } from "node:http";
import config from "../config/index.js";

const pinoOptions: LoggerOptions = {
  level: config.LOG_LEVEL,
  ...(config.NODE_ENV === "development" && {
    transport: { target: "pino-pretty" },
  }),
};

const logger = pino(pinoOptions);

const requestLogger = pinoHttp({
  logger,
  genReqId: (req: IncomingMessage) => {
    return (
      (req.headers["x-request-id"] as string | undefined) ??
      crypto.randomUUID()
    );
  },
  customLogLevel: (_req: IncomingMessage, res: ServerResponse) => {
    if (res.statusCode >= 500) return "error";
    if (res.statusCode >= 400) return "warn";
    return "info";
  },
  serializers: {
    req: (req: IncomingMessage & { id?: string }) => ({
      id: req.id,
      method: req.method,
      url: req.url,
    }),
    res: (res: ServerResponse) => ({
      statusCode: res.statusCode,
    }),
  },
});

export default requestLogger;
