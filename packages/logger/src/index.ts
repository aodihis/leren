import pino from "pino";

/**
 * Structured key-value data attached to a log entry. An `Error` stored under the `error` key is
 * serialized with its message and stack trace.
 */
export type LogMetadata = Record<string, unknown>;

/**
 * A logger that does not depend on any logging library.
 *
 * Every method takes a message and optional metadata. Metadata from `child` is included in every
 * entry written by the returned logger, such as a request ID or a job ID.
 */
export interface Logger {
  debug(message: string, metadata?: LogMetadata): void;
  info(message: string, metadata?: LogMetadata): void;
  warn(message: string, metadata?: LogMetadata): void;
  error(message: string, metadata?: LogMetadata): void;
  fatal(message: string, metadata?: LogMetadata): void;
  child(context: LogMetadata): Logger;
}

export type CreateLoggerOptions = {
  name: string;
  level?: string;
};

/**
 * Wraps a Pino instance in the library-agnostic `Logger` interface. This file is the only place
 * that knows about Pino.
 */
function wrap(instance: pino.Logger): Logger {
  const write =
    (level: "debug" | "info" | "warn" | "error" | "fatal") =>
    (message: string, metadata?: LogMetadata) => {
      instance[level](metadata ?? {}, message);
    };

  return {
    debug: write("debug"),
    info: write("info"),
    warn: write("warn"),
    error: write("error"),
    fatal: write("fatal"),
    child: (context) => wrap(instance.child(context)),
  };
}

/**
 * Creates a logger that writes JSON lines in production and human-readable output otherwise.
 * The level defaults to `LOG_LEVEL`, then to `info`.
 */
export function createLogger(options: CreateLoggerOptions): Logger {
  const isProduction = process.env.NODE_ENV === "production";

  return wrap(
    pino({
      name: options.name,
      level: options.level ?? process.env.LOG_LEVEL ?? "info",
      serializers: { error: pino.stdSerializers.err },
      transport: isProduction ? undefined : { target: "pino-pretty" },
    }),
  );
}
