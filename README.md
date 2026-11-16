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

Read: `me_get`, `projects_list`, `tasks_list`, `task_get`, `task_pull_requests_list`,
`github_pull_requests_list`, `github_pull_request_get`, `github_pull_request_logs_get`,
`knowledge_prompts_list`, `knowledge_runbooks_list`.
Write: `task_update_status` (status only), `task_link_pull_request`.

There are no delete, project-management, report or assistant tools. The same limits are enforced
server-side by Proactive, so a leaked token cannot do more than this list.

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
