import { describe, expect, it } from "vitest";
import { createObserver } from "./index";
import { redact, redactContactDetails } from "./redaction";

const completeEnv = {
  ANVIA_LENS_BASE_URL: "http://lens.test",
  ANVIA_LENS_PUBLIC_KEY: "pk-lens-test",
  ANVIA_LENS_SECRET_KEY: "sk-lens-test",
  ANVIA_LENS_SERVICE_NAME: "leren-test",
};

describe("createObserver", () => {
  it("returns a disabled observer when no connection variables are set", async () => {
    const observer = createObserver({});

    expect(observer.enabled).toBe(false);
    expect(observer.forAgent()).toBeUndefined();
    expect(observer.forPipeline()).toBeUndefined();
    expect(observer.evalReporter()).toBeUndefined();
    await expect(observer.flush()).resolves.toBeUndefined();
    await expect(observer.close()).resolves.toBeUndefined();
  });

  it("returns an enabled observer when the connection is complete", async () => {
    const observer = createObserver(completeEnv);

    expect(observer.enabled).toBe(true);
    expect(observer.forAgent()?.primaryTrace).toBe("lens");
    expect(observer.forPipeline()?.primaryTrace).toBe("lens");
    expect(observer.evalReporter()).toBeDefined();
    await observer.close();
  });

  it("fails fast when the connection is partial", () => {
    expect(() => createObserver({ ANVIA_LENS_BASE_URL: "http://lens.test" })).toThrow();
  });
});

describe("redact", () => {
  it("masks email addresses and phone numbers", () => {
    expect(redact("Mail a.b@example.com or call +62 812 3456 7890.")).toBe(
      "Mail [redacted] or call [redacted].",
    );
  });

  it("leaves other text unchanged", () => {
    expect(redact("Project 42 ships on 2026-12-01.")).toBe("Project 42 ships on 2026-12-01.");
  });
});

describe("redactContactDetails", () => {
  it("masks email addresses and phone numbers by their form", () => {
    expect(
      redactContactDetails(
        "Mail a.b@example.com, call +62 812 3456 7890, 0812-3456-7890 or (021) 555 1234.",
      ),
    ).toBe("Mail [redacted], call [redacted], [redacted] or [redacted].");
  });

  it("keeps order numbers, invoice numbers, dates, times and amounts", () => {
    const text =
      "Order 1234567890, invoice INV-2026-11-0042, meeting on 2026-11-26 10:00, total 1.250.000.000.";

    expect(redactContactDetails(text)).toBe(text);
  });
});
