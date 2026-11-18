// Parses an employee CSV into rows for the import_targets() SQL function.
// Handles quoted fields, escaped quotes, CRLF, a UTF-8 BOM, and the ';' / tab delimiters that
// Excel produces in many locales. Validation of the addresses themselves (format, verified
// domain) is done again server-side; this only shapes the data and reports file-level problems.

export const MAX_ROWS = 5000;

export interface TargetRow {
  email: string;
  full_name?: string;
  department?: string;
  line: number; // 1-based line in the file, for error messages
}

export interface ParseResult {
  rows: TargetRow[];
  errors: { line: number; reason: string }[];
}

const HEADER_ALIASES: Record<"email" | "full_name" | "department", string[]> = {
  email: ["email", "e-mail", "email address", "work email", "mail"],
  full_name: ["name", "full name", "full_name", "fullname", "employee", "employee name"],
  department: ["department", "dept", "team", "division"],
};

function detectDelimiter(firstLine: string): string {
  const counts: [string, number][] = [",", ";", "\t"].map((d) => [d, firstLine.split(d).length - 1]);
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 0 ? counts[0][0] : ",";
}

/** RFC 4180-style parser. Returns records with the 1-based line each record starts on. */
export function parseCsv(text: string, delimiter: string): { cells: string[]; line: number }[] {
  const records: { cells: string[]; line: number }[] = [];
  let cells: string[] = [];
  let field = "";
  let inQuotes = false;
  let line = 1;
  let recordLine = 1;

  const endField = () => {
    cells.push(field);
    field = "";
  };
  const endRecord = () => {
    endField();
    records.push({ cells, line: recordLine });
    cells = [];
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        if (ch === "\n") line++;
        field += ch;
      }
    } else if (ch === '"' && field === "") {
      inQuotes = true;
    } else if (ch === delimiter) {
      endField();
    } else if (ch === "\r") {
      // swallowed; the following \n ends the record (a lone \r is treated as a newline too)
      if (text[i + 1] !== "\n") {
        endRecord();
        line++;
        recordLine = line;
      }
    } else if (ch === "\n") {
      endRecord();
      line++;
      recordLine = line;
    } else {
      field += ch;
    }
  }
  if (field !== "" || cells.length > 0) endRecord();
  return records;
}

export function parseTargetsCsv(input: string): ParseResult {
  const text = input.replace(/^﻿/, "");
  const errors: ParseResult["errors"] = [];
  const firstLine = text.split(/\r\n|\n|\r/, 1)[0] ?? "";
  const records = parseCsv(text, detectDelimiter(firstLine)).filter(
    (r) => !(r.cells.length === 1 && r.cells[0].trim() === ""),
  );

  if (records.length === 0) {
    return { rows: [], errors: [{ line: 1, reason: "file is empty" }] };
  }

  const header = records[0].cells.map((h) => h.trim().toLowerCase());
  const col = (field: keyof typeof HEADER_ALIASES) =>
    header.findIndex((h) => HEADER_ALIASES[field].includes(h));
  const emailCol = col("email");
  const nameCol = col("full_name");
  const deptCol = col("department");

  if (emailCol === -1) {
    return { rows: [], errors: [{ line: records[0].line, reason: 'no "email" column found in the header row' }] };
  }

  const dataRecords = records.slice(1);
  if (dataRecords.length > MAX_ROWS) {
    return {
      rows: [],
      errors: [{ line: 1, reason: `too many rows (${dataRecords.length}); the limit is ${MAX_ROWS} per import` }],
    };
  }

  const rows: TargetRow[] = dataRecords.map((r) => {
    const row: TargetRow = { email: (r.cells[emailCol] ?? "").trim(), line: r.line };
    const name = nameCol >= 0 ? (r.cells[nameCol] ?? "").trim() : "";
    const dept = deptCol >= 0 ? (r.cells[deptCol] ?? "").trim() : "";
    if (name) row.full_name = name;
    if (dept) row.department = dept;
    return row;
  });

  return { rows, errors };
}
