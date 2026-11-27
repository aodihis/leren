import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const authClient = vi.hoisted(() => ({ getSession: vi.fn() }));

const messagesApi = vi.hoisted(() => ({ $get: vi.fn(), ":id": { $get: vi.fn() } }));

vi.mock("../../../modules/auth/auth-client", () => ({ authClient }));

vi.mock("../../../modules/api/api-client", () => ({
  api: { api: { messages: messagesApi } },
}));

import { renderApp } from "../../../testing";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const MESSAGE_ID = "11111111-1111-4111-8111-111111111111";
const PLAYBOOK_ID = "22222222-2222-4222-8222-222222222222";

const summary = {
  id: MESSAGE_ID,
  from: "sender@example.com",
  to: ["owner@example.com"],
  subject: "Deadline",
  status: "drafted",
  statusReason: null,
  receivedAt: "2026-11-23T10:00:00.000Z",
  outcome: "answer",
  deliveryState: "completed",
};

const detail = {
  ...summary,
  body: "When is the deadline?",
  decision: {
    outcome: "answer",
    body: "The deadline is Friday.",
    category: "project_question",
    citations: [PLAYBOOK_ID],
    citedPlaybooks: [{ id: PLAYBOOK_ID, topic: "Deadline" }],
    playbookIds: [PLAYBOOK_ID],
    reasons: [],
    revisions: 1,
    evaluations: [{ pass: true, issues: [] }],
    createdAt: "2026-11-23T10:00:01.000Z",
    delivery: {
      mode: "draft",
      state: "completed",
      request: { to: "sender@example.com" },
      response: { id: "draft-1" },
      attempts: 1,
      startedAt: "2026-11-23T10:00:02.000Z",
      finishedAt: "2026-11-23T10:00:03.000Z",
      mailboxDraftId: "draft-1",
      sentMessageId: null,
      error: null,
    },
  },
};

describe("processed emails routes", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    authClient.getSession.mockResolvedValue({
      data: { user: { id: "u1", name: "Ada", email: "ada@example.com" } },
      error: null,
    });
  });

  it("lists the emails with their status, outcome and delivery state", async () => {
    messagesApi.$get.mockImplementation(() =>
      jsonResponse({
        messages: [
          summary,
          {
            ...summary,
            id: "m2",
            subject: "Newsletter",
            status: "not_applicable",
            outcome: null,
            deliveryState: null,
          },
        ],
        nextCursor: null,
      }),
    );

    await renderApp("/emails");

    expect(await screen.findByRole("link", { name: "Deadline" })).toBeTruthy();
    const table = within(screen.getByRole("table"));

    expect(table.getByText("Reply ready")).toBeTruthy();
    expect(table.getByText("Answer")).toBeTruthy();
    expect(table.getByText("Delivered")).toBeTruthy();
    expect(table.getByText("Ignored")).toBeTruthy();
    expect(messagesApi.$get).toHaveBeenCalledWith({
      query: { limit: "25", status: undefined, cursor: undefined },
    });
  });

  it("explains when there is nothing to show", async () => {
    messagesApi.$get.mockImplementation(() => jsonResponse({ messages: [], nextCursor: null }));

    await renderApp("/emails");

    expect(await screen.findByText("No email has been processed yet.")).toBeTruthy();
  });

  it("filters by the status in the address and offers the next page", async () => {
    messagesApi.$get.mockImplementation(() =>
      jsonResponse({ messages: [summary], nextCursor: "next-page" }),
    );

    await renderApp("/emails?status=drafted");

    expect(await screen.findByRole("link", { name: "Older emails" })).toBeTruthy();
    expect(messagesApi.$get).toHaveBeenCalledWith({
      query: { limit: "25", status: "drafted", cursor: undefined },
    });
  });

  it("loads the list again with the status that the user chooses", async () => {
    messagesApi.$get.mockImplementation(() =>
      jsonResponse({ messages: [summary], nextCursor: null }),
    );
    const user = userEvent.setup();

    await renderApp("/emails");
    await user.selectOptions(await screen.findByLabelText("Status"), "failed");

    await vi.waitFor(() =>
      expect(messagesApi.$get).toHaveBeenLastCalledWith({
        query: { limit: "25", status: "failed", cursor: undefined },
      }),
    );
  });

  it("loads the list again with the outcome that the user chooses", async () => {
    messagesApi.$get.mockImplementation(() =>
      jsonResponse({ messages: [summary], nextCursor: null }),
    );
    const user = userEvent.setup();

    await renderApp("/emails");
    await user.selectOptions(await screen.findByLabelText("Outcome"), "escalate");

    await vi.waitFor(() =>
      expect(messagesApi.$get).toHaveBeenLastCalledWith({
        query: expect.objectContaining({ outcome: "escalate" }),
      }),
    );
  });

  it("shows failed emails since an instant from the address, and how to see them all", async () => {
    messagesApi.$get.mockImplementation(() => jsonResponse({ messages: [], nextCursor: null }));

    await renderApp("/emails?failed=true&since=2026-11-20T00:00:00.000Z");

    expect(await screen.findByText("No email matches these filters.")).toBeTruthy();
    expect(screen.getByText(/Showing failed emails received since/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Show all emails" })).toBeTruthy();
    expect(messagesApi.$get).toHaveBeenCalledWith({
      query: expect.objectContaining({ failed: "true", since: "2026-11-20T00:00:00.000Z" }),
    });
  });

  it("drops a malformed instant from the address and shows every email since a valid one", async () => {
    messagesApi.$get.mockImplementation(() =>
      jsonResponse({ messages: [{ ...summary, subject: "" }], nextCursor: null }),
    );

    await renderApp("/emails?since=yesterday");

    expect(await screen.findByRole("link", { name: "(no subject)" })).toBeTruthy();
    expect(screen.queryByText(/Showing/)).toBeNull();
    expect(messagesApi.$get).toHaveBeenCalledWith({
      query: expect.objectContaining({ since: undefined }),
    });
  });

  it("offers the newest page from a later page", async () => {
    messagesApi.$get.mockImplementation(() =>
      jsonResponse({ messages: [summary], nextCursor: null }),
    );

    await renderApp("/emails?cursor=page-2&since=2026-11-20T00:00:00.000Z");

    expect(await screen.findByRole("link", { name: "Newest emails" })).toBeTruthy();
    expect(screen.getByText(/Showing emails received since/)).toBeTruthy();
  });

  it("explains when the list cannot be loaded", async () => {
    messagesApi.$get.mockImplementation(() => jsonResponse({ error: "boom" }, 500));

    await renderApp("/emails");

    expect(await screen.findByText(/Could not load your processed emails/)).toBeTruthy();
  });

  it("shows the email, the reply, the cited playbook and the delivery record", async () => {
    messagesApi[":id"].$get.mockImplementation(() => jsonResponse(detail));

    await renderApp(`/emails/${MESSAGE_ID}`);

    expect(await screen.findByRole("heading", { name: "Deadline" })).toBeTruthy();
    expect(screen.getByText("When is the deadline?")).toBeTruthy();
    expect(screen.getByText("The deadline is Friday.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Deadline", description: "" })).toBeTruthy();
    expect(screen.getByText("draft-1", { selector: "dd" })).toBeTruthy();
    expect(screen.getByText("Request that was stored before the call")).toBeTruthy();
    expect(screen.getByText("Answer of the provider")).toBeTruthy();
  });

  it("says so when the assistant has not decided yet", async () => {
    messagesApi[":id"].$get.mockImplementation(() =>
      jsonResponse({
        ...detail,
        status: "queued",
        outcome: null,
        deliveryState: null,
        decision: null,
      }),
    );

    await renderApp(`/emails/${MESSAGE_ID}`);

    expect(
      await screen.findByText("The assistant has not decided on this email yet."),
    ).toBeTruthy();
  });

  it("shows an escalation that has no reply, no citation and no delivery", async () => {
    messagesApi[":id"].$get.mockImplementation(() =>
      jsonResponse({
        ...detail,
        subject: "",
        to: [],
        status: "escalated",
        decision: {
          ...detail.decision,
          outcome: "escalate",
          body: null,
          citations: [],
          citedPlaybooks: [],
          reasons: ["No playbook matches the email reliably."],
          delivery: {
            ...detail.decision.delivery,
            mode: null,
            state: null,
            attempts: 0,
            startedAt: null,
            finishedAt: null,
            mailboxDraftId: null,
            request: null,
            response: null,
          },
        },
      }),
    );

    await renderApp(`/emails/${MESSAGE_ID}`);

    expect(await screen.findByRole("heading", { name: "(no subject)" })).toBeTruthy();
    expect(screen.getByText("No playbook matches the email reliably.")).toBeTruthy();
    expect(screen.getByText("The assistant wrote no reply.")).toBeTruthy();
    expect(screen.getByText("The reply cites no playbook.")).toBeTruthy();
    expect(screen.queryByText("Request that was stored before the call")).toBeNull();
    expect(screen.queryByText("Answer of the provider")).toBeNull();
  });

  it("explains when the email cannot be loaded", async () => {
    messagesApi[":id"].$get.mockImplementation(() => jsonResponse({ error: "boom" }, 500));

    await renderApp(`/emails/${MESSAGE_ID}`);

    expect(await screen.findByText(/Could not load the email/)).toBeTruthy();
  });

  it("shows a message for an email that does not exist", async () => {
    messagesApi[":id"].$get.mockImplementation(() => jsonResponse({ error: "Not found" }, 404));

    await renderApp(`/emails/${MESSAGE_ID}`);

    expect(await screen.findByText("This email does not exist.")).toBeTruthy();
  });
});
