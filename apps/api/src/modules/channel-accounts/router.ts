import { createHash, randomBytes } from "node:crypto";

import type { Db } from "@leren/db";
import type { Logger } from "@leren/logger";
import { Hono } from "hono";
import { deleteCookie, getSignedCookie, setSignedCookie } from "hono/cookie";
import { z } from "zod";

import { validate } from "../../validation";
import { requireUser } from "../auth/middleware";
import type { AuthVariables } from "../auth/middleware";
import type { Auth } from "../auth/service";
import { callbackQuerySchema, channelAccountParamsSchema, providerParamsSchema } from "./schema";
import type { ConnectionErrorCode } from "./schema";
import {
  disconnectChannelAccount,
  getUserEmail,
  listChannelAccounts,
  saveAuthorisedAccount,
} from "./service";
import type { ChannelAccountsDependencies } from "./service";

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
 * What the router needs beyond the account functions. `cookieSecret` signs the cookie that holds
 * a pending connection. `apiUrl` is the origin that providers redirect back to and `platformUrl`
 * is where the callback sends the browser afterwards.
 */
export type ChannelAccountsRouterDependencies = ChannelAccountsDependencies & {
  cookieSecret: string;
  apiUrl: string;
  platformUrl: string;
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

function codeChallengeOf(codeVerifier: string): string {
  return createHash("sha256").update(codeVerifier).digest("base64url");
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * Mounts the routes of channel accounts under `/api/channel-accounts`. Every route, including the
 * provider callback, requires a session and is scoped to the signed-in user. A provider that is
 * unknown or not enabled is reported as not found.
 *
 * A connection is kept between the connect request and the callback in a signed, `httpOnly`
 * cookie that expires after ten minutes. It holds the random `state` value, the PKCE code verifier,
 * the user and the provider. The callback accepts a request only when the cookie is present, its
 * `state` equals the query's and the session's user is the cookie's user. The cookie is cleared on
 * every callback, so a `state` value is used once. The cookie is `SameSite=Lax` because the
 * provider's redirect is a cross-site navigation. Tokens are never logged.
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

  return new Hono<{ Variables: AuthVariables }>()
    .use("/api/channel-accounts/*", requireUser(auth))
    .use("/api/channel-accounts", requireUser(auth))
    .get("/api/channel-accounts", async (c) => {
      const accounts = await listChannelAccounts(db, c.get("userId"), dependencies.providers);

      const providers = [...dependencies.providers.values()].map((provider) => ({
        name: provider.name,
        channel: provider.channel,
        displayName: provider.displayName,
      }));

      return c.json({ providers, accounts }, 200);
    })
    .post(
      "/api/channel-accounts/:provider/connect",
      validate("param", providerParamsSchema),
      async (c) => {
        const provider = dependencies.providers.get(c.req.valid("param").provider);
        const userId = c.get("userId");
        const userEmail = provider ? await getUserEmail(db, userId) : null;

        if (!provider || !userEmail) {
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

        if (!provider) {
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
