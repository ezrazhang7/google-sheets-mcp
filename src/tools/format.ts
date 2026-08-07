import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import type { GoogleClient } from "../google/client.js";
import type { CellFormat, Color, TextFormat } from "../google/types.js";
import { parseSpreadsheetId } from "../utils/a1.js";
import { runTool, textResult } from "../utils/result.js";
import { sheetNameSchema, spreadsheetIdSchema, toGridRange } from "./shared.js";

const hexColorSchema = z
  .string()
  .regex(/^#?[0-9a-fA-F]{6}$/, 'Expected a hex color like "#FF8800"');

function toColor(hex: string): Color {
  const n = parseInt(hex.replace("#", ""), 16);
  return {
    red: ((n >> 16) & 0xff) / 255,
    green: ((n >> 8) & 0xff) / 255,
    blue: (n & 0xff) / 255,
  };
}

export function registerFormatTools(
  server: McpServer,
  client: GoogleClient,
): void {
  server.registerTool(
    "format_cells",
    {
      title: "Format cells",
      description:
        "Apply formatting to a range: bold/italic, font size, text and background color, alignment, wrapping, and number format. Only the options you pass are changed.",
      inputSchema: z.object({
        spreadsheetId: spreadsheetIdSchema,
        sheet: sheetNameSchema,
        range: z.string().describe('A1 range to format, e.g. "A1:F1"'),
        bold: z.boolean().optional(),
        italic: z.boolean().optional(),
        fontSize: z.number().int().min(1).optional(),
        textColor: hexColorSchema.optional(),
        backgroundColor: hexColorSchema.optional(),
        horizontalAlign: z.enum(["LEFT", "CENTER", "RIGHT"]).optional(),
        wrap: z.enum(["OVERFLOW_CELL", "CLIP", "WRAP"]).optional(),
        numberFormat: z
          .string()
          .optional()
          .describe(
            'Number format pattern, e.g. "#,##0.00", "0.0%", "$#,##0", "yyyy-mm-dd"',
          ),
      }),
    },
    async (args) =>
      runTool(async () => {
        const id = parseSpreadsheetId(args.spreadsheetId);
        const range = await toGridRange(client, id, args.sheet, args.range);
        const { format, fields } = buildFormat(args);
        if (fields.length === 0) {
          throw new Error("No formatting options were provided.");
        }
        await client.batchUpdate(id, [
          {
            repeatCell: {
              range,
              cell: { userEnteredFormat: format },
              fields: fields.map((f) => `userEnteredFormat.${f}`).join(","),
            },
          },
        ]);
        return textResult(`Formatted ${args.range}`);
      }),
  );
}

interface FormatArgs {
  bold?: boolean | undefined;
  italic?: boolean | undefined;
  fontSize?: number | undefined;
  textColor?: string | undefined;
  backgroundColor?: string | undefined;
  horizontalAlign?: "LEFT" | "CENTER" | "RIGHT" | undefined;
  wrap?: "OVERFLOW_CELL" | "CLIP" | "WRAP" | undefined;
  numberFormat?: string | undefined;
}

/** Build a CellFormat and the matching field mask from the provided options. */
function buildFormat(args: FormatArgs): { format: CellFormat; fields: string[] } {
  const format: CellFormat = {};
  const fields: string[] = [];
  const textFormat: TextFormat = {};

  if (args.bold !== undefined) {
    textFormat.bold = args.bold;
    fields.push("textFormat.bold");
  }
  if (args.italic !== undefined) {
    textFormat.italic = args.italic;
    fields.push("textFormat.italic");
  }
  if (args.fontSize !== undefined) {
    textFormat.fontSize = args.fontSize;
    fields.push("textFormat.fontSize");
  }
  if (args.textColor !== undefined) {
    textFormat.foregroundColor = toColor(args.textColor);
    fields.push("textFormat.foregroundColor");
  }
  if (Object.keys(textFormat).length > 0) format.textFormat = textFormat;

  if (args.backgroundColor !== undefined) {
    format.backgroundColor = toColor(args.backgroundColor);
    fields.push("backgroundColor");
  }
  if (args.horizontalAlign !== undefined) {
    format.horizontalAlignment = args.horizontalAlign;
    fields.push("horizontalAlignment");
  }
  if (args.wrap !== undefined) {
    format.wrapStrategy = args.wrap;
    fields.push("wrapStrategy");
  }
  if (args.numberFormat !== undefined) {
    format.numberFormat = { type: "NUMBER", pattern: args.numberFormat };
    fields.push("numberFormat");
  }
  return { format, fields };
}
