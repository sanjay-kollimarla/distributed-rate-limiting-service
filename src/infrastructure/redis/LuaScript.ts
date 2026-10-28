import { createHash } from "node:crypto";

/** A Lua source together with its SHA1, so it can be invoked via EVALSHA. */
export class LuaScript {
  readonly sha: string;

  constructor(readonly source: string) {
    this.sha = createHash("sha1").update(source).digest("hex");
  }
}
