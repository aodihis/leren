import { beforeEach, describe, expect, it, vi } from "vitest";

const sendMail = vi.hoisted(() => vi.fn());
const verify = vi.hoisted(() => vi.fn());
const createTransport = vi.hoisted(() => vi.fn(() => ({ sendMail, verify })));

vi.mock("nodemailer", () => ({ createTransport }));

import { createSmtpEmailSender } from "./smtp";

describe("createSmtpEmailSender", () => {
  beforeEach(() => {
    sendMail.mockResolvedValue(undefined);
  });

  it("connects with the configured URL", () => {
    createSmtpEmailSender({ url: "smtp://localhost:51025", from: "Leren <a@b.c>" });

    expect(createTransport).toHaveBeenCalledWith("smtp://localhost:51025");
  });

  it("sends the message from the configured address", async () => {
    const sender = createSmtpEmailSender({ url: "smtp://localhost:51025", from: "Leren <a@b.c>" });

    await sender.send({ to: "x@y.z", subject: "Hi", text: "Body" });

    expect(sendMail).toHaveBeenCalledWith({
      from: "Leren <a@b.c>",
      to: "x@y.z",
      subject: "Hi",
      text: "Body",
      html: undefined,
    });
  });

  it("rejects when the provider rejects", async () => {
    sendMail.mockRejectedValue(new Error("refused"));
    const sender = createSmtpEmailSender({ url: "smtp://localhost:51025", from: "a@b.c" });

    await expect(sender.send({ to: "x@y.z", subject: "Hi", text: "Body" })).rejects.toThrow(
      "refused",
    );
  });

  it("verifies the connection through the transport", async () => {
    verify.mockResolvedValue(true);
    const sender = createSmtpEmailSender({ url: "smtp://localhost:51025", from: "a@b.c" });

    await expect(sender.verify()).resolves.toBeUndefined();
    expect(verify).toHaveBeenCalled();
  });
});
