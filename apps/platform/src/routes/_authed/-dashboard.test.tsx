import { screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const authClient = vi.hoisted(() => ({ getSession: vi.fn() }));

const playbooksApi = vi.hoisted(() => ({ $get: vi.fn() }));

const channelAccountsApi = vi.hoisted(() => ({ $get: vi.fn() }));

const dashboardApi = vi.hoisted(() => ({
  overview: { $get: vi.fn() },
  playbooks: { ":id": { report: { $get: vi.fn() } } },
}));

vi.mock("../../modules/auth/auth-client", () => ({ authClient }));

vi.mock("../../modules/api/api-client", () => ({
  api: {
    api: {
      playbooks: playbooksApi,
      dashboard: dashboardApi,
      "channel-accounts": channelAccountsApi,
    },
  },
}));

import { renderApp } from "../../testing";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const PLAYBOOK_ID = "11111111-1111-4111-8111-111111111111";
const MESSAGE_ID = "22222222-2222-4222-8222-222222222222";

const overview = {
  days: 30,
  since: "2026-10-24T10:00:00.000Z",
  total: 7,
  byStatus: { sent: 4, failed: 1 },
  byOutcome: { answer: 5, escalate: 2 },
  byDeliveryState: { completed: 4, failed: 1 },
  failures: [
    {
      id: MESSAGE_ID,
      from: "sender@example.com",
      subject: "Broken delivery",
      receivedAt: "2026-11-22T10:00:00.000Z",
      status: "drafted",
      statusReason: null,
      deliveryState: "failed",
      deliveryError: "quota",
    },
  ],
};

const ended = {
  id: PLAYBOOK_ID,
  topic: "Vacation",
  examples: [],
  response: "I am away.",
  restrictions: "",
  startsAt: "2026-11-01T00:00:00.000Z",
  endsAt: "2026-11-10T00:00:00.000Z",
  timezone: "UTC",
  enabled: true,
  periodStatus: "expired",
  usable: false,
  conditions: [],
};

describe("dashboard", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    authClient.getSession.mockResolvedValue({
      data: { user: { id: "u1", name: "Ada", email: "ada@example.com" } },
      error: null,
    });
    channelAccountsApi.$get.mockImplementation(() => jsonResponse({ providers: [], accounts: [] }));
    playbooksApi.$get.mockImplementation(() => jsonResponse({ playbooks: [ended] }));
  });

  it("shows the counts by outcome and the failures on the overview", async () => {
    dashboardApi.overview.$get.mockImplementation(() => jsonResponse(overview));

    renderApp("/");

    const summary = await screen.findByRole("region", { name: "Email summary" });

    expect(within(summary).getByText("7")).toBeTruthy();
    expect(within(summary).getByRole("link", { name: "Answer emails" }).textContent).toBe("5");
    expect(within(summary).getByRole("link", { name: "Ignore emails" }).textContent).toBe("0");
    expect(screen.getByRole("link", { name: "Broken delivery" })).toBeTruthy();
    expect(dashboardApi.overview.$get).toHaveBeenCalledWith({ query: { days: "30" } });
  });

  it("opens the overview without the counts when they cannot be loaded", async () => {
    dashboardApi.overview.$get.mockImplementation(() => jsonResponse({}, 500));

    renderApp("/");

    expect(await screen.findByRole("heading", { name: "Your playbooks" })).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Email summary" })).toBeNull();
  });

  it("links a playbook that has ended to its report", async () => {
    dashboardApi.overview.$get.mockImplementation(() => jsonResponse(overview));

    renderApp("/playbooks");

    expect(await screen.findByRole("link", { name: "Report for Vacation" })).toBeTruthy();
  });

  it("shows the report of a playbook", async () => {
    dashboardApi.playbooks[":id"].report.$get.mockImplementation(() =>
      jsonResponse({
        playbook: {
          id: PLAYBOOK_ID,
          topic: "Vacation",
          startsAt: ended.startsAt,
          endsAt: ended.endsAt,
          timezone: "UTC",
        },
        total: 3,
        cited: 2,
        byOutcome: { answer: 2, escalate: 1 },
        byDeliveryState: { completed: 2 },
      }),
    );

    renderApp(`/playbooks/${PLAYBOOK_ID}/report`);

    expect(await screen.findByRole("heading", { name: "Report: Vacation" })).toBeTruthy();

    const outcomes = screen.getByRole("region", { name: "Outcomes" });

    expect(within(outcomes).getByText("Emails handled").nextSibling?.textContent).toBe("3");
    expect(within(outcomes).getByText("Cited in a reply").nextSibling?.textContent).toBe("2");
    expect(within(outcomes).getByText("Escalate").nextSibling?.textContent).toBe("1");
  });

  it("says that a playbook whose period has not ended has no report", async () => {
    dashboardApi.playbooks[":id"].report.$get.mockImplementation(() =>
      jsonResponse({ error: "period_not_ended" }, 409),
    );

    renderApp(`/playbooks/${PLAYBOOK_ID}/report`);

    expect(await screen.findByText(/no report yet/)).toBeTruthy();
  });
});
