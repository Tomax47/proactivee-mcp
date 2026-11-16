import { z } from "zod";
import type { ProactiveClient, Query } from "./client.js";

export const MAX_OUTPUT_CHARS = 20_000;

const TASK_STATUSES = ["DRAFT", "TODO", "IN_PROGRESS", "REVIEW", "TESTING", "DONE", "BLOCKED", "ON_HOLD"] as const;

const id = (description: string) => z.string().min(1).max(100).describe(description);
const page = z.number().int().min(1).optional();
const pageSize = z.number().int().min(1).max(50).optional();
const seg = encodeURIComponent;

export interface ToolDef {
  name: string;
  description: string;
  readOnly: boolean;
  shape: z.ZodRawShape;
  run: (client: ProactiveClient, args: Record<string, never>) => Promise<unknown>;
}

// Typed helper so each handler gets its own argument types.
function tool<S extends z.ZodRawShape>(def: {
  name: string;
  description: string;
  readOnly: boolean;
  shape: S;
  run: (client: ProactiveClient, args: z.infer<z.ZodObject<S>>) => Promise<unknown>;
}): ToolDef {
  return def as unknown as ToolDef;
}

/**
 * The complete tool surface. Deliberately small: no deletes, no project or
 * repository management, no reports, no assistant. Anything added here must
 * also be on the server-side IDE route allowlist (lib/api-tokens/ide-policy.ts).
 */
export const TOOLS: ToolDef[] = [
  tool({
    name: "me_get",
    description: "Get the Proactive user this token belongs to.",
    readOnly: true,
    shape: {},
    run: (c) => c.request("GET", "/api/v1/me"),
  }),
  tool({
    name: "projects_list",
    description: "List projects this token can access. Use the returned ids with the other tools.",
    readOnly: true,
    shape: { page, page_size: pageSize },
    run: (c, a) => c.request("GET", "/api/v1/projects", { query: { page: a.page, pageSize: a.page_size, statusFilter: "ACTIVE_ONLY" } }),
  }),
  tool({
    name: "tasks_list",
    description: "List tasks of a project in one status.",
    readOnly: true,
    shape: { project_id: id("Project id"), status: z.enum(TASK_STATUSES), page, page_size: pageSize },
    run: (c, a) =>
      c.request("GET", `/api/v1/projects/${seg(a.project_id)}/tasks`, {
        query: { status: a.status, page: a.page, pageSize: a.page_size },
      }),
  }),
  tool({
    name: "task_get",
    description: "Get one task with its details.",
    readOnly: true,
    shape: { project_id: id("Project id"), task_id: id("Task id") },
    run: (c, a) => c.request("GET", `/api/v1/projects/${seg(a.project_id)}/tasks/${seg(a.task_id)}`),
  }),
  tool({
    name: "task_update_status",
    description: "Move a task to a new status (for example IN_PROGRESS or REVIEW). Only the status can be changed.",
    readOnly: false,
    shape: { project_id: id("Project id"), task_id: id("Task id"), status: z.enum(TASK_STATUSES) },
    run: (c, a) =>
      c.request("PATCH", `/api/v1/projects/${seg(a.project_id)}/tasks/${seg(a.task_id)}`, {
        body: { status: a.status },
      }),
  }),
  tool({
    name: "task_link_pull_request",
    description: "Link a GitHub pull request to a task.",
    readOnly: false,
    shape: {
      task_id: id("Task id"),
      repository_full_name: z.string().regex(/^[\w.-]+\/[\w.-]+$/).describe("owner/repo"),
      pull_number: z.number().int().min(1),
    },
    run: (c, a) =>
      c.request("POST", `/api/v1/tasks/${seg(a.task_id)}/github/pull-requests`, {
        body: { repositoryFullName: a.repository_full_name, pullNumber: a.pull_number },
      }),
  }),
  tool({
    name: "task_pull_requests_list",
    description: "List pull requests linked to a task.",
    readOnly: true,
    shape: { task_id: id("Task id") },
    run: (c, a) => c.request("GET", `/api/v1/tasks/${seg(a.task_id)}/github/pull-requests`),
  }),
  tool({
    name: "github_pull_requests_list",
    description: "List synced GitHub pull requests of a project.",
    readOnly: true,
    shape: {
      project_id: id("Project id"),
      state: z.enum(["open", "closed", "merged", "all"]).optional(),
      page,
      page_size: pageSize,
    },
    run: (c, a) =>
      c.request("GET", "/api/v1/github/pull-requests", {
        query: { projectId: a.project_id, state: a.state, page: a.page, pageSize: a.page_size },
      }),
  }),
  tool({
    name: "github_pull_request_get",
    description: "Get a pull request with reviews, comments and CI status.",
    readOnly: true,
    shape: { github_pr_id: id("githubPrId from github_pull_requests_list") },
    run: (c, a) => c.request("GET", `/api/v1/github/pull-requests/${seg(a.github_pr_id)}`),
  }),
  tool({
    name: "github_pull_request_logs_get",
    description: "Get the review-round log of a pull request.",
    readOnly: true,
    shape: { github_pr_id: id("githubPrId from github_pull_requests_list") },
    run: (c, a) => c.request("GET", `/api/v1/github/pull-requests/${seg(a.github_pr_id)}/logs`),
  }),
  tool({
    name: "knowledge_prompts_list",
    description: "List saved AI prompts from the knowledge vault (read-only context).",
    readOnly: true,
    shape: { page, page_size: pageSize },
    run: (c, a) => c.request("GET", "/api/v1/knowledge-vault/prompts", { query: { page: a.page, pageSize: a.page_size } as Query }),
  }),
  tool({
    name: "knowledge_runbooks_list",
    description: "List runbooks from the knowledge vault (read-only context).",
    readOnly: true,
    shape: { page, page_size: pageSize },
    run: (c, a) => c.request("GET", "/api/v1/knowledge-vault/runbooks", { query: { page: a.page, pageSize: a.page_size } as Query }),
  }),
];

export function formatResult(data: unknown): string {
  const text = JSON.stringify(data ?? null, null, 2);
  return text.length <= MAX_OUTPUT_CHARS
    ? text
    : `${text.slice(0, MAX_OUTPUT_CHARS)}\n... [truncated ${text.length - MAX_OUTPUT_CHARS} chars; use page/page_size to narrow]`;
}
