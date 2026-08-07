/**
 * Minimal structural types for the slice of the Google Sheets and Drive REST
 * APIs this server uses. Hand-written rather than pulled from `googleapis` so
 * the client stays dependency-free and runs on both Node and Workers.
 */

export type CellValue = string | number | boolean | null;

export interface GridRange {
  sheetId: number;
  startRowIndex?: number;
  endRowIndex?: number;
  startColumnIndex?: number;
  endColumnIndex?: number;
}

export interface Color {
  red: number;
  green: number;
  blue: number;
}

export interface TextFormat {
  bold?: boolean;
  italic?: boolean;
  fontSize?: number;
  foregroundColor?: Color;
}

export interface CellFormat {
  textFormat?: TextFormat;
  backgroundColor?: Color;
  horizontalAlignment?: string;
  wrapStrategy?: string;
  numberFormat?: { type: string; pattern: string };
}

/** A Sheets API v4 batchUpdate request. Only the shapes we build are typed. */
export type BatchUpdateRequest = Record<string, unknown>;

export interface BatchUpdateResponse {
  replies?: Array<Record<string, any>>;
}

export interface SheetProperties {
  sheetId?: number;
  title?: string;
  index?: number;
  gridProperties?: { rowCount?: number; columnCount?: number };
}

export interface Spreadsheet {
  spreadsheetId?: string;
  spreadsheetUrl?: string;
  properties?: { title?: string };
  sheets?: Array<{ properties?: SheetProperties }>;
}

export interface ValueRange {
  range?: string;
  values?: CellValue[][];
}

export interface UpdateValuesResponse {
  updatedRange?: string;
  updatedCells?: number;
}

export interface AppendValuesResponse {
  updates?: { updatedRange?: string; updatedRows?: number };
}

export interface ClearValuesResponse {
  clearedRange?: string;
}

export interface DriveFile {
  id?: string;
  name?: string;
  modifiedTime?: string;
  webViewLink?: string;
}

export interface DriveFileList {
  files?: DriveFile[];
}

/** Sheet (tab) metadata in the normalized shape the tools consume. */
export interface SheetInfo {
  sheetId: number;
  title: string;
  index: number;
  rowCount: number;
  columnCount: number;
}
