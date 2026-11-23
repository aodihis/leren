import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const authClient = vi.hoisted(() => ({ getSession: vi.fn() }));

const playbooksApi = vi.hoisted(() => ({
  $get: vi.fn(),
  $post: vi.fn(),
  ":id": { $get: vi.fn(), $put: vi.fn(), $patch: vi.fn(), $delete: vi.fn() },
}));

const channelAccountsApi = vi.hoisted(() => ({ $get: vi.fn() }));

vi.mock("../../../modules/auth/auth-client", () => ({ authClient }));

vi.mock("../../../modules/api/api-client", () => ({
  api: { api: { playbooks: playbooksApi, "channel-accounts": channelAccountsApi } },
}));

import { renderApp } from "../../../testing";

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const ACCOUNT_ID = "88888888-8888-4888-8888-888888888888";

async function chooseAccount(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("tab", { name: "Rules" }));
  await user.selectOptions(await screen.findByLabelText("Email account"), ACCOUNT_ID);
}

const email = {
  channel: "email",
  channelAccountId: ACCOUNT_ID,
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

const scheduled = {
  id: "11111111-1111-4111-8111-111111111111",
  topic: "Project status",
  examples: [],
  response: "On track.",
  restrictions: "",
  startsAt: "2026-12-01T02:00:00.000Z",
  endsAt: null,
  timezone: "Asia/Jakarta",
  enabled: true,
  periodStatus: "scheduled",
  usable: false,
  conditions: [email],
};

const active = {
  ...scheduled,
  id: "44444444-4444-4444-8444-444444444444",
  topic: "Budget",
  startsAt: null,
  periodStatus: "active",
  usable: true,
};

const expired = {
  ...active,
  id: "55555555-5555-4555-8555-555555555555",
  topic: "Old news",
  endsAt: "2020-01-01T00:00:00.000Z",
  periodStatus: "expired",
  usable: false,
};

const disabled = {
  ...scheduled,
  id: "66666666-6666-4666-8666-666666666666",
  topic: "Gone",
  enabled: false,
};

describe("playbooks routes", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    authClient.getSession.mockResolvedValue({
      data: { user: { id: "u1", name: "Ada", email: "ada@example.com" } },
      error: null,
    });
    playbooksApi.$get.mockImplementation(() => jsonResponse({ playbooks: [] }, 200));
    channelAccountsApi.$get.mockImplementation(() =>
      jsonResponse(
        {
          providers: [],
          accounts: [
            {
              id: ACCOUNT_ID,
              channel: "email",
              provider: "google",
              label: "me@example.com",
              status: "active",
              usable: true,
            },
          ],
        },
        200,
      ),
    );
  });

  describe("list", () => {
    it("shows one status for each playbook and the period of each", async () => {
      playbooksApi.$get.mockImplementation(() =>
        jsonResponse({ playbooks: [scheduled, active, expired, disabled] }, 200),
      );
      await renderApp("/playbooks");

      expect(await screen.findByText("Project status")).toBeTruthy();
      expect(screen.getByText("Scheduled")).toBeTruthy();
      expect(screen.getByText("Active")).toBeTruthy();
      expect(screen.getByText("Expired")).toBeTruthy();
      expect(screen.getByText("Disabled")).toBeTruthy();
      expect(screen.getByText("Always")).toBeTruthy();
    });

    it("explains that there are no playbooks yet", async () => {
      await renderApp("/playbooks");

      expect(await screen.findByText(/You have no playbooks yet/)).toBeTruthy();
    });

    it("offers Disable for an enabled playbook and Enable for a disabled one", async () => {
      playbooksApi.$get.mockImplementation(() =>
        jsonResponse({ playbooks: [scheduled, disabled] }, 200),
      );
      await renderApp("/playbooks");

      expect(await screen.findByRole("button", { name: "Disable Project status" })).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Enable Project status" })).toBeNull();
      expect(screen.getByRole("button", { name: "Enable Gone" })).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Disable Gone" })).toBeNull();
    });

    it("disables a playbook and reloads the list", async () => {
      playbooksApi.$get
        .mockImplementationOnce(() => jsonResponse({ playbooks: [active] }, 200))
        .mockImplementation(() =>
          jsonResponse({ playbooks: [{ ...active, enabled: false }] }, 200),
        );
      playbooksApi[":id"].$patch.mockImplementation(() =>
        jsonResponse({ playbook: { ...active, enabled: false } }, 200),
      );
      const user = userEvent.setup();

      await renderApp("/playbooks");
      await user.click(await screen.findByRole("button", { name: "Disable Budget" }));

      expect(await screen.findByText("Disabled")).toBeTruthy();
      expect(playbooksApi[":id"].$patch).toHaveBeenCalledExactlyOnceWith({
        param: { id: active.id },
        json: { enabled: false },
      });
    });

    it("tells the user when the switch fails", async () => {
      playbooksApi.$get.mockImplementation(() => jsonResponse({ playbooks: [scheduled] }, 200));
      playbooksApi[":id"].$patch.mockImplementation(() => jsonResponse({ error: "boom" }, 500));
      const user = userEvent.setup();

      await renderApp("/playbooks");
      await user.click(await screen.findByRole("button", { name: "Disable Project status" }));

      expect(await screen.findByText("Could not disable the playbook")).toBeTruthy();
    });

    it("marks a playbook that is on and names no account", async () => {
      const withoutAccount = { ...active, conditions: [{ ...email, channelAccountId: null }] };

      playbooksApi.$get.mockImplementation(() =>
        jsonResponse({ playbooks: [withoutAccount, scheduled, disabled] }, 200),
      );

      await renderApp("/playbooks");

      expect(await screen.findAllByText("No mailbox")).toHaveLength(1);
    });

    it("marks a playbook that is on and names an account that was revoked", async () => {
      channelAccountsApi.$get.mockImplementation(() =>
        jsonResponse(
          {
            providers: [],
            accounts: [
              {
                id: ACCOUNT_ID,
                channel: "email",
                provider: "google",
                label: "me@example.com",
                status: "revoked",
                usable: false,
              },
            ],
          },
          200,
        ),
      );
      playbooksApi.$get.mockImplementation(() => jsonResponse({ playbooks: [active] }, 200));

      await renderApp("/playbooks");

      expect(await screen.findAllByText("No mailbox")).toHaveLength(1);
    });

    it("falls back to a general message when the refusal has no reason", async () => {
      playbooksApi.$get.mockImplementation(() => jsonResponse({ playbooks: [disabled] }, 200));
      playbooksApi[":id"].$patch.mockImplementation(
        () => new Response("<html>Bad request</html>", { status: 400 }),
      );
      const user = userEvent.setup();

      await renderApp("/playbooks");
      await user.click(await screen.findByRole("button", { name: "Enable Gone" }));

      expect(await screen.findByText("Could not enable the playbook")).toBeTruthy();
    });

    it("shows why a playbook cannot be turned on without an account", async () => {
      const withoutAccount = { ...disabled, conditions: [{ ...email, channelAccountId: null }] };

      playbooksApi.$get.mockImplementation(() =>
        jsonResponse({ playbooks: [withoutAccount] }, 200),
      );
      playbooksApi[":id"].$patch.mockImplementation(() =>
        jsonResponse(
          {
            fieldErrors: {
              channelAccountId: [
                "Choose the account that this playbook answers on, or turn the playbook off",
              ],
            },
          },
          400,
        ),
      );
      const user = userEvent.setup();

      await renderApp("/playbooks");
      await user.click(await screen.findByRole("button", { name: "Enable Gone" }));

      expect(
        await screen.findByText(
          "Choose the account that this playbook answers on, or turn the playbook off",
        ),
      ).toBeTruthy();
    });

    it("deletes a playbook and reloads the list", async () => {
      playbooksApi.$get
        .mockImplementationOnce(() => jsonResponse({ playbooks: [scheduled] }, 200))
        .mockImplementation(() => jsonResponse({ playbooks: [] }, 200));
      playbooksApi[":id"].$delete.mockImplementation(() => new Response(null, { status: 204 }));
      const user = userEvent.setup();

      await renderApp("/playbooks");
      await user.click(await screen.findByRole("button", { name: "Delete Project status" }));

      expect(await screen.findByText(/You have no playbooks yet/)).toBeTruthy();
      expect(playbooksApi[":id"].$delete).toHaveBeenCalledExactlyOnceWith({
        param: { id: scheduled.id },
      });
    });
  });

  describe("new playbook", () => {
    it("sends the knowledge and the rules of one form and returns to the list", async () => {
      playbooksApi.$post.mockImplementation(() => jsonResponse({ playbook: scheduled }, 201));
      const user = userEvent.setup();
      const router = await renderApp("/playbooks/new");

      await user.type(await screen.findByLabelText("Topic"), "Project status");
      await user.type(screen.getByLabelText("Examples"), "How is it going?{Enter}When?");
      await user.type(screen.getByLabelText("Response"), "On track.");
      await chooseAccount(user);
      await user.click(await screen.findByRole("combobox", { name: "Senders" }));
      await user.click(screen.getByRole("button", { name: "Create playbook" }));

      expect(await screen.findByText(/You have no playbooks yet/)).toBeTruthy();
      expect(router.state.location.pathname).toBe("/playbooks");
      expect(playbooksApi.$post).toHaveBeenCalledExactlyOnceWith({
        json: {
          enabled: true,
          topic: "Project status",
          examples: ["How is it going?", "When?"],
          response: "On track.",
          restrictions: "",
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          startsAt: null,
          endsAt: null,
          conditions: [email],
        },
      });
    });

    it("shows the errors of the API and opens the tab of the first rejected field", async () => {
      playbooksApi.$post.mockResolvedValue(
        jsonResponse({ fieldErrors: { conditions: ["Enter at least one sender"] } }, 400),
      );
      const user = userEvent.setup();
      const router = await renderApp("/playbooks/new");

      await screen.findByLabelText("Topic");
      await chooseAccount(user);
      await user.click(screen.getByRole("button", { name: "Create playbook" }));

      expect(await screen.findByText("Enter at least one sender")).toBeTruthy();
      expect(screen.getByRole("tab", { name: "Rules" }).getAttribute("data-state")).toBe("active");
      expect(router.state.location.pathname).toBe("/playbooks/new");
    });

    it("shows the errors of the API next to the knowledge fields", async () => {
      playbooksApi.$post.mockResolvedValue(
        jsonResponse(
          { fieldErrors: { topic: ["Enter a topic"], response: ["Enter a response"] } },
          400,
        ),
      );
      const user = userEvent.setup();

      await renderApp("/playbooks/new");
      await screen.findByLabelText("Topic");
      await chooseAccount(user);
      await user.click(screen.getByRole("button", { name: "Create playbook" }));

      expect(await screen.findByText("Enter a topic")).toBeTruthy();
      expect(screen.getByText("Enter a response")).toBeTruthy();
    });

    it("shows a general error when the save fails for another reason", async () => {
      playbooksApi.$post.mockResolvedValue(jsonResponse({ error: "boom" }, 500));
      const user = userEvent.setup();

      await renderApp("/playbooks/new");
      await screen.findByLabelText("Topic");
      await chooseAccount(user);
      await user.click(screen.getByRole("button", { name: "Create playbook" }));

      expect(await screen.findByText("Could not save the playbook")).toBeTruthy();
    });

    it("asks for an account before it saves a playbook that is on", async () => {
      const user = userEvent.setup();
      const router = await renderApp("/playbooks/new");

      await user.click(await screen.findByRole("button", { name: "Create playbook" }));

      expect(
        await screen.findByText(
          "Choose the account that this playbook answers on, or turn the playbook off",
        ),
      ).toBeTruthy();
      expect(screen.getByRole("tab", { name: "Rules" }).getAttribute("data-state")).toBe("active");
      expect(playbooksApi.$post).not.toHaveBeenCalled();
      expect(router.state.location.pathname).toBe("/playbooks/new");
    });

    it("shows the account error of the API next to the account field", async () => {
      playbooksApi.$post.mockResolvedValue(
        jsonResponse(
          { fieldErrors: { channelAccountId: ["Choose one of your own connected accounts"] } },
          400,
        ),
      );
      const user = userEvent.setup();

      await renderApp("/playbooks/new");
      await screen.findByLabelText("Topic");
      await chooseAccount(user);
      await user.click(screen.getByRole("button", { name: "Create playbook" }));

      expect(await screen.findByText("Choose one of your own connected accounts")).toBeTruthy();
      expect(screen.getByRole("tab", { name: "Rules" }).getAttribute("data-state")).toBe("active");
    });
  });

  describe("edit playbook", () => {
    it("shows the stored playbook with its dates in the playbook's timezone", async () => {
      playbooksApi[":id"].$get.mockImplementation(() => jsonResponse({ playbook: scheduled }, 200));
      const user = userEvent.setup();

      await renderApp(`/playbooks/${scheduled.id}`);

      expect((await screen.findByLabelText<HTMLInputElement>("Topic")).value).toBe(
        "Project status",
      );

      await user.click(screen.getByRole("tab", { name: "Rules" }));

      expect((await screen.findByLabelText<HTMLInputElement>("Starts")).value).toBe(
        "2026-12-01T09:00",
      );
      expect(screen.getByLabelText<HTMLInputElement>("Ends").value).toBe("");
    });

    it("replaces the playbook with the edited values", async () => {
      playbooksApi[":id"].$get.mockImplementation(() => jsonResponse({ playbook: active }, 200));
      playbooksApi[":id"].$put.mockImplementation(() => jsonResponse({ playbook: active }, 200));
      const user = userEvent.setup();

      await renderApp(`/playbooks/${active.id}`);
      await user.type(await screen.findByLabelText("Topic"), " 2026");
      await user.click(screen.getByRole("button", { name: "Save changes" }));

      expect(await screen.findByText(/You have no playbooks yet/)).toBeTruthy();
      expect(playbooksApi[":id"].$put).toHaveBeenCalledWith(
        expect.objectContaining({
          param: { id: active.id },
          json: expect.objectContaining({
            topic: "Budget 2026",
            enabled: true,
            conditions: [email],
          }),
        }),
      );
    });

    it("says so when the playbook does not exist", async () => {
      playbooksApi[":id"].$get.mockImplementation(() => jsonResponse({ error: "Not found" }, 404));
      await renderApp(`/playbooks/${scheduled.id}`);

      expect(await screen.findByText("This playbook does not exist.")).toBeTruthy();
    });
  });
});
