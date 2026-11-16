import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export interface StoredTokens {
  accessToken: string;
  refreshToken: string;
}

interface StoreFile extends StoredTokens {
  /** Hash of the env refresh token the file was seeded from. */
  seed: string;
}

const REFRESH_SKEW_SECONDS = 60;

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function defaultStorePath(baseUrl: string): string {
  const dir = process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config");
  return join(dir, "proactive-ide-mcp", `${hash(baseUrl).slice(0, 12)}.json`);
}

/** Reads `exp` from a JWT without verifying it; returns null when unreadable. */
export function jwtExpiry(token: string): number | null {
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8"));
    return typeof payload.exp === "number" ? payload.exp : null;
  } catch {
    return null;
  }
}

export function needsRefresh(accessToken: string, nowSeconds = Date.now() / 1000): boolean {
  if (!accessToken) return true;
  const exp = jwtExpiry(accessToken);
  return exp === null || exp - nowSeconds < REFRESH_SKEW_SECONDS;
}

/**
 * Refresh tokens rotate on every use, so the latest pair is persisted to a
 * 0600 file. The env tokens only seed the file; if the user re-issues a token
 * (different env refresh token) the file is discarded.
 */
export class TokenStore {
  private tokens: StoredTokens;

  constructor(
    seed: StoredTokens,
    private readonly path: string,
  ) {
    this.tokens = this.load(seed);
  }

  private load(seed: StoredTokens): StoredTokens {
    try {
      const file = JSON.parse(readFileSync(this.path, "utf8")) as StoreFile;
      if (file.seed === hash(seed.refreshToken) && file.accessToken && file.refreshToken) {
        return { accessToken: file.accessToken, refreshToken: file.refreshToken };
      }
    } catch {
      // no usable store yet
    }
    return seed;
  }

  get(): StoredTokens {
    return this.tokens;
  }

  save(next: StoredTokens, seedRefreshToken: string): void {
    this.tokens = next;
    const file: StoreFile = { ...next, seed: hash(seedRefreshToken) };
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    writeFileSync(this.path, JSON.stringify(file), { mode: 0o600 });
    chmodSync(this.path, 0o600);
  }
}
