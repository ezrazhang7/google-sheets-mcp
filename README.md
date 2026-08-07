# Google Sheets MCP

An MCP server that lets Claude (including Claude Cowork and Claude Desktop) work with
your Google Sheets **in place** — no more "here's a new spreadsheet" every time.

Read data, edit cells inline with natural language, append rows, insert/delete rows and
columns, fill formulas, format cells, and find & replace — all against the sheet you
already have open.

Built on the [MCP TypeScript SDK v2](https://github.com/modelcontextprotocol/typescript-sdk)
(2026-07-28 spec) and the Google Sheets API v4.

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

## Setup

### 1. Google Cloud credentials (one-time)

1. In [Google Cloud Console](https://console.cloud.google.com/), create (or pick) a project.
2. Enable the **Google Sheets API** and **Google Drive API**.
3. Under **APIs & Services → Credentials**, create an **OAuth client ID** of type
   **Desktop app**. Note the client ID and secret.
   - Alternative: create a **service account** key instead, and share your sheets with
     the service account's email address.

### 2a. Install into Claude Desktop / Cowork (recommended)

```bash
npm install
npm run pack        # builds and produces google-sheets.mcpb
```

Double-click `google-sheets.mcpb` (or Claude Desktop → Settings → Extensions →
Install Extension…), then paste your OAuth client ID and secret in the extension
settings. On first use a browser window opens to authorize your Google account;
tokens are cached at `~/.config/google-sheets-mcp/token.json`.

### 2b. Or run as a plain local MCP server

Add to your MCP client config (e.g. `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "google-sheets": {
      "command": "node",
      "args": ["/path/to/google-sheets-mcp/dist/index.js"],
      "env": {
        "GOOGLE_OAUTH_CLIENT_ID": "…apps.googleusercontent.com",
        "GOOGLE_OAUTH_CLIENT_SECRET": "…"
      }
    }
  }
}
```

### Configuration reference

| Env var | Purpose |
|---|---|
| `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` | OAuth desktop flow (acts as you) |
| `GOOGLE_SERVICE_ACCOUNT_KEY_FILE` | Path to a service-account JSON key |
| `GOOGLE_SERVICE_ACCOUNT_KEY` | Inline service-account JSON |
| `GOOGLE_APPLICATION_CREDENTIALS` | Standard ADC fallback |
| `GSHEETS_TOKEN_PATH` | Override OAuth token cache location |
| `GSHEETS_SCOPES` | Override requested OAuth scopes |

Default scopes: `spreadsheets` (read/write) + `drive.metadata.readonly` (list/search files).

## Development

```bash
npm install
npm run build       # compile to dist/
npm run typecheck   # tsc --noEmit
npm run pack        # build + package .mcpb bundle
```

Source layout:

```
src/
  index.ts        stdio entry point
  server.ts       server factory: registers all tool groups
  auth.ts         OAuth loopback / service account / ADC resolution
  sheets.ts       googleapis client wrappers + sheet resolution
  tools/          one module per tool group (read, write, structure, format, advanced)
  utils/          A1-notation parsing, tool result/error helpers
```
