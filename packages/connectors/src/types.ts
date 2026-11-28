import type { ProviderTokens } from "@leren/channels";

/** The names of the connectors that exist. `CONNECTORS` selects which of them are enabled. */
export const CONNECTOR_IDS = ["notion", "google_docs", "google_sheets"] as const;

export type ConnectorId = (typeof CONNECTOR_IDS)[number];

/** The account that an authorisation identifies. `providerAccountId` is stable for its life. */
export type ConnectorIdentity = { providerAccountId: string; label: string };

/** The fields of a token response that an identity can be read from. */
export type TokenResponse = Readonly<Record<string, unknown>>;

/**
 * The stored credentials of a connection. `clientId` names the OAuth client that the tokens were
 * issued to, which a refresh must present again. It is null for the product's own client, and the
 * registered id when the connector uses dynamic registration.
 */
export type ConnectorTokens = ProviderTokens & { clientId: string | null };

/**
 * How the OAuth client of a connector is known to the authorization server. `static` is a client
 * that the deployment registered and configured, with a secret. `dynamic` registers a public
 * client for each connection at the server's registration endpoint (RFC 7591).
 */
export type ClientRegistration = "static" | "dynamic";

/**
 * The description of one external MCP server and how to authorise access to it (decision 0054).
 * `allowedTools` lists the remote names of the read-only tools that the assistant may use. Every
 * other tool that the server advertises is dropped, whatever it does.
 */
export interface ConnectorDefinition {
  readonly id: ConnectorId;
  readonly displayName: string;
  readonly mcpUrl: string;
  readonly allowedTools: readonly string[];
  readonly oauth: {
    readonly registration: ClientRegistration;
    /**
     * The address of the authorization server's metadata (RFC 8414), from which the endpoints are
     * discovered. Without it, `authorizationUrl` and `tokenUrl` are used.
     */
    readonly metadataUrl?: string | undefined;
    readonly authorizationUrl?: string | undefined;
    readonly tokenUrl?: string | undefined;
    readonly revokeUrl?: string | undefined;
    readonly scopes: readonly string[];
    /** Extra query parameters of the authorization request. */
    readonly authorizationParameters?: Readonly<Record<string, string>> | undefined;
    /** The protected resource that tokens are bound to, sent as `resource` (RFC 8707). */
    readonly resource?: string | undefined;
  };
  /** Reads the account out of the token response, or throws when it cannot be identified. */
  identify(response: TokenResponse): ConnectorIdentity;
}

/** An enabled connector: its definition and how the product authenticates to its authorization server. */
export interface Connector {
  readonly definition: ConnectorDefinition;
  /**
   * Builds the authorization URL for the given `state` and PKCE `codeChallenge`. `clientId` is the
   * client that the authorization request was made for, which the callback must present again.
   */
  start(input: {
    state: string;
    codeChallenge: string;
    redirectUri: string;
  }): Promise<{ url: string; clientId: string }>;
  /** Exchanges the authorization code for tokens and identifies the account. */
  finish(input: {
    code: string;
    codeVerifier: string;
    redirectUri: string;
    clientId: string;
  }): Promise<{ identity: ConnectorIdentity; tokens: ConnectorTokens }>;
  /** Returns new tokens. Throws `InvalidGrantError` when the refresh token is no longer valid. */
  refresh(tokens: ConnectorTokens): Promise<ConnectorTokens>;
  /** Revokes the tokens at the authorization server, when it has a revocation endpoint. */
  revoke(tokens: ConnectorTokens): Promise<void>;
}
