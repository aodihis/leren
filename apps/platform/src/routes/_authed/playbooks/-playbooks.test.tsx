import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const authClient = vi.hoisted(() => ({ getSession: vi.fn() }));

const playbooksApi = vi.hoisted(() => ({
  $get: vi.fn(),
  $post: vi.fn(),
  ":id": { $get: vi.fn(), $put: vi.fn(), $delete: vi.fn(), ":action": { $post: vi.fn() } },
}));

vi.mock("../../../modules/auth/auth-client", () => ({ authClient }));

vi.mock("../../../modules/api/api-client", () => ({
  api: { api: { playbooks: playbooksApi } },
}));

import { renderApp } from "../../../testing";

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const email = {
  channel: "email",
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
};

const draft = {
  id: "11111111-1111-4111-8111-111111111111",
  topic: "Project status",
  examples: [],
  response: "On track.",
  restrictions: "",
  contacts: [],
  startsAt: "2026-12-01T02:00:00.000Z",
  endsAt: null,
  timezone: "Asia/Jakarta",
  approvalStatus: "draft",
  approvedAt: null,
  periodStatus: "scheduled",
  usable: false,
  conditions: [email],
};

const active = {
  ...draft,
  id: "44444444-4444-4444-8444-444444444444",
  topic: "Budget",
  startsAt: null,
  approvalStatus: "approved",
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

const archived = {
  ...draft,
  id: "66666666-6666-4666-8666-666666666666",
  topic: "Gone",
  approvalStatus: "archived",
};

describe("playbooks routes", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    authClient.getSession.mockResolvedValue({
      data: { user: { id: "u1", name: "Ada", email: "ada@example.com" } },
      error: null,
    });
    playbooksApi.$get.mockImplementation(() => jsonResponse({ playbooks: [] }, 200));
  });

  describe("list", () => {
    it("shows one status for each playbook and the period of each", async () => {
      playbooksApi.$get.mockImplementation(() =>
        jsonResponse({ playbooks: [draft, active, expired, archived] }, 200),
      );
      await renderApp("/playbooks");

      expect(await screen.findByText("Project status")).toBeTruthy();
      expect(screen.getByText("Draft")).toBeTruthy();
      expect(screen.getByText("Active")).toBeTruthy();
      expect(screen.getByText("Expired")).toBeTruthy();
      expect(screen.getByText("Archived")).toBeTruthy();
      expect(screen.getByText("Always")).toBeTruthy();
    });

    it("explains that there are no playbooks yet", async () => {
      await renderApp("/playbooks");

      expect(await screen.findByText(/You have no playbooks yet/)).toBeTruthy();
    });

    it("offers only the actions that the approval status allows", async () => {
      playbooksApi.$get.mockImplementation(() =>
        jsonResponse({ playbooks: [draft, active, archived] }, 200),
      );
      await renderApp("/playbooks");

      expect(await screen.findByRole("button", { name: "Approve Project status" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "Archive Project status" })).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Approve Budget" })).toBeNull();
      expect(screen.getByRole("button", { name: "Archive Budget" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "Restore Gone" })).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Archive Gone" })).toBeNull();
    });

    it("approves a draft and reloads the list", async () => {
      playbooksApi.$get
        .mockImplementationOnce(() => jsonResponse({ playbooks: [draft] }, 200))
        .mockImplementation(() => jsonResponse({ playbooks: [active] }, 200));
      playbooksApi[":id"][":action"].$post.mockImplementation(() =>
        jsonResponse({ playbook: active }, 200),
      );
      const user = userEvent.setup();

      await renderApp("/playbooks");
      await user.click(await screen.findByRole("button", { name: "Approve Project status" }));

      expect(await screen.findByText("Active")).toBeTruthy();
      expect(playbooksApi[":id"][":action"].$post).toHaveBeenCalledExactlyOnceWith({
        param: { id: draft.id, action: "approve" },
      });
    });

    it("tells the user when an action fails", async () => {
      playbooksApi.$get.mockImplementation(() => jsonResponse({ playbooks: [draft] }, 200));
      playbooksApi[":id"][":action"].$post.mockImplementation(() =>
        jsonResponse({ error: "conflict" }, 409),
      );
      const user = userEvent.setup();

      await renderApp("/playbooks");
      await user.click(await screen.findByRole("button", { name: "Approve Project status" }));

      expect(await screen.findByText("Could not approve the playbook")).toBeTruthy();
    });

    it("deletes a playbook and reloads the list", async () => {
      playbooksApi.$get
        .mockImplementationOnce(() => jsonResponse({ playbooks: [draft] }, 200))
        .mockImplementation(() => jsonResponse({ playbooks: [] }, 200));
      playbooksApi[":id"].$delete.mockImplementation(() => new Response(null, { status: 204 }));
      const user = userEvent.setup();

      await renderApp("/playbooks");
      await user.click(await screen.findByRole("button", { name: "Delete Project status" }));

      expect(await screen.findByText(/You have no playbooks yet/)).toBeTruthy();
      expect(playbooksApi[":id"].$delete).toHaveBeenCalledExactlyOnceWith({
        param: { id: draft.id },
      });
    });
  });

  describe("new playbook", () => {
    it("sends the knowledge and the rules of one form and returns to the list", async () => {
      playbooksApi.$post.mockImplementation(() => jsonResponse({ playbook: draft }, 201));
      const user = userEvent.setup();
      const router = await renderApp("/playbooks/new");

      await user.type(await screen.findByLabelText("Topic"), "Project status");
      await user.type(screen.getByLabelText("Examples"), "How is it going?{Enter}When?");
      await user.type(screen.getByLabelText("Response"), "On track.");
      await user.type(screen.getByLabelText("Contacts"), "dewi@example.com, @Don");
      await user.click(screen.getByRole("tab", { name: "Rules" }));
      await user.click(await screen.findByRole("combobox", { name: "Senders" }));
      await user.click(screen.getByRole("button", { name: "Create playbook" }));

      expect(await screen.findByText(/You have no playbooks yet/)).toBeTruthy();
      expect(router.state.location.pathname).toBe("/playbooks");
      expect(playbooksApi.$post).toHaveBeenCalledExactlyOnceWith({
        json: {
          topic: "Project status",
          examples: ["How is it going?", "When?"],
          response: "On track.",
          restrictions: "",
          contacts: ["dewi@example.com", "@Don"],
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          startsAt: null,
          endsAt: null,
          conditions: [email],
        },
      });
    });

    it("shows the errors of the API and opens the tab of the first rejected field", async () => {
      playbooksApi.$post.mockResolvedValue(
        jsonResponse({ fieldErrors: { endsAt: ["The end must not be before the start"] } }, 400),
      );
      const user = userEvent.setup();
      const router = await renderApp("/playbooks/new");

      await user.click(await screen.findByRole("button", { name: "Create playbook" }));

      expect(await screen.findByText("The end must not be before the start")).toBeTruthy();
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
      await user.click(await screen.findByRole("button", { name: "Create playbook" }));

      expect(await screen.findByText("Enter a topic")).toBeTruthy();
      expect(screen.getByText("Enter a response")).toBeTruthy();
    });

    it("shows a general error when the save fails for another reason", async () => {
      playbooksApi.$post.mockResolvedValue(jsonResponse({ error: "boom" }, 500));
      const user = userEvent.setup();

      await renderApp("/playbooks/new");
      await user.click(await screen.findByRole("button", { name: "Create playbook" }));

      expect(await screen.findByText("Could not save the playbook")).toBeTruthy();
    });
  });

  describe("edit playbook", () => {
    it("shows the stored playbook with its dates in the playbook's timezone", async () => {
      playbooksApi[":id"].$get.mockImplementation(() => jsonResponse({ playbook: draft }, 200));
      const user = userEvent.setup();

      await renderApp(`/playbooks/${draft.id}`);

      expect((await screen.findByLabelText<HTMLInputElement>("Topic")).value).toBe(
        "Project status",
      );

      await user.click(screen.getByRole("tab", { name: "Rules" }));

      expect((await screen.findByLabelText<HTMLInputElement>("Starts")).value).toBe(
        "2026-12-01T09:00",
      );
      expect(screen.getByLabelText<HTMLInputElement>("Ends").value).toBe("");
    });

    it("warns that an approved playbook returns to draft and replaces it", async () => {
      playbooksApi[":id"].$get.mockImplementation(() => jsonResponse({ playbook: active }, 200));
      playbooksApi[":id"].$put.mockImplementation(() => jsonResponse({ playbook: draft }, 200));
      const user = userEvent.setup();

      await renderApp(`/playbooks/${active.id}`);

      expect(await screen.findByText(/Saving a change returns it to draft/)).toBeTruthy();

      await user.type(screen.getByLabelText("Topic"), " 2026");
      await user.click(screen.getByRole("button", { name: "Save changes" }));

      expect(await screen.findByText(/You have no playbooks yet/)).toBeTruthy();
      expect(playbooksApi[":id"].$put).toHaveBeenCalledWith(
        expect.objectContaining({
          param: { id: active.id },
          json: expect.objectContaining({ topic: "Budget 2026", conditions: [email] }),
        }),
      );
    });

    it("says so when the playbook does not exist", async () => {
      playbooksApi[":id"].$get.mockImplementation(() => jsonResponse({ error: "Not found" }, 404));
      await renderApp(`/playbooks/${draft.id}`);

      expect(await screen.findByText("This playbook does not exist.")).toBeTruthy();
    });
  });
});
