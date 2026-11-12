/** RFC 4180 CSV. Values that a spreadsheet would run as a formula are neutralised. */
export function toCsv(headers: string[], rows: (string | number | null | undefined)[][]): string {
  const cell = (value: string | number | null | undefined) => {
    let text = value == null ? "" : String(value);
    // Free text that starts like a formula gets a leading apostrophe; plain numbers ("-1.03") do not.
    if (typeof value === "string" && /^[=+\-@\t\r]/.test(text) && !/^-?\d+(\.\d+)?$/.test(text)) text = `'${text}`;
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return [headers, ...rows].map((row) => row.map(cell).join(",")).join("\r\n") + "\r\n";
}

export const dollars = (cents: number | null | undefined) => ((cents ?? 0) / 100).toFixed(2);
