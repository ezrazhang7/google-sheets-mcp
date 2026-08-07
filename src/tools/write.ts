import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import { applyBatchUpdate, getSheets } from "../sheets.js";
import { parseSpreadsheetId } from "../utils/a1.js";
import { jsonResult, runTool, textResult } from "../utils/result.js";
import {
  rowsSchema,
  sheetNameSchema,
  spreadsheetIdSchema,
  toGridRange,
} from "./shared.js";
import { qualifyRange } from "./read.js";

export function registerWriteTools(server: McpServer): void {
  server.registerTool(
    "update_cells",
    {
      title: "Update cells",
      description:
        "Write values into a range in place, overwriting existing cells. Values are parsed as if typed in the Sheets UI, so strings starting with '=' become formulas, and dates/numbers are recognized.",
      inputSchema: z.object({
        spreadsheetId: spreadsheetIdSchema,
        sheet: sheetNameSchema,
        range: z
          .string()
          .describe(
            'A1 range to write, e.g. "B2" or "A1:C3". The values array is anchored at its top-left cell.',
          ),
        values: rowsSchema,
        literal: z
          .boolean()
          .default(false)
          .describe(
            "If true, store values exactly as given (no formula or date parsing)",
          ),
      }),
    },
    async ({ spreadsheetId, sheet, range, values, literal }) =>
      runTool(async () => {
        const id = parseSpreadsheetId(spreadsheetId);
        const sheets = await getSheets();
        const res = await sheets.spreadsheets.values.update({
          spreadsheetId: id,
          range: await qualifyRange(id, sheet, range),
          valueInputOption: literal ? "RAW" : "USER_ENTERED",
          requestBody: { values },
        });
        return jsonResult({
          updatedRange: res.data.updatedRange,
          updatedCells: res.data.updatedCells,
        });
      }),
  );

  server.registerTool(
    "append_rows",
    {
      title: "Append rows",
      description:
        "Append rows after the last row of data in a sheet (or of the table containing `range`). Strings starting with '=' become formulas.",
      inputSchema: z.object({
        spreadsheetId: spreadsheetIdSchema,
        sheet: sheetNameSchema,
        values: rowsSchema,
        range: z
          .string()
          .optional()
          .describe(
            "Optional A1 range identifying the table to append to; defaults to the whole sheet",
          ),
      }),
    },
    async ({ spreadsheetId, sheet, values, range }) =>
      runTool(async () => {
        const id = parseSpreadsheetId(spreadsheetId);
        const sheets = await getSheets();
        const res = await sheets.spreadsheets.values.append({
          spreadsheetId: id,
          range: await qualifyRange(id, sheet, range),
          valueInputOption: "USER_ENTERED",
          insertDataOption: "INSERT_ROWS",
          requestBody: { values },
        });
        return jsonResult({
          appendedRange: res.data.updates?.updatedRange,
          appendedRows: res.data.updates?.updatedRows,
        });
      }),
  );

  server.registerTool(
    "clear_range",
    {
      title: "Clear a range",
      description:
        "Clear cell values in a range (formatting is kept). To remove rows or columns entirely, use delete_rows / delete_columns instead.",
      inputSchema: z.object({
        spreadsheetId: spreadsheetIdSchema,
        sheet: sheetNameSchema,
        range: z.string().describe('A1 range to clear, e.g. "A2:C10"'),
      }),
    },
    async ({ spreadsheetId, sheet, range }) =>
      runTool(async () => {
        const id = parseSpreadsheetId(spreadsheetId);
        const sheets = await getSheets();
        const res = await sheets.spreadsheets.values.clear({
          spreadsheetId: id,
          range: await qualifyRange(id, sheet, range),
        });
        return textResult(`Cleared ${res.data.clearedRange}`);
      }),
  );

  server.registerTool(
    "fill_formula",
    {
      title: "Fill a formula across a range",
      description:
        "Write one formula into every cell of a range, with relative references adjusting per cell (like dragging the fill handle). For a formula in a single cell, update_cells works too.",
      inputSchema: z.object({
        spreadsheetId: spreadsheetIdSchema,
        sheet: sheetNameSchema,
        range: z
          .string()
          .describe('A1 range to fill, e.g. "D2:D100"'),
        formula: z
          .string()
          .describe(
            'The formula as written for the top-left cell of the range, e.g. "=B2*C2"',
          ),
      }),
    },
    async ({ spreadsheetId, sheet, range, formula }) =>
      runTool(async () => {
        const id = parseSpreadsheetId(spreadsheetId);
        const gridRange = await toGridRange(id, sheet, range);
        const formulaValue = formula.startsWith("=") ? formula : `=${formula}`;
        await applyBatchUpdate(id, [
          {
            repeatCell: {
              range: gridRange,
              cell: {
                userEnteredValue: { formulaValue },
              },
              fields: "userEnteredValue",
            },
          },
        ]);
        return textResult(`Filled ${range} with ${formulaValue}`);
      }),
  );
}
