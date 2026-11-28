import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { REASONING_EFFORT_CONTROL_ID } from "@anvia/core";
import type { CompletionModel } from "@anvia/core";
import { resolveModel, resolveTaskModel } from "./config";
import type { AgentName, HarnessConfig, ModelTask, ReasoningEffort } from "./config";
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
  /** Builds the model that `task` runs on and the controls to call it with, as `model` does. */
  taskModel(task: ModelTask, reasoning?: ReasoningEffort): HarnessModel;
  /**
   * Builds the model with the key `key` and the controls to call it with. It uses `reasoning` when
   * the model lists it and the model's default effort otherwise, so a model is never asked for an
   * effort it does not accept.
   */
  model(key: string, reasoning?: ReasoningEffort): HarnessModel;
}

/** A model of the harness and the control values to call it with. */
export interface HarnessModel {
  readonly model: CompletionModel;
  readonly controls: { readonly [REASONING_EFFORT_CONTROL_ID]: ReasoningEffort } | undefined;
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

    if (effort === undefined && model.reasoningEfforts.length > 0) {
      throw new Error(`"${name}" lists reasoning efforts but has no default reasoning effort.`);
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

  /** The models that were built, by key and requested effort, so a model is built only once. */
  const built = new Map<string, HarnessModel>();

  const model = (key: string, reasoning?: ReasoningEffort): HarnessModel => {
    const cacheKey = `${key}:${reasoning ?? ""}`;
    const cached = built.get(cacheKey);

    if (cached) {
      return cached;
    }

    const { definition, apiKey } = resolveModel(config, key, env);
    const efforts = definition.reasoningEfforts;

    const effort =
      reasoning !== undefined && efforts.includes(reasoning)
        ? reasoning
        : definition.defaultReasoningEffort;

    const result = {
      model: createModel({
        apiKey,
        modelId: definition.modelId,
        baseUrl: definition.baseUrl,
        api: definition.api,
        reasoningEfforts: efforts,
      }),
      controls: effort === undefined ? undefined : { [REASONING_EFFORT_CONTROL_ID]: effort },
    };

    built.set(cacheKey, result);

    return result;
  };

  const taskModel = (task: ModelTask, reasoning?: ReasoningEffort): HarnessModel =>
    model(resolveTaskModel(config, task, env).key, reasoning);

  return {
    config,
    rootDir,
    pluginsDir: resolve(rootDir, config.pluginsDir),
    readPrompt: (agent) => readFile(resolve(rootDir, config.prompts[agent]), "utf8"),
    createModel: (task) => taskModel(task).model,
    taskModel,
    model,
  };
}
