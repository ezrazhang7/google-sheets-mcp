# Google Sheets MCP

An MCP server that lets Claude work with your Google Sheets **in place** — no more
"here's a new spreadsheet" every time.

Read data, edit cells inline with natural language, append rows, insert/delete rows and
columns, fill formulas, format cells, and find & replace — all against the sheet you
already have open.

Runs two ways from one codebase:

- **Local** — a `.mcpb` desktop extension for Claude Desktop and local Cowork sessions.
- **Remote** — a Cloudflare Worker you add as a custom connector, which also works in
  **cloud Cowork sessions, claude.ai on the web, and mobile**.

Built on the [MCP TypeScript SDK v2](https://github.com/modelcontextprotocol/typescript-sdk)
(2026-07-28 spec) and the Google Sheets API v4, with no Google SDK dependency — just
`fetch` and WebCrypto, so the same code runs on Node and in V8 isolates.

## Tools

| Tool | What it does |
|---|---|
| `list_spreadsheets` | List/search your spreadsheets, most recent first |
| `get_spreadsheet_info` | Spreadsheet title, tabs, and grid sizes |
| `read_range` | Read values, raw values, or formulas from a range |
| `update_cells` | Overwrite a range in place (`=`-prefixed strings become formulas) |
| `append_rows` | Append rows after the last row of data |
| `clear_range` | Clear values (keeps formatting) |
| `fill_formula` | Fill one formula across a range with relative references adjusting |
| `insert_rows` / `insert_columns` | Insert blank rows/columns at a position |
| `delete_rows` / `delete_columns` | Delete entire rows/columns |
| `add_sheet` / `delete_sheet` | Manage tabs |
| `format_cells` | Bold, colors, alignment, wrap, number formats |
| `find_replace` | Find & replace across a sheet or the whole file |
| `batch_update` | Raw Sheets API batchUpdate escape hatch (charts, merges, validation, …) |

Spreadsheet IDs can be given as bare IDs **or full Google Sheets URLs**. Rows are 1-based
numbers and columns are letters, exactly as in the Sheets UI.

## 1. Google Cloud credentials (one-time, needed either way)

1. In [Google Cloud Console](https://console.cloud.google.com/), create or pick a project.
2. Enable the **Google Sheets API** and **Google Drive API**.
3. **APIs & Services → OAuth consent screen**: set it up, add yourself under **Test users**.
   Then click **Publish app**. This does *not* require Google's verification review —
   personal-use apps (under 100 known users) are exempt; you just click through an
   "unverified app" warning once during authorization. Publishing matters because while
   the app sits in **Testing**, Google revokes refresh tokens every 7 days.
   The local extension recovers automatically by re-opening the browser, but a remote
   deployment needs a manual re-mint each time.
4. **APIs & Services → Credentials → Create Credentials → OAuth client ID →
   Desktop app**. Save the **Client ID** and **Client Secret**.

> The Sheets and Drive APIs are free to use, and this project never needs a Cloud billing
> account attached. Leaving billing unattached is the simplest guarantee against charges.

## 2a. Local install (Claude Desktop / local Cowork sessions)

```bash
npm install
npm run pack        # builds and produces google-sheets.mcpb (~1.7 MB)
```

Double-click `google-sheets.mcpb`, or Claude Desktop → **Settings → Extensions →
Install Extension…**. Paste your Client ID and Secret into the extension settings.
On first use a browser opens to authorize; the refresh token is cached at
`~/.config/google-sheets-mcp/token.json`.

The extension asks only for OAuth credentials. Service-account auth is still
supported when running the server directly or remotely — set
`GOOGLE_SERVICE_ACCOUNT_KEY_FILE` or `GOOGLE_SERVICE_ACCOUNT_KEY` in the
environment instead.

> Local MCP servers do **not** run in cloud Cowork sessions or on claude.ai — for those,
> use the remote deployment below.

## 2b. Remote install (cloud Cowork sessions, web, mobile)

**Mint a refresh token** — this runs the same browser consent flow and prints a
long-lived token for the server to use:

```bash
GOOGLE_OAUTH_CLIENT_ID=…apps.googleusercontent.com \
GOOGLE_OAUTH_CLIENT_SECRET=… \
npm run mint-token
```

**Pick a bearer token.** This is the shared secret Claude must present on every request:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

**Deploy to Cloudflare Workers** (free tier is plenty; the Worker is ~174 KB gzipped):

```bash
npx wrangler login
npx wrangler secret put MCP_BEARER_TOKEN            # the value you just generated
npx wrangler secret put GOOGLE_OAUTH_CLIENT_ID
npx wrangler secret put GOOGLE_OAUTH_CLIENT_SECRET
npx wrangler secret put GOOGLE_REFRESH_TOKEN        # from mint-token
npm run deploy
```

Wrangler prints a URL like `https://google-sheets-mcp.<you>.workers.dev`. Verify it with
`curl https://…/health` — it should return `ok`.

**Add it to Claude**: Settings → **Connectors** → **Add custom connector**.

- If your Add-connector dialog has a **Request headers** section (beta, gradual
  rollout): URL `https://google-sheets-mcp.<you>.workers.dev/mcp` with header
  `authorization: Bearer <your MCP_BEARER_TOKEN>`.
- If it doesn't, put the token in the URL path instead:
  `https://google-sheets-mcp.<you>.workers.dev/mcp/<your MCP_BEARER_TOKEN>`.

### Security notes

- The endpoint is public, so the bearer token is the only thing standing between the
  internet and your spreadsheets. Use a long random value and treat it like a password.
- Auth **fails closed**: if `MCP_BEARER_TOKEN` is unset, every request to `/mcp` is
  rejected with 401 rather than running unauthenticated.
- Token comparison is constant-time, so the secret can't be recovered by timing.
- `GOOGLE_REFRESH_TOKEN` grants access to every spreadsheet your account can open. To
  narrow that, use a service account instead (`GOOGLE_SERVICE_ACCOUNT_KEY`, inline JSON)
  and share only specific sheets with its email address.
- To revoke everything at once: [myaccount.google.com/permissions](https://myaccount.google.com/permissions).

## Configuration reference

| Env var / secret | Purpose |
|---|---|
| `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` | OAuth client (both modes) |
| `GOOGLE_REFRESH_TOKEN` | Pre-minted refresh token (required for remote) |
| `GOOGLE_SERVICE_ACCOUNT_KEY` | Inline service-account JSON (alternative to OAuth) |
| `GOOGLE_SERVICE_ACCOUNT_KEY_FILE` | Path to a service-account key (local only) |
| `MCP_BEARER_TOKEN` | Shared secret required by the remote endpoint |
| `GSHEETS_TOKEN_PATH` | Override the local token cache location |

Scopes: `spreadsheets` (read/write) + `drive.metadata.readonly` (list/search files).

## Development

```bash
npm install
npm run build       # compile to dist/
npm run typecheck   # tsc --noEmit
npm run pack        # build + package the .mcpb bundle
npm run dev:worker  # run the Worker locally via wrangler
npm run deploy      # deploy the Worker
```

```
src/
  index.ts          stdio entry point (local)
  worker.ts         Cloudflare Worker entry (remote) + bearer auth
  server.ts         server factory: registers all tool groups
  config.ts         credentials → token provider, shared by both entries
  google/
    auth.ts         fetch + WebCrypto token providers (refresh token, service account)
    client.ts       REST client for the Sheets/Drive endpoints used
    types.ts        minimal API types
  node/
    localOAuth.ts   Node-only desktop OAuth loopback flow
    mintToken.ts    CLI to print a refresh token for remote deploys
  tools/            one module per tool group (read, write, structure, format, advanced)
  utils/            A1-notation parsing, tool result/error helpers
```
