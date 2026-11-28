import { randomBytes } from "node:crypto";

import { imapSettingsInputSchema, isSignInProvider, SignInError } from "@leren/channels";
import type { ChannelAccountsDependencies } from "@leren/channels";
import type { Db } from "@leren/db";
import type { Logger } from "@leren/logger";
import type { RateLimitRule, RateLimiter } from "@leren/rate-limit";
import { Hono } from "hono";
import type { Context } from "hono";
import { deleteCookie, getSignedCookie, setSignedCookie } from "hono/cookie";
import { z } from "zod";

import { codeChallengeOf, parseJson } from "../../oauth";
import { validate } from "../../validation";
import { requireUser } from "../auth/middleware";
import type { AuthVariables } from "../auth/middleware";
import type { Auth } from "../auth/service";
import {
  callbackQuerySchema,
  channelAccountParamsSchema,
  providerParamsSchema,
  settingsQuerySchema,
} from "./schema";
import type { ConnectionErrorCode } from "./schema";
import {
  disconnectChannelAccount,
  getUserEmail,
  listChannelAccounts,
  saveAuthorisedAccount,
} from "./service";

const STATE_COOKIE = "channel_oauth";
const STATE_COOKIE_PATH = "/api/channel-accounts";
const STATE_MAX_AGE_SECONDS = 600;
const PLATFORM_PAGE = "/channels";

const pendingConnectionSchema = z.object({
  state: z.string(),
  codeVerifier: z.string(),
  userId: z.string(),
  provider: z.string(),
});

/**
 * The most times that one user may try to sign in to a mail server, so the product cannot be used
 * to guess passwords (decision 0063).
 */
export const SIGN_IN_RULE: RateLimitRule = { limit: 5, windowSeconds: 15 * 60 };

/**
 * The most server settings that one user may look up. Each lookup makes requests to hosts that the
 * user chose, so it is limited like a sign-in (decision 0063).
 */
export const SETTINGS_RULE: RateLimitRule = { limit: 20, windowSeconds: 15 * 60 };

/**
 * What the router needs beyond the account functions. `cookieSecret` signs the pending-connection
 * cookie, `apiUrl` is where providers redirect back to, and `platformUrl` is where the callback
 * sends the browser. Without `rateLimiter`, sign-ins to mail servers are not limited.
 */
export type ChannelAccountsRouterDependencies = ChannelAccountsDependencies & {
  cookieSecret: string;
  apiUrl: string;
  platformUrl: string;
  rateLimiter?: RateLimiter | undefined;
};

/**
 * The dependencies of an API without any enabled provider. Every provider route answers with not
 * found, so the other values are never used.
 */
export const NO_CHANNEL_PROVIDERS: ChannelAccountsRouterDependencies = {
  providers: new Map(),
  encryptionKey: undefined,
  cookieSecret: "",
  apiUrl: "",
  platformUrl: "",
};

/**
 * Mounts the channel account routes under `/api/channel-accounts`. Every route requires a session
 * and is scoped to its user. The OAuth callback is accepted only with the signed, single-use cookie
 * whose `state` and user match the request. Tokens and mail server passwords are never logged.
 */
export function createChannelAccountsRouter({
  auth,
  db,
  logger,
  dependencies,
}: {
  auth: Auth;
  db: Db;
  logger: Logger;
  dependencies: ChannelAccountsRouterDependencies;
}) {
  const redirectUriOf = (provider: string) =>
    `${dependencies.apiUrl}/api/channel-accounts/${provider}/callback`;

  const secure = dependencies.apiUrl.startsWith("https://");

  const backToPlatform = (query: Record<string, string>) =>
    `${dependencies.platformUrl}${PLATFORM_PAGE}?${new URLSearchParams(query).toString()}`;

  const failure = (code: ConnectionErrorCode) => backToPlatform({ error: code });

  /**
   * Counts one request of `userId` against `rule`. A request over the limit sets `Retry-After`.
   * The limit protects hosts and passwords, so it fails closed: when the counter store fails, the
   * request is `unavailable` and an error is logged.
   */
  const checkLimit = async (
    c: Context,
    action: string,
    userId: string,
    rule: RateLimitRule,
  ): Promise<"allowed" | "limited" | "unavailable"> => {
    if (!dependencies.rateLimiter) {
      return "allowed";
    }

    try {
      const result = await dependencies.rateLimiter.consume(`channel-${action}:${userId}`, rule);

      if (!result.allowed) {
        c.header("Retry-After", String(result.retryAfterSeconds));
      }

      return result.allowed ? "allowed" : "limited";
    } catch (caught) {
      logger.error("A channel account rate limit is unavailable, so the request was refused", {
        action,
        error: caught,
      });

      return "unavailable";
    }
  };

  return new Hono<{ Variables: AuthVariables }>()
    .use("/api/channel-accounts/*", requireUser(auth))
    .use("/api/channel-accounts", requireUser(auth))
    .get("/api/channel-accounts", async (c) => {
      const accounts = await listChannelAccounts(db, c.get("userId"), dependencies.providers);

      const providers = [...dependencies.providers.values()].map((provider) => ({
        name: provider.name,
        channel: provider.channel,
        displayName: provider.displayName,
        connection: isSignInProvider(provider) ? ("sign-in" as const) : ("redirect" as const),
      }));

      return c.json({ providers, accounts }, 200);
    })
    .get(
      "/api/channel-accounts/:provider/settings",
      validate("param", providerParamsSchema),
      validate("query", settingsQuerySchema),
      async (c) => {
        const provider = dependencies.providers.get(c.req.valid("param").provider);

        if (!provider || !isSignInProvider(provider) || !provider.suggestSettings) {
          return c.json({ error: "Not found" }, 404);
        }

        const limit = await checkLimit(c, "settings", c.get("userId"), SETTINGS_RULE);

        if (limit === "limited") {
          return c.json({ error: "too_many_attempts" as const }, 429);
        }

        if (limit === "unavailable") {
          return c.json({ error: "unavailable" as const }, 503);
        }

        return c.json(
          { settings: await provider.suggestSettings(c.req.valid("query").address) },
          200,
        );
      },
    )
    .post(
      "/api/channel-accounts/:provider/sign-in",
      validate("param", providerParamsSchema),
      validate("json", imapSettingsInputSchema),
      async (c) => {
        const provider = dependencies.providers.get(c.req.valid("param").provider);
        const userId = c.get("userId");

        if (!provider || !isSignInProvider(provider)) {
          return c.json({ error: "Not found" }, 404);
        }

        const limit = await checkLimit(c, "sign-in", userId, SIGN_IN_RULE);

        if (limit === "limited") {
          return c.json({ error: "too_many_attempts" as const }, 429);
        }

        if (limit === "unavailable") {
          return c.json({ error: "unavailable" as const }, 503);
        }

        let authorised;

        try {
          authorised = await provider.signIn(c.req.valid("json"));
        } catch (caught) {
          if (caught instanceof z.ZodError) {
            return c.json({ error: "invalid_settings" as const }, 400);
          }

          if (caught instanceof SignInError) {
            return c.json({ error: caught.reason }, 422);
          }

          logger.error("Signing in to a mail server failed", {
            provider: provider.name,
            error: caught instanceof Error ? caught.name : "unknown",
          });

          return c.json({ error: "failed" as const }, 502);
        }

        const result = await saveAuthorisedAccount(db, dependencies, userId, provider, authorised);

        return result.status === "saved"
          ? c.json({ status: "connected" as const, account: result.account }, 201)
          : c.json({ error: result.status }, 409);
      },
    )
    .post(
      "/api/channel-accounts/:provider/connect",
      validate("param", providerParamsSchema),
      async (c) => {
        const provider = dependencies.providers.get(c.req.valid("param").provider);
        const userId = c.get("userId");
        const userEmail = provider ? await getUserEmail(db, userId) : null;

        if (!provider || isSignInProvider(provider) || !userEmail) {
          return c.json({ error: "Not found" }, 404);
        }

        const state = randomBytes(24).toString("base64url");
        const codeVerifier = randomBytes(32).toString("base64url");

        const started = provider.start({
          state,
          codeChallenge: codeChallengeOf(codeVerifier),
          redirectUri: redirectUriOf(provider.name),
          userEmail,
        });

        if (started.kind === "connected") {
          const result = await saveAuthorisedAccount(
            db,
            dependencies,
            userId,
            provider,
            started.account,
          );

          return result.status === "saved"
            ? c.json({ status: "connected" as const, account: result.account }, 201)
            : c.json({ error: result.status }, 409);
        }

        await setSignedCookie(
          c,
          STATE_COOKIE,
          JSON.stringify({ state, codeVerifier, userId, provider: provider.name }),
          dependencies.cookieSecret,
          {
            httpOnly: true,
            sameSite: "Lax",
            secure,
            path: STATE_COOKIE_PATH,
            maxAge: STATE_MAX_AGE_SECONDS,
          },
        );

        return c.json({ status: "redirect" as const, url: started.url }, 200);
      },
    )
    .get(
      "/api/channel-accounts/:provider/callback",
      validate("param", providerParamsSchema),
      validate("query", callbackQuerySchema),
      async (c) => {
        const provider = dependencies.providers.get(c.req.valid("param").provider);

        if (!provider || isSignInProvider(provider)) {
          return c.json({ error: "Not found" }, 404);
        }

        const { code, state, error } = c.req.valid("query");
        const raw = await getSignedCookie(c, dependencies.cookieSecret, STATE_COOKIE);

        deleteCookie(c, STATE_COOKIE, { path: STATE_COOKIE_PATH, secure });

        const pending = pendingConnectionSchema.safeParse(
          typeof raw === "string" ? parseJson(raw) : undefined,
        );

        if (
          !pending.success ||
          pending.data.state !== state ||
          pending.data.provider !== provider.name ||
          pending.data.userId !== c.get("userId")
        ) {
          return c.redirect(failure("invalid_state"));
        }

        if (error || !code) {
          return c.redirect(failure("denied"));
        }

        try {
          const authorised = await provider.finish({
            code,
            codeVerifier: pending.data.codeVerifier,
            redirectUri: redirectUriOf(provider.name),
          });

          const result = await saveAuthorisedAccount(
            db,
            dependencies,
            c.get("userId"),
            provider,
            authorised,
          );

          return c.redirect(
            result.status === "saved"
              ? backToPlatform({ connected: provider.name })
              : failure(result.status),
          );
        } catch (caught) {
          logger.error("Connecting a channel account failed", {
            provider: provider.name,
            error: caught,
          });

          return c.redirect(failure("failed"));
        }
      },
    )
    .delete(
      "/api/channel-accounts/:id",
      validate("param", channelAccountParamsSchema),
      async (c) => {
        const disconnected = await disconnectChannelAccount(
          db,
          dependencies,
          logger,
          c.get("userId"),
          c.req.valid("param").id,
        );

        return disconnected ? c.body(null, 204) : c.json({ error: "Not found" }, 404);
      },
    );
}
