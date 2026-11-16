export interface Config {
  baseUrl: string;
  accessToken: string;
  refreshToken: string;
  requestTimeoutMs: number;
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** Throws on anything that would send a bearer token over plain http to a remote host. */
export function assertSafeBaseUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("PROACTIVE_BASE_URL is not a valid URL");
  }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && LOCAL_HOSTS.has(url.hostname))) {
    throw new Error("PROACTIVE_BASE_URL must use https (http is only allowed for localhost)");
  }
  return url.origin;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const baseUrl = env.PROACTIVE_BASE_URL;
  const accessToken = env.PROACTIVE_ACCESS_TOKEN ?? "";
  const refreshToken = env.PROACTIVE_REFRESH_TOKEN;
  if (!baseUrl || !refreshToken) {
    throw new Error(
      "PROACTIVE_BASE_URL and PROACTIVE_REFRESH_TOKEN are required (PROACTIVE_ACCESS_TOKEN is optional)",
    );
  }
  return {
    baseUrl: assertSafeBaseUrl(baseUrl),
    accessToken,
    refreshToken,
    requestTimeoutMs: Number(env.PROACTIVE_TIMEOUT_MS) || 30_000,
  };
}
