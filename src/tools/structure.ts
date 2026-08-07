import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import type { GoogleClient } from "../google/client.js";
import { columnToIndex, indexToColumn, parseSpreadsheetId } from "../utils/a1.js";
import { jsonResult, runTool, textResult } from "../utils/result.js";
import { sheetNameSchema, spreadsheetIdSchema } from "./shared.js";

type Dimension = "ROWS" | "COLUMNS";

const rowStartSchema = z
  .number()
  .int()
  .min(1)
  .describe("1-based row number where the operation starts (as shown in the sheet)");

const columnStartSchema = z
  .string()
  .describe('Column letter where the operation starts, e.g. "C"');

const countSchema = z.number().int().min(1).default(1).describe("How many to affect");

interface DimensionOp {
  spreadsheetId: string;
  sheet?: string | undefined;
  dimension: Dimension;
  /** 0-based start index (half-open range start). */
  startIndex: number;
  count: number;
  kind: "insert" | "delete";
  inheritFromBefore?: boolean | undefined;
}

/** Shared implementation behind insert/delete of rows and columns. */
async function applyDimensionOp(
  client: GoogleClient,
  op: DimensionOp,
): Promise<string> {
  const id = parseSpreadsheetId(op.spreadsheetId);
  const info = await client.resolveSheet(id, op.sheet);
  const range = {
    sheetId: info.sheetId,
    dimension: op.dimension,
    startIndex: op.startIndex,
    endIndex: op.startIndex + op.count,
  };
  await client.batchUpdate(id, [
    op.kind === "insert"
      ? { insertDimension: { range, inheritFromBefore: op.inheritFromBefore ?? false } }
      : { deleteDimension: { range } },
  ]);
  const what = op.dimension === "ROWS" ? "row(s)" : "column(s)";
  const at =
    op.dimension === "ROWS"
      ? `row ${op.startIndex + 1}`
      : `column ${indexToColumn(op.startIndex)}`;
  const verb = op.kind === "insert" ? "Inserted" : "Deleted";
  return `${verb} ${op.count} ${what} at ${at} in "${info.title}"`;
}

export function registerStructureTools(
  server: McpServer,
  client: GoogleClient,
): void {
  server.registerTool(
    "insert_rows",
    {
      title: "Insert rows",
      description:
        "Insert blank rows at a position, shifting existing rows down. Existing formulas and references adjust automatically.",
      inputSchema: z.object({
        spreadsheetId: spreadsheetIdSchema,
        sheet: sheetNameSchema,
        startRow: rowStartSchema,
        count: countSchema,
        inheritFromBefore: z
          .boolean()
          .default(false)
          .describe("Inherit formatting from the row above instead of the row below"),
      }),
    },
    async ({ spreadsheetId, sheet, startRow, count, inheritFromBefore }) =>
      runTool(async () =>
        textResult(
          await applyDimensionOp(client, {
            spreadsheetId,
            sheet,
            dimension: "ROWS",
            startIndex: startRow - 1,
            count,
            kind: "insert",
            inheritFromBefore,
          }),
        ),
      ),
  );

  server.registerTool(
    "delete_rows",
    {
      title: "Delete rows",
      description:
        "Delete entire rows, shifting the rows below up. This removes the rows themselves, not just their values.",
      inputSchema: z.object({
        spreadsheetId: spreadsheetIdSchema,
        sheet: sheetNameSchema,
        startRow: rowStartSchema,
        count: countSchema,
      }),
      annotations: { destructiveHint: true },
    },
    async ({ spreadsheetId, sheet, startRow, count }) =>
      runTool(async () =>
        textResult(
          await applyDimensionOp(client, {
            spreadsheetId,
            sheet,
            dimension: "ROWS",
            startIndex: startRow - 1,
            count,
            kind: "delete",
          }),
        ),
      ),
  );

  server.registerTool(
    "insert_columns",
    {
      title: "Insert columns",
      description:
        "Insert blank columns at a position, shifting existing columns right. Existing formulas and references adjust automatically.",
      inputSchema: z.object({
        spreadsheetId: spreadsheetIdSchema,
        sheet: sheetNameSchema,
        startColumn: columnStartSchema,
        count: countSchema,
        inheritFromBefore: z
          .boolean()
          .default(false)
          .describe(
            "Inherit formatting from the column to the left instead of the right",
          ),
      }),
    },
    async ({ spreadsheetId, sheet, startColumn, count, inheritFromBefore }) =>
      runTool(async () =>
        textResult(
          await applyDimensionOp(client, {
            spreadsheetId,
            sheet,
            dimension: "COLUMNS",
            startIndex: columnToIndex(startColumn),
            count,
            kind: "insert",
            inheritFromBefore,
          }),
        ),
      ),
  );

  server.registerTool(
    "delete_columns",
    {
      title: "Delete columns",
      description:
        "Delete entire columns, shifting the columns to the right left. This removes the columns themselves, not just their values.",
      inputSchema: z.object({
        spreadsheetId: spreadsheetIdSchema,
        sheet: sheetNameSchema,
        startColumn: columnStartSchema,
        count: countSchema,
      }),
      annotations: { destructiveHint: true },
    },
    async ({ spreadsheetId, sheet, startColumn, count }) =>
      runTool(async () =>
        textResult(
          await applyDimensionOp(client, {
            spreadsheetId,
            sheet,
            dimension: "COLUMNS",
            startIndex: columnToIndex(startColumn),
            count,
            kind: "delete",
          }),
        ),
      ),
  );

  server.registerTool(
    "add_sheet",
    {
      title: "Add a sheet (tab)",
      description: "Add a new sheet (tab) to an existing spreadsheet.",
      inputSchema: z.object({
        spreadsheetId: spreadsheetIdSchema,
        title: z.string().describe("Name for the new sheet"),
        rows: z.number().int().min(1).default(1000),
        columns: z.number().int().min(1).default(26),
      }),
    },
    async ({ spreadsheetId, title, rows, columns }) =>
      runTool(async () => {
        const id = parseSpreadsheetId(spreadsheetId);
        const res = await client.batchUpdate(id, [
          {
            addSheet: {
              properties: {
                title,
                gridProperties: { rowCount: rows, columnCount: columns },
              },
            },
          },
        ]);
        const props = res.replies?.[0]?.addSheet?.properties;
        return jsonResult({ sheetId: props?.sheetId, title: props?.title });
      }),
  );

  server.registerTool(
    "delete_sheet",
    {
      title: "Delete a sheet (tab)",
      description: "Delete a sheet (tab) and all of its data from a spreadsheet.",
      inputSchema: z.object({
        spreadsheetId: spreadsheetIdSchema,
        sheet: z.string().describe("Name of the sheet to delete"),
      }),
      annotations: { destructiveHint: true },
    },
    async ({ spreadsheetId, sheet }) =>
      runTool(async () => {
        const id = parseSpreadsheetId(spreadsheetId);
        const info = await client.resolveSheet(id, sheet);
        await client.batchUpdate(id, [{ deleteSheet: { sheetId: info.sheetId } }]);
        return textResult(`Deleted sheet "${info.title}"`);
      }),
  );
}
