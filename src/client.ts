import type { Config } from "./config.js";
import { needsRefresh, type TokenStore } from "./credentials.js";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export type Query = Record<string, string | number | undefined>;

interface Envelope {
  status?: string;
  data?: unknown;
  error_message?: string;
}

export class ProactiveClient {
  private refreshing: Promise<void> | null = null;
  /** Refresh token the store was seeded with (identifies the issued credential). */
  private readonly seedRefreshToken: string;

  constructor(
    private readonly config: Config,
    private readonly store: TokenStore,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.seedRefreshToken = config.refreshToken;
  }

  /** Remote (OAuth) mode passes a bearer through and cannot refresh it. */
  private get canRefresh(): boolean {
    return this.store.get().refreshToken !== "";
  }

  private async refresh(): Promise<void> {
    if (!this.canRefresh) {
      throw new ApiError(401, "Proactive access expired or was revoked. Reconnect the Proactive MCP server to sign in again.");
    }
    this.refreshing ??= this.doRefresh().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  private async doRefresh(): Promise<void> {
    const res = await this.fetchImpl(`${this.config.baseUrl}/api/v1/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: this.store.get().refreshToken }),
      signal: AbortSignal.timeout(this.config.requestTimeoutMs),
    });
    const body = (await res.json().catch(() => ({}))) as {
      data?: { access_token?: string; refresh_token?: string };
    };
    const data = body.data;
    if (!res.ok || !data?.access_token || !data.refresh_token) {
      throw new ApiError(
        401,
        "Proactive token is invalid, expired or revoked. Create a new IDE token in Proactive (Access Control > IDE).",
      );
    }
    this.store.save({ accessToken: data.access_token, refreshToken: data.refresh_token }, this.seedRefreshToken);
  }

  async request(method: "GET" | "POST" | "PATCH" | "DELETE", path: string, opts: { query?: Query; body?: unknown } = {}): Promise<unknown> {
    if (this.canRefresh && needsRefresh(this.store.get().accessToken)) await this.refresh();

    for (let attempt = 0; attempt < 2; attempt++) {
      const url = new URL(`${this.config.baseUrl}${path}`);
      for (const [key, value] of Object.entries(opts.query ?? {})) {
        if (value !== undefined) url.searchParams.set(key, String(value));
      }

      const res = await this.fetchImpl(url, {
        method,
        headers: {
          Authorization: `Bearer ${this.store.get().accessToken}`,
          ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        signal: AbortSignal.timeout(this.config.requestTimeoutMs),
      });

      if (res.status === 401 && attempt === 0) {
        await this.refresh();
        continue;
      }

      const envelope = (await res.json().catch(() => ({}))) as Envelope;
      if (!res.ok || envelope.status === "failure") {
        throw new ApiError(res.status, envelope.error_message ?? `Request failed (${res.status})`);
      }
      return envelope.data;
    }
    throw new ApiError(401, "Unauthorized");
  }
}
