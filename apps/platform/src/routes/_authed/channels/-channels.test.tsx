import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const authClient = vi.hoisted(() => ({ getSession: vi.fn() }));

const channelAccountsApi = vi.hoisted(() => ({
  $get: vi.fn(),
  ":provider": {
    connect: { $post: vi.fn() },
    settings: { $get: vi.fn() },
    "sign-in": { $post: vi.fn() },
  },
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
        "You can connect at most 10 email accounts. Disconnect one before you connect another.",
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

  it("explains a disconnect that fails and keeps the list", async () => {
    channelAccountsApi.$get.mockImplementation(() => overview([connectedAccount]));
    channelAccountsApi[":id"].$delete.mockImplementation(() =>
      jsonResponse({ error: "Not found" }, 404),
    );
    const user = userEvent.setup();

    await renderApp("/channels");
    await user.click(await screen.findByRole("button", { name: "Disconnect dewi@company.com" }));

    expect(await screen.findByText("Could not disconnect the account")).toBeTruthy();
    expect(channelAccountsApi.$get).toHaveBeenCalledOnce();
  });

  it("explains a connection that fails for another reason", async () => {
    channelAccountsApi[":provider"].connect.$post.mockImplementation(() =>
      jsonResponse({ error: "boom" }, 500),
    );
    const user = userEvent.setup();

    await renderApp("/channels");
    await user.click(await screen.findByRole("button", { name: "Connect Google" }));

    expect(await screen.findByText("Could not connect the account. Try again.")).toBeTruthy();
  });

  it("names the provider of an account whose provider is no longer enabled", async () => {
    channelAccountsApi.$get.mockImplementation(() =>
      overview([{ ...connectedAccount, provider: "zoho" }], [google]),
    );

    await renderApp("/channels");

    expect(await screen.findByText("zoho")).toBeTruthy();
  });
});

const signIn = () => channelAccountsApi[":provider"]["sign-in"].$post;

/** Opens the sign-in form of the IMAP provider and fills in the address and the password. */
async function openForm() {
  const user = userEvent.setup();

  await renderApp("/channels");
  await user.click(await screen.findByRole("button", { name: "Connect Other email (IMAP)" }));
  await user.type(await screen.findByLabelText("Email address"), "ada@mail.test");
  await user.type(screen.getByLabelText("Password"), "app-password");

  return user;
}

describe("signing in to a mail server", () => {
  const imap = {
    name: "imap",
    channel: "email",
    displayName: "Other email (IMAP)",
    connection: "sign-in",
  };

  const suggested = {
    imapHost: "imap.mail.test",
    imapPort: 143,
    smtpHost: "smtp.mail.test",
    smtpPort: 587,
  };

  beforeEach(() => {
    vi.resetAllMocks();
    authClient.getSession.mockResolvedValue({
      data: { user: { id: "u1", name: "Ada", email: "ada@example.com" } },
      error: null,
    });
    channelAccountsApi.$get.mockImplementation(() => overview([], [google, imap]));
  });

  it("fills in the settings that the provider suggests for the address", async () => {
    channelAccountsApi[":provider"].settings.$get.mockImplementation(async () =>
      jsonResponse({ settings: suggested }, 200),
    );
    const user = await openForm();

    await user.click(screen.getByRole("button", { name: "Find settings" }));

    expect(channelAccountsApi[":provider"].settings.$get).toHaveBeenCalledExactlyOnceWith({
      param: { provider: "imap" },
      query: { address: "ada@mail.test" },
    });
    await vi.waitFor(() =>
      expect(screen.getByLabelText<HTMLInputElement>("Incoming server (IMAP)").value).toBe(
        "imap.mail.test",
      ),
    );
    expect(screen.getByLabelText<HTMLSelectElement>("SMTP port").value).toBe("587");
    expect(screen.queryByText(/No settings were found/)).toBeNull();
  });

  it.each([
    ["the provider knows none", () => jsonResponse({ error: "not_found" }, 404)],
    [
      "the lookup fails",
      () => {
        throw new Error("offline");
      },
    ],
  ])("says so when %s", async (_name, answer) => {
    channelAccountsApi[":provider"].settings.$get.mockImplementation(async () => answer());
    const user = await openForm();

    await user.click(screen.getByRole("button", { name: "Find settings" }));

    expect(await screen.findByText(/No settings were found for this address/)).toBeTruthy();
  });

  it("signs in with the entered settings, closes the form and reloads the accounts", async () => {
    channelAccountsApi.$get
      .mockImplementationOnce(() => overview([], [google, imap]))
      .mockImplementation(() =>
        overview([{ ...connectedAccount, provider: "imap", label: "ada@mail.test" }], [imap]),
      );
    signIn().mockImplementation(async () => jsonResponse({ account: connectedAccount }, 201));
    const user = await openForm();

    await user.type(screen.getByLabelText("Incoming server (IMAP)"), "imap.mail.test");
    await user.selectOptions(screen.getByLabelText("IMAP port"), "143");
    await user.type(screen.getByLabelText("Outgoing server (SMTP)"), "smtp.mail.test");
    await user.click(screen.getByRole("button", { name: "Connect" }));

    expect(signIn()).toHaveBeenCalledExactlyOnceWith({
      param: { provider: "imap" },
      json: {
        address: "ada@mail.test",
        username: "",
        password: "app-password",
        imapHost: "imap.mail.test",
        imapPort: 143,
        smtpHost: "smtp.mail.test",
        smtpPort: 465,
      },
    });
    expect(await screen.findByText("ada@mail.test")).toBeTruthy();
    expect(screen.queryByLabelText("Email address")).toBeNull();
  });

  it("shows the message of each field that the API rejected", async () => {
    signIn().mockImplementation(async () =>
      jsonResponse({ fieldErrors: { imapHost: ["Enter the incoming server"] } }, 400),
    );
    const user = await openForm();

    await user.click(screen.getByRole("button", { name: "Connect" }));

    expect(await screen.findByText("Enter the incoming server")).toBeTruthy();
    expect(screen.queryByText("Could not connect the account. Try again.")).toBeNull();
  });

  it.each([
    [
      "a known error",
      () => jsonResponse({ error: "authentication_failed" }, 400),
      "The mail server refused the user name or password. If your account uses two-step sign-in, use an app password.",
    ],
    [
      "an unknown error",
      () => jsonResponse({ error: "something_new" }, 400),
      "Could not connect the account. Try again.",
    ],
    [
      "a body that is not JSON",
      () => new Response("Bad gateway", { status: 502 }),
      "Could not connect the account. Try again.",
    ],
    [
      "a failed request",
      () => {
        throw new Error("offline");
      },
      "Could not connect the account. Try again.",
    ],
  ])("explains a sign-in refused with %s", async (_name, answer, message) => {
    signIn().mockImplementation(async () => answer());
    const user = await openForm();

    await user.click(screen.getByRole("button", { name: "Connect" }));

    expect(await screen.findByText(message)).toBeTruthy();
  });

  it("closes the form when it is cancelled", async () => {
    const user = await openForm();

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByLabelText("Email address")).toBeNull();
    expect(signIn()).not.toHaveBeenCalled();
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
