// SiTeki - API Laporan Kerja + Manajemen Admin
// Ganti seluruh Code.gs pada project Apps Script laporan kerja dengan file ini.
// Deploy sebagai Web App: Execute as Me, Who has access: Anyone.
// Jika deployment lama diedit (bukan deployment baru), URL web tidak perlu diganti.

var REPORT_SHEET_NAME = "lap_kerja"; // Sumber utama yang sama dengan aplikasi Android.
var FIRESTORE_PROJECT_ID = "siteki-1f0a3";
var USER_API_URL =
  "https://script.google.com/macros/s/AKfycbw2rSZ0GAJJv3PMtrXTeKktphfRYBHzQ4-2NJQ0vWU2_9k329UGC-2uancWWbgFnv4/exec";
var DB2_URL =
  "https://docs.google.com/spreadsheets/d/1XnjbaYXuyYIgEsf9mcxsHSAZWQxgNebZI4p_Wk8H1Cc/edit";
var DB3_URL =
  "https://docs.google.com/spreadsheets/d/1nbmqEBQWJMy-1CYSGtIiTHDXgbXR485xe1Np-THWR9U/edit";

var REPORT_FIELDS = [
  "tanggal",
  "bagian",
  "kategoriMesin",
  "jenis",
  "namaMesin",
  "jenisPekerjaan",
  "laporan",
  "jenisKomponen",
  "jamMulai",
  "jamSelesai",
  "totalJam",
  "definisi",
  "sparepart",
  "ukuranPart",
  "order",
  "statusOrder",
  "nilaiPerbaikan",
  "keterangan",
  "isNewMachine",
  "isNewPart",
  "partKategori",
  "partNama",
  "partUkuran",
];

var REPORT_LABELS = {
  tanggal: "Tanggal",
  bagian: "Bagian",
  kategoriMesin: "Kategori Mesin",
  jenis: "Jenis",
  namaMesin: "Nama Mesin",
  jenisPekerjaan: "Jenis Pekerjaan",
  laporan: "Laporan",
  jenisKomponen: "Jenis Komponen",
  jamMulai: "Jam Mulai",
  jamSelesai: "Jam Selesai",
  totalJam: "Total Jam",
  definisi: "Definisi",
  sparepart: "Sparepart",
  ukuranPart: "Ukuran Part",
  order: "Order",
  statusOrder: "Status Order",
  nilaiPerbaikan: "Nilai Perbaikan",
  keterangan: "Keterangan",
  isNewMachine: "Is New Machine",
  isNewPart: "Is New Part",
  partKategori: "Part Kategori",
  partNama: "Part Nama",
  partUkuran: "Part Ukuran",
};

var REPORT_ALIASES = {
  tanggal: ["tanggal", "tgl", "tanggal laporan"],
  bagian: ["bagian", "departemen"],
  kategoriMesin: ["kategori mesin", "kategorimesin", "kategori perangkat"],
  jenis: ["jenis", "jenis mesin", "jenismesin"],
  namaMesin: ["nama mesin", "namamesin", "mesin", "nama armada"],
  jenisPekerjaan: ["jenis pekerjaan", "jenispekerjaan", "pekerjaan"],
  laporan: ["laporan", "laporan pekerjaan", "uraian pekerjaan"],
  jenisKomponen: ["jenis komponen", "jeniskomponen", "komponen"],
  jamMulai: ["jam mulai", "jammulai", "awal", "waktu mulai"],
  jamSelesai: ["jam selesai", "jamselesai", "akhir", "waktu selesai"],
  totalJam: ["total jam", "totaljam", "durasi", "jam"],
  definisi: ["definisi"],
  sparepart: ["sparepart", "spare part", "part dipakai"],
  ukuranPart: ["ukuran part", "ukuranpart", "ukuran"],
  order: ["order", "order sparepart", "order part"],
  statusOrder: ["status order", "statusorder", "status pekerjaan", "status"],
  nilaiPerbaikan: ["nilai perbaikan", "nilaiperbaikan", "hasil"],
  keterangan: ["keterangan", "catatan"],
  isNewMachine: ["is new machine", "isnewmachine"],
  isNewPart: ["is new part", "isnewpart"],
  partKategori: ["part kategori", "partkategori", "kategori part"],
  partNama: ["part nama", "partnama", "nama part"],
  partUkuran: ["part ukuran", "partukuran"],
};

function doGet(e) {
  try {
    var action = clean_((e && e.parameter && e.parameter.action) || "");
    if (action === "getMachines")
      return json_(externalSheetRows_(DB2_URL, "Mesin"));
    if (action === "getParts")
      return json_(externalSheetRows_(DB3_URL, "Part"));
    if (action === "getKPI") return json_(getKPIData_());
    if (action === "getCapabilities") {
      return json_({
        status: "success",
        version: "3.0-report-start-date",
        capabilities: [
          "getDataLapKerja",
          "getMachines",
          "getParts",
          "getKPI",
          "updateReport",
          "deleteReport",
          "addMasterPart",
        ],
      });
    }
    if (action === "getDataLapKerja") {
      return json_(getReports_((e && e.parameter) || {}));
    }
    // Kompatibilitas dashboard Android lama yang memanggil endpoint tanpa action.
    return json_(getDashboardData_());
  } catch (error) {
    return json_({ status: "error", message: String(error.message || error) });
  }
}

function doPost(e) {
  try {
    var body = JSON.parse((e && e.postData && e.postData.contents) || "{}");
    var action = clean_(body.action);
    if (action === "updateReport") return json_(updateReport_(body));
    if (action === "deleteReport") return json_(deleteReport_(body));
    if (action === "addMasterPart") return json_(addMasterPart_(body));
    return json_(insertReport_(body));
  } catch (error) {
    return json_({ status: "error", message: String(error.message || error) });
  }
}

function getReports_(params) {
  var monthFilter = parseMonthFilter_(params.bulan);
  var start = parseFlexibleDate_(params.tglAwal);
  var end = parseFlexibleDate_(params.tglAkhir);
  if (end) end.setHours(23, 59, 59, 999);
  var result = [];

  reportSheets_().forEach(function (sheet) {
    var lastRow = sheet.getLastRow();
    var lastColumn = sheet.getLastColumn();
    if (lastRow < 2 || lastColumn < 1) return;
    var raw = sheet.getRange(1, 1, lastRow, lastColumn).getValues();
    var display = sheet.getRange(1, 1, lastRow, lastColumn).getDisplayValues();
    var columns = reportColumns_(display[0]);

    for (var row = lastRow - 1; row >= 1; row--) {
      if (isEmptyRow_(display[row])) continue;
      // Daftar laporan mengikuti tanggal pekerjaan dimulai. Pada struktur
      // Android, tanggal dan jam mulai tersimpan bersama di kolom Jam Mulai.
      var dateIndex =
        columns.jamMulai >= 0 ? columns.jamMulai : columns.tanggal;
      var rowDate =
        dateIndex >= 0 ? parseFlexibleDate_(raw[row][dateIndex]) : null;
      if (
        monthFilter &&
        (!rowDate ||
          rowDate.getMonth() !== monthFilter.month ||
          rowDate.getFullYear() !== monthFilter.year)
      )
        continue;
      if (start && (!rowDate || rowDate < start)) continue;
      if (end && (!rowDate || rowDate > end)) continue;
      result.push(reportObject_(display[row], columns, row + 1, sheet));
    }
  });
  result.sort(function (a, b) {
    var left = parseFlexibleDate_(a.tanggalMulai || a.tanggal);
    var right = parseFlexibleDate_(b.tanggalMulai || b.tanggal);
    return (right ? right.getTime() : 0) - (left ? left.getTime() : 0);
  });
  return result;
}

function insertReport_(body) {
  var sheet = reportSheet_();
  var columns = ensureReportColumns_(sheet);
  if (
    !clean_(body.tanggal) ||
    !clean_(body.namaMesin) ||
    !clean_(body.laporan)
  ) {
    throw new Error("Tanggal, nama mesin, dan laporan pekerjaan wajib diisi.");
  }

  var lock = LockService.getDocumentLock();
  lock.waitLock(20000);
  try {
    var row = new Array(sheet.getLastColumn()).fill("");
    REPORT_FIELDS.forEach(function (field) {
      var column = columns[field];
      if (column >= 0 && body[field] !== undefined)
        row[column] = sheetValue_(field, body[field]);
    });
    sheet.appendRow(row);
    if (body.isNewMachine) {
      SpreadsheetApp.openByUrl(DB2_URL)
        .getSheetByName("Mesin")
        .appendRow(["Mesin", "Lainnya", clean_(body.namaMesin)]);
    }
    if (body.isNewPart) {
      SpreadsheetApp.openByUrl(DB3_URL)
        .getSheetByName("Part")
        .appendRow([
          clean_(body.partKategori),
          clean_(body.partNama),
          clean_(body.partUkuran),
          clean_(body.jenisKomponen),
        ]);
    }
    return {
      status: "success",
      message: "Laporan berhasil disimpan.",
      rowIndex: sheet.getLastRow(),
      sheetId: sheet.getSheetId(),
      sheetName: sheet.getName(),
    };
  } finally {
    lock.releaseLock();
  }
}

function addMasterPart_(body) {
  requireAdmin_(body.token);
  var kategori = clean_(body.kategori);
  var nama = clean_(body.nama);
  var ukuran = clean_(body.ukuran);
  var jenisKomponen = clean_(body.jenisKomponen);
  var satuan = clean_(body.satuan) || "Pcs";
  var stokAwalText = clean_(body.stokAwal).replace(",", ".");
  var stokAwal = Number(stokAwalText || 0);
  if (!isFinite(stokAwal) || stokAwal < 0) {
    throw new Error("Stok awal harus berupa angka nol atau lebih.");
  }
  if (!kategori || !nama || !ukuran) {
    throw new Error("Kategori, nama, dan ukuran part wajib diisi.");
  }
  var stockDatabase = SpreadsheetApp.openByUrl(DB3_URL);
  var sheet = stockDatabase.getSheetByName("Part");
  if (!sheet)
    throw new Error("Sheet 'Part' pada database stok tidak ditemukan.");
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var values = sheet.getDataRange().getDisplayValues();
    var target = [kategori, nama, ukuran].map(normalize_);
    var duplicate = false;
    var repairedShiftedRow = false;
    var matchedRowIndex = null;
    for (var row = 1; row < values.length; row++) {
      // Struktur resmi sheet Part:
      // A=Kategori, B=Nama, C=Ukuran/kode, D=Jenis komponen.
      if (
        normalize_(values[row][0]) === target[0] &&
        normalize_(values[row][1]) === target[1] &&
        normalize_(values[row][2]) === target[2]
      ) {
        duplicate = true;
        matchedRowIndex = row + 1;
        break;
      }
      // Memperbaiki data dari versi lama yang menulis:
      // A kosong, B=Kategori, C=Nama, D=Ukuran, E=Jenis komponen.
      if (
        !clean_(values[row][0]) &&
        normalize_(values[row][1]) === target[0] &&
        normalize_(values[row][2]) === target[1] &&
        normalize_(values[row][3]) === target[2]
      ) {
        sheet
          .getRange(row + 1, 1, 1, 5)
          .setValues([[kategori, nama, ukuran, jenisKomponen, ""]]);
        duplicate = true;
        repairedShiftedRow = true;
        matchedRowIndex = row + 1;
        break;
      }
    }

    // Firestore ditulis oleh backend setelah token Admin diverifikasi. Jangan
    // membuka Security Rules untuk write anonim dari browser.
    var firestoreId = upsertFirestoreMasterPart_({
      kategori: kategori,
      nama: nama,
      ukuran: ukuran,
      jenisKomponen: jenisKomponen,
    });

    if (!duplicate) {
      sheet.appendRow([kategori, nama, ukuran, jenisKomponen]);
      matchedRowIndex = sheet.getLastRow();
    }
    var stockSync = syncStockPart_(stockDatabase, {
      kategori: kategori,
      nama: nama,
      ukuran: ukuran,
      jenisKomponen: jenisKomponen,
      stokAwal: stokAwal,
      satuan: satuan,
    });
    return {
      status: "success",
      message: repairedShiftedRow
        ? "Posisi kolom part diperbaiki dan data berhasil disinkronkan ke tab Stok."
        : duplicate
          ? "Part yang sudah ada berhasil disinkronkan ke Firestore dan tab Stok."
          : "Master part berhasil ditambahkan ke Firestore, tab Part, dan tab Stok.",
      rowIndex: matchedRowIndex,
      duplicate: duplicate,
      repairedShiftedRow: repairedShiftedRow,
      firestoreSynced: true,
      firestoreId: firestoreId,
      stockSynced: true,
      stockDuplicate: stockSync.duplicate,
      stockRowIndex: stockSync.rowIndex,
    };
  } finally {
    lock.releaseLock();
  }
}

function syncStockPart_(spreadsheet, part) {
  var sheet = spreadsheet.getSheetByName("Stok");
  if (!sheet)
    throw new Error("Sheet 'Stok' pada database stok tidak ditemukan.");
  var structure = stockSheetStructure_(sheet);
  var columns = structure.columns;
  var physicalLastRow = sheet.getLastRow();
  var firstDataRow = structure.headerRow + 1;

  if (physicalLastRow >= firstDataRow) {
    var rows = sheet
      .getRange(
        firstDataRow,
        1,
        physicalLastRow - firstDataRow + 1,
        Math.max(sheet.getLastColumn(), 4),
      )
      .getDisplayValues();
    for (var index = 0; index < rows.length; index++) {
      if (
        normalize_(rows[index][columns.nama]) === normalize_(part.nama) &&
        normalize_(rows[index][columns.ukuran]) === normalize_(part.ukuran)
      ) {
        return { duplicate: true, rowIndex: firstDataRow + index };
      }
    }
  }

  var lastColumn = Math.max(sheet.getLastColumn(), 4);
  var targetRow = stockFirstEmptyRow_(
    sheet,
    firstDataRow,
    physicalLastRow,
    columns,
  );
  var sourceRow = targetRow > firstDataRow ? targetRow - 1 : null;
  if (sourceRow) {
    var sourceFormulas = sheet
      .getRange(sourceRow, 1, 1, lastColumn)
      .getFormulasR1C1()[0];
    if (
      sourceFormulas.some(function (formula) {
        return !!formula;
      })
    ) {
      sheet
        .getRange(sourceRow, 1, 1, lastColumn)
        .copyTo(
          sheet.getRange(targetRow, 1, 1, lastColumn),
          SpreadsheetApp.CopyPasteType.PASTE_FORMULA,
          false,
        );
    }
  }

  if (columns.nomor >= 0) {
    sheet
      .getRange(targetRow, columns.nomor + 1)
      .setValue(
        stockNextSequence_(sheet, firstDataRow, physicalLastRow, columns.nomor),
      );
  }
  sheet.getRange(targetRow, columns.nama + 1).setValue(part.nama);
  sheet.getRange(targetRow, columns.ukuran + 1).setValue(part.ukuran);
  if (columns.kategori >= 0) {
    sheet.getRange(targetRow, columns.kategori + 1).setValue(part.kategori);
  }
  if (columns.jenisKomponen >= 0) {
    sheet
      .getRange(targetRow, columns.jenisKomponen + 1)
      .setValue(part.jenisKomponen);
  }
  if (columns.satuan >= 0) {
    sheet.getRange(targetRow, columns.satuan + 1).setValue(part.satuan);
  }

  var stockFormula =
    columns.stok >= 0
      ? clean_(sheet.getRange(firstDataRow, columns.stok + 1).getFormula())
      : "";
  var calculatedStock = stockFormula.toUpperCase().indexOf("ARRAYFORMULA") >= 0;
  if (calculatedStock) {
    // Struktur sheet Stok:
    // E = stok masuk/awal, F = pemakaian/keluar, G = E - F (ARRAYFORMULA).
    // Jangan menulis ke G karena G merupakan hasil perhitungan otomatis.
    var incomingColumn =
      columns.stokMasuk >= 0 ? columns.stokMasuk : columns.stok - 2;
    var outgoingColumn =
      columns.stokKeluar >= 0 ? columns.stokKeluar : columns.stok - 1;
    if (incomingColumn >= 0) {
      sheet.getRange(targetRow, incomingColumn + 1).setValue(part.stokAwal);
    }
    if (outgoingColumn >= 0) {
      sheet.getRange(targetRow, outgoingColumn + 1).setValue(0);
    }
  } else if (columns.stok >= 0) {
    var stockCell = sheet.getRange(targetRow, columns.stok + 1);
    if (!stockCell.getFormula()) stockCell.setValue(part.stokAwal);
  }
  return { duplicate: false, rowIndex: targetRow };
}

function stockNextSequence_(
  sheet,
  firstDataRow,
  physicalLastRow,
  numberColumn,
) {
  if (physicalLastRow < firstDataRow) return 1;
  var values = sheet
    .getRange(
      firstDataRow,
      numberColumn + 1,
      physicalLastRow - firstDataRow + 1,
      1,
    )
    .getDisplayValues();
  var highest = values.reduce(function (maximum, row) {
    var number = Number(clean_(row[0]).replace(/[^0-9.-]/g, ""));
    return isFinite(number) ? Math.max(maximum, number) : maximum;
  }, 0);
  return highest + 1;
}

function stockFirstEmptyRow_(sheet, firstDataRow, physicalLastRow, columns) {
  if (physicalLastRow < firstDataRow) return firstDataRow;
  var identityColumns = [columns.kategori, columns.nama, columns.ukuran].filter(
    function (column, index, values) {
      return column >= 0 && values.indexOf(column) === index;
    },
  );
  if (!identityColumns.length) identityColumns = [0, 1];

  var width = Math.max.apply(null, identityColumns) + 1;
  var rows = sheet
    .getRange(firstDataRow, 1, physicalLastRow - firstDataRow + 1, width)
    .getDisplayValues();

  for (var index = 0; index < rows.length; index++) {
    var hasIdentity = identityColumns.some(function (column) {
      return clean_(rows[index][column]) !== "";
    });
    if (!hasIdentity) return firstDataRow + index;
  }
  return physicalLastRow + 1;
}

function stockSheetStructure_(sheet) {
  var lastColumn = Math.max(sheet.getLastColumn(), 4);
  var scanRows = Math.min(Math.max(sheet.getLastRow(), 1), 20);
  var values = sheet.getRange(1, 1, scanRows, lastColumn).getDisplayValues();
  var best = null;
  values.forEach(function (row, rowIndex) {
    var columns = {
      nomor: headerColumn_(row, ["no", "no.", "nomor", "nomor urut"]),
      kategori: headerColumn_(row, ["kategori", "kategori part"]),
      nama: headerColumn_(row, [
        "nama",
        "nama part",
        "nama sparepart",
        "sparepart",
      ]),
      ukuran: headerColumn_(row, [
        "ukuran",
        "ukuran jenis",
        "ukuran kode",
        "kode jenis ukuran part",
      ]),
      stokMasuk: headerColumn_(row, [
        "stok awal",
        "stock awal",
        "stok masuk",
        "stock masuk",
        "masuk",
        "jumlah masuk",
        "qty masuk",
      ]),
      stokKeluar: headerColumn_(row, [
        "stok keluar",
        "stock keluar",
        "keluar",
        "pemakaian",
        "terpakai",
        "jumlah keluar",
        "qty keluar",
      ]),
      stok: headerColumn_(row, ["stok", "stock", "jumlah stok", "qty"]),
      satuan: headerColumn_(row, ["satuan", "unit"]),
      jenisKomponen: headerColumn_(row, ["jenis komponen", "komponen"]),
    };
    var score = ["nama", "ukuran", "stok", "satuan"].reduce(function (
      total,
      key,
    ) {
      return total + (columns[key] >= 0 ? 1 : 0);
    }, 0);
    if (!best || score > best.score) {
      best = { headerRow: rowIndex + 1, columns: columns, score: score };
    }
  });
  if (!best || best.score < 2) {
    return {
      headerRow: 1,
      columns: {
        nomor: 0,
        kategori: 1,
        nama: 2,
        ukuran: 3,
        jenisKomponen: -1,
        stokMasuk: 4,
        stokKeluar: 5,
        stok: 6,
        satuan: 7,
      },
    };
  }
  var numberedLayout = best.columns.stok === 6;
  if (best.columns.nomor < 0 && numberedLayout) best.columns.nomor = 0;
  if (best.columns.kategori < 0 && numberedLayout) best.columns.kategori = 1;
  if (best.columns.nama < 0) best.columns.nama = numberedLayout ? 2 : 0;
  if (best.columns.ukuran < 0) best.columns.ukuran = numberedLayout ? 3 : 1;
  if (best.columns.stok < 0) best.columns.stok = 2;
  if (best.columns.satuan < 0) best.columns.satuan = numberedLayout ? 7 : 3;
  if (best.columns.stokMasuk === undefined) best.columns.stokMasuk = -1;
  if (best.columns.stokKeluar === undefined) best.columns.stokKeluar = -1;
  return best;
}

function headerColumn_(headers, aliases) {
  var normalizedAliases = aliases.map(normalize_);
  for (var index = 0; index < headers.length; index++) {
    if (normalizedAliases.indexOf(normalize_(headers[index])) >= 0)
      return index;
  }
  return -1;
}

function upsertFirestoreMasterPart_(part) {
  var identity = [
    normalize_(part.kategori),
    normalize_(part.nama),
    normalize_(part.ukuran),
  ].join("|");
  var digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    identity,
    Utilities.Charset.UTF_8,
  );
  var documentId = digest
    .map(function (value) {
      return ("0" + (value & 255).toString(16)).slice(-2);
    })
    .join("")
    .slice(0, 40);
  var url =
    "https://firestore.googleapis.com/v1/projects/" +
    encodeURIComponent(FIRESTORE_PROJECT_ID) +
    "/databases/(default)/documents/master_part/" +
    encodeURIComponent(documentId);
  var payload = {
    fields: {
      id: { stringValue: documentId },
      Kategori: { stringValue: part.kategori },
      Nama: { stringValue: part.nama },
      Ukuran: { stringValue: part.ukuran },
      "Jenis Komponen": { stringValue: part.jenisKomponen },
    },
  };
  var response = UrlFetchApp.fetch(url, {
    method: "patch",
    contentType: "application/json",
    headers: { Authorization: "Bearer " + ScriptApp.getOAuthToken() },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });
  var status = response.getResponseCode();
  if (status < 200 || status >= 300) {
    var detail = response.getContentText();
    try {
      var parsed = JSON.parse(detail || "{}");
      detail =
        parsed && parsed.error && parsed.error.message
          ? parsed.error.message
          : detail;
    } catch (ignored) {}
    throw new Error(
      "Firestore gagal diperbarui (" +
        status +
        "): " +
        clean_(detail || "Periksa scope datastore dan akses project Firebase."),
    );
  }
  return documentId;
}

// Jalankan satu kali dari editor Apps Script setelah appsscript.json diganti.
// Fungsi ini hanya membaca maksimal satu dokumen untuk memicu persetujuan scope
// dan memastikan akun pemilik deployment mempunyai akses ke project Firebase.
function authorizeFirestoreAccess() {
  var url =
    "https://firestore.googleapis.com/v1/projects/" +
    encodeURIComponent(FIRESTORE_PROJECT_ID) +
    "/databases/(default)/documents/master_part?pageSize=1";
  var response = UrlFetchApp.fetch(url, {
    method: "get",
    headers: { Authorization: "Bearer " + ScriptApp.getOAuthToken() },
    muteHttpExceptions: true,
  });
  var status = response.getResponseCode();
  if (status < 200 || status >= 300) {
    throw new Error(
      "Akses Firestore belum siap (" +
        status +
        "): " +
        response.getContentText(),
    );
  }
  Logger.log("Akses Firestore siap. HTTP " + status);
  return true;
}

function updateReport_(body) {
  requireAdmin_(body.token);
  var sheet = reportSheetByReference_(body);
  var rowIndex = validRowIndex_(sheet, body.rowIndex);
  var columns = ensureReportColumns_(sheet);
  var lock = LockService.getDocumentLock();
  lock.waitLock(20000);
  try {
    REPORT_FIELDS.forEach(function (field) {
      if (body[field] === undefined) return;
      var column = columns[field];
      if (column >= 0)
        sheet
          .getRange(rowIndex, column + 1)
          .setValue(sheetValue_(field, body[field]));
    });
    return {
      status: "success",
      message: "Laporan berhasil diperbarui.",
      rowIndex: rowIndex,
    };
  } finally {
    lock.releaseLock();
  }
}

function deleteReport_(body) {
  requireAdmin_(body.token);
  var sheet = reportSheetByReference_(body);
  var rowIndex = validRowIndex_(sheet, body.rowIndex);
  var lock = LockService.getDocumentLock();
  lock.waitLock(20000);
  try {
    sheet.deleteRow(rowIndex);
    return { status: "success", message: "Laporan berhasil dihapus." };
  } finally {
    lock.releaseLock();
  }
}

function reportObject_(row, columns, rowIndex, sheet) {
  function value(field) {
    var index = columns[field];
    return index >= 0 ? row[index] : "";
  }
  return {
    rowIndex: rowIndex,
    sheetId: sheet ? sheet.getSheetId() : "",
    sheetName: sheet ? sheet.getName() : "",
    tanggal: value("tanggal"),
    tanggalMulai: value("jamMulai") || value("tanggal"),
    bagian: value("bagian"),
    kategoriMesin: value("kategoriMesin"),
    jenis: value("jenis"),
    namaMesin: value("namaMesin"),
    mesin: value("namaMesin"),
    jenisPekerjaan: value("jenisPekerjaan"),
    laporan: value("laporan"),
    jenisKomponen: value("jenisKomponen"),
    jamMulai: value("jamMulai"),
    jamSelesai: value("jamSelesai"),
    awal: value("jamMulai"),
    akhir: value("jamSelesai"),
    totalJam: value("totalJam"),
    durasi: value("totalJam"),
    definisi: value("definisi"),
    sparepart: value("sparepart"),
    ukuranPart: value("ukuranPart"),
    order: value("order"),
    statusOrder: value("statusOrder"),
    nilaiPerbaikan: value("nilaiPerbaikan"),
    keterangan: value("keterangan"),
    partKategori: value("partKategori"),
    partNama: value("partNama"),
    partUkuran: value("partUkuran"),
  };
}

function reportSheet_() {
  var sheets = reportSheets_();
  if (!sheets.length)
    throw new Error("Sheet laporan tidak ditemukan dari struktur header.");
  return sheets[0];
}

function reportSheets_() {
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet)
    throw new Error("Script harus terhubung dengan Spreadsheet laporan kerja.");
  if (REPORT_SHEET_NAME) {
    var configured = spreadsheet.getSheetByName(REPORT_SHEET_NAME);
    if (!configured)
      throw new Error("Sheet '" + REPORT_SHEET_NAME + "' tidak ditemukan.");
    return [configured];
  }

  var matches = [];
  spreadsheet.getSheets().forEach(function (sheet) {
    if (sheet.getLastColumn() < 1) return;
    var headers = sheet
      .getRange(1, 1, 1, sheet.getLastColumn())
      .getDisplayValues()[0];
    var columns = reportColumns_(headers);
    var score = [
      "tanggal",
      "bagian",
      "namaMesin",
      "laporan",
      "totalJam",
    ].filter(function (field) {
      return columns[field] >= 0;
    }).length;
    if (score >= 3) matches.push({ sheet: sheet, score: score });
  });
  matches.sort(function (a, b) {
    if (b.score !== a.score) return b.score - a.score;
    return a.sheet.getIndex() - b.sheet.getIndex();
  });
  return matches.map(function (item) {
    return item.sheet;
  });
}

function reportSheetByReference_(body) {
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet)
    throw new Error("Script harus terhubung dengan Spreadsheet laporan kerja.");
  var requestedId = Number(body.sheetId);
  var requestedName = clean_(body.sheetName);
  var found = null;
  reportSheets_().some(function (sheet) {
    if (
      (requestedId && sheet.getSheetId() === requestedId) ||
      (requestedName && sheet.getName() === requestedName)
    ) {
      found = sheet;
      return true;
    }
    return false;
  });
  if ((requestedId || requestedName) && !found) {
    throw new Error("Tab asal laporan tidak ditemukan. Muat ulang halaman.");
  }
  return found || reportSheet_();
}

function reportColumns_(headers) {
  var normalized = headers.map(normalize_);
  var result = {};
  REPORT_FIELDS.forEach(function (field) {
    var aliases = (REPORT_ALIASES[field] || []).map(normalize_);
    result[field] = -1;
    for (var i = 0; i < normalized.length; i++) {
      if (aliases.indexOf(normalized[i]) >= 0) {
        result[field] = i;
        break;
      }
    }
  });
  return result;
}

function ensureReportColumns_(sheet) {
  var lastColumn = Math.max(sheet.getLastColumn(), 1);
  var headers = sheet.getRange(1, 1, 1, lastColumn).getDisplayValues()[0];
  var columns = reportColumns_(headers);
  REPORT_FIELDS.forEach(function (field) {
    if (columns[field] >= 0) return;
    sheet.getRange(1, sheet.getLastColumn() + 1).setValue(REPORT_LABELS[field]);
    columns[field] = sheet.getLastColumn() - 1;
  });
  return columns;
}

function validRowIndex_(sheet, value) {
  var row = Number(value);
  if (!Number.isInteger(row) || row < 2 || row > sheet.getLastRow()) {
    throw new Error("Baris laporan tidak valid. Muat ulang halaman.");
  }
  var values = sheet
    .getRange(row, 1, 1, sheet.getLastColumn())
    .getDisplayValues()[0];
  if (isEmptyRow_(values)) throw new Error("Laporan sudah tidak tersedia.");
  return row;
}

function requireAdmin_(token) {
  token = clean_(token);
  if (!token)
    throw new Error("Token sesi tidak tersedia. Silakan login kembali.");
  var response = UrlFetchApp.fetch(USER_API_URL, {
    method: "post",
    contentType: "text/plain",
    payload: JSON.stringify({ action: "getMyProfile", token: token }),
    muteHttpExceptions: true,
    followRedirects: true,
  });
  var result;
  try {
    result = JSON.parse(response.getContentText() || "{}");
  } catch (error) {
    throw new Error("Verifikasi sesi Admin gagal.");
  }
  if (!result || String(result.status).toLowerCase() !== "success") {
    throw new Error(
      (result && result.message) ||
        "Sesi sudah berakhir. Silakan login kembali.",
    );
  }
  var profile = result.data || result.profile || {};
  if (clean_(profile.role).toLowerCase() !== "admin")
    throw new Error("Akses hanya untuk Admin.");
  return profile;
}

function externalSheetRows_(url, sheetName) {
  var sheet = SpreadsheetApp.openByUrl(url).getSheetByName(sheetName);
  if (!sheet) throw new Error("Sheet '" + sheetName + "' tidak ditemukan.");
  return sheet.getDataRange().getDisplayValues();
}

function getKPIData_() {
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet)
    throw new Error("Script harus terhubung dengan Spreadsheet laporan kerja.");
  var sheetJam = spreadsheet.getSheetByName("Rekap Jam");
  var sheetOrder = spreadsheet.getSheetByName("Rekap Order");
  var sheetPenilaian = spreadsheet.getSheetByName("Rekap Penilaian");
  if (!sheetJam || !sheetOrder || !sheetPenilaian) {
    throw new Error(
      "Sheet Rekap Jam, Rekap Order, atau Rekap Penilaian tidak ditemukan.",
    );
  }
  var dataJam = sheetJam.getRange(2, 1, 12, 3).getValues();
  var dataOrder = sheetOrder.getRange(2, 2, 12, 1).getValues();
  var dataPenilaian = sheetPenilaian.getRange(2, 2, 12, 3).getValues();
  var rekap = [];
  for (var i = 0; i < 12; i++) {
    rekap.push({
      bulan: monthShort_(dataJam[i][0]),
      jam: Number(dataJam[i][1]) || 0,
      target: Number(dataJam[i][2]) || 500,
      order: Number(dataOrder[i][0]) || 0,
      bagus: Number(dataPenilaian[i][0]) || 0,
      cukup: Number(dataPenilaian[i][1]) || 0,
      tidakBagus: Number(dataPenilaian[i][2]) || 0,
    });
  }
  return { rekap: rekap };
}

function getDashboardData_() {
  var result = getKPIData_();
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = spreadsheet.getSheetByName("Laporan Kerja");
  var reports = [];
  if (sheet && sheet.getLastRow() >= 2) {
    var columnCount = Math.min(39, sheet.getLastColumn());
    var values = sheet
      .getRange(2, 1, sheet.getLastRow() - 1, columnCount)
      .getValues();
    reports = values.map(function (row) {
      return {
        bulan: monthShort_(row[0]),
        bagian: row[1] || "",
        mesin: row[4] || "",
        komponen: row[26] || "",
        total_jam: Number(row[29]) || 0,
        jenis: row[38] || "",
      };
    });
  }
  result.laporan_mentah = reports;
  return result;
}

function monthShort_(value) {
  var date = parseFlexibleDate_(value);
  return date ? Utilities.formatDate(date, "GMT+7", "MMM") : "";
}

function sheetValue_(field, value) {
  if (field === "tanggal") return parseFlexibleDate_(value) || value;
  if (field === "jamMulai" || field === "jamSelesai")
    return parseFlexibleDate_(value) || value;
  if (field === "totalJam") {
    var numberText = String(value || "0");
    if (numberText.indexOf(",") >= 0)
      numberText = numberText.replace(/\./g, "").replace(",", ".");
    var number = Number(numberText);
    return isNaN(number) ? value : number;
  }
  if (field === "isNewMachine" || field === "isNewPart") {
    return value === true || String(value).toLowerCase() === "true";
  }
  return value === null ? "" : value;
}

function parseMonthFilter_(value) {
  value = clean_(value).toLowerCase();
  if (!value || value.indexOf("semua") >= 0) return null;
  var names = {
    januari: 0,
    februari: 1,
    maret: 2,
    april: 3,
    mei: 4,
    juni: 5,
    juli: 6,
    agustus: 7,
    september: 8,
    oktober: 9,
    november: 10,
    desember: 11,
    january: 0,
    february: 1,
    march: 2,
    may: 4,
    june: 5,
    july: 6,
    august: 7,
    october: 9,
    december: 11,
  };
  var yearMatch = value.match(/(20\d{2})/);
  var year = yearMatch ? Number(yearMatch[1]) : new Date().getFullYear();
  var month = null;
  Object.keys(names).some(function (name) {
    if (value.indexOf(name) >= 0) {
      month = names[name];
      return true;
    }
    return false;
  });
  return month === null ? null : { month: month, year: year };
}

function parseFlexibleDate_(value) {
  if (!value) return null;
  if (
    Object.prototype.toString.call(value) === "[object Date]" &&
    !isNaN(value.getTime())
  ) {
    return new Date(value.getTime());
  }
  var text = clean_(value);
  var id = text.match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2})[:.](\d{2})(?:[:.](\d{2}))?)?$/,
  );
  if (id) {
    var first = Number(id[1]);
    var second = Number(id[2]);
    var day = second > 12 && first <= 12 ? second : first;
    var month = second > 12 && first <= 12 ? first : second;
    return new Date(
      Number(id[3]),
      month - 1,
      day,
      Number(id[4] || 0),
      Number(id[5] || 0),
      Number(id[6] || 0),
    );
  }
  var parsed = new Date(text);
  return isNaN(parsed.getTime()) ? null : parsed;
}

function isEmptyRow_(row) {
  return !row.some(function (value) {
    return clean_(value) !== "";
  });
}

function normalize_(value) {
  return clean_(value)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function clean_(value) {
  return String(value === undefined || value === null ? "" : value).trim();
}

function json_(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(
    ContentService.MimeType.JSON,
  );
}
