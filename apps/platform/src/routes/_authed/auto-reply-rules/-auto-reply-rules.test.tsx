import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const authClient = vi.hoisted(() => ({ getSession: vi.fn() }));

const rulesApi = vi.hoisted(() => ({
  $get: vi.fn(),
  $post: vi.fn(),
  ":id": { $get: vi.fn(), $put: vi.fn(), $delete: vi.fn() },
}));

vi.mock("../../../modules/auth/auth-client", () => ({ authClient }));

vi.mock("../../../modules/api/api-client", () => ({
  api: { api: { "auto-reply-rules": rulesApi } },
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

const holiday = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Holiday",
  enabled: true,
  startsAt: "2026-12-01T02:00:00.000Z",
  endsAt: null,
  timezone: "Asia/Jakarta",
  status: "scheduled",
  conditions: [email],
};

const always = {
  ...holiday,
  id: "22222222-2222-4222-8222-222222222222",
  name: "Always on",
  startsAt: null,
  status: "active",
};

describe("auto-reply rules routes", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    authClient.getSession.mockResolvedValue({
      data: { user: { id: "u1", name: "Ada", email: "ada@example.com" } },
      error: null,
    });
    rulesApi.$get.mockResolvedValue(jsonResponse({ rules: [] }, 200));
  });

  describe("list", () => {
    it("shows each rule with its derived status", async () => {
      rulesApi.$get.mockResolvedValue(jsonResponse({ rules: [holiday, always] }, 200));
      await renderApp("/auto-reply-rules");

      expect(await screen.findByText("Holiday")).toBeTruthy();
      expect(screen.getByText("Scheduled")).toBeTruthy();
      expect(screen.getByText("Always on")).toBeTruthy();
      expect(screen.getByText("Active")).toBeTruthy();
      expect(screen.getByText("Always")).toBeTruthy();
    });

    it("explains that there are no rules yet", async () => {
      await renderApp("/auto-reply-rules");

      expect(await screen.findByText(/You have no rules yet/)).toBeTruthy();
    });

    it("deletes a rule and reloads the list", async () => {
      rulesApi.$get
        .mockResolvedValueOnce(jsonResponse({ rules: [holiday] }, 200))
        .mockResolvedValue(jsonResponse({ rules: [] }, 200));
      rulesApi[":id"].$delete.mockResolvedValue(new Response(null, { status: 204 }));
      const user = userEvent.setup();

      await renderApp("/auto-reply-rules");
      await user.click(await screen.findByRole("button", { name: "Delete Holiday" }));

      expect(await screen.findByText(/You have no rules yet/)).toBeTruthy();
      expect(rulesApi[":id"].$delete).toHaveBeenCalledExactlyOnceWith({
        param: { id: holiday.id },
      });
    });

    it("tells the user when a rule could not be deleted", async () => {
      rulesApi.$get.mockResolvedValue(jsonResponse({ rules: [holiday] }, 200));
      rulesApi[":id"].$delete.mockResolvedValue(jsonResponse({ error: "boom" }, 500));
      const user = userEvent.setup();

      await renderApp("/auto-reply-rules");
      await user.click(await screen.findByRole("button", { name: "Delete Holiday" }));

      expect(await screen.findByText("Could not delete the rule")).toBeTruthy();
    });
  });

  describe("new rule", () => {
    it("sends the entered rule and returns to the list", async () => {
      rulesApi.$post.mockResolvedValue(jsonResponse({ rule: always }, 201));
      const user = userEvent.setup();
      const router = await renderApp("/auto-reply-rules/new");

      await user.type(await screen.findByLabelText("Name"), "Holiday");
      await user.type(screen.getByLabelText("Allowed senders"), "ignored");
      await user.click(screen.getByRole("button", { name: "Create rule" }));

      expect(await screen.findByText(/You have no rules yet/)).toBeTruthy();
      expect(router.state.location.pathname).toBe("/auto-reply-rules");
      expect(rulesApi.$post).toHaveBeenCalledExactlyOnceWith({
        json: {
          name: "Holiday",
          enabled: true,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          startsAt: null,
          endsAt: null,
          conditions: [email],
        },
      });
    });

    it("shows the API's field errors next to the fields it rejects", async () => {
      rulesApi.$post.mockResolvedValue(
        jsonResponse({ fieldErrors: { name: ["Enter a name"] } }, 400),
      );
      const user = userEvent.setup();
      const router = await renderApp("/auto-reply-rules/new");

      await user.click(await screen.findByRole("button", { name: "Create rule" }));

      expect(await screen.findByText("Enter a name")).toBeTruthy();
      expect(router.state.location.pathname).toBe("/auto-reply-rules/new");
    });

    it("shows a general error when the save fails for another reason", async () => {
      rulesApi.$post.mockResolvedValue(jsonResponse({ error: "boom" }, 500));
      const user = userEvent.setup();

      await renderApp("/auto-reply-rules/new");
      await user.click(await screen.findByRole("button", { name: "Create rule" }));

      expect(await screen.findByText("Could not save the rule")).toBeTruthy();
    });
  });

  describe("edit rule", () => {
    it("shows the stored rule with its dates in the rule's timezone", async () => {
      rulesApi[":id"].$get.mockResolvedValue(jsonResponse({ rule: holiday }, 200));
      await renderApp(`/auto-reply-rules/${holiday.id}`);

      expect((await screen.findByLabelText<HTMLInputElement>("Name")).value).toBe("Holiday");
      expect(screen.getByLabelText<HTMLInputElement>("Starts").value).toBe("2026-12-01T09:00");
      expect(screen.getByLabelText<HTMLInputElement>("Ends").value).toBe("");
      expect(rulesApi[":id"].$get).toHaveBeenCalledExactlyOnceWith({ param: { id: holiday.id } });
    });

    it("replaces the rule with the edited values", async () => {
      rulesApi[":id"].$get.mockResolvedValue(jsonResponse({ rule: holiday }, 200));
      rulesApi[":id"].$put.mockResolvedValue(jsonResponse({ rule: holiday }, 200));
      const user = userEvent.setup();

      await renderApp(`/auto-reply-rules/${holiday.id}`);
      await user.type(await screen.findByLabelText("Name"), " 2026");
      await user.click(screen.getByRole("button", { name: "Save changes" }));

      expect(await screen.findByText(/You have no rules yet/)).toBeTruthy();
      expect(rulesApi[":id"].$put).toHaveBeenCalledExactlyOnceWith({
        param: { id: holiday.id },
        json: {
          name: "Holiday 2026",
          enabled: true,
          timezone: "Asia/Jakarta",
          startsAt: "2026-12-01T02:00:00.000Z",
          endsAt: null,
          conditions: [email],
        },
      });
    });

    it("says so when the rule does not exist", async () => {
      rulesApi[":id"].$get.mockResolvedValue(jsonResponse({ error: "Not found" }, 404));
      await renderApp(`/auto-reply-rules/${holiday.id}`);

      expect(await screen.findByText("This rule does not exist.")).toBeTruthy();
    });
  });
});
