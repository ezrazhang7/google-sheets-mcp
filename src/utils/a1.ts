/** Convert a column letter ("A", "AB") to a 0-based column index. */
export function columnToIndex(column: string): number {
  const letters = column.toUpperCase().trim();
  if (!/^[A-Z]+$/.test(letters)) {
    throw new Error(`Invalid column letter: "${column}"`);
  }
  let index = 0;
  for (const ch of letters) {
    index = index * 26 + (ch.charCodeAt(0) - 64);
  }
  return index - 1;
}

/** Convert a 0-based column index to a column letter. */
export function indexToColumn(index: number): string {
  let n = index + 1;
  let letters = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

/**
 * Quote a sheet name for use in an A1 range if needed
 * (names with spaces or special characters require single quotes).
 */
export function quoteSheetName(name: string): string {
  return /^[A-Za-z0-9_]+$/.test(name) ? name : `'${name.replace(/'/g, "''")}'`;
}

/** Build an A1 range string scoped to a sheet, e.g. `'My Sheet'!A1:C10`. */
export function sheetRange(sheetName: string, range?: string): string {
  return range ? `${quoteSheetName(sheetName)}!${range}` : quoteSheetName(sheetName);
}

/** The row/column bounds of an A1 range, 0-based and half-open, as used by GridRange. */
export interface GridRangeParts {
  startRowIndex?: number;
  endRowIndex?: number;
  startColumnIndex?: number;
  endColumnIndex?: number;
}

/**
 * Split an A1 reference that may carry a sheet prefix
 * (`'My Sheet'!A1:B2` or `Sheet1!A1`) into sheet name and bare range.
 */
export function splitSheetRef(ref: string): { sheetName?: string; range?: string } {
  const bang = ref.lastIndexOf("!");
  if (bang === -1) return { range: ref || undefined };
  let sheetName = ref.slice(0, bang);
  if (sheetName.startsWith("'") && sheetName.endsWith("'")) {
    sheetName = sheetName.slice(1, -1).replace(/''/g, "'");
  }
  return { sheetName, range: ref.slice(bang + 1) || undefined };
}

/**
 * Parse a bare A1 range (no sheet prefix) into 0-based half-open GridRange
 * bounds. Supports "A1:C10", "A1", "A:C" (whole columns), and "2:5" (whole rows).
 */
export function parseA1Range(range: string): GridRangeParts {
  const parts = range.split(":");
  if (parts.length > 2 || parts[0] === "") {
    throw new Error(`Invalid A1 range: "${range}"`);
  }
  const start = parseA1Cell(parts[0]!);
  const end = parts.length === 2 ? parseA1Cell(parts[1]!) : start;
  if (
    (start.col === undefined) !== (end.col === undefined) ||
    (start.row === undefined) !== (end.row === undefined)
  ) {
    throw new Error(`Invalid A1 range: "${range}"`);
  }
  const out: GridRangeParts = {};
  if (start.col !== undefined && end.col !== undefined) {
    out.startColumnIndex = Math.min(start.col, end.col);
    out.endColumnIndex = Math.max(start.col, end.col) + 1;
  }
  if (start.row !== undefined && end.row !== undefined) {
    out.startRowIndex = Math.min(start.row, end.row);
    out.endRowIndex = Math.max(start.row, end.row) + 1;
  }
  return out;
}

function parseA1Cell(cell: string): { col?: number; row?: number } {
  const match = cell.trim().match(/^([A-Za-z]+)?([0-9]+)?$/);
  if (!match || (!match[1] && !match[2])) {
    throw new Error(`Invalid A1 cell reference: "${cell}"`);
  }
  return {
    col: match[1] ? columnToIndex(match[1]) : undefined,
    row: match[2] ? Number(match[2]) - 1 : undefined,
  };
}

/**
 * Accept either a bare spreadsheet ID or a full Google Sheets URL and
 * return the spreadsheet ID.
 */
export function parseSpreadsheetId(idOrUrl: string): string {
  const urlMatch = idOrUrl.match(/\/spreadsheets\/d\/([A-Za-z0-9_-]+)/);
  if (urlMatch?.[1]) return urlMatch[1];
  const trimmed = idOrUrl.trim();
  if (!/^[A-Za-z0-9_-]{20,}$/.test(trimmed)) {
    throw new Error(
      `"${idOrUrl}" does not look like a spreadsheet ID or Google Sheets URL.`,
    );
  }
  return trimmed;
}
