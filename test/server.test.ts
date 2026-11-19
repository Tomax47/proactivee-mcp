import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/server.js";
import { TOOLS } from "../src/tools.js";

describe("MCP server over a real transport", () => {
  it("lists exactly the allowlisted tools and returns tool errors as isError", async () => {
    const fakeClient = { request: async () => { throw new Error("boom"); } };
    const server = createServer(fakeClient as never);
    const [a, b] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "t", version: "0" });
    await Promise.all([server.connect(a), client.connect(b)]);

    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((t) => t.name).sort(), TOOLS.map((t) => t.name).sort());

    const res = await client.callTool({ name: "me_get", arguments: {} });
    assert.equal(res.isError, true);

    const bad = await client.callTool({ name: "task_update_status", arguments: { project_id: "p", task_id: "t", status: "NOPE" } });
    assert.equal(bad.isError, true);
    await client.close();
  });
});

describe("rich text guidance", () => {
  it("sends the formatting guide as server instructions and on every rich-text field", async () => {
    const server = createServer({ request: async () => ({}) } as never);
    const [a, b] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "t", version: "0" });
    await Promise.all([server.connect(a), client.connect(b)]);

    const instructions = client.getInstructions() ?? "";
    for (const snippet of ["Always send HTML", "<table>", 'data-type="toggle"', "background-color", "text-align", "no font-size"]) {
      assert.ok(instructions.includes(snippet), `instructions mention ${snippet}`);
    }

    const { tools } = await client.listTools();
    const fields: [string, string][] = [
      ["task_create", "description"],
      ["task_update", "description"],
      ["project_create", "description"],
      ["project_update", "description"],
      ["knowledge_resource_create", "notes"],
      ["knowledge_resource_update", "notes"],
    ];
    for (const [toolName, field] of fields) {
      const tool = tools.find((t) => t.name === toolName);
      const prop = (tool?.inputSchema.properties as Record<string, { description?: string }>)[field];
      assert.match(prop?.description ?? "", /Send HTML, not Markdown/, `${toolName}.${field}`);
    }
    await client.close();
  });
});
