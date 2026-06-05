import rateLimit from "express-rate-limit";
import config from "../config/index.js";
import { ErrorCode } from "../lib/errors.js";

const rateLimitMiddleware = rateLimit({
  windowMs: config.RATE_LIMIT_WINDOW_MS,
  max: config.RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(429).json({
      error: {
        code: ErrorCode.RATE_LIMITED,
        message: "Too many requests, please try again later.",
      },
    });
  },
});

export default rateLimitMiddleware;
