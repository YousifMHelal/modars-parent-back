import express, { type Application } from "express";
import helmet from "helmet";
import cors from "cors";
import requestLogger from "./middleware/requestLogger.js";
import rateLimitMiddleware from "./middleware/rateLimit.js";
import { notFound } from "./middleware/notFound.js";
import errorHandler from "./middleware/errorHandler.js";
import config from "./config/index.js";
import { configurePassport, passport } from "./lib/oauth.js";
import healthRouter from "./modules/health/health.routes.js";
import authRouter from "./modules/auth/auth.routes.js";

export function createApp(): Application {
  const app = express();

  // Security headers
  app.use(helmet());

  // CORS
  app.use(
    cors({
      origin: config.CORS_ORIGINS,
      credentials: true,
    }),
  );

  // Request logging
  app.use(requestLogger);

  // Body parsers
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Rate limiting
  app.use(rateLimitMiddleware);

  // OAuth strategies (no sessions — stateless JWT auth)
  configurePassport();
  app.use(passport.initialize());

  // Routes
  app.use(healthRouter);
  app.use(authRouter);

  // 404 + centralized error handler (must be last)
  app.use(notFound);
  app.use(errorHandler);

  return app;
}

export default createApp;
