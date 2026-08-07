import { z } from "zod";
import type { sheets_v4 } from "googleapis";
import { resolveSheetId } from "../sheets.js";
import { parseA1Range, splitSheetRef } from "../utils/a1.js";

export const spreadsheetIdSchema = z
  .string()
  .describe("Spreadsheet ID or full Google Sheets URL");

export const sheetNameSchema = z
  .string()
  .optional()
  .describe("Sheet (tab) name; defaults to the first sheet");

export const cellValueSchema = z
  .union([z.string(), z.number(), z.boolean(), z.null()])
  .describe(
    'A cell value; strings starting with "=" are entered as formulas',
  );

export const rowsSchema = z
  .array(z.array(cellValueSchema))
  .describe("2D array of cell values, one inner array per row");

/**
 * Resolve a sheet reference plus optional A1 range into a GridRange for
 * batchUpdate requests. A sheet prefix inside `range` (e.g. "Sheet2!A1:B2")
 * overrides the `sheet` argument.
 */
export async function toGridRange(
  spreadsheetId: string,
  sheet: string | undefined,
  range: string | undefined,
): Promise<sheets_v4.Schema$GridRange> {
  const split = range ? splitSheetRef(range) : {};
  const info = await resolveSheetId(spreadsheetId, split.sheetName ?? sheet);
  const bounds = split.range ? parseA1Range(split.range) : {};
  return { sheetId: info.sheetId, ...bounds };
}
