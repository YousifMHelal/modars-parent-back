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
import dashboardRouter from "./modules/dashboard/dashboard.routes.js";
import onboardingRouter from "./modules/onboarding/onboarding.routes.js";
import childrenRouter from "./modules/children/children.routes.js";
import settingsRouter from "./modules/settings/settings.routes.js";
import webhooksRouter from "./modules/webhooks/webhooks.routes.js";
import billingRouter from "./modules/billing/billing.routes.js";
import notificationsRouter from "./modules/notifications/notifications.routes.js";

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

  // Payment webhook — MUST mount before express.json() so the provider signature
  // verifies against the exact raw bytes (research.md §2). The router itself applies
  // express.raw() for this single route; all other routes still get the JSON parser.
  app.use(webhooksRouter);

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
  app.use(dashboardRouter);
  app.use(onboardingRouter);
  app.use(childrenRouter);
  app.use(settingsRouter);
  app.use(billingRouter);
  app.use(notificationsRouter);

  // 404 + centralized error handler (must be last)
  app.use(notFound);
  app.use(errorHandler);

  return app;
}

export default createApp;
