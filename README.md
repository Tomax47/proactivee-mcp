# proactive-ide-mcp

A small, **stdio-only** MCP server that lets Cursor and Claude Code work with Proactive. It runs on the
developer's machine and talks only to the public Proactive `/api/v1`, using a restricted **IDE token**.
It opens no network port. The production MCP container is not involved.

## Setup

1. In Proactive open **Access Control → IDE → Connect IDE**, choose the projects, scopes (uncheck `write`
   for read-only) and an optional expiry, then copy the snippet shown (it is only shown once).
2. Cursor, `.cursor/mcp.json` (or `~/.cursor/mcp.json`):

   ```json
   {
     "mcpServers": {
       "proactive": {
         "command": "npx",
         "args": ["-y", "github:Tomax47/proactive-ide-mcp"],
         "env": {
           "PROACTIVE_BASE_URL": "https://your-proactive-host",
           "PROACTIVE_ACCESS_TOKEN": "...",
           "PROACTIVE_REFRESH_TOKEN": "..."
         }
       }
     }
   }
   ```

3. Claude Code:

   ```bash
   claude mcp add proactive \
     -e PROACTIVE_BASE_URL=https://your-proactive-host \
     -e PROACTIVE_ACCESS_TOKEN=... -e PROACTIVE_REFRESH_TOKEN=... \
     -- npx -y github:Tomax47/proactive-ide-mcp
   ```

`PROACTIVE_BASE_URL` must be `https` (plain `http` is accepted for `localhost` only).

## Tools

Read: `me_get`, `projects_list`, `project_get`, `tasks_list`, `task_get`, `task_pull_requests_list`,
`github_pull_requests_list`, `github_pull_request_get`, `github_pull_request_logs_get`, and
`knowledge_<kind>_list` / `knowledge_<kind>_get`.
Write: `project_create`, `project_update`, `task_create`, `task_update`, `task_update_status`,
`task_link_pull_request`, and `knowledge_<kind>_create` / `_update`.
Destructive (flagged `destructiveHint`): `project_delete`, `task_delete`, `knowledge_<kind>_delete`.

`<kind>` is one of `prompt`, `runbook`, `command`, `resource`, `category`. Proactive has no hard project delete,
so `project_delete` sets the status to `DISCARDED` (reversible with `project_update`). Tokens limited to specific
projects cannot create projects, and the knowledge vault is per user, not per project.

There are no repository-management, report or assistant tools. Limits are enforced server-side by Proactive,
so a leaked token cannot do more than this list. Use a read-only token (no `write` scope) if you want no writes.

## Tokens

Access tokens last 1 hour and refresh tokens rotate on every use, so the latest pair is stored in
`~/.config/proactive-ide-mcp/<hash>.json` (mode `0600`). The env values only seed that file; issuing a new
token in Proactive replaces it automatically. Revoking the token in Proactive takes effect immediately.

## Development

```bash
yarn install
yarn typecheck && yarn test && yarn build
```

When you add a tool here, add its route to the allowlist in Proactive (`lib/api-tokens/ide-policy.ts`).

## Remote mode (OAuth, no token to paste)

`build/http.js` is a stateless Streamable HTTP server for hosting (for example
at `https://mcp.proactivee.dev`). Users add the URL to their client and sign in
through the browser; the Proactive app is the OAuth server (login, consent,
project selection, token issuing, revocation under Access > IDE).

```
claude mcp add --transport http proactive https://mcp.proactivee.dev/mcp
```

For Cursor, add `{"mcpServers":{"proactive":{"url":"https://mcp.proactivee.dev/mcp"}}}`
to `mcp.json`.

Environment (no secrets, no database access):

| Variable | Meaning |
| --- | --- |
| `PROACTIVE_BASE_URL` | Public URL of the Proactive app (OAuth server and API) |
| `MCP_PUBLIC_URL` | Public URL of this server, e.g. `https://mcp.proactivee.dev` |
| `PORT` | Listen port (default 3000) |

Run with `docker build -t proactive-ide-mcp .` or `yarn build && yarn start:http`.
A health check is available at `/healthz`. The stdio mode above keeps working.
