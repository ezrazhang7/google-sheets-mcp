import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import { getDrive, getSheets, listSheets, resolveSheetId } from "../sheets.js";
import { parseSpreadsheetId, sheetRange } from "../utils/a1.js";
import { jsonResult, runTool } from "../utils/result.js";
import { spreadsheetIdSchema, sheetNameSchema } from "./shared.js";

const SPREADSHEET_MIME = "application/vnd.google-apps.spreadsheet";

const valueRenderMap = {
  formatted: "FORMATTED_VALUE",
  raw: "UNFORMATTED_VALUE",
  formula: "FORMULA",
} as const;

export function registerReadTools(server: McpServer): void {
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
        const drive = await getDrive();
        const qParts = [`mimeType='${SPREADSHEET_MIME}'`, "trashed=false"];
        if (nameContains) {
          qParts.push(`name contains '${nameContains.replace(/'/g, "\\'")}'`);
        }
        const res = await drive.files.list({
          q: qParts.join(" and "),
          orderBy: "modifiedTime desc",
          pageSize: limit,
          fields: "files(id,name,modifiedTime,webViewLink)",
        });
        return jsonResult(res.data.files ?? []);
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
        const sheets = await getSheets();
        const res = await sheets.spreadsheets.get({
          spreadsheetId: id,
          fields: "spreadsheetId,properties(title),spreadsheetUrl",
        });
        return jsonResult({
          spreadsheetId: res.data.spreadsheetId,
          title: res.data.properties?.title,
          url: res.data.spreadsheetUrl,
          sheets: await listSheets(id),
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
        const sheets = await getSheets();
        const res = await sheets.spreadsheets.values.get({
          spreadsheetId: id,
          range: await qualifyRange(id, sheet, range),
          valueRenderOption: valueRenderMap[render],
        });
        return jsonResult({
          range: res.data.range,
          values: res.data.values ?? [],
        });
      }),
  );
}

/** Build a sheet-qualified A1 range, defaulting to the first sheet. */
export async function qualifyRange(
  spreadsheetId: string,
  sheet: string | undefined,
  range: string | undefined,
): Promise<string> {
  if (range?.includes("!")) return range;
  const info = await resolveSheetId(spreadsheetId, sheet);
  return sheetRange(info.title, range);
}
