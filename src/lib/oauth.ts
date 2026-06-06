import type { Request, Response, NextFunction, RequestHandler } from "express";
import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import config from "../config/index.js";

export interface OAuthProfile {
  provider: "GOOGLE" | "APPLE";
  providerAccountId: string;
  email: string | undefined;
  name: string | undefined;
}

// Surface the verified OAuth profile to the callback controller.
declare module "express-serve-static-core" {
  interface Request {
    oauthProfile?: OAuthProfile;
  }
}

type DoneCallback = (err: Error | null, profile?: OAuthProfile) => void;

// Maps a route :provider param to the registered passport strategy name.
const STRATEGY_BY_PROVIDER: Record<string, string> = { google: "google" };

// Strategy names actually registered by configurePassport() (i.e. credentials present).
const configuredStrategies = new Set<string>();

export function configurePassport(): void {
  if (config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET) {
    passport.use(
      new GoogleStrategy(
        {
          clientID: config.GOOGLE_CLIENT_ID,
          clientSecret: config.GOOGLE_CLIENT_SECRET,
          callbackURL:
            config.GOOGLE_CALLBACK_URL ?? "http://localhost:4000/auth/oauth/google/callback",
        },
        (
          _accessToken: string,
          _refreshToken: string,
          profile: import("passport-google-oauth20").Profile,
          done: DoneCallback,
        ) => {
          const oauthProfile: OAuthProfile = {
            provider: "GOOGLE",
            providerAccountId: profile.id,
            email: profile.emails?.[0]?.value ?? undefined,
            name: profile.displayName ?? undefined,
          };
          done(null, oauthProfile);
        },
      ),
    );
    configuredStrategies.add("google");
  }

  // Apple strategy wiring would go here when APPLE_CLIENT_ID is set
  // @nicokaiser/passport-apple requires key files which are better handled at runtime
}

/** Authenticates the OAuth callback for the route's :provider and, on success,
 *  attaches the normalized profile to `req.oauthProfile` for the controller.
 *  Returns 501 when the provider has no configured strategy. */
export function oauthCallbackAuth(req: Request, res: Response, next: NextFunction): void {
  const provider = String(req.params["provider"] ?? "").toLowerCase();
  const strategy = STRATEGY_BY_PROVIDER[provider];

  if (!strategy || !configuredStrategies.has(strategy)) {
    res.status(501).json({
      error: { code: "NOT_IMPLEMENTED", message: "Configure OAuth credentials to enable" },
    });
    return;
  }

  const verify = (err: unknown, user: unknown): void => {
    const profile = user as OAuthProfile | false | null | undefined;
    if (err || !profile) {
      res.status(401).json({ error: { code: "UNAUTHORIZED", message: "OAuth failed" } });
      return;
    }
    req.oauthProfile = profile;
    next();
  };

  // passport.authenticate's custom-callback overload is typed `any`; cast to the
  // express handler it actually returns so the call site stays type-safe.
  const handler = passport.authenticate(
    strategy,
    { session: false },
    verify,
  ) as unknown as RequestHandler;
  handler(req, res, next);
}

export { passport };
