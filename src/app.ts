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
import rewardsRouter from "./modules/rewards/rewards.routes.js";
import homeworkRouter from "./modules/homework/homework.routes.js";
import filesRouter from "./modules/files/files.routes.js";

export function createApp(): Application {
  const app = express();

  // In non-local (production) the API sits behind a TLS-terminating proxy. Trust it so
  // req.secure / X-Forwarded-Proto are honored for the HTTPS redirect + HSTS below.
  const nonLocal = config.NODE_ENV === "production";
  if (nonLocal) {
    app.set("trust proxy", 1);
  }

  // Security headers. helmet sets HSTS by default; make it explicit + long-lived in
  // non-local so browsers pin HTTPS (FR-018). HSTS is meaningless over plain HTTP, so in
  // local/dev we keep helmet's defaults without forcing the redirect.
  app.use(
    helmet(
      nonLocal ? { hsts: { maxAge: 31_536_000, includeSubDomains: true, preload: true } } : {},
    ),
  );

  // Enforce HTTPS in non-local: a plain-HTTP request (per X-Forwarded-Proto) is redirected
  // to its https:// equivalent, so credentials/tokens never travel in cleartext (FR-018).
  if (nonLocal) {
    app.use((req, res, next) => {
      if (req.secure || req.headers["x-forwarded-proto"] === "https") {
        next();
        return;
      }
      res.redirect(308, `https://${req.headers.host ?? ""}${req.originalUrl}`);
    });
  }

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
  app.use(rewardsRouter);
  app.use(homeworkRouter);
  // Authorized object retrieval. NOTE: there is intentionally no public
  // express.static('/storage') mount — stored objects are reachable ONLY through this
  // family-scoped /files route (Principle V, SC-005/006).
  app.use(filesRouter);

  // 404 + centralized error handler (must be last)
  app.use(notFound);
  app.use(errorHandler);

  return app;
}

export default createApp;
