import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import type { GoogleClient } from "../google/client.js";
import { parseSpreadsheetId } from "../utils/a1.js";
import { jsonResult, runTool } from "../utils/result.js";
import { sheetNameSchema, spreadsheetIdSchema } from "./shared.js";

export function registerAdvancedTools(
  server: McpServer,
  client: GoogleClient,
): void {
  server.registerTool(
    "find_replace",
    {
      title: "Find and replace",
      description:
        "Find and replace text across a sheet or the whole spreadsheet. Can also search inside formulas.",
      inputSchema: z.object({
        spreadsheetId: spreadsheetIdSchema,
        find: z.string().describe("Text to find"),
        replacement: z.string().describe("Replacement text"),
        sheet: sheetNameSchema,
        allSheets: z
          .boolean()
          .default(false)
          .describe("Search every sheet instead of just one"),
        matchCase: z.boolean().default(false),
        matchEntireCell: z.boolean().default(false),
        searchFormulas: z
          .boolean()
          .default(false)
          .describe("Also match text inside formulas"),
      }),
    },
    async (args) =>
      runTool(async () => {
        const id = parseSpreadsheetId(args.spreadsheetId);
        const findReplace: Record<string, unknown> = {
          find: args.find,
          replacement: args.replacement,
          matchCase: args.matchCase,
          matchEntireCell: args.matchEntireCell,
          searchByRegex: false,
          includeFormulas: args.searchFormulas,
        };
        if (args.allSheets) {
          findReplace["allSheets"] = true;
        } else {
          findReplace["sheetId"] = (await client.resolveSheet(id, args.sheet)).sheetId;
        }
        const res = await client.batchUpdate(id, [{ findReplace }]);
        const stats = res.replies?.[0]?.findReplace;
        return jsonResult({
          replacedValues: stats?.valuesChanged ?? 0,
          replacedFormulas: stats?.formulasChanged ?? 0,
          rowsChanged: stats?.rowsChanged ?? 0,
        });
      }),
  );

  server.registerTool(
    "batch_update",
    {
      title: "Raw batch update (advanced)",
      description:
        "Escape hatch: apply raw Google Sheets API batchUpdate requests (charts, conditional formatting, merges, data validation, sorting — anything the API supports). Each item is one request object from the Sheets API v4 batchUpdate schema.",
      inputSchema: z.object({
        spreadsheetId: spreadsheetIdSchema,
        requests: z
          .array(z.record(z.string(), z.unknown()))
          .min(1)
          .describe("Array of Sheets API v4 Request objects, applied atomically in order"),
      }),
    },
    async ({ spreadsheetId, requests }) =>
      runTool(async () => {
        const id = parseSpreadsheetId(spreadsheetId);
        const res = await client.batchUpdate(id, requests);
        return jsonResult({ replies: res.replies ?? [] });
      }),
  );
}
