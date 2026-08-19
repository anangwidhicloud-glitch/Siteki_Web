import ExcelJS from "exceljs";

const MAX_FILE_BYTES = 15 * 1024 * 1024;
const MAX_ROWS = 50000;

const FORMATS = {
  maintenance: {
    filename: "Rekap Perawatan.xlsx",
    sheet: "det_rawat",
    label: "Rekap Perawatan",
    requiredHeaders: ["Tanggal", "Kategori", "Jenis", "Nama Mesin", "Waktu", "Keterangan"],
  },
  work_reports: {
    filename: "Laporan Kerja.xlsx",
    sheet: "lap_kerja",
    label: "Laporan Kerja",
    requiredHeaders: [
      "Tanggal", "Bagian", "Kategori Mesin", "Jenis", "Nama Mesin",
      "Jenis Pekerjaan", "Laporan Pekerjaan",
    ],
  },
};

const clean = value => String(value ?? "").trim();
const normalized = value => clean(value).toLocaleLowerCase("id-ID");

function scalar(value, sheet, row, column) {
  if (value === null || value === undefined) return null;
  if (value instanceof Date || ["string", "number", "boolean"].includes(typeof value)) return value;
  if (typeof value === "object") {
    if (Object.prototype.hasOwnProperty.call(value, "formula") || Object.prototype.hasOwnProperty.call(value, "sharedFormula")) {
      throw new Error(`Formula tidak diizinkan (${sheet}, baris ${row}, kolom ${column}).`);
    }
    if (Array.isArray(value.richText)) return value.richText.map(part => part.text || "").join("");
    if (value.hyperlink) return String(value.text || value.hyperlink);
    if (Object.prototype.hasOwnProperty.call(value, "result")) return scalar(value.result, sheet, row, column);
  }
  throw new Error(`Format sel tidak didukung (${sheet}, baris ${row}, kolom ${column}).`);
}

function isoDateParts(year, month, day) {
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (month < 1 || month > 12 || day < 1 || candidate.getUTCFullYear() !== year || candidate.getUTCMonth() !== month - 1 || candidate.getUTCDate() !== day) return null;
  return `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
}

export function excelDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return isoDateParts(value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate());
  }
  const source = clean(value);
  let match = source.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (match) return isoDateParts(Number(match[3]), Number(match[2]), Number(match[1]));
  match = source.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? isoDateParts(Number(match[1]), Number(match[2]), Number(match[3])) : null;
}

function dateTime(value, baseDate) {
  if (value === null || value === undefined || value === "") return null;
  let hour;
  let minute;
  let second = 0;
  let date = baseDate;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    hour = value.getUTCHours();
    minute = value.getUTCMinutes();
    second = value.getUTCSeconds();
    if (value.getUTCFullYear() >= 2000) date = excelDate(value);
  } else {
    const source = clean(value);
    const full = source.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})\s+(\d{1,2}):([0-5]\d)(?::([0-5]\d))?/);
    const time = source.match(/^(\d{1,2}):([0-5]\d)(?::([0-5]\d))?$/);
    if (full) {
      date = isoDateParts(Number(full[3]), Number(full[2]), Number(full[1]));
      hour = Number(full[4]); minute = Number(full[5]); second = Number(full[6] || 0);
    } else if (time) {
      hour = Number(time[1]); minute = Number(time[2]); second = Number(time[3] || 0);
    } else return null;
  }
  if (!date || hour < 0 || hour > 23) return null;
  return `${date}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}+07:00`;
}

function numeric(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  let source = clean(value).replace(/\s+/g, "");
  if (source.includes(",")) source = source.replace(/\./g, "").replace(",", ".");
  const result = Number(source);
  return Number.isFinite(result) ? result : null;
}

function bool(value) {
  return /^(true|ya|yes|1)$/i.test(clean(value));
}

function headerMap(sheet) {
  const headers = [];
  const byName = new Map();
  sheet.getRow(1).eachCell({ includeEmpty: true }, (cell, column) => {
    const name = clean(cell.value);
    headers[column] = name;
    if (name) byName.set(name, column);
  });
  return { headers, byName };
}

function assertHeaders(format, byName) {
  const missing = format.requiredHeaders.filter(header => !byName.has(header));
  if (missing.length) throw new Error(`Format ${format.label} tidak sesuai. Kolom wajib tidak ditemukan: ${missing.join(", ")}.`);
}

function rowValue(sheet, rowNumber, byName, name) {
  const column = byName.get(name);
  return column ? scalar(sheet.getRow(rowNumber).getCell(column).value, sheet.name, rowNumber, name) : null;
}

function rowHasValues(sheet, rowNumber, columns) {
  return columns.some(column => {
    const value = sheet.getRow(rowNumber).getCell(column).value;
    return value !== null && value !== undefined && clean(value) !== "";
  });
}

function parseMaintenance(sheet, fileName) {
  const { headers, byName } = headerMap(sheet);
  const format = FORMATS.maintenance;
  assertHeaders(format, byName);
  if (byName.get("Tanggal") !== 1 || byName.get("Kategori") !== 2 || byName.get("Jenis") !== 3 || byName.get("Nama Mesin") !== 4 || byName.get("Waktu") !== 5) {
    throw new Error("Urutan kolom awal Rekap Perawatan harus: Tanggal, Kategori, Jenis, Nama Mesin, Waktu.");
  }
  const notesColumn = byName.get("Keterangan");
  const checkIndexes = new Map();
  for (let column = 6; column < notesColumn; column += 1) {
    const name = headers[column];
    if (!name) continue;
    const indexes = checkIndexes.get(normalized(name)) || [];
    indexes.push(column);
    checkIndexes.set(normalized(name), indexes);
  }
  if (!checkIndexes.size) throw new Error("Kolom checklist Rekap Perawatan tidak ditemukan.");
  const rows = [];
  const identities = new Map();
  for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber += 1) {
    if (!rowHasValues(sheet, rowNumber, [1, 2, 3, 4, 5])) continue;
    const inspectedOn = excelDate(rowValue(sheet, rowNumber, byName, "Tanggal"));
    const category = clean(rowValue(sheet, rowNumber, byName, "Kategori"));
    const machineType = clean(rowValue(sheet, rowNumber, byName, "Jenis"));
    const machineName = clean(rowValue(sheet, rowNumber, byName, "Nama Mesin"));
    const scheduleCode = clean(rowValue(sheet, rowNumber, byName, "Waktu")).toUpperCase();
    if (!inspectedOn) throw new Error(`Tanggal Rekap Perawatan baris ${rowNumber} tidak valid.`);
    if (!category || !machineType || !machineName || !scheduleCode) throw new Error(`Kolom wajib Rekap Perawatan baris ${rowNumber} belum lengkap.`);
    if (!/^[MB]$/.test(scheduleCode)) throw new Error(`Waktu Rekap Perawatan baris ${rowNumber} harus M atau B.`);
    const checks = [];
    for (const indexes of checkIndexes.values()) {
      const column = normalized(category) === "armada" ? indexes.at(-1) : indexes[0];
      const rawStatus = clean(scalar(sheet.getRow(rowNumber).getCell(column).value, sheet.name, rowNumber, headers[column]));
      if (rawStatus) checks.push({ name: headers[column], raw_status: rawStatus });
    }
    const identity = [inspectedOn, category, machineType, machineName, scheduleCode].map(normalized).join("|");
    if (identities.has(identity)) throw new Error(`Data Rekap Perawatan ganda pada baris ${identities.get(identity)} dan ${rowNumber}.`);
    identities.set(identity, rowNumber);
    rows.push({
      inspected_on: inspectedOn,
      machine_category: category,
      machine_type: machineType,
      machine_name: machineName,
      schedule_code: scheduleCode,
      maintenance_type: scheduleCode === "B" ? "Bulanan" : "Mingguan",
      notes: clean(rowValue(sheet, rowNumber, byName, "Keterangan")) || null,
      source_row: rowNumber,
      source_file: fileName,
      checks,
    });
  }
  return rows;
}

function parseWorkReports(sheet, fileName) {
  const { byName } = headerMap(sheet);
  const format = FORMATS.work_reports;
  assertHeaders(format, byName);
  const get = (row, name) => rowValue(sheet, row, byName, name);
  const rows = [];
  const identities = new Map();
  const duplicateRows = [];
  for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const columns = format.requiredHeaders.map(header => byName.get(header));
    if (!rowHasValues(sheet, rowNumber, columns)) continue;
    const reportDate = excelDate(get(rowNumber, "Tanggal"));
    const machineName = clean(get(rowNumber, "Nama Mesin"));
    const description = clean(get(rowNumber, "Laporan Pekerjaan"));
    if (!reportDate) throw new Error(`Tanggal Laporan Kerja baris ${rowNumber} tidak valid.`);
    if (!machineName || !description) throw new Error(`Nama Mesin dan Laporan Pekerjaan wajib diisi pada baris ${rowNumber}.`);
    const startedAt = dateTime(get(rowNumber, "Jam Mulai"), reportDate);
    const finishedAt = dateTime(get(rowNumber, "Jam Selesai"), reportDate);
    const row = {
      report_date: reportDate,
      department: clean(get(rowNumber, "Bagian")) || null,
      machine_category: clean(get(rowNumber, "Kategori Mesin")) || null,
      machine_type: clean(get(rowNumber, "Jenis")) || null,
      machine_name: machineName,
      job_type: clean(get(rowNumber, "Jenis Pekerjaan")) || null,
      work_description: description,
      component_type: clean(get(rowNumber, "Jenis Komponen")) || null,
      started_at: startedAt,
      finished_at: finishedAt,
      total_hours: numeric(get(rowNumber, "Total Jam")),
      definition: clean(get(rowNumber, "Definisi")) || null,
      spare_part_name: clean(get(rowNumber, "Part Nama") || get(rowNumber, "Spare Part")) || null,
      spare_part_size: clean(get(rowNumber, "Part Ukuran") || get(rowNumber, "Ukuran Part") || get(rowNumber, "Ukuran Spare Part")) || null,
      order_type: clean(get(rowNumber, "Order")) || null,
      order_status: clean(get(rowNumber, "Status Order")) || null,
      repair_rating: clean(get(rowNumber, "Nilai Perbaikan")) || null,
      notes: clean(get(rowNumber, "Keterangan")) || null,
      is_new_machine: bool(get(rowNumber, "Is New Machine")),
      is_new_part: bool(get(rowNumber, "Is New Part")),
      part_category: clean(get(rowNumber, "Part Kategori")) || null,
      source_row: rowNumber,
      source_file: fileName,
    };
    const identity = JSON.stringify([
      reportDate, row.department, row.machine_category, row.machine_type, machineName,
      row.job_type, description, row.component_type, startedAt, finishedAt,
      row.total_hours === null ? null : Math.round(row.total_hours * 1000) / 1000,
      row.definition, row.spare_part_name, row.spare_part_size, row.order_type,
      row.order_status, row.repair_rating, row.notes, row.is_new_machine,
      row.is_new_part, row.part_category,
    ].map(value => typeof value === "string" ? normalized(value) : value));
    if (identities.has(identity)) {
      duplicateRows.push({ source_row: rowNumber, duplicate_of: identities.get(identity) });
      continue;
    }
    identities.set(identity, rowNumber);
    rows.push(row);
  }
  return { rows, duplicateRows };
}

export async function parseDirectWorkbook(file) {
  if (!file) throw new Error("Pilih file Excel terlebih dahulu.");
  if (file.size > MAX_FILE_BYTES) throw new Error("Ukuran workbook maksimal 15 MB.");
  const format = Object.values(FORMATS).find(item => normalized(item.filename) === normalized(file.name));
  if (!format) throw new Error("Nama file tidak dikenal. Gunakan tepat Rekap Perawatan.xlsx atau Laporan Kerja.xlsx.");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await file.arrayBuffer());
  const sheet = workbook.getWorksheet(format.sheet);
  if (!sheet) throw new Error(`Sheet ${format.sheet} tidak ditemukan dalam ${format.filename}.`);
  const documentType = format === FORMATS.maintenance ? "maintenance" : "work_reports";
  const parsed = documentType === "maintenance"
    ? { rows: parseMaintenance(sheet, file.name), duplicateRows: [] }
    : parseWorkReports(sheet, file.name);
  const { rows, duplicateRows } = parsed;
  if (!rows.length) throw new Error(`${format.label} tidak memiliki baris data.`);
  if (rows.length > MAX_ROWS) throw new Error("Jumlah data workbook maksimal 50.000 baris.");
  return {
    kind: "direct",
    filename: file.name,
    totalRows: rows.length,
    warnings: { duplicatesInFile: duplicateRows.length },
    duplicateRows,
    datasets: [{
      key: `direct_${documentType}`,
      label: format.label,
      sheet: format.sheet,
      importMode: "direct",
      documentType,
      rows,
    }],
  };
}

export { FORMATS as DIRECT_WORKBOOK_FORMATS };
