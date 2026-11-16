import { z } from "zod";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { ProactiveClient } from "../src/client.js";
import { assertSafeBaseUrl, loadConfig } from "../src/config.js";
import { TokenStore, needsRefresh } from "../src/credentials.js";
import { TOOLS, formatResult, MAX_OUTPUT_CHARS } from "../src/tools.js";

const jwt = (exp: number) => `x.${Buffer.from(JSON.stringify({ exp })).toString("base64url")}.y`;
const future = () => jwt(Math.floor(Date.now() / 1000) + 3600);
const past = () => jwt(Math.floor(Date.now() / 1000) - 10);

const ok = (data: unknown, status = 200) =>
  new Response(JSON.stringify({ status: "success", data }), { status });
const fail = (status: number, msg = "nope") =>
  new Response(JSON.stringify({ status: "failure", error_message: msg }), { status });

function setup(fetchImpl: typeof fetch, access = future()) {
  const path = join(mkdtempSync(join(tmpdir(), "pim-")), "creds.json");
  const config = { baseUrl: "https://app.test", accessToken: access, refreshToken: "r0", requestTimeoutMs: 1000 };
  const store = new TokenStore({ accessToken: access, refreshToken: "r0" }, path);
  return { client: new ProactiveClient(config, store, fetchImpl), store, path };
}

describe("tool surface", () => {
  it("exposes no repository, report, assistant or token tools", () => {
    for (const t of TOOLS) assert.doesNotMatch(t.name, /report|assistant|repositor|token|integration/);
  });

  it("marks exactly the delete tools as destructive", () => {
    assert.deepEqual(
      TOOLS.filter((t) => t.destructive).map((t) => t.name).sort(),
      [
        "knowledge_category_delete", "knowledge_command_delete", "knowledge_prompt_delete",
        "knowledge_resource_delete", "knowledge_runbook_delete", "project_delete", "task_delete",
      ],
    );
    for (const t of TOOLS.filter((x) => x.destructive)) assert.equal(t.readOnly, false);
  });

  it("maps writes to the expected requests", async () => {
    const seen: { url: string; method?: string; body?: string }[] = [];
    const { client } = setup((async (url: URL, init: RequestInit) => {
      seen.push({ url: String(url), method: init.method, body: init.body as string });
      return ok({});
    }) as unknown as typeof fetch);
    const run = (name: string, args: Record<string, unknown>) => {
      const def = TOOLS.find((t) => t.name === name)!;
      return def.run(client, z.object(def.shape).parse(args) as never);
    };
    await run("task_create", { project_id: "p1", title: "T", type: "FEATURE", assigned_to_id: "u1", estimated_hours: 2 });
    await run("task_update", { project_id: "p1", task_id: "t1", due_date: "2026-12-01" });
    await run("task_delete", { project_id: "p1", task_id: "t1" });
    await run("project_delete", { project_id: "p1" });
    await run("knowledge_prompt_update", { id: "k1", category_id: null });
    await run("knowledge_resource_create", { title: "R", type: "NOTE", public_access: true });
    await run("knowledge_category_delete", { id: "c/1" });
    assert.deepEqual(
      seen.map((s) => `${s.method} ${new URL(s.url).pathname}`),
      [
        "POST /api/v1/projects/p1/tasks",
        "PATCH /api/v1/projects/p1/tasks/t1",
        "DELETE /api/v1/projects/p1/tasks/t1",
        "PATCH /api/v1/projects/p1",
        "PATCH /api/v1/knowledge-vault/prompts/k1",
        "POST /api/v1/knowledge-vault/resources",
        "DELETE /api/v1/knowledge-vault/categories/c%2F1",
      ],
    );
    assert.deepEqual(JSON.parse(seen[0].body!), { title: "T", type: "FEATURE", assignedToId: "u1", estimatedHours: 2 });
    assert.deepEqual(JSON.parse(seen[1].body!), { dueDate: "2026-12-01" });
    assert.deepEqual(JSON.parse(seen[3].body!), { status: "DISCARDED" });
    assert.deepEqual(JSON.parse(seen[4].body!), { categoryId: null });
    assert.deepEqual(JSON.parse(seen[5].body!), { title: "R", type: "NOTE", publicAccess: true });
    assert.equal(seen[6].body, undefined);
  });

  it("task_update_status sends only the status field", async () => {
    let seen: { url: string; method?: string; body?: string } | null = null;
    const { client } = setup((async (url: URL, init: RequestInit) => {
      seen = { url: String(url), method: init.method, body: init.body as string };
      return ok({});
    }) as unknown as typeof fetch);
    const def = TOOLS.find((t) => t.name === "task_update_status")!;
    await def.run(client, { project_id: "p/1", task_id: "t1", status: "REVIEW" } as never);
    assert.equal(seen!.method, "PATCH");
    assert.equal(seen!.url, "https://app.test/api/v1/projects/p%2F1/tasks/t1");
    assert.deepEqual(JSON.parse(seen!.body!), { status: "REVIEW" });
  });

  it("truncates large output", () => {
    assert.ok(formatResult("x".repeat(MAX_OUTPUT_CHARS * 2)).includes("truncated"));
  });
});

describe("config", () => {
  it("requires https except for localhost", () => {
    assert.equal(assertSafeBaseUrl("https://a.com/x"), "https://a.com");
    assert.equal(assertSafeBaseUrl("http://localhost:3000"), "http://localhost:3000");
    assert.throws(() => assertSafeBaseUrl("http://a.com"));
    assert.throws(() => assertSafeBaseUrl("nonsense"));
  });
  it("requires base url and refresh token", () => {
    assert.throws(() => loadConfig({}));
  });
});

describe("token handling", () => {
  it("detects expiring access tokens", () => {
    assert.equal(needsRefresh(""), true);
    assert.equal(needsRefresh(past()), true);
    assert.equal(needsRefresh(future()), false);
  });

  it("refreshes an expired token, persists the rotated pair with 0600 and reuses it", async () => {
    const calls: string[] = [];
    const newAccess = future();
    const { client, path } = setup((async (url: URL) => {
      calls.push(String(url));
      if (String(url).endsWith("/auth/refresh")) return ok({ access_token: newAccess, refresh_token: "r1" });
      return ok({ id: "u1" });
    }) as unknown as typeof fetch, past());

    assert.deepEqual(await client.request("GET", "/api/v1/me"), { id: "u1" });
    const saved = JSON.parse(readFileSync(path, "utf8"));
    assert.equal(saved.refreshToken, "r1");
    assert.equal(statSync(path).mode & 0o777, 0o600);

    // A new process with the same env seed picks up the rotated tokens.
    const reloaded = new TokenStore({ accessToken: "", refreshToken: "r0" }, path);
    assert.equal(reloaded.get().refreshToken, "r1");
    // A re-issued token (different seed) discards the stale file.
    const reseeded = new TokenStore({ accessToken: "a", refreshToken: "other" }, path);
    assert.equal(reseeded.get().refreshToken, "other");
  });

  it("retries once after a 401 and reports revoked tokens clearly", async () => {
    let n = 0;
    const { client } = setup((async (url: URL) => {
      if (String(url).endsWith("/auth/refresh")) return fail(401);
      n++;
      return fail(401);
    }) as unknown as typeof fetch);
    await assert.rejects(() => client.request("GET", "/api/v1/me"), /revoked/);
    assert.equal(n, 1);
  });

  it("surfaces API errors without throwing away the message", async () => {
    const { client } = setup((async () => fail(403, "This endpoint is not available to IDE tokens")) as unknown as typeof fetch);
    await assert.rejects(() => client.request("GET", "/api/v1/reports"), /not available to IDE tokens/);
  });
});
