import { describe, expect, it } from "vitest";

import { createInMemoryEmailSender } from "./testing";
import { createVerificationCodeEmail } from "./templates";

describe("createVerificationCodeEmail", () => {
  it("addresses the recipient and includes the code in both bodies", () => {
    const message = createVerificationCodeEmail("a@example.com", "123456");

    expect(message.to).toBe("a@example.com");
    expect(message.subject).toContain("123456");
    expect(message.text).toContain("123456");
    expect(message.html).toContain("123456");
  });
});

describe("createInMemoryEmailSender", () => {
  it("records every message it is asked to send", async () => {
    const sender = createInMemoryEmailSender();
    const message = createVerificationCodeEmail("a@example.com", "123456");

    await sender.send(message);

    expect(sender.sent).toEqual([message]);
  });
});
