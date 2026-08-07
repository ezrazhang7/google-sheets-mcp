import { z } from "zod";
import type { GoogleClient } from "../google/client.js";
import type { GridRange } from "../google/types.js";
import { parseA1Range, sheetRange, splitSheetRef } from "../utils/a1.js";

export const spreadsheetIdSchema = z
  .string()
  .describe("Spreadsheet ID or full Google Sheets URL");

export const sheetNameSchema = z
  .string()
  .optional()
  .describe("Sheet (tab) name; defaults to the first sheet");

export const cellValueSchema = z
  .union([z.string(), z.number(), z.boolean(), z.null()])
  .describe('A cell value; strings starting with "=" are entered as formulas');

export const rowsSchema = z
  .array(z.array(cellValueSchema))
  .describe("2D array of cell values, one inner array per row");

/**
 * Resolve a sheet reference plus optional A1 range into a GridRange for
 * batchUpdate requests. A sheet prefix inside `range` (e.g. "Sheet2!A1:B2")
 * overrides the `sheet` argument.
 */
export async function toGridRange(
  client: GoogleClient,
  spreadsheetId: string,
  sheet: string | undefined,
  range: string | undefined,
): Promise<GridRange> {
  const split = range ? splitSheetRef(range) : {};
  const info = await client.resolveSheet(spreadsheetId, split.sheetName ?? sheet);
  const bounds = split.range ? parseA1Range(split.range) : {};
  return { sheetId: info.sheetId, ...bounds };
}

/** Build a sheet-qualified A1 range, defaulting to the first sheet. */
export async function qualifyRange(
  client: GoogleClient,
  spreadsheetId: string,
  sheet: string | undefined,
  range: string | undefined,
): Promise<string> {
  if (range?.includes("!")) return range;
  const info = await client.resolveSheet(spreadsheetId, sheet);
  return sheetRange(info.title, range);
}
