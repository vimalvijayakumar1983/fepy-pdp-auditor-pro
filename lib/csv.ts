export function parseCsv(input: string): Record<string, string>[] {
  const records: string[][] = [];
  let record: string[] = [], cell = "", quoted = false;
  const csv = input.replace(/^\uFEFF/, "");
  for (let i = 0; i < csv.length; i++) {
    const c = csv[i];
    if (c === '"') {
      if (quoted && csv[i + 1] === '"') { cell += '"'; i++; }
      else quoted = !quoted;
    } else if (c === ',' && !quoted) { record.push(cell.trim()); cell = ""; }
    else if ((c === '\n' || c === '\r') && !quoted) {
      if (c === '\r' && csv[i + 1] === '\n') i++;
      record.push(cell.trim());
      if (record.some(Boolean)) records.push(record);
      record = []; cell = "";
    } else cell += c;
  }
  if (quoted) throw new Error("CSV has an unclosed quoted field.");
  record.push(cell.trim());
  if (record.some(Boolean)) records.push(record);
  if (records.length < 2) throw new Error("Add a header and at least one product row.");
  const headers = records.shift()!;
  if (new Set(headers).size !== headers.length || headers.some(h => !h)) throw new Error("CSV headers must be unique and non-empty.");
  if (!headers.includes("sku")) throw new Error("CSV must include a sku column.");
  return records.map((cells, i) => {
    if (cells.length > headers.length) throw new Error(`Row ${i + 2} has extra columns. Put fields containing commas inside quotes.`);
    return Object.fromEntries(headers.map((h, j) => [h, cells[j] || ""]));
  });
}
