import pino from "pino";
import type { LogFields, Logger } from "../../shared/Logger";
import { requestContext } from "../../shared/requestContext";

export type LogLevel = "debug" | "info" | "warn" | "error" | "silent";

export interface PinoLoggerOptions {
  readonly level: LogLevel;
  /** Human-readable output for local development. Requires the pino-pretty dev dependency. */
  readonly pretty: boolean;
  readonly service?: string;
}

/** pino-pretty is a dev dependency, so it is only loaded when asked for. */
async function prettyStream(): Promise<pino.DestinationStream> {
  const { default: pretty } = await import("pino-pretty");
  return pretty({ colorize: true, translateTime: "SYS:HH:MM:ss.l", ignore: "pid,hostname,service" });
}

/** Adapter: pino -> Logger. Emits one JSON object per line with ISO timestamps and the request id. */
export async function createPinoLogger({
  level,
  pretty,
  service = "rate-limiter",
}: PinoLoggerOptions): Promise<Logger> {
  const base = pino(
    {
      level,
      base: { service },
      timestamp: pino.stdTimeFunctions.isoTime,
      formatters: { level: (label) => ({ level: label }) },
      mixin: () => {
        const context = requestContext.getStore();
        return context ? { requestId: context.requestId } : {};
      },
    },
    pretty ? await prettyStream() : undefined,
  );

  const log =
    (write: pino.LogFn) =>
    (message: string, fields: LogFields = {}) =>
      write.call(base, fields, message);

  return {
    debug: log(base.debug),
    info: log(base.info),
    warn: log(base.warn),
    error: log(base.error),
  };
}
