/**
 * Single source of truth for the server version.
 *
 * Read from package.json at runtime so the version can never drift from the
 * published package the way the previously hardcoded literals did. Resolving
 * relative to this module's own URL works in both layouts: `dist/version.js`
 * and `src/version.ts` are each one level below the package root.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const FALLBACK_VERSION = "0.0.0";

function readVersion(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(readFileSync(join(here, "..", "package.json"), "utf8"));
    return typeof pkg.version === "string" && pkg.version.length > 0
      ? pkg.version
      : FALLBACK_VERSION;
  } catch {
    // Never let telemetry metadata break startup.
    return FALLBACK_VERSION;
  }
}

export const VERSION = readVersion();

/** User-Agent sent on every Meshy API call, e.g. "meshy-mcp-server/0.5.0". */
export const USER_AGENT = `meshy-mcp-server/${VERSION}`;
