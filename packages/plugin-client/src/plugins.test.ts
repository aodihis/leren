import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadPlugins } from "./plugins";

/** Plugins are loaded from temporary directories. */
describe("loadPlugins", () => {
  let pluginsDir: string;

  beforeEach(async () => {
    pluginsDir = await mkdtemp(join(tmpdir(), "leren-plugins-"));
  });

  afterEach(async () => {
    await rm(pluginsDir, { recursive: true, force: true });
  });

  async function writePlugin(name: string, files: Record<string, string>) {
    const directory = join(pluginsDir, name);

    await mkdir(directory);

    for (const [file, content] of Object.entries(files)) {
      await writeFile(join(directory, file), content);
    }
  }

  it("loads the manifest and the default-exported tools of each plugin", async () => {
    await writePlugin("greeter", {
      "manifest.json": JSON.stringify({ name: "greeter", version: "1.0.0", entry: "index.mjs" }),
      "index.mjs": 'export default { tools: ["tool-a", "tool-b"] };',
    });

    const plugins = await loadPlugins(pluginsDir);

    expect(plugins).toEqual([
      {
        manifest: { name: "greeter", version: "1.0.0", entry: "index.mjs" },
        tools: ["tool-a", "tool-b"],
      },
    ]);
  });

  it("skips files and directories without a manifest", async () => {
    await writeFile(join(pluginsDir, "README.md"), "not a plugin");
    await mkdir(join(pluginsDir, "empty"));

    expect(await loadPlugins(pluginsDir)).toEqual([]);
  });

  it("throws on a manifest that fails validation, naming the manifest path", async () => {
    await writePlugin("broken", {
      "manifest.json": JSON.stringify({ name: "", version: "1.0.0" }),
    });

    await expect(loadPlugins(pluginsDir)).rejects.toThrow(
      /Invalid plugin manifest .*manifest\.json/,
    );
  });

  it("throws when the entry file has no default export", async () => {
    await writePlugin("headless", {
      "manifest.json": JSON.stringify({ name: "headless", version: "1.0.0", entry: "index.mjs" }),
      "index.mjs": "export const tools = [];",
    });

    await expect(loadPlugins(pluginsDir)).rejects.toThrow(
      /Plugin "headless" must default-export definePlugin/,
    );
  });
});
