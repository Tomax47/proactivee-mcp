import { z } from "zod";
import type { ProactiveClient, Query } from "./client.js";
import { RICH_TEXT_FIELD } from "./richText.js";

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
  /** Removes or discards data; clients may ask the user to confirm. */
  destructive: boolean;
  shape: z.ZodRawShape;
  run: (client: ProactiveClient, args: Record<string, never>) => Promise<unknown>;
}

// Typed helper so each handler gets its own argument types.
function tool<S extends z.ZodRawShape>(def: {
  name: string;
  description: string;
  readOnly: boolean;
  destructive?: boolean;
  shape: S;
  run: (client: ProactiveClient, args: z.infer<z.ZodObject<S>>) => Promise<unknown>;
}): ToolDef {
  return { destructive: false, ...def } as unknown as ToolDef;
}

const TASK_PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;
const TASK_TYPES = ["FEATURE", "TESTS", "BUG_FIX", "UI_UPDATE", "PERFORMANCE_UPLIFT", "INVESTIGATION"] as const;
const BUG_SEVERITIES = ["LOW", "MODERATE", "HIGH", "CRITICAL", "FATAL"] as const;
const PROJECT_STATUSES = ["ACTIVE", "PAUSED", "FINISHED", "ARCHIVED", "DISCARDED"] as const;

const taskFields = {
  title: z.string().min(1).max(255),
  description: z.string().optional().describe(RICH_TEXT_FIELD),
  status: z.enum(TASK_STATUSES).optional(),
  priority: z.enum(TASK_PRIORITIES).optional(),
  type: z.enum(TASK_TYPES),
  bug_severity: z.enum(BUG_SEVERITIES).optional().describe("Only valid when type is BUG_FIX"),
  assigned_to_id: z.string().optional().describe("User id of the assignee"),
  due_date: z.string().optional().describe("ISO date"),
  estimated_hours: z.number().min(0).optional(),
};

function taskBody(a: Record<string, unknown>): Record<string, unknown> {
  const map: Record<string, string> = {
    bug_severity: "bugSeverity",
    assigned_to_id: "assignedToId",
    due_date: "dueDate",
    estimated_hours: "estimatedHours",
  };
  return Object.fromEntries(
    Object.entries(a)
      .filter(([k, v]) => v !== undefined && k !== "project_id" && k !== "task_id")
      .map(([k, v]) => [map[k] ?? k, v]),
  );
}

const tags = z.array(z.string().min(1).max(50)).max(6).describe("Up to 6 unique tags");
const categoryId = z.string().nullable().optional().describe("Knowledge category id");

/** Knowledge vault collections: list/get/create/update/delete, all user-scoped. */
const KNOWLEDGE: { key: string; singular: string; create: z.ZodRawShape }[] = [
  { key: "prompts", singular: "prompt", create: { title: z.string().min(1).max(255), prompt: z.string().min(1).max(20000), category_id: categoryId, tags } },
  {
    key: "skills",
    singular: "skill",
    create: {
      title: z.string().min(1).max(255),
      description: z.string().max(5000).nullable().optional().describe("Plain text: what the skill does and when to use it"),
      category_id: categoryId,
      tags,
    },
  },
  {
    key: "runbooks",
    singular: "runbook",
    create: {
      title: z.string().min(1).max(255),
      category_id: categoryId,
      tags,
      steps: z.array(z.object({ command: z.string().min(1).max(10000), position: z.number().int().min(0) })).min(1),
    },
  },
  { key: "commands", singular: "command", create: { title: z.string().min(1).max(255), command: z.string().min(1).max(10000), category_id: categoryId, tags } },
  {
    key: "resources",
    singular: "resource",
    create: {
      title: z.string().min(1).max(255),
      type: z.enum(["LINK", "VIDEO", "NOTE", "DOCUMENTATION"]),
      url: z.string().optional().describe("Required unless type is NOTE"),
      notes: z.string().optional().describe(RICH_TEXT_FIELD),
      category_id: categoryId,
      public_access: z.boolean().optional().describe("Defaults to false"),
      tags: tags.optional(),
    },
  },
  { key: "categories", singular: "category", create: { name: z.string().min(1).max(100), color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).describe("Hex color, e.g. #FF5733") } },
];

function knowledgeBody(a: Record<string, unknown>): Record<string, unknown> {
  const map: Record<string, string> = { category_id: "categoryId", public_access: "publicAccess" };
  return Object.fromEntries(
    Object.entries(a)
      .filter(([k, v]) => v !== undefined && k !== "id")
      .map(([k, v]) => [map[k] ?? k, v]),
  );
}

function knowledgeTools(): ToolDef[] {
  return KNOWLEDGE.flatMap(({ key, singular, create }) => {
    const base = `/api/v1/knowledge-vault/${key}`;
    const optional = Object.fromEntries(Object.entries(create).map(([k, v]) => [k, (v as z.ZodTypeAny).optional()])) as z.ZodRawShape;
    const idShape = { id: id(`${singular} id`) };
    const richNote = key === "resources" ? " The notes field is rich text: write it as HTML (see the notes field for the supported formatting)." : "";
    const skillNote =
      key === "skills" ? " Metadata only: the skill's .md or .zip file can only be uploaded or replaced in the Proactive app." : "";
    const def = (d: Omit<ToolDef, "run"> & { run: (c: ProactiveClient, a: Record<string, unknown>) => Promise<unknown> }) => d as unknown as ToolDef;
    return [
      def({
        name: `knowledge_${key}_list`,
        description: `List ${key} from the knowledge vault.`,
        readOnly: true,
        destructive: false,
        shape: { page, page_size: pageSize },
        run: (c, a) => c.request("GET", base, { query: { page: a.page as number, pageSize: a.page_size as number } }),
      }),
      def({
        name: `knowledge_${singular}_get`,
        description: `Get one ${singular} from the knowledge vault.`,
        readOnly: true,
        destructive: false,
        shape: idShape,
        run: (c, a) => c.request("GET", `${base}/${seg(String(a.id))}`),
      }),
      def({
        name: `knowledge_${singular}_create`,
        description: `Create a ${singular} in the knowledge vault.${richNote}${skillNote}`,
        readOnly: false,
        destructive: false,
        shape: create,
        run: (c, a) => c.request("POST", base, { body: knowledgeBody(a) }),
      }),
      def({
        name: `knowledge_${singular}_update`,
        description: `Update a ${singular}. Send only the fields to change.${richNote}${skillNote}`,
        readOnly: false,
        destructive: false,
        shape: { ...idShape, ...optional },
        run: (c, a) => c.request("PATCH", `${base}/${seg(String(a.id))}`, { body: knowledgeBody(a) }),
      }),
      def({
        name: `knowledge_${singular}_delete`,
        description: `Permanently delete a ${singular} from the knowledge vault.${key === "skills" ? " Its uploaded file is deleted too." : ""} Destructive.`,
        readOnly: false,
        destructive: true,
        shape: idShape,
        run: (c, a) => c.request("DELETE", `${base}/${seg(String(a.id))}`),
      }),
    ];
  });
}

/**
 * The complete tool surface. Anything added here must also be on the
 * server-side IDE route allowlist (lib/api-tokens/ide-policy.ts), which is what
 * actually limits a token. Still excluded: repository management, reports, the
 * assistant, integrations and token endpoints. Projects have no hard delete in
 * Proactive; project_delete sets status DISCARDED.
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
    name: "project_get",
    description: "Get one project.",
    readOnly: true,
    shape: { project_id: id("Project id") },
    run: (c, a) => c.request("GET", `/api/v1/projects/${seg(a.project_id)}`),
  }),
  tool({
    name: "project_create",
    description: "Create a project. Not available to tokens limited to specific projects.",
    readOnly: false,
    shape: { name: z.string().min(1).max(255), description: z.string().optional().describe(RICH_TEXT_FIELD), status: z.enum(PROJECT_STATUSES).default("ACTIVE") },
    run: (c, a) => c.request("POST", "/api/v1/projects", { body: a }),
  }),
  tool({
    name: "project_update",
    description: "Update a project's name, description or status. Send only the fields to change.",
    readOnly: false,
    shape: {
      project_id: id("Project id"),
      name: z.string().min(1).max(255).optional(),
      description: z.string().optional().describe(RICH_TEXT_FIELD),
      status: z.enum(PROJECT_STATUSES).optional(),
    },
    run: (c, a) => {
      const { project_id, ...body } = a;
      return c.request("PATCH", `/api/v1/projects/${seg(project_id)}`, { body });
    },
  }),
  tool({
    name: "project_delete",
    description: "Delete a project. Proactive has no hard delete, so this sets the status to DISCARDED (reversible with project_update). Destructive.",
    readOnly: false,
    destructive: true,
    shape: { project_id: id("Project id") },
    run: (c, a) => c.request("PATCH", `/api/v1/projects/${seg(a.project_id)}`, { body: { status: "DISCARDED" } }),
  }),
  tool({
    name: "task_create",
    description: "Create a task in a project. The description is rich text: write it as HTML (see the description field for the supported formatting).",
    readOnly: false,
    shape: { project_id: id("Project id"), ...taskFields },
    run: (c, a) => c.request("POST", `/api/v1/projects/${seg(a.project_id)}/tasks`, { body: taskBody(a) }),
  }),
  tool({
    name: "task_update",
    description: "Update task fields (title, description, status, priority, type, assignee, due date, estimate). Send only the fields to change. The description is rich text HTML and is replaced as a whole, so fetch it with task_get first when editing.",
    readOnly: false,
    shape: {
      project_id: id("Project id"),
      task_id: id("Task id"),
      ...Object.fromEntries(Object.entries(taskFields).map(([k, v]) => [k, (v as z.ZodTypeAny).optional()])),
    },
    run: (c, a) => c.request("PATCH", `/api/v1/projects/${seg(a.project_id)}/tasks/${seg(a.task_id)}`, { body: taskBody(a) }),
  }),
  tool({
    name: "task_delete",
    description: "Delete a task (it is discarded and hidden from lists). Destructive.",
    readOnly: false,
    destructive: true,
    shape: { project_id: id("Project id"), task_id: id("Task id") },
    run: (c, a) => c.request("DELETE", `/api/v1/projects/${seg(a.project_id)}/tasks/${seg(a.task_id)}`),
  }),
  ...knowledgeTools(),
];

export function formatResult(data: unknown): string {
  const text = JSON.stringify(data ?? null, null, 2);
  return text.length <= MAX_OUTPUT_CHARS
    ? text
    : `${text.slice(0, MAX_OUTPUT_CHARS)}\n... [truncated ${text.length - MAX_OUTPUT_CHARS} chars; use page/page_size to narrow]`;
}
