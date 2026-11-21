import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const authClient = vi.hoisted(() => ({ getSession: vi.fn() }));

const itemsApi = vi.hoisted(() => ({
  $get: vi.fn(),
  $post: vi.fn(),
  ":id": { $get: vi.fn(), $put: vi.fn(), $delete: vi.fn(), ":action": { $post: vi.fn() } },
}));

const rulesApi = vi.hoisted(() => ({ $get: vi.fn() }));

vi.mock("../../../modules/auth/auth-client", () => ({ authClient }));

vi.mock("../../../modules/api/api-client", () => ({
  api: {
    api: { "knowledge-items": itemsApi, "auto-reply-rules": rulesApi },
  },
}));

import { renderApp } from "../../../testing";

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const rule = {
  id: "22222222-2222-4222-8222-222222222222",
  name: "Holiday",
  timezone: "Asia/Jakarta",
};

const draft = {
  id: "11111111-1111-4111-8111-111111111111",
  ruleId: rule.id,
  topic: "Project status",
  examples: [],
  response: "On track.",
  restrictions: "",
  validFrom: null,
  validUntil: null,
  approvalStatus: "draft",
  approvedAt: null,
  usable: false,
  contacts: [],
};

const approved = {
  ...draft,
  id: "44444444-4444-4444-8444-444444444444",
  topic: "Budget",
  approvalStatus: "approved",
  usable: true,
};

const expired = {
  ...approved,
  id: "55555555-5555-4555-8555-555555555555",
  topic: "Old news",
  usable: false,
};

const archived = {
  ...draft,
  id: "66666666-6666-4666-8666-666666666666",
  topic: "Gone",
  approvalStatus: "archived",
};

describe("knowledge routes", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    authClient.getSession.mockResolvedValue({
      data: { user: { id: "u1", name: "Ada", email: "ada@example.com" } },
      error: null,
    });
    itemsApi.$get.mockImplementation(() => jsonResponse({ items: [] }, 200));
    rulesApi.$get.mockImplementation(() => jsonResponse({ rules: [rule] }, 200));
  });

  describe("list", () => {
    it("shows the status of each item and flags an approved item outside its validity", async () => {
      itemsApi.$get.mockImplementation(() =>
        jsonResponse({ items: [draft, approved, expired] }, 200),
      );
      await renderApp("/knowledge");

      expect(await screen.findByText("Project status")).toBeTruthy();
      expect(screen.getByText("Draft")).toBeTruthy();
      expect(screen.getAllByText("Approved")).toHaveLength(2);
      expect(screen.getAllByText("Outside its validity")).toHaveLength(1);
      expect(screen.getAllByText("Holiday")).toHaveLength(3);
    });

    it("explains that there is no knowledge yet", async () => {
      await renderApp("/knowledge");

      expect(await screen.findByText(/You have no knowledge yet/)).toBeTruthy();
    });

    it("offers only the actions that the status allows", async () => {
      itemsApi.$get.mockImplementation(() =>
        jsonResponse({ items: [draft, approved, archived] }, 200),
      );
      await renderApp("/knowledge");

      expect(await screen.findByRole("button", { name: "Approve Project status" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "Archive Project status" })).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Approve Budget" })).toBeNull();
      expect(screen.getByRole("button", { name: "Archive Budget" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "Restore Gone" })).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Archive Gone" })).toBeNull();
    });

    it("approves a draft and reloads the list", async () => {
      itemsApi.$get
        .mockImplementationOnce(() => jsonResponse({ items: [draft] }, 200))
        .mockResolvedValue(
          jsonResponse({ items: [{ ...draft, approvalStatus: "approved" }] }, 200),
        );
      itemsApi[":id"][":action"].$post.mockImplementation(() =>
        jsonResponse({ item: approved }, 200),
      );
      const user = userEvent.setup();

      await renderApp("/knowledge");
      await user.click(await screen.findByRole("button", { name: "Approve Project status" }));

      expect(await screen.findByText("Approved")).toBeTruthy();
      expect(itemsApi[":id"][":action"].$post).toHaveBeenCalledExactlyOnceWith({
        param: { id: draft.id, action: "approve" },
      });
    });

    it("tells the user when an action fails", async () => {
      itemsApi.$get.mockImplementation(() => jsonResponse({ items: [draft] }, 200));
      itemsApi[":id"][":action"].$post.mockImplementation(() =>
        jsonResponse({ error: "conflict" }, 409),
      );
      const user = userEvent.setup();

      await renderApp("/knowledge");
      await user.click(await screen.findByRole("button", { name: "Approve Project status" }));

      expect(await screen.findByText("Could not approve the item")).toBeTruthy();
    });

    it("deletes an item and reloads the list", async () => {
      itemsApi.$get
        .mockImplementationOnce(() => jsonResponse({ items: [draft] }, 200))
        .mockImplementation(() => jsonResponse({ items: [] }, 200));
      itemsApi[":id"].$delete.mockImplementation(() => new Response(null, { status: 204 }));
      const user = userEvent.setup();

      await renderApp("/knowledge");
      await user.click(await screen.findByRole("button", { name: "Delete Project status" }));

      expect(await screen.findByText(/You have no knowledge yet/)).toBeTruthy();
      expect(itemsApi[":id"].$delete).toHaveBeenCalledExactlyOnceWith({ param: { id: draft.id } });
    });
  });

  describe("new item", () => {
    it("sends the entered item with its contacts and returns to the list", async () => {
      itemsApi.$post.mockImplementation(() => jsonResponse({ item: draft }, 201));
      const user = userEvent.setup();
      const router = await renderApp("/knowledge/new");

      await user.type(await screen.findByLabelText("Topic"), "Project status");
      await user.type(screen.getByLabelText("Examples"), "How is it going?{Enter}When?");
      await user.type(screen.getByLabelText("Response"), "On track.");
      await user.type(screen.getByLabelText("Contacts"), "dewi@example.com, @Don");
      await user.click(screen.getByRole("button", { name: "Create item" }));

      expect(await screen.findByText(/You have no knowledge yet/)).toBeTruthy();
      expect(router.state.location.pathname).toBe("/knowledge");
      expect(itemsApi.$post).toHaveBeenCalledExactlyOnceWith({
        json: {
          ruleId: rule.id,
          topic: "Project status",
          examples: ["How is it going?", "When?"],
          response: "On track.",
          restrictions: "",
          validFrom: null,
          validUntil: null,
          contacts: ["dewi@example.com", "@Don"],
        },
      });
    });

    it("shows the errors of the API next to the fields", async () => {
      itemsApi.$post.mockResolvedValue(
        jsonResponse(
          { fieldErrors: { topic: ["Enter a topic"], response: ["Enter a response"] } },
          400,
        ),
      );
      const user = userEvent.setup();

      await renderApp("/knowledge/new");
      await user.click(await screen.findByRole("button", { name: "Create item" }));

      expect(await screen.findByText("Enter a topic")).toBeTruthy();
      expect(screen.getByText("Enter a response")).toBeTruthy();
    });

    it("asks the user to create a rule first when there is none", async () => {
      rulesApi.$get.mockImplementation(() => jsonResponse({ rules: [] }, 200));
      await renderApp("/knowledge/new");

      expect(await screen.findByRole("link", { name: "Create a rule" })).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Create item" })).toBeNull();
    });
  });

  describe("edit item", () => {
    it("loads the item, warns that an approved item returns to draft and replaces it", async () => {
      itemsApi[":id"].$get.mockImplementation(() => jsonResponse({ item: approved }, 200));
      itemsApi[":id"].$put.mockImplementation(() => jsonResponse({ item: draft }, 200));
      const user = userEvent.setup();

      await renderApp(`/knowledge/${approved.id}`);

      expect(await screen.findByText(/Saving a change returns it to draft/)).toBeTruthy();
      expect((screen.getByLabelText("Topic") as HTMLInputElement).value).toBe("Budget");

      await user.click(screen.getByRole("button", { name: "Save changes" }));

      expect(await screen.findByText(/You have no knowledge yet/)).toBeTruthy();
      expect(itemsApi[":id"].$put).toHaveBeenCalledWith(
        expect.objectContaining({ param: { id: approved.id } }),
      );
    });

    it("says so when the item does not exist", async () => {
      itemsApi[":id"].$get.mockImplementation(() => jsonResponse({ error: "Not found" }, 404));
      await renderApp(`/knowledge/${draft.id}`);

      expect(await screen.findByText("This item does not exist.")).toBeTruthy();
    });
  });
});
