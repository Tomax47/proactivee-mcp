import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ApiError, type ProactiveClient } from "./client.js";
import { SERVER_INSTRUCTIONS } from "./richText.js";
import { TOOLS, formatResult } from "./tools.js";

export function createServer(client: ProactiveClient): McpServer {
  const server = new McpServer({ name: "proactive-ide", version: "0.1.0" }, { instructions: SERVER_INSTRUCTIONS });
  // Tool shapes are dynamic here, which makes the SDK's generic overloads blow
  // up the type checker; validation is done explicitly with zod below.
  const register = server.tool.bind(server) as unknown as (
    name: string,
    description: string,
    shape: z.ZodRawShape,
    annotations: Record<string, boolean>,
    handler: (args: Record<string, unknown>) => Promise<unknown>,
  ) => void;

  for (const def of TOOLS) {
    register(
      def.name,
      def.description,
      def.shape,
      { readOnlyHint: def.readOnly, destructiveHint: def.destructive, openWorldHint: false },
      async (args: Record<string, unknown>) => {
        try {
          const parsed = z.object(def.shape).parse(args);
          const data = await def.run(client, parsed as never);
          return { content: [{ type: "text" as const, text: formatResult(data) }] };
        } catch (err) {
          const message = err instanceof ApiError || err instanceof Error ? err.message : "Unknown error";
          // Never include tokens or stack traces in tool output.
          return { isError: true, content: [{ type: "text" as const, text: message }] };
        }
      },
    );
  }
  return server;
}
