import { InvalidGrantError } from "@leren/channels";
import { z } from "zod";

import type { Connector, ConnectorDefinition } from "./types";

const tokenResponseSchema = z
  .object({
    access_token: z.string().min(1),
    refresh_token: z.string().min(1).optional(),
    expires_in: z.number().positive().optional(),
  })
  .loose();

const metadataSchema = z.looseObject({
  issuer: z.string().optional(),
  authorization_endpoint: z.url(),
  token_endpoint: z.url(),
  registration_endpoint: z.url().optional(),
  revocation_endpoint: z.url().optional(),
});

const registrationSchema = z.looseObject({ client_id: z.string().min(1) });

type Endpoints = {
  authorization: string;
  token: string;
  registration: string | undefined;
  revocation: string | undefined;
};

export type OAuthClientOptions = {
  /** The client of the product. Used by connectors whose registration is `static`. */
  clientId?: string | undefined;
  clientSecret?: string | undefined;
  /** Replaces the global `fetch`, so tests can run without the network. */
  fetch?: typeof fetch;
};

function expiry(seconds: number | undefined): string | null {
  return seconds === undefined ? null : new Date(Date.now() + seconds * 1000).toISOString();
}

/**
 * Builds the OAuth 2.0 client of a connector: the authorization code flow with PKCE, refresh and
 * revocation. The definition supplies the endpoints, or the address that they are discovered from,
 * so one implementation serves every connector. A `dynamic` connector registers a public client for
 * each connection. Tokens are never logged.
 */
export function createConnector(
  definition: ConnectorDefinition,
  options: OAuthClientOptions,
): Connector {
  const send = options.fetch ?? fetch;
  const { oauth } = definition;

  let discovered: Promise<Endpoints> | undefined;

  const loadEndpoints = async (): Promise<Endpoints> => {
    if (!oauth.metadataUrl) {
      if (!oauth.authorizationUrl || !oauth.tokenUrl) {
        throw new Error(`${definition.displayName} has no OAuth endpoints`);
      }

      return {
        authorization: oauth.authorizationUrl,
        token: oauth.tokenUrl,
        registration: undefined,
        revocation: oauth.revokeUrl,
      };
    }

    const response = await send(oauth.metadataUrl, { headers: { accept: "application/json" } });

    if (!response.ok) {
      throw new Error(`${definition.displayName} metadata request failed (${response.status})`);
    }

    const metadata = metadataSchema.parse(await response.json());

    if (metadata.issuer !== undefined && metadata.issuer !== new URL(oauth.metadataUrl).origin) {
      throw new Error(`${definition.displayName} metadata names an unexpected issuer`);
    }

    return {
      authorization: metadata.authorization_endpoint,
      token: metadata.token_endpoint,
      registration: metadata.registration_endpoint,
      revocation: metadata.revocation_endpoint,
    };
  };

  const endpoints = (): Promise<Endpoints> => {
    discovered ??= loadEndpoints().catch((error: unknown) => {
      discovered = undefined;

      throw error;
    });

    return discovered;
  };

  const registerClient = async (redirectUri: string): Promise<string> => {
    const { registration } = await endpoints();

    if (!registration) {
      throw new Error(`${definition.displayName} does not offer client registration`);
    }

    const response = await send(registration, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        client_name: "Leren",
        redirect_uris: [redirectUri],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
      }),
    });

    if (!response.ok) {
      throw new Error(`${definition.displayName} client registration failed (${response.status})`);
    }

    return registrationSchema.parse(await response.json()).client_id;
  };

  const requestTokens = async (clientId: string, parameters: Record<string, string>) => {
    const { token } = await endpoints();
    const body = new URLSearchParams({ ...parameters, client_id: clientId });

    if (oauth.resource) {
      body.set("resource", oauth.resource);
    }

    if (oauth.registration === "static") {
      body.set("client_secret", options.clientSecret ?? "");
    }

    const response = await send(token, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body,
    });

    if (!response.ok) {
      const error: unknown = await response.json().catch(() => undefined);

      if (
        response.status === 400 &&
        z.object({ error: z.literal("invalid_grant") }).safeParse(error).success
      ) {
        throw new InvalidGrantError();
      }

      throw new Error(
        `${definition.displayName} token request failed with status ${response.status}`,
      );
    }

    return tokenResponseSchema.parse(await response.json());
  };

  const clientIdOf = (stored: string | null): string => stored ?? options.clientId ?? "";

  return {
    definition,
    async start({ state, codeChallenge, redirectUri }) {
      const { authorization } = await endpoints();

      const clientId =
        oauth.registration === "dynamic" ? await registerClient(redirectUri) : clientIdOf(null);

      const parameters = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: "code",
        state,
        code_challenge: codeChallenge,
        code_challenge_method: "S256",
        ...oauth.authorizationParameters,
      });

      if (oauth.scopes.length > 0) {
        parameters.set("scope", oauth.scopes.join(" "));
      }

      if (oauth.resource) {
        parameters.set("resource", oauth.resource);
      }

      const url = new URL(authorization);

      url.search = parameters.toString();

      return { url: url.toString(), clientId };
    },
    async finish({ code, codeVerifier, redirectUri, clientId }) {
      const response = await requestTokens(clientId, {
        grant_type: "authorization_code",
        code,
        code_verifier: codeVerifier,
        redirect_uri: redirectUri,
      });

      return {
        identity: definition.identify(response),
        tokens: {
          accessToken: response.access_token,
          refreshToken: response.refresh_token ?? null,
          expiresAt: expiry(response.expires_in),
          clientId: oauth.registration === "dynamic" ? clientId : null,
        },
      };
    },
    async refresh(tokens) {
      if (!tokens.refreshToken) {
        throw new InvalidGrantError("The connection has no refresh token");
      }

      const response = await requestTokens(clientIdOf(tokens.clientId), {
        grant_type: "refresh_token",
        refresh_token: tokens.refreshToken,
      });

      return {
        accessToken: response.access_token,
        refreshToken: response.refresh_token ?? tokens.refreshToken,
        expiresAt: expiry(response.expires_in),
        clientId: tokens.clientId,
      };
    },
    async revoke(tokens) {
      const { revocation } = await endpoints();

      if (!revocation) {
        return;
      }

      const response = await send(revocation, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          token: tokens.refreshToken ?? tokens.accessToken,
          client_id: clientIdOf(tokens.clientId),
        }),
      });

      if (!response.ok) {
        throw new Error(
          `${definition.displayName} token revocation failed with status ${response.status}`,
        );
      }
    },
  };
}
