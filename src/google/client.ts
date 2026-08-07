import type { TokenProvider } from "./auth.js";
import type {
  AppendValuesResponse,
  BatchUpdateRequest,
  BatchUpdateResponse,
  CellValue,
  ClearValuesResponse,
  DriveFileList,
  SheetInfo,
  Spreadsheet,
  UpdateValuesResponse,
  ValueRange,
} from "./types.js";

const SHEETS_BASE = "https://sheets.googleapis.com/v4/spreadsheets";
const DRIVE_BASE = "https://www.googleapis.com/drive/v3/files";

/** An error returned by a Google API, carrying the HTTP status. */
export class GoogleApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "GoogleApiError";
  }
}

export type ValueRenderOption =
  | "FORMATTED_VALUE"
  | "UNFORMATTED_VALUE"
  | "FORMULA";

export type ValueInputOption = "RAW" | "USER_ENTERED";

/**
 * A thin, runtime-agnostic client over the Sheets and Drive REST APIs.
 * One instance is bound per server connection.
 */
export class GoogleClient {
  constructor(private readonly tokens: TokenProvider) {}

  private async request<T>(
    url: string,
    init: { method?: string; body?: unknown } = {},
  ): Promise<T> {
    const token = await this.tokens.getAccessToken();
    const res = await fetch(url, {
      method: init.method ?? "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init.body === undefined
          ? {}
          : { "Content-Type": "application/json" }),
      },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    });
    const text = await res.text();
    if (!res.ok) {
      throw new GoogleApiError(res.status, extractApiMessage(text, res.status));
    }
    return (text ? JSON.parse(text) : {}) as T;
  }

  // ---------------------------------------------------------------- Sheets

  getSpreadsheet(spreadsheetId: string, fields: string): Promise<Spreadsheet> {
    const url = `${SHEETS_BASE}/${encodeURIComponent(spreadsheetId)}?fields=${encodeURIComponent(fields)}`;
    return this.request<Spreadsheet>(url);
  }

  /** Sheet (tab) metadata, normalized with defaults filled in. */
  async listSheets(spreadsheetId: string): Promise<SheetInfo[]> {
    const data = await this.getSpreadsheet(
      spreadsheetId,
      "sheets(properties(sheetId,title,index,gridProperties(rowCount,columnCount)))",
    );
    return (data.sheets ?? []).map((sheet) => ({
      sheetId: sheet.properties?.sheetId ?? 0,
      title: sheet.properties?.title ?? "",
      index: sheet.properties?.index ?? 0,
      rowCount: sheet.properties?.gridProperties?.rowCount ?? 0,
      columnCount: sheet.properties?.gridProperties?.columnCount ?? 0,
    }));
  }

  /**
   * Resolve a sheet reference — a title, or nothing for the first sheet — to
   * its numeric sheetId, which structural batchUpdate requests require.
   */
  async resolveSheet(
    spreadsheetId: string,
    sheetName?: string,
  ): Promise<SheetInfo> {
    const all = await this.listSheets(spreadsheetId);
    const first = all[0];
    if (!first) throw new Error("Spreadsheet has no sheets.");
    if (!sheetName) return first;
    const match = all.find(
      (sheet) => sheet.title.toLowerCase() === sheetName.toLowerCase(),
    );
    if (!match) {
      const names = all.map((sheet) => `"${sheet.title}"`).join(", ");
      throw new Error(`No sheet named "${sheetName}". Available sheets: ${names}`);
    }
    return match;
  }

  getValues(
    spreadsheetId: string,
    range: string,
    renderOption: ValueRenderOption,
  ): Promise<ValueRange> {
    const url = `${this.valuesUrl(spreadsheetId, range)}?valueRenderOption=${renderOption}`;
    return this.request<ValueRange>(url);
  }

  updateValues(
    spreadsheetId: string,
    range: string,
    values: CellValue[][],
    inputOption: ValueInputOption,
  ): Promise<UpdateValuesResponse> {
    const url = `${this.valuesUrl(spreadsheetId, range)}?valueInputOption=${inputOption}`;
    return this.request<UpdateValuesResponse>(url, {
      method: "PUT",
      body: { values },
    });
  }

  appendValues(
    spreadsheetId: string,
    range: string,
    values: CellValue[][],
  ): Promise<AppendValuesResponse> {
    const url = `${this.valuesUrl(spreadsheetId, range)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;
    return this.request<AppendValuesResponse>(url, {
      method: "POST",
      body: { values },
    });
  }

  clearValues(
    spreadsheetId: string,
    range: string,
  ): Promise<ClearValuesResponse> {
    return this.request<ClearValuesResponse>(
      `${this.valuesUrl(spreadsheetId, range)}:clear`,
      { method: "POST", body: {} },
    );
  }

  batchUpdate(
    spreadsheetId: string,
    requests: BatchUpdateRequest[],
  ): Promise<BatchUpdateResponse> {
    return this.request<BatchUpdateResponse>(
      `${SHEETS_BASE}/${encodeURIComponent(spreadsheetId)}:batchUpdate`,
      { method: "POST", body: { requests } },
    );
  }

  private valuesUrl(spreadsheetId: string, range: string): string {
    return `${SHEETS_BASE}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}`;
  }

  // ----------------------------------------------------------------- Drive

  listSpreadsheetFiles(query: string, pageSize: number): Promise<DriveFileList> {
    const params = new URLSearchParams({
      q: query,
      orderBy: "modifiedTime desc",
      pageSize: String(pageSize),
      fields: "files(id,name,modifiedTime,webViewLink)",
    });
    return this.request<DriveFileList>(`${DRIVE_BASE}?${params}`);
  }
}

/** Pull the human-readable message out of a Google JSON error body. */
function extractApiMessage(body: string, status: number): string {
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string } };
    if (parsed.error?.message) return parsed.error.message;
  } catch {
    // Fall through to the raw body.
  }
  return body.slice(0, 300) || `HTTP ${status}`;
}
