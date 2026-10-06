const MARGIN = 10;

function displayDate(value) {
  const raw = String(value || "").trim();
  if (!raw) return "-";
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
    const [year, month, day] = raw.slice(0, 10).split("-");
    return `${day}/${month}/${year}`;
  }
  const match = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (match) {
    const day = match[1].padStart(2, "0");
    const month = match[2].padStart(2, "0");
    const year = match[3];
    return `${day}/${month}/${year}`;
  }
  return raw.split(" ")[0].split("\n")[0];
}

function numberLabel(value) {
  if (value === null || value === undefined || value === "" || !Number.isFinite(Number(value))) return "-";
  return Number(value).toLocaleString("id-ID", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatSelisih(value) {
  if (value === null || value === undefined || value === "" || !Number.isFinite(Number(value))) return "-";
  const num = Number(value);
  const formatted = Math.abs(num).toLocaleString("id-ID", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return num >= 0 ? `+${formatted}` : `-${formatted}`;
}

function drawHeader(doc, { title, page, rowCount, pageWidth }) {
  doc.setFillColor(7, 45, 35);
  doc.rect(0, 0, pageWidth, 23, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text(title, MARGIN, 10);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.text("SiTeki · Sistem Informasi Teknik", MARGIN, 16);
  doc.text(`Halaman ${page}`, pageWidth - MARGIN, 10, { align: "right" });
  doc.text(`${rowCount} catatan diekspor`, pageWidth - MARGIN, 16, { align: "right" });

  doc.setTextColor(54, 69, 63);
  doc.setFontSize(7.5);
  doc.text(`Dibuat: ${new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short" }).format(new Date())}`, MARGIN, 29);
}

function drawTableHeader(doc, y, columns, contentWidth) {
  doc.setFillColor(222, 239, 231);
  doc.rect(MARGIN, y, contentWidth, 8, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(6.3);
  doc.setTextColor(21, 72, 55);
  let x = MARGIN;
  columns.forEach(column => {
    doc.text(column.label, x + 1.5, y + 5, { maxWidth: column.width - 3 });
    x += column.width;
  });
  return y + 8;
}

function drawRow(doc, y, row, columns, index, contentWidth) {
  const cells = columns.map(column => doc.splitTextToSize(String(row[column.key] ?? "-"), column.width - 3));
  const height = Math.max(8, ...cells.map(lines => lines.length * 3.4 + 3));
  doc.setFillColor(index % 2 ? 249 : 255, index % 2 ? 252 : 255, index % 2 ? 250 : 255);
  doc.rect(MARGIN, y, contentWidth, height, "F");
  doc.setDrawColor(204, 221, 213);
  doc.rect(MARGIN, y, contentWidth, height, "S");
  doc.setFont("helvetica", "normal");
  doc.setFontSize(6.8);
  doc.setTextColor(31, 48, 42);
  let x = MARGIN;
  cells.forEach((lines, cellIndex) => {
    if (cellIndex > 0) {
      doc.setDrawColor(204, 221, 213);
      doc.line(x, y, x, y + height);
    }
    const colKey = columns[cellIndex].key;
    const textVal = String(row[colKey] ?? "-").trim();
    if (colKey === "kesimpulan" && /DENDA/i.test(textVal)) {
      doc.setFont("helvetica", "bold");
      doc.setTextColor(220, 38, 38);
    } else {
      doc.setFont("helvetica", "normal");
      doc.setTextColor(31, 48, 42);
    }
    doc.text(lines, x + 1.5, y + 4.3);
    x += columns[cellIndex].width;
  });
  return y + height;
}

function formatKesimpulan(value) {
  const raw = String(value || "").trim();
  if (!raw || raw === "-") return "-";
  if (/POTENSI\s*DENDA|DENDA/i.test(raw)) return "DENDA";
  return raw;
}

export async function downloadElectricityHistoryPdf(items, { exportType = "listrik" } = {}) {
  if (!Array.isArray(items) || !items.length) throw new Error("Tidak ada riwayat stand meter PLN untuk diekspor.");
  const { jsPDF } = await import("jspdf");

  const orientation = exportType === "semua" ? "landscape" : "portrait";
  const doc = new jsPDF({ orientation, unit: "mm", format: "a4", compress: true, putOnlyUsedFonts: true });

  const pageWidth = orientation === "landscape" ? 297 : 210;
  const pageHeight = orientation === "landscape" ? 210 : 297;
  const contentWidth = pageWidth - MARGIN * 2;

  let mainTitle = "REKAP RIWAYAT STAND METER PLN";
  if (exportType === "listrik") mainTitle = "REKAP RIWAYAT STAND METER PLN (PEMAKAIAN LISTRIK)";
  else if (exportType === "plts") mainTitle = "REKAP RIWAYAT PEMAKAIAN PLTS";
  else if (exportType === "semua") mainTitle = "REKAP RIWAYAT METER PLN & PLTS (PEMAKAIAN SEMUA)";

  doc.setProperties({
    title: mainTitle,
    subject: "Riwayat pembacaan meter dan energi PLN / PLTS",
    author: "SiTeki",
  });

  const rows = items.map(item => ({
    tanggal: displayDate(item.tanggal_input || item.tanggal),
    jam: item.jam || "-",
    petugas: item.petugas || "-",
    huheH: numberLabel(item.huhe_h),
    huheHh: numberLabel(item.huhe_hh),
    huarHeh: numberLabel(item.huar_heh),
    huarHh: numberLabel(item.huar_hh),
    selisih: formatSelisih(item.selisih),
    kesimpulan: formatKesimpulan(item.kesimpulan),
    gridPln: numberLabel(item.grid_pln),
    pvPlts: numberLabel(item.pv_plts),
    toGrid: numberLabel(item.to_grid),
  }));

  const listrikColumns = orientation === "portrait" ? [
    { key: "tanggal", label: "Tanggal", width: 22 },
    { key: "jam", label: "Jam", width: 12 },
    { key: "petugas", label: "Petugas", width: 30 },
    { key: "huheH", label: "HUHE H", width: 21 },
    { key: "huheHh", label: "HUHE HH", width: 21 },
    { key: "huarHeh", label: "HUAR HEH", width: 21 },
    { key: "huarHh", label: "HUAR HH", width: 21 },
    { key: "selisih", label: "SELISIH", width: 19 },
    { key: "kesimpulan", label: "Kesimpulan", width: 23 },
  ] : [
    { key: "tanggal", label: "Tanggal", width: 30 },
    { key: "jam", label: "Jam", width: 16 },
    { key: "petugas", label: "Petugas", width: 43 },
    { key: "huheH", label: "HUHE H", width: 30 },
    { key: "huheHh", label: "HUHE HH", width: 30 },
    { key: "huarHeh", label: "HUAR HEH", width: 30 },
    { key: "huarHh", label: "HUAR HH", width: 30 },
    { key: "selisih", label: "SELISIH", width: 33 },
    { key: "kesimpulan", label: "Kesimpulan", width: 35 },
  ];

  const pltsColumns = orientation === "portrait" ? [
    { key: "tanggal", label: "Tanggal", width: 30 },
    { key: "jam", label: "Jam", width: 18 },
    { key: "petugas", label: "Petugas", width: 50 },
    { key: "gridPln", label: "Grid PLN (MWh)", width: 31 },
    { key: "pvPlts", label: "PV PLTS (MWh)", width: 31 },
    { key: "toGrid", label: "To Grid (MWh)", width: 30 },
  ] : [
    { key: "tanggal", label: "Tanggal", width: 40 },
    { key: "jam", label: "Jam", width: 24 },
    { key: "petugas", label: "Petugas", width: 65 },
    { key: "gridPln", label: "Grid PLN (MWh)", width: 49 },
    { key: "pvPlts", label: "PV PLTS (MWh)", width: 49 },
    { key: "toGrid", label: "To Grid (MWh)", width: 50 },
  ];

  let page = 1;
  let headerDrawn = false;

  const startPage = (sectionTitle, tableColumns) => {
    if (headerDrawn) doc.addPage();
    drawHeader(doc, { title: mainTitle, page, rowCount: rows.length, pageWidth });
    doc.setFont("helvetica", "bold");
    doc.setTextColor(21, 72, 55);
    doc.setFontSize(8);
    doc.text(sectionTitle, MARGIN, 34);
    headerDrawn = true;
    return drawTableHeader(doc, 37, tableColumns, contentWidth);
  };

  const drawTable = (sectionTitle, tableColumns) => {
    let cursor = startPage(sectionTitle, tableColumns);
    rows.forEach((row, index) => {
      const cellLines = tableColumns.map(column => doc.splitTextToSize(String(row[column.key] ?? "-"), column.width - 3));
      const rowHeight = Math.max(8, ...cellLines.map(lines => lines.length * 3.4 + 3));
      if (cursor + rowHeight > pageHeight - 12) {
        page += 1;
        cursor = startPage(sectionTitle, tableColumns);
      }
      cursor = drawRow(doc, cursor, row, tableColumns, index, contentWidth);
    });
  };

  if (exportType === "listrik") {
    drawTable("Rekap Stand Meter Listrik PLN", listrikColumns);
  } else if (exportType === "plts") {
    drawTable("Rekap Pemakaian PLTS", pltsColumns);
  } else {
    drawTable("1. Rekap Stand Meter Listrik PLN", listrikColumns);
    page += 1;
    drawTable("2. Rekap Pemakaian PLTS", pltsColumns);
  }

  const today = new Date().toISOString().slice(0, 10);
  doc.save(`rekap-pemakaian-${exportType}-${today}.pdf`);
}
