export type LogFields = Readonly<Record<string, unknown>>;

/** Port: the core logs through this and never imports a logging library. */
export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  /** Pass an Error under the `err` field to get a serialized stack trace. */
  error(message: string, fields?: LogFields): void;
}

/** Null Object, for tests and callers that do not care about logs. */
export const noopLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};
