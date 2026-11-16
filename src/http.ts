#!/usr/bin/env node
/**
 * Remote (Streamable HTTP) entry point, meant to run behind HTTPS at
 * e.g. https://mcp.proactivee.dev. Stateless and secret-free: each request
 * carries the user's OAuth access token, which is forwarded to the Proactive
 * public API where all restrictions are enforced. OAuth itself (login,
 * consent, tokens) is served by the Proactive app.
 */
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { ProactiveClient } from "./client.js";
import { assertSafeBaseUrl } from "./config.js";
import { jwtExpiry } from "./credentials.js";
import { createServer } from "./server.js";

const MAX_BODY_BYTES = 1_000_000;

const baseUrl = assertSafeBaseUrl(process.env.PROACTIVE_BASE_URL ?? "");
const publicUrl = assertSafeBaseUrl(process.env.MCP_PUBLIC_URL ?? "");
const port = Number(process.env.PORT) || 4600;
const timeoutMs = Number(process.env.PROACTIVE_TIMEOUT_MS) || 30_000;
const metadataUrl = `${publicUrl}/.well-known/oauth-protected-resource`;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, Mcp-Protocol-Version, Mcp-Session-Id",
  "Access-Control-Expose-Headers": "WWW-Authenticate",
};

function send(res: ServerResponse, status: number, body?: unknown, headers: Record<string, string> = {}) {
  res.writeHead(status, { ...CORS, ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...headers });
  res.end(body !== undefined ? JSON.stringify(body) : undefined);
}

function unauthorized(res: ServerResponse, invalidToken: boolean) {
  const params = [`resource_metadata="${metadataUrl}"`, ...(invalidToken ? ['error="invalid_token"'] : [])];
  send(res, 401, { error: "unauthorized" }, { "WWW-Authenticate": `Bearer ${params.join(", ")}` });
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new Error("body too large");
    chunks.push(chunk as Buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function handleMcp(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== "POST") {
    // Stateless server: no server-initiated streams or sessions to close.
    return send(res, 405, { error: "method not allowed" }, { Allow: "POST" });
  }

  const match = /^Bearer\s+(.+)$/i.exec(req.headers.authorization ?? "");
  const accessToken = match?.[1]?.trim();
  if (!accessToken) return unauthorized(res, false);
  // Expired tokens get a 401 so the client runs its refresh flow.
  const exp = jwtExpiry(accessToken);
  if (exp === null || exp <= Date.now() / 1000) return unauthorized(res, true);

  let body: unknown;
  try {
    body = await readJson(req);
  } catch {
    return send(res, 400, { error: "invalid request body" });
  }

  const store = { get: () => ({ accessToken, refreshToken: "" }), save: () => {} };
  const client = new ProactiveClient(
    { baseUrl, accessToken, refreshToken: "", requestTimeoutMs: timeoutMs },
    store as never,
  );
  const server = createServer(client);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on("close", () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, body);
}

const http = createHttpServer((req, res) => {
  const path = new URL(req.url ?? "/", "http://localhost").pathname;
  const handle = async () => {
    if (req.method === "OPTIONS") return send(res, 204);
    if (path === "/healthz") return send(res, 200, { ok: true });
    if (path === "/.well-known/oauth-protected-resource" || path === "/.well-known/oauth-protected-resource/mcp") {
      return send(res, 200, {
        resource: `${publicUrl}/mcp`,
        authorization_servers: [baseUrl],
        bearer_methods_supported: ["header"],
      });
    }
    if (path === "/mcp") return handleMcp(req, res);
    return send(res, 404, { error: "not found" });
  };
  handle().catch((err) => {
    // Never log tokens or request bodies.
    console.error(`proactive-ide-mcp: ${err instanceof Error ? err.message : "request failed"}`);
    if (!res.headersSent) send(res, 500, { error: "internal error" });
  });
});

http.listen(port, () => console.error(`proactive-ide-mcp listening on :${port}`));
