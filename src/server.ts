import { McpServer } from "@modelcontextprotocol/server";
import type { GoogleClient } from "./google/client.js";
import { registerReadTools } from "./tools/read.js";
import { registerWriteTools } from "./tools/write.js";
import { registerStructureTools } from "./tools/structure.js";
import { registerFormatTools } from "./tools/format.js";
import { registerAdvancedTools } from "./tools/advanced.js";

export const SERVER_NAME = "google-sheets-mcp";
export const SERVER_VERSION = "0.2.1";

const INSTRUCTIONS = `Edit Google Sheets in place — never create a copy to make a change.
Typical flow: list_spreadsheets or get_spreadsheet_info to find the target,
read_range to see current data, then the matching edit tool
(update_cells, append_rows, insert_rows/columns, delete_rows/columns,
fill_formula, format_cells, find_replace). Spreadsheet IDs may be given
as full Google Sheets URLs. Rows are 1-based numbers and columns are
letters, exactly as shown in the Sheets UI.`;

/**
 * Build a fully configured server instance bound to a Google client.
 * Called once per connection (stdio) or per request (stateless HTTP).
 */
export function createServer(client: GoogleClient): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { capabilities: { tools: {} }, instructions: INSTRUCTIONS },
  );
  registerReadTools(server, client);
  registerWriteTools(server, client);
  registerStructureTools(server, client);
  registerFormatTools(server, client);
  registerAdvancedTools(server, client);
  return server;
}
