import { google, type sheets_v4, type drive_v3 } from "googleapis";
import { getAuthClient } from "./auth.js";

let sheetsClient: sheets_v4.Sheets | undefined;
let driveClient: drive_v3.Drive | undefined;

export async function getSheets(): Promise<sheets_v4.Sheets> {
  if (!sheetsClient) {
    const auth = await getAuthClient();
    sheetsClient = google.sheets({ version: "v4", auth });
  }
  return sheetsClient;
}

export async function getDrive(): Promise<drive_v3.Drive> {
  if (!driveClient) {
    const auth = await getAuthClient();
    driveClient = google.drive({ version: "v3", auth });
  }
  return driveClient;
}

export interface SheetInfo {
  sheetId: number;
  title: string;
  index: number;
  rowCount: number;
  columnCount: number;
}

/** Fetch sheet (tab) metadata for a spreadsheet. */
export async function listSheets(spreadsheetId: string): Promise<SheetInfo[]> {
  const sheets = await getSheets();
  const res = await sheets.spreadsheets.get({
    spreadsheetId,
    fields:
      "sheets(properties(sheetId,title,index,gridProperties(rowCount,columnCount)))",
  });
  return (res.data.sheets ?? []).map((s) => ({
    sheetId: s.properties?.sheetId ?? 0,
    title: s.properties?.title ?? "",
    index: s.properties?.index ?? 0,
    rowCount: s.properties?.gridProperties?.rowCount ?? 0,
    columnCount: s.properties?.gridProperties?.columnCount ?? 0,
  }));
}

/**
 * Resolve a sheet (tab) reference — a title, or nothing for the first sheet —
 * to its numeric sheetId, which structural batchUpdate requests require.
 */
export async function resolveSheetId(
  spreadsheetId: string,
  sheetName?: string,
): Promise<SheetInfo> {
  const all = await listSheets(spreadsheetId);
  if (all.length === 0) throw new Error("Spreadsheet has no sheets.");
  if (!sheetName) return all[0]!;
  const match = all.find(
    (s) => s.title.toLowerCase() === sheetName.toLowerCase(),
  );
  if (!match) {
    const names = all.map((s) => `"${s.title}"`).join(", ");
    throw new Error(`No sheet named "${sheetName}". Available sheets: ${names}`);
  }
  return match;
}

/** Apply a list of structural requests via spreadsheets.batchUpdate. */
export async function applyBatchUpdate(
  spreadsheetId: string,
  requests: sheets_v4.Schema$Request[],
): Promise<sheets_v4.Schema$BatchUpdateSpreadsheetResponse> {
  const sheets = await getSheets();
  const res = await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests },
  });
  return res.data;
}
