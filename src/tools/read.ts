import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import type { GoogleClient, ValueRenderOption } from "../google/client.js";
import { parseSpreadsheetId } from "../utils/a1.js";
import { jsonResult, runTool } from "../utils/result.js";
import { qualifyRange, sheetNameSchema, spreadsheetIdSchema } from "./shared.js";

const SPREADSHEET_MIME = "application/vnd.google-apps.spreadsheet";

const valueRenderMap: Record<string, ValueRenderOption> = {
  formatted: "FORMATTED_VALUE",
  raw: "UNFORMATTED_VALUE",
  formula: "FORMULA",
};

export function registerReadTools(server: McpServer, client: GoogleClient): void {
  server.registerTool(
    "list_spreadsheets",
    {
      title: "List spreadsheets",
      description:
        "List Google Sheets spreadsheets the authorized account can access, most recently modified first. Optionally filter by name.",
      inputSchema: z.object({
        nameContains: z
          .string()
          .optional()
          .describe("Only return spreadsheets whose name contains this text"),
        limit: z.number().int().min(1).max(100).default(20),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ nameContains, limit }) =>
      runTool(async () => {
        const clauses = [`mimeType='${SPREADSHEET_MIME}'`, "trashed=false"];
        if (nameContains) {
          clauses.push(`name contains '${nameContains.replace(/'/g, "\\'")}'`);
        }
        const data = await client.listSpreadsheetFiles(clauses.join(" and "), limit);
        return jsonResult(data.files ?? []);
      }),
  );

  server.registerTool(
    "get_spreadsheet_info",
    {
      title: "Get spreadsheet info",
      description:
        "Get a spreadsheet's title and its sheets (tabs) with their IDs and grid sizes. Call this before structural edits to see what sheets exist.",
      inputSchema: z.object({ spreadsheetId: spreadsheetIdSchema }),
      annotations: { readOnlyHint: true },
    },
    async ({ spreadsheetId }) =>
      runTool(async () => {
        const id = parseSpreadsheetId(spreadsheetId);
        const data = await client.getSpreadsheet(
          id,
          "spreadsheetId,spreadsheetUrl,properties(title)",
        );
        return jsonResult({
          spreadsheetId: data.spreadsheetId,
          title: data.properties?.title,
          url: data.spreadsheetUrl,
          sheets: await client.listSheets(id),
        });
      }),
  );

  server.registerTool(
    "read_range",
    {
      title: "Read a range",
      description:
        "Read cell values from a sheet. Omit `range` to read the whole sheet. Use render 'formula' to see the formulas behind cells.",
      inputSchema: z.object({
        spreadsheetId: spreadsheetIdSchema,
        sheet: sheetNameSchema,
        range: z
          .string()
          .optional()
          .describe('A1 range like "A1:C10"; omit for the entire sheet'),
        render: z
          .enum(["formatted", "raw", "formula"])
          .default("formatted")
          .describe(
            "How to render values: formatted (as displayed), raw (underlying values), or formula (cell formulas)",
          ),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ spreadsheetId, sheet, range, render }) =>
      runTool(async () => {
        const id = parseSpreadsheetId(spreadsheetId);
        const data = await client.getValues(
          id,
          await qualifyRange(client, id, sheet, range),
          valueRenderMap[render] ?? "FORMATTED_VALUE",
        );
        return jsonResult({ range: data.range, values: data.values ?? [] });
      }),
  );
}
