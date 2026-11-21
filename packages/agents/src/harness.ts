import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { CompletionModel } from "@anvia/core";
import { resolveTaskModel } from "./config";
import type { AgentName, HarnessConfig, ModelTask } from "./config";
import { createModel } from "./model";

const CONFIG_FILE = "harness.config.ts";

/**
 * A harness config that was loaded and validated, together with what is derived from it.
 *
 * Paths in the config are relative to `rootDir`, the directory that contains the config file.
 */
export interface Harness {
  readonly config: HarnessConfig;
  readonly rootDir: string;
  readonly pluginsDir: string;
  readPrompt(agent: AgentName): Promise<string>;
  /** Builds the model that `task` runs on, as selected by its environment variable. */
  createModel(task: ModelTask): CompletionModel;
}

/** Where to look for the config file, and which environment holds the API keys. */
export interface LoadHarnessOptions {
  readonly configPath?: string | undefined;
  readonly startDir?: string | undefined;
  readonly env?: Readonly<Record<string, string | undefined>> | undefined;
}

/**
 * Finds `harness.config.ts` in `startDir` or in the nearest parent directory that has one.
 * Returns `undefined` when no directory up to the filesystem root has it.
 */
export function findHarnessConfig(startDir: string): string | undefined {
  let directory = resolve(startDir);

  for (;;) {
    const candidate = join(directory, CONFIG_FILE);

    if (existsSync(candidate)) {
      return candidate;
    }

    const parent = dirname(directory);

    if (parent === directory) {
      return undefined;
    }

    directory = parent;
  }
}

/**
 * Throws when the config contradicts itself, so a bad config fails at startup and not in the
 * middle of an agent run.
 */
export function validateHarnessConfig(config: HarnessConfig): void {
  if (!config.models[config.defaultModel]) {
    throw new Error(`The default model "${config.defaultModel}" is not in the models list.`);
  }

  for (const [name, model] of Object.entries(config.models)) {
    const effort = model.defaultReasoningEffort;

    if (effort !== undefined && !model.reasoningEfforts.includes(effort)) {
      throw new Error(`The default reasoning effort of "${name}" is not one of its efforts.`);
    }
  }
}

/**
 * Loads the harness config and returns a `Harness` for it.
 *
 * The config file is `options.configPath`, then `HARNESS_CONFIG`, then the nearest
 * `harness.config.ts` above `options.startDir`, which defaults to the working directory. The
 * process must be able to import TypeScript.
 */
export async function loadHarness(options: LoadHarnessOptions = {}): Promise<Harness> {
  const env = options.env ?? process.env;

  const path =
    options.configPath ??
    env.HARNESS_CONFIG ??
    findHarnessConfig(options.startDir ?? process.cwd());

  if (!path) {
    throw new Error(`Could not find ${CONFIG_FILE}.`);
  }

  const configPath = resolve(path);
  const module = (await import(pathToFileURL(configPath).href)) as { default?: HarnessConfig };

  if (!module.default) {
    throw new Error(`${configPath} must default-export the harness config.`);
  }

  const config = module.default;
  const rootDir = dirname(configPath);

  validateHarnessConfig(config);

  return {
    config,
    rootDir,
    pluginsDir: resolve(rootDir, config.pluginsDir),
    readPrompt: (agent) => readFile(resolve(rootDir, config.prompts[agent]), "utf8"),
    createModel(task) {
      const { definition, apiKey } = resolveTaskModel(config, task, env);

      return createModel({
        apiKey,
        modelId: definition.modelId,
        baseUrl: definition.baseUrl,
        api: definition.api,
      });
    },
  };
}
