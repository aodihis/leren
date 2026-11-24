import { randomBytes } from "node:crypto";

import { InvalidGrantError, getAccessToken } from "@leren/channels";
import type {
  AuthorisedAccount,
  ChannelAccountsDependencies,
  ChannelProvider,
  ConnectStart,
  ProviderTokens,
} from "@leren/channels";
import { channelAccounts } from "@leren/db";
import { createTestDatabase } from "@leren/db/testing";
import type { TestDatabase } from "@leren/db/testing";
import { createInMemoryEmailSender } from "@leren/email/testing";
import type { InMemoryEmailSender } from "@leren/email/testing";
import type { Logger } from "@leren/logger";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { createApp } from "../../app";
import { createAuth } from "../auth/service";
import { listChannelAccounts } from "./service";

const ORIGIN = "http://localhost:5173";
const PATH = "/api/channel-accounts";
const MISSING_ID = "00000000-0000-4000-8000-000000000000";
const MCP_SECRET = "an-mcp-test-secret-of-at-least-32-chars";
const COOKIE_SECRET = "a-cookie-test-secret-of-at-least-32-chars";

function createSilentLogger(): Logger {
  const logger: Logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    child: () => logger,
  };

  return logger;
}

const TOKENS: ProviderTokens = {
  accessToken: "access-token-1",
  refreshToken: "refresh-token-1",
  expiresAt: "2999-01-01T00:00:00.000Z",
};

/** A fake Google-like provider without the network. */
function createFakeProvider() {
  const state: { next: AuthorisedAccount } = {
    next: { providerAccountId: "sub-1", label: "one@example.com", tokens: TOKENS },
  };

  const provider = {
    name: "google",
    channel: "email",
    displayName: "Fake Google",
    start: vi.fn(
      ({ state: value, redirectUri }: { state: string; redirectUri: string }): ConnectStart => ({
        kind: "redirect",
        url: `https://provider.example/authorize?state=${value}&redirect_uri=${redirectUri}`,
      }),
    ),
    finish: vi.fn(async () => state.next),
    refresh: vi.fn(async (tokens: ProviderTokens) => ({
      ...tokens,
      accessToken: "access-token-2",
      expiresAt: "2999-01-01T00:00:00.000Z",
    })),
    revoke: vi.fn(async () => {}),
  } satisfies ChannelProvider;

  return { provider, state };
}

function createDirectProvider(): ChannelProvider {
  return {
    name: "mailpit",
    channel: "email",
    displayName: "Direct",
    start: ({ userEmail }) => ({
      kind: "connected",
      account: { providerAccountId: userEmail, label: userEmail, tokens: null },
    }),
    finish: async () => {
      throw new Error("No authorization step");
    },
    refresh: async (tokens) => tokens,
    revoke: async () => {},
  };
}

describe("channel accounts API", () => {
  let database: TestDatabase;
  let sender: InMemoryEmailSender;
  let app: ReturnType<typeof createApp>;
  let dependencies: ChannelAccountsDependencies;
  const fake = createFakeProvider();

  const post = (path: string, payload: unknown) =>
    app.request(path, {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN },
      body: JSON.stringify(payload),
    });

  const signIn = async (email: string) => {
    await post("/api/auth/email-otp/send-verification-otp", { email, type: "sign-in" });

    const otp = /\b\d{6}\b/.exec(sender.sent.at(-1)?.text ?? "")?.[0];
    const response = await post("/api/auth/sign-in/email-otp", { email, otp });

    return response.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; ");
  };

  const call = (cookie: string, method: string, path: string) =>
    app.request(path, { method, headers: { cookie } });

  /** Starts a connection and returns cookie and state. */
  const startConnection = async (cookie: string, provider = "google") => {
    const response = await call(cookie, "POST", `${PATH}/${provider}/connect`);
    const { url } = await response.json();

    const pending = response.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; ");

    return { response, pending, state: new URL(url).searchParams.get("state") ?? "" };
  };

  const callback = (cookie: string, pending: string, query: string) =>
    call(`${cookie}; ${pending}`, "GET", `${PATH}/google/callback?${query}`);

  const connect = async (cookie: string) => {
    const { pending, state } = await startConnection(cookie);

    return callback(cookie, pending, `code=the-code&state=${state}`);
  };

  const list = async (cookie: string) => {
    const response = await call(cookie, "GET", PATH);

    return (await response.json()) as {
      providers: { name: string }[];
      accounts: { id: string; label: string; status: string; usable: boolean }[];
    };
  };

  const connectAccount = async (
    email: string,
    tokens: ProviderTokens,
    providerAccountId: string,
  ) => {
    const cookie = await signIn(email);

    fake.state.next = { providerAccountId, label: email, tokens };
    await connect(cookie);

    const [account] = (await list(cookie)).accounts;

    const [row] = await database.db
      .select()
      .from(channelAccounts)
      .where(eq(channelAccounts.id, account?.id ?? ""));

    return { id: row?.id ?? "", userId: row?.userId ?? "" };
  };

  beforeAll(async () => {
    database = await createTestDatabase();
    sender = createInMemoryEmailSender();

    const logger = createSilentLogger();

    const auth = createAuth({
      db: database.db,
      emailSender: sender,
      logger,
      secret: "test-secret-test-secret-test-secret-1234",
      baseURL: "http://localhost:3000",
      trustedOrigins: [ORIGIN],
    });

    dependencies = {
      providers: new Map<string, ChannelProvider>([
        ["google", fake.provider],
        ["mailpit", createDirectProvider()],
      ]),
      encryptionKey: randomBytes(32),
    };

    app = createApp({
      auth,
      db: database.db,
      logger,
      requestKnowledgeIndex: vi.fn(),
      mcp: { secret: MCP_SECRET },
      channelAccounts: {
        ...dependencies,
        cookieSecret: COOKIE_SECRET,
        apiUrl: "http://localhost:3000",
        platformUrl: ORIGIN,
      },
    });
  });

  afterAll(async () => {
    await database.drop();
  });

  it("rejects every route without a session", async () => {
    for (const [method, path] of [
      ["GET", PATH],
      ["POST", `${PATH}/google/connect`],
      ["GET", `${PATH}/google/callback`],
      ["DELETE", `${PATH}/${MISSING_ID}`],
    ]) {
      const response = await app.request(path, { method });

      expect(response.status, `${method} ${path}`).toBe(401);
    }
  });

  it("lists the enabled providers and no accounts for a new user", async () => {
    const cookie = await signIn("empty@example.com");

    const result = await list(cookie);

    expect(result.providers.map((provider) => provider.name).toSorted()).toEqual([
      "google",
      "mailpit",
    ]);
    expect(result.accounts).toEqual([]);
  });

  it("answers an unknown or disabled provider with not found", async () => {
    const cookie = await signIn("unknown@example.com");

    expect((await call(cookie, "POST", `${PATH}/slack/connect`)).status).toBe(404);
    expect((await call(cookie, "GET", `${PATH}/slack/callback`)).status).toBe(404);
  });

  it("answers every provider route with not found when no provider is enabled", async () => {
    const bare = createApp({
      auth: createAuth({
        db: database.db,
        emailSender: sender,
        logger: createSilentLogger(),
        secret: "test-secret-test-secret-test-secret-1234",
        baseURL: "http://localhost:3000",
        trustedOrigins: [ORIGIN],
      }),
      db: database.db,
      logger: createSilentLogger(),
      requestKnowledgeIndex: vi.fn(),
      mcp: { secret: MCP_SECRET },
    });

    const cookie = await signIn("bare@example.com");

    const response = await bare.request(`${PATH}/google/connect`, {
      method: "POST",
      headers: { cookie },
    });

    expect(response.status).toBe(404);
  });

  it("connects an account through the OAuth redirect and stores encrypted credentials", async () => {
    const cookie = await signIn("owner@example.com");
    const { response, pending, state } = await startConnection(cookie);

    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toMatch(/HttpOnly/i);
    expect(response.headers.get("set-cookie")).toMatch(/SameSite=Lax/i);
    expect(fake.provider.start).toHaveBeenLastCalledWith(
      expect.objectContaining({
        state,
        redirectUri: "http://localhost:3000/api/channel-accounts/google/callback",
        userEmail: "owner@example.com",
        codeChallenge: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
      }),
    );

    fake.state.next = { providerAccountId: "sub-owner", label: "owner@gmail.com", tokens: TOKENS };

    const finished = await callback(cookie, pending, `code=the-code&state=${state}`);

    expect(finished.status).toBe(302);
    expect(finished.headers.get("location")).toBe(`${ORIGIN}/channels?connected=google`);
    expect(finished.headers.get("set-cookie")).toMatch(/channel_oauth=;|Max-Age=0/i);
    expect(fake.provider.finish).toHaveBeenLastCalledWith(
      expect.objectContaining({ code: "the-code" }),
    );

    const { accounts } = await list(cookie);

    expect(accounts).toEqual([
      expect.objectContaining({ label: "owner@gmail.com", status: "active", usable: true }),
    ]);
    expect(JSON.stringify(accounts)).not.toContain("access-token");

    const [row] = await database.db
      .select()
      .from(channelAccounts)
      .where(eq(channelAccounts.id, accounts[0]?.id ?? ""));

    expect(row?.credentials).toMatch(/^v1\./);
    expect(row?.credentials).not.toContain("refresh-token-1");
  });

  it("rejects a callback whose state, cookie or user does not match", async () => {
    const alice = await signIn("alice@example.com");
    const bob = await signIn("bob@example.com");
    const { pending, state } = await startConnection(alice);
    const invalid = `${ORIGIN}/channels?error=invalid_state`;

    const wrongState = await callback(alice, pending, "code=the-code&state=wrong");
    const noCookie = await call(alice, "GET", `${PATH}/google/callback?code=c&state=${state}`);
    const otherUser = await callback(bob, pending, `code=the-code&state=${state}`);
    const forged = await callback(alice, `${pending.slice(0, -4)}AAAA`, `code=c&state=${state}`);

    for (const response of [wrongState, noCookie, otherUser, forged]) {
      expect(response.headers.get("location")).toBe(invalid);
    }

    expect((await list(alice)).accounts).toEqual([]);
    expect((await list(bob)).accounts).toEqual([]);
  });

  it("reports a refusal at the provider without creating an account", async () => {
    const cookie = await signIn("denied@example.com");
    const { pending, state } = await startConnection(cookie);

    const response = await callback(cookie, pending, `error=access_denied&state=${state}`);

    expect(response.headers.get("location")).toBe(`${ORIGIN}/channels?error=denied`);
    expect((await list(cookie)).accounts).toEqual([]);
  });

  it("reports a failed code exchange without creating an account", async () => {
    const cookie = await signIn("failed@example.com");
    const { pending, state } = await startConnection(cookie);

    fake.provider.finish.mockRejectedValueOnce(new Error("exchange failed"));

    const response = await callback(cookie, pending, `code=the-code&state=${state}`);

    expect(response.headers.get("location")).toBe(`${ORIGIN}/channels?error=failed`);
    expect((await list(cookie)).accounts).toEqual([]);
  });

  it("allows one email account for each user and replaces it when it is connected again", async () => {
    const cookie = await signIn("single@example.com");

    fake.state.next = { providerAccountId: "sub-single", label: "old@gmail.com", tokens: TOKENS };
    await connect(cookie);

    fake.state.next = { providerAccountId: "sub-other", label: "other@gmail.com", tokens: TOKENS };

    const second = await connect(cookie);

    expect(second.headers.get("location")).toBe(`${ORIGIN}/channels?error=limit`);

    await database.db
      .update(channelAccounts)
      .set({ syncCursor: "100" })
      .where(eq(channelAccounts.providerAccountId, "sub-single"));

    fake.state.next = { providerAccountId: "sub-single", label: "new@gmail.com", tokens: TOKENS };
    await connect(cookie);

    const { accounts } = await list(cookie);

    expect(accounts).toHaveLength(1);
    expect(accounts[0]?.label).toBe("new@gmail.com");

    const [stored] = await database.db
      .select({ cursor: channelAccounts.syncCursor })
      .from(channelAccounts)
      .where(eq(channelAccounts.providerAccountId, "sub-single"));

    expect(stored?.cursor).toBeNull();
  });

  it("does not let a provider account belong to two users", async () => {
    const first = await signIn("first@example.com");
    const second = await signIn("second@example.com");

    fake.state.next = {
      providerAccountId: "sub-shared",
      label: "shared@gmail.com",
      tokens: TOKENS,
    };

    const connected = await connect(first);
    const stolen = await connect(second);

    expect(connected.headers.get("location")).toContain("connected=google");
    expect(stolen.headers.get("location")).toBe(`${ORIGIN}/channels?error=conflict`);
    expect((await list(first)).accounts).toHaveLength(1);
    expect((await list(second)).accounts).toEqual([]);
  });

  it("connects a provider without OAuth at once", async () => {
    const cookie = await signIn("direct@example.com");

    const response = await call(cookie, "POST", `${PATH}/mailpit/connect`);
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body).toMatchObject({
      status: "connected",
      account: { label: "direct@example.com", provider: "mailpit", usable: true },
    });

    const [row] = await database.db
      .select()
      .from(channelAccounts)
      .where(eq(channelAccounts.id, body.account.id));

    expect(row?.credentials).toBeNull();
    expect((await call(cookie, "POST", `${PATH}/mailpit/connect`)).status).toBe(201);
    expect((await list(cookie)).accounts).toHaveLength(1);
  });

  it("does not show, disconnect or revoke the account of another user", async () => {
    const owner = await signIn("private-owner@example.com");
    const intruder = await signIn("intruder@example.com");

    fake.state.next = {
      providerAccountId: "sub-private",
      label: "private@gmail.com",
      tokens: TOKENS,
    };
    await connect(owner);

    const [account] = (await list(owner)).accounts;

    expect((await list(intruder)).accounts).toEqual([]);
    expect((await call(intruder, "DELETE", `${PATH}/${account?.id}`)).status).toBe(404);
    expect(fake.provider.revoke).not.toHaveBeenCalled();
    expect((await list(owner)).accounts).toHaveLength(1);
  });

  it("revokes the tokens at the provider and deletes the account when it is disconnected", async () => {
    const cookie = await signIn("leaving@example.com");

    fake.state.next = {
      providerAccountId: "sub-leaving",
      label: "leaving@gmail.com",
      tokens: TOKENS,
    };
    await connect(cookie);

    const [account] = (await list(cookie)).accounts;
    const response = await call(cookie, "DELETE", `${PATH}/${account?.id}`);

    expect(response.status).toBe(204);
    expect(fake.provider.revoke).toHaveBeenCalledWith(TOKENS);
    expect((await list(cookie)).accounts).toEqual([]);
    expect((await call(cookie, "DELETE", `${PATH}/${account?.id}`)).status).toBe(404);
  });

  it("deletes the account even when revoking the tokens fails", async () => {
    const cookie = await signIn("stuck@example.com");

    fake.state.next = { providerAccountId: "sub-stuck", label: "stuck@gmail.com", tokens: TOKENS };
    await connect(cookie);
    fake.provider.revoke.mockRejectedValueOnce(new Error("provider is down"));

    const [account] = (await list(cookie)).accounts;

    expect((await call(cookie, "DELETE", `${PATH}/${account?.id}`)).status).toBe(204);
    expect((await list(cookie)).accounts).toEqual([]);
  });

  describe("access tokens", () => {
    it("returns a token that is still valid without refreshing it", async () => {
      const { id, userId } = await connectAccount("valid@example.com", TOKENS, "sub-valid");

      expect(await getAccessToken(database.db, dependencies, userId, id)).toBe("access-token-1");
      expect(fake.provider.refresh).not.toHaveBeenCalled();
    });

    it("refreshes an expired token and stores the new credentials", async () => {
      const expired = { ...TOKENS, expiresAt: "2000-01-01T00:00:00.000Z" };
      const { id, userId } = await connectAccount("expired@example.com", expired, "sub-expired");

      expect(await getAccessToken(database.db, dependencies, userId, id)).toBe("access-token-2");
      expect(fake.provider.refresh).toHaveBeenCalledWith(expired);
      expect(await getAccessToken(database.db, dependencies, userId, id)).toBe("access-token-2");
      expect(fake.provider.refresh).toHaveBeenCalledTimes(1);
    });

    it("marks the account revoked when the provider rejects the refresh token", async () => {
      const expired = { ...TOKENS, expiresAt: "2000-01-01T00:00:00.000Z" };
      const { id, userId } = await connectAccount("revoked@example.com", expired, "sub-revoked");

      fake.provider.refresh.mockRejectedValueOnce(new InvalidGrantError());

      expect(await getAccessToken(database.db, dependencies, userId, id)).toBeNull();

      const [account] = await listChannelAccounts(database.db, userId, dependencies.providers);

      expect(account).toMatchObject({ status: "revoked", usable: false });
      expect(await getAccessToken(database.db, dependencies, userId, id)).toBeNull();
    });

    it("throws a failure that may succeed later and keeps the account active", async () => {
      const expired = { ...TOKENS, expiresAt: "2000-01-01T00:00:00.000Z" };
      const { id, userId } = await connectAccount("flaky@example.com", expired, "sub-flaky");

      fake.provider.refresh.mockRejectedValueOnce(new Error("provider is down"));

      await expect(getAccessToken(database.db, dependencies, userId, id)).rejects.toThrow(
        /provider is down/,
      );

      const [account] = await listChannelAccounts(database.db, userId, dependencies.providers);

      expect(account?.status).toBe("active");
    });

    it("returns nothing for another user's account or a disabled provider", async () => {
      const { id, userId } = await connectAccount("guarded@example.com", TOKENS, "sub-guarded");
      const disabled = { ...dependencies, providers: new Map<string, ChannelProvider>() };

      expect(await getAccessToken(database.db, dependencies, MISSING_ID, id)).toBeNull();
      expect(await getAccessToken(database.db, disabled, userId, id)).toBeNull();

      const [account] = await listChannelAccounts(database.db, userId, disabled.providers);

      expect(account).toMatchObject({ status: "active", usable: false });
    });
  });
});
