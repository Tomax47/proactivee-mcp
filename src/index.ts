#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ProactiveClient } from "./client.js";
import { loadConfig } from "./config.js";
import { TokenStore, defaultStorePath } from "./credentials.js";
import { createServer } from "./server.js";

async function main() {
  const config = loadConfig();
  const store = new TokenStore(
    { accessToken: config.accessToken, refreshToken: config.refreshToken },
    defaultStorePath(config.baseUrl),
  );
  const server = createServer(new ProactiveClient(config, store));
  await server.connect(new StdioServerTransport());
}

main().catch((err) => {
  // stdout is the MCP channel; log to stderr only, and never print tokens.
  console.error(`proactive-ide-mcp: ${err instanceof Error ? err.message : "failed to start"}`);
  process.exit(1);
});
