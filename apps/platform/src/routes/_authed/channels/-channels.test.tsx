import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const authClient = vi.hoisted(() => ({ getSession: vi.fn() }));

const channelAccountsApi = vi.hoisted(() => ({
  $get: vi.fn(),
  ":provider": { connect: { $post: vi.fn() } },
  ":id": { $delete: vi.fn() },
}));

const playbooksApi = vi.hoisted(() => ({
  $get: vi.fn(),
  $post: vi.fn(),
  ":id": { $get: vi.fn(), $put: vi.fn(), $patch: vi.fn(), $delete: vi.fn() },
}));

vi.mock("../../../modules/auth/auth-client", () => ({ authClient }));

vi.mock("../../../modules/api/api-client", () => ({
  api: { api: { "channel-accounts": channelAccountsApi, playbooks: playbooksApi } },
}));

import { renderApp } from "../../../testing";

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const google = { name: "google", channel: "email", displayName: "Google" };
const mailpit = { name: "mailpit", channel: "email", displayName: "Mailpit (development)" };

const connectedAccount = {
  id: "11111111-1111-4111-8111-111111111111",
  channel: "email",
  provider: "google",
  label: "dewi@company.com",
  status: "active",
  usable: true,
};

function overview(accounts: unknown[] = [], providers: unknown[] = [google, mailpit]) {
  return jsonResponse({ providers, accounts }, 200);
}

const email = {
  channel: "email",
  channelAccountId: null,
  senderMode: "any",
  senderAllowlist: [],
  replyWhenTo: true,
  replyWhenCc: false,
  replyWhenBcc: false,
  requireSoleRecipient: false,
  mentionOverrides: false,
  mentionDetection: "alias",
  mentionAliases: [],
  threadMode: "both",
  skipBulkMail: true,
  replyMode: "draft",
};

const playbook = {
  id: "22222222-2222-4222-8222-222222222222",
  topic: "Budget",
  information: "On track.",
  instruction: "",
  startsAt: null,
  endsAt: null,
  timezone: "Asia/Jakarta",
  enabled: true,
  periodStatus: "active",
  usable: true,
  conditions: [email],
};

describe("channels route", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    authClient.getSession.mockResolvedValue({
      data: { user: { id: "u1", name: "Ada", email: "ada@example.com" } },
      error: null,
    });
    channelAccountsApi.$get.mockImplementation(() => overview());
  });

  it("lists the connected accounts with their status and the providers to connect", async () => {
    channelAccountsApi.$get.mockImplementation(() =>
      overview([
        connectedAccount,
        {
          ...connectedAccount,
          id: "a2",
          label: "old@company.com",
          status: "revoked",
          usable: false,
        },
        { ...connectedAccount, id: "a3", label: "off@company.com", usable: false },
      ]),
    );

    await renderApp("/channels");

    expect(await screen.findByText("dewi@company.com")).toBeTruthy();
    expect(screen.getByText("Connected")).toBeTruthy();
    expect(screen.getByText("Reconnect needed")).toBeTruthy();
    expect(screen.getByText("Provider off")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Connect Google" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Connect Mailpit (development)" })).toBeTruthy();
  });

  it("explains when nothing is connected and when no provider is enabled", async () => {
    channelAccountsApi.$get.mockImplementation(() => overview([], []));

    await renderApp("/channels");

    expect(await screen.findByText("You have not connected an account yet.")).toBeTruthy();
    expect(screen.getByText("No channel providers are enabled on this server.")).toBeTruthy();
  });

  it("sends the browser to the provider when connecting an OAuth provider", async () => {
    const assign = vi.fn();
    const originalLocation = window.location;

    vi.stubGlobal("location", { ...window.location, assign });
    channelAccountsApi[":provider"].connect.$post.mockImplementation(() =>
      jsonResponse({ status: "redirect", url: "https://accounts.google.com/authorize?x=1" }, 200),
    );
    const user = userEvent.setup();

    await renderApp("/channels");
    await user.click(await screen.findByRole("button", { name: "Connect Google" }));

    expect(channelAccountsApi[":provider"].connect.$post).toHaveBeenCalledExactlyOnceWith({
      param: { provider: "google" },
    });
    expect(assign).toHaveBeenCalledExactlyOnceWith("https://accounts.google.com/authorize?x=1");

    vi.stubGlobal("location", originalLocation);
  });

  it("reloads the accounts after a provider without OAuth connects at once", async () => {
    channelAccountsApi.$get
      .mockImplementationOnce(() => overview())
      .mockImplementation(() => overview([{ ...connectedAccount, provider: "mailpit" }]));
    channelAccountsApi[":provider"].connect.$post.mockImplementation(() =>
      jsonResponse({ status: "connected", account: connectedAccount }, 201),
    );
    const user = userEvent.setup();

    await renderApp("/channels");
    await user.click(await screen.findByRole("button", { name: "Connect Mailpit (development)" }));

    expect(await screen.findByText("dewi@company.com")).toBeTruthy();
  });

  it("explains a refused connection and a failed callback", async () => {
    channelAccountsApi[":provider"].connect.$post.mockImplementation(() =>
      jsonResponse({ error: "limit" }, 409),
    );
    const user = userEvent.setup();

    await renderApp("/channels?error=conflict");

    expect(
      await screen.findByText("That account is already connected to another user."),
    ).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Connect Google" }));

    expect(
      await screen.findByText(
        "You already have an email account. Disconnect it before you connect another.",
      ),
    ).toBeTruthy();
  });

  it("confirms a connection that the callback reported", async () => {
    await renderApp("/channels?connected=google");

    expect(await screen.findByText("The account is connected.")).toBeTruthy();
  });

  it("disconnects an account and reloads the list", async () => {
    channelAccountsApi.$get
      .mockImplementationOnce(() => overview([connectedAccount]))
      .mockImplementation(() => overview());
    channelAccountsApi[":id"].$delete.mockImplementation(() => new Response(null, { status: 204 }));
    const user = userEvent.setup();

    await renderApp("/channels");
    await user.click(await screen.findByRole("button", { name: "Disconnect dewi@company.com" }));

    expect(channelAccountsApi[":id"].$delete).toHaveBeenCalledExactlyOnceWith({
      param: { id: connectedAccount.id },
    });
    expect(await screen.findByText("You have not connected an account yet.")).toBeTruthy();
  });
});

describe("playbook email account", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    authClient.getSession.mockResolvedValue({
      data: { user: { id: "u1", name: "Ada", email: "ada@example.com" } },
      error: null,
    });
    playbooksApi.$get.mockImplementation(() => jsonResponse({ playbooks: [] }, 200));
    playbooksApi[":id"].$get.mockImplementation(() => jsonResponse({ playbook }, 200));
    playbooksApi[":id"].$put.mockImplementation(() => jsonResponse({ playbook }, 200));
    channelAccountsApi.$get.mockImplementation(() => overview([connectedAccount]));
  });

  it("lets a playbook choose a connected account and saves the choice", async () => {
    const user = userEvent.setup();

    await renderApp(`/playbooks/${playbook.id}`);
    await user.click(await screen.findByRole("tab", { name: "Rules" }));
    await user.selectOptions(await screen.findByLabelText("Email account"), connectedAccount.id);
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect(playbooksApi[":id"].$put).toHaveBeenCalledWith(
      expect.objectContaining({
        json: expect.objectContaining({
          conditions: [{ ...email, channelAccountId: connectedAccount.id }],
        }),
      }),
    );
  });

  it("still opens the playbook when the accounts cannot be loaded", async () => {
    channelAccountsApi.$get.mockImplementation(() => jsonResponse({ error: "boom" }, 500));
    const user = userEvent.setup();

    await renderApp(`/playbooks/${playbook.id}`);
    await user.click(await screen.findByRole("tab", { name: "Rules" }));

    const select = await screen.findByLabelText<HTMLSelectElement>("Email account");

    expect(select.value).toBe("");
    expect(select.options).toHaveLength(1);
  });
});
