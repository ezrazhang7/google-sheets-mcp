# Google Sheets MCP Connector for Claude Cowork — Tech Research (Aug 2026)

Goal: an MCP server that lets Claude Cowork read a spreadsheet and edit it **in place** —
update cells, append/delete rows and columns, write formulas — instead of generating a new
sheet every time.

## TL;DR recommended stack

| Layer | Choice | Why |
|---|---|---|
| Language | TypeScript (Node 20+) | Best-supported MCP SDK, same language as the reference servers |
| MCP SDK | `@modelcontextprotocol/server@beta` (SDK v2, spec **2026-07-28**) — or stable v1 `@modelcontextprotocol/sdk` if beta is a concern | v2 targets the new stateless spec finalized July 28, 2026; serves both `2026-07-28` and `2025-11-25` clients |
| Schemas | Zod v4 | Required by SDK v2 `registerTool()` |
| Google API | `googleapis` npm package → Sheets API **v4** | Official client; covers values + structural `batchUpdate` |
| Auth | `google-auth-library` OAuth 2.0 (desktop/local) or service account | OAuth = acts as you on your own sheets |
| Packaging for Cowork | **MCPB desktop extension** (`.mcpb` bundle, `modelcontextprotocol/mcpb` CLI) | One-click install into Claude Desktop/Cowork, runs locally, no hosting |
| Alt deployment | Stateless streamable-HTTP server (Cloudflare Workers / Vercel) added as a **custom connector** | Needed only if the connector must work from claude.ai web/mobile; must be publicly reachable (Anthropic connects from its cloud) |

## Key findings

### 1. MCP spec & SDKs just had a major release (July 28, 2026)
- The **2026-07-28 spec** is the largest revision since launch: stateless protocol core,
  header-based routing, cacheable list results, authorization hardening, extensions framework.
- **TypeScript SDK v2** retires the monolithic `@modelcontextprotocol/sdk` in favor of
  `@modelcontextprotocol/server` / `@modelcontextprotocol/client` plus adapters for Node,
  Express, Hono, Fastify. ESM-only, Node 20+, `registerTool()` + Zod v4,
  `createMcpHandler` for stateless HTTP. Beta today; codemod exists for v1→v2 migration.
- **Python SDK v2** (`pip install "mcp[cli]==2.0.0b1"`): `FastMCP` becomes `MCPServer`,
  decorator API carries over. Fine alternative if we prefer Python.
- Both SDKs speak stdio *and* HTTP, and serve old + new protocol revisions from one server.

### 2. Google now has an official (preview) Sheets MCP server
- Google announced fully-managed **remote MCP servers** for Google services; the
  **Sheets MCP server** is part of the Google Workspace **Developer Preview Program**.
- Capabilities: read cell values/metadata, update values, **set formulas, insert
  rows/columns, structural batch updates**.
- Caveats: preview-gated (must enroll), remote-only, capability set not under our control.
  Worth trying as a baseline, but building our own keeps full control (delete rows/columns,
  custom "natural-language edit" helpers, no preview gate).

### 3. Two ways to attach a custom MCP server to Claude Cowork
1. **Local, via MCPB desktop extension (recommended).** Cowork lives in the Claude
   desktop app, which installs `.mcpb` bundles (successor to `.dxt`) — the whole Node
   server + deps in one file, one-click install, config UI for secrets. OAuth happens
   locally against Google; nothing to host.
2. **Remote, via custom connector (Settings → Connectors → Add custom connector).**
   Works on Pro/Max/Team/Enterprise (free: 1 connector). Anthropic's cloud connects to
   the server, so it must be on the public internet, ideally with OAuth. Use the SDK v2
   stateless HTTP handler on Cloudflare Workers/Vercel if we go this route.

### 4. Sheets API v4 surface that covers every requested capability
| Need | API call |
|---|---|
| Read ranges/cells | `spreadsheets.values.get` / `values.batchGet`; `spreadsheets.get` for metadata & sheet list |
| Edit cells inline | `spreadsheets.values.update` / `values.batchUpdate` |
| Append rows | `spreadsheets.values.append` |
| Delete rows/columns | `spreadsheets.batchUpdate` → `DeleteDimensionRequest` |
| Insert rows/columns | `spreadsheets.batchUpdate` → `InsertDimensionRequest` |
| Write formulas | any values write with `valueInputOption: "USER_ENTERED"` (e.g. `"=SUM(A1:A10)"`) |
| Formatting, merges, conditional formats, charts | `spreadsheets.batchUpdate` (RepeatCell, borders, etc.) |
| Find sheets by name | Drive API `files.list` (optional `drive.file` or `drive.readonly` scope) |

OAuth scopes: `https://www.googleapis.com/auth/spreadsheets` (+ optionally
`https://www.googleapis.com/auth/drive.file` for listing/creating).

### 5. Reference implementations to borrow from
- **freema/mcp-gsheets** — TypeScript, 44 tools (values, formatting, tables, charts,
  insert/delete rows & columns, formulas via USER_ENTERED). Notable idea: `GSHEETS_TOOLSETS`
  env var to expose only needed tools (~9,900 → ~900 prompt tokens). Service-account auth.
- **xing5/mcp-google-sheets** — Python, OAuth + service account patterns.
- **dudegladiator/spreadsheet-mcp** — read/write/format/charts.
- **modelcontextprotocol/mcpb** — the MCPB packaging spec + CLI.

## Proposed build plan
1. Scaffold TypeScript MCP server (`@modelcontextprotocol/server@beta`, Zod v4, stdio).
2. Auth module: Google OAuth desktop flow with token cache (service-account fallback).
3. Core tools (small, composable, A1-notation): `list_spreadsheets`, `get_sheet_info`,
   `read_range`, `update_cells`, `append_rows`, `insert_rows`/`insert_columns`,
   `delete_rows`/`delete_columns`, `write_formula`, `format_range`, `batch_update` escape hatch.
4. Package as `.mcpb` with the mcpb CLI; install into Claude Desktop → available in Cowork.
5. (Optional later) stateless HTTP build of the same server for a claude.ai custom connector.

## Sources
- https://blog.modelcontextprotocol.io/posts/2026-07-28/
- https://blog.modelcontextprotocol.io/posts/sdk-betas-2026-07-28/
- https://blog.mcpservers.org/posts/mcp-spec-2026-07-28
- https://cloud.google.com/blog/products/ai-machine-learning/announcing-official-mcp-support-for-google-services
- https://developers.google.com/workspace/sheets/api/guides/configure-mcp-server
- https://workspace.google.com/blog/product-announcements/10-more-announcements-workspace-at-next-2026
- https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp
- https://support.claude.com/en/articles/12922929-building-desktop-extensions-with-mcpb
- https://github.com/modelcontextprotocol/mcpb
- https://github.com/freema/mcp-gsheets
