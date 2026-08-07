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
