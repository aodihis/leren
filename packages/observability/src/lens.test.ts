import type * as AnviaLens from "@anvia/lens";
import { describe, expect, it, vi } from "vitest";

const captured = vi.hoisted(() => ({ options: undefined as Record<string, unknown> | undefined }));

vi.mock("@anvia/lens", async (importOriginal) => {
  const actual = await importOriginal<typeof AnviaLens>();

  return {
    ...actual,
    LensClient: class extends actual.LensClient {
      constructor(options: ConstructorParameters<typeof actual.LensClient>[0]) {
        captured.options = { ...options };
        super(options);
      }
    },
  };
});

const { createLensObserver } = await import("./lens");

describe("createLensObserver", () => {
  it("exports the payloads and turns the redaction of the library on", async () => {
    const observer = createLensObserver({
      ANVIA_LENS_BASE_URL: "http://lens.test",
      ANVIA_LENS_PUBLIC_KEY: "pk-lens-test",
      ANVIA_LENS_SECRET_KEY: "sk-lens-test",
      ANVIA_LENS_SERVICE_NAME: "leren-test",
    });

    expect(captured.options).toMatchObject({
      captureMode: "full",
      redactInputs: true,
      redactOutputs: true,
    });

    await observer.close();
  });
});
