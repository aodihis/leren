import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { AgentToolInput } from "@anvia/core";
import { z } from "zod";

const manifestSchema = z.object({
  name: z.string().min(1),
  version: z.string().min(1),
  description: z.string().optional(),
  entry: z.string().min(1),
});

/** The contents of a plugin manifest. `entry` is relative to the plugin directory. */
export type PluginManifest = z.infer<typeof manifestSchema>;

/** What the entry file of a plugin exports as its default: the tools it registers. */
export interface Plugin {
  readonly tools: readonly AgentToolInput[];
}

/** A plugin that was read from disk, with its manifest and the tools its entry file exports. */
export interface LoadedPlugin extends Plugin {
  readonly manifest: PluginManifest;
}

/** Returns the plugin unchanged, so that an entry file gets full type checking. */
export function definePlugin(plugin: Plugin): Plugin {
  return plugin;
}

/**
 * Loads every plugin in `pluginsDir`.
 *
 * Each subdirectory is one plugin and contains a `manifest.json`. Subdirectories without a
 * manifest are skipped. An invalid manifest, or an entry file without a default export, throws, so
 * a broken plugin fails at startup and not in the middle of an agent run.
 */
export async function loadPlugins(pluginsDir: string): Promise<LoadedPlugin[]> {
  const root = resolve(pluginsDir);
  const entries = await readdir(root, { withFileTypes: true });
  const plugins: LoadedPlugin[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const directory = join(root, entry.name);
    const manifest = await readManifest(directory);

    if (manifest) {
      plugins.push({ manifest, tools: await loadTools(directory, manifest) });
    }
  }

  return plugins;
}

async function readManifest(directory: string): Promise<PluginManifest | undefined> {
  const path = join(directory, "manifest.json");
  const text = await readFile(path, "utf8").catch(() => undefined);

  if (text === undefined) {
    return undefined;
  }

  const result = manifestSchema.safeParse(JSON.parse(text));

  if (!result.success) {
    throw new Error(`Invalid plugin manifest ${path}: ${result.error.message}`);
  }

  return result.data;
}

async function loadTools(
  directory: string,
  manifest: PluginManifest,
): Promise<readonly AgentToolInput[]> {
  const entryPath = join(directory, manifest.entry);
  const module: { default?: Plugin } = await import(pathToFileURL(entryPath).href);

  if (!module.default) {
    throw new Error(
      `Plugin "${manifest.name}" must default-export definePlugin(...): ${entryPath}`,
    );
  }

  return module.default.tools;
}
