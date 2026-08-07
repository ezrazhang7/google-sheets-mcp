import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import type { GoogleClient } from "../google/client.js";
import { parseSpreadsheetId } from "../utils/a1.js";
import { jsonResult, runTool, textResult } from "../utils/result.js";
import {
  qualifyRange,
  rowsSchema,
  sheetNameSchema,
  spreadsheetIdSchema,
  toGridRange,
} from "./shared.js";

export function registerWriteTools(server: McpServer, client: GoogleClient): void {
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
        const data = await client.updateValues(
          id,
          await qualifyRange(client, id, sheet, range),
          values,
          literal ? "RAW" : "USER_ENTERED",
        );
        return jsonResult({
          updatedRange: data.updatedRange,
          updatedCells: data.updatedCells,
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
        const data = await client.appendValues(
          id,
          await qualifyRange(client, id, sheet, range),
          values,
        );
        return jsonResult({
          appendedRange: data.updates?.updatedRange,
          appendedRows: data.updates?.updatedRows,
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
        const data = await client.clearValues(
          id,
          await qualifyRange(client, id, sheet, range),
        );
        return textResult(`Cleared ${data.clearedRange}`);
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
        range: z.string().describe('A1 range to fill, e.g. "D2:D100"'),
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
        const gridRange = await toGridRange(client, id, sheet, range);
        const formulaValue = formula.startsWith("=") ? formula : `=${formula}`;
        await client.batchUpdate(id, [
          {
            repeatCell: {
              range: gridRange,
              cell: { userEnteredValue: { formulaValue } },
              fields: "userEnteredValue",
            },
          },
        ]);
        return textResult(`Filled ${range} with ${formulaValue}`);
      }),
  );
}
