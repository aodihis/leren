import pino from "pino";

/** Structured key-value data attached to a log entry. */
export type LogMetadata = Record<string, unknown>;

/** A logger that does not depend on a library. */
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

/** Wraps Pino in the Logger interface. */
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

/** Creates a logger for the current environment. */
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
