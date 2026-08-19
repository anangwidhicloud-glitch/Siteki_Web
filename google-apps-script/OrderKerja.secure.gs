// SiTeki - API Order Kerja terpadu (Android + Web)
//
// Pasang script ini pada project Apps Script Spreadsheet Order Kerja.
// Hanya ada satu doGet dan satu doPost.
//
// Struktur sheet "Kerja" (A:X):
// A Tanggal Order       G Nama Mesin          M Selesai
// B Bagian Order        H Jenis Pekerjaan     N Status Mesin
// C Nama Pengorder      I Kerusakan           O Total Jam
// D Bagian Tujuan       J Urgensi             P Status Order
// E Kategori            K Perbaikan           Q Nilai Perbaikan
// F Jenis Mesin         L Mulai               R Spare Part
//                                             S Ukuran Part
//                                             T Keterangan
//                                             U Sinkron Laporan
//                                             V Waktu Sinkron
//
// Script Properties opsional:
// FONNTE_TOKEN, WHATSAPP_TARGET, PUBLIC_BASE_URL

var ORDER_SHEET = "Kerja";
var MACHINE_SHEET = "mesin";
var ORDER_TIMEZONE = "Asia/Jakarta";
var DEFAULT_REPORT_API_URL =
  "https://script.google.com/macros/s/AKfycbwYHHf8ONKbs9m5CppnzUuo067CBvrqRRfLYzl5ABwOH81sVWnFD8AyPx6F6Vf3uC4/exec";

function doPost(e) {
  try {
    var body = parseBody_(e);
    var action = clean_(body.action || "create").toLowerCase();
    if (action === "create") return createOrder_(body);
    if (action === "complete") return completeOrder_(body);
    return json_({ status: "error", message: "Action tidak dikenali." });
  } catch (error) {
    console.error(error.stack || error);
    return json_({ status: "error", message: String(error.message || error) });
  }
}

function doGet(e) {
  try {
    var params = e && e.parameter ? e.parameter : {};
    var action = clean_(params.action);
    if (action === "getAllOrders") return getAllOrders_(params);
    if (action === "getStatus") return getStatus_(params);

    var machineName = clean_(params.mesin || params.namaMesin);
    if (machineName) return getMachineByName_(machineName);

    return json_({
      status: "success",
      message: "SiTeki Order API aktif.",
      actions: ["getAllOrders", "getStatus", "create", "complete"],
    });
  } catch (error) {
    console.error(error.stack || error);
    return json_({ status: "error", message: String(error.message || error) });
  }
}

function createOrder_(body) {
  var bagianOrder = safeCell_(required_(body.bagianOrder, "Bagian order"));
  var namaOrder = safeCell_(required_(body.namaOrder, "Nama pengorder"));
  var bagianTujuan = safeCell_(required_(body.bagianTujuan, "Bagian tujuan"));
  var namaMesin = safeCell_(required_(body.namaMesin, "Nama mesin"));
  var jenis = safeCell_(required_(body.jenis, "Jenis mesin"));
  var jenisPekerjaan = safeCell_(
    required_(body.jenisPekerjaan, "Jenis pekerjaan"),
  );
  var kerusakan = safeCell_(
    required_(body.kerusakan, "Kerusakan/permasalahan"),
  );
  var urgensi = safeCell_(body.urgensi || "Biasa");
  var kategori = bagianTujuan === "Bengkel" ? "Armada" : "Mesin";

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sheet = orderSheet_();
    var now = new Date();
    var rowData = [
      now,
      bagianOrder,
      namaOrder,
      bagianTujuan,
      kategori,
      jenis,
      namaMesin,
      jenisPekerjaan,
      kerusakan,
      urgensi,
      "",
      "",
      "",
      "",
      "",
      "Open",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
    ];
    sheet.appendRow(rowData);
    var row = sheet.getLastRow();
    sendWhatsAppNewOrder_(sheet, row);
    return json_({
      status: "success",
      message: "Order kerja berhasil dibuat.",
      row: row,
      rowIndex: row,
      orderStatus: "Open",
    });
  } finally {
    lock.releaseLock();
  }
}

function completeOrder_(body) {
  var row = Number(body.rowIndex);
  if (!Number.isInteger(row) || row < 2)
    throw new Error("Row index order tidak valid.");

  var repair = safeCell_(
    required_(body.perbaikanDilakukan, "Perbaikan yang dilakukan"),
  );
  var startText = required_(body.jamMulai, "Waktu mulai");
  var endText = required_(body.jamSelesai, "Waktu selesai");
  var start = parseDateTime_(startText);
  var end = parseDateTime_(endText);
  if (!start || !end) throw new Error("Format waktu harus dd/MM/yyyy HH:mm.");
  if (end.getTime() < start.getTime())
    throw new Error("Waktu selesai tidak boleh sebelum waktu mulai.");

  var statusMesin = safeCell_(required_(body.statusMesin, "Status mesin"));
  var nilai = safeCell_(body.nilaiPerbaikan || "Bagus");
  var sparePart = safeCell_(body.sparePart || "Tidak Pakai");
  var ukuran = safeCell_(body.ukuranSparePart || "Tidak Pakai");
  var keterangan = safeCell_(body.keterangan || "");
  var totalHours =
    Math.round(((end.getTime() - start.getTime()) / 3600000) * 100) / 100;

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sheet = orderSheet_();
    if (row > sheet.getLastRow()) throw new Error("Order tidak ditemukan.");
    var currentStatus = clean_(
      sheet.getRange(row, 16).getDisplayValue(),
    ).toLowerCase();
    if (currentStatus === "closed") {
      var retrySync = syncClosedOrderSafely_(sheet, row);
      return json_({
        status: "success",
        message: retrySync.synced
          ? "Order sudah Closed dan laporan kerja sudah tersinkron."
          : "Order sudah Closed; sinkronisasi laporan masih tertunda.",
        rowIndex: row,
        orderStatus: "Closed",
        reportSync: retrySync,
      });
    }
    sheet
      .getRange(row, 11, 1, 10)
      .setValues([
        [
          repair,
          start,
          end,
          statusMesin,
          totalHours,
          "Closed",
          nilai,
          sparePart,
          ukuran,
          keterangan,
        ],
      ]);
    SpreadsheetApp.flush();
    var reportSync = syncClosedOrderSafely_(sheet, row);
    sendWhatsAppOrderComplete_(sheet, row);
    return json_({
      status: "success",
      message: reportSync.synced
        ? "Order Closed dan otomatis masuk ke Laporan Kerja."
        : "Order Closed, tetapi sinkronisasi Laporan Kerja masih tertunda.",
      rowIndex: row,
      orderStatus: "Closed",
      totalJam: totalHours,
      reportSync: reportSync,
    });
  } finally {
    lock.releaseLock();
  }
}

function syncClosedOrderSafely_(sheet, row) {
  var markerCell = sheet.getRange(row, 21);
  if (clean_(markerCell.getDisplayValue()).toUpperCase() === "SYNCED") {
    return {
      synced: true,
      status: "SYNCED",
      message: "Laporan sudah pernah dibuat.",
    };
  }
  try {
    var result = syncClosedOrderToReport_(sheet, row);
    markerCell.setValue("SYNCED");
    sheet.getRange(row, 22).setValue(new Date());
    return {
      synced: true,
      status: "SYNCED",
      message: result.message || "Laporan berhasil dibuat.",
    };
  } catch (error) {
    markerCell.setValue("PENDING");
    sheet.getRange(row, 22).setValue(new Date());
    console.error(
      "Sinkronisasi laporan order baris " + row + " gagal: " + error,
    );
    return {
      synced: false,
      status: "PENDING",
      message: String(error.message || error),
    };
  }
}

function syncClosedOrderToReport_(sheet, row) {
  var values = sheet.getRange(row, 1, 1, 22).getValues()[0];
  var reportUrl =
    PropertiesService.getScriptProperties().getProperty("REPORT_API_URL") ||
    DEFAULT_REPORT_API_URL;
  if (!reportUrl) throw new Error("REPORT_API_URL belum diatur.");

  var statusMachine = clean_(values[13]);
  var definition =
    statusMachine === "Tunggu Part"
      ? "Tunggu Part"
      : statusMachine === "Overhoul Mesin"
        ? "Overhaul"
        : "";
  var sparePart = clean_(values[17]) || "Tidak Pakai";
  var partSize = clean_(values[18]) || "Tidak Pakai";
  var note = clean_(values[19]);
  var problem = clean_(values[8]);

  var payload = {
    tanggal: formatDateOnly_(values[12] || new Date()),
    bagian: clean_(values[3]),
    kategoriMesin: clean_(values[4]),
    jenis: clean_(values[5]),
    namaMesin: clean_(values[6]),
    jenisPekerjaan: clean_(values[7]) || "Perbaikan",
    laporan: clean_(values[10]),
    jenisKomponen: "",
    jamMulai: formatCompactDateTime_(values[11]),
    jamSelesai: formatCompactDateTime_(values[12]),
    totalJam: Number(values[14] || 0),
    definisi: definition,
    sparepart: sparePart,
    ukuranPart: partSize,
    order: "Tanpa Order",
    statusOrder: "Close",
    nilaiPerbaikan: clean_(values[16]) || "Bagus",
    keterangan:
      (problem ? "Keluhan: " + problem : "") +
      (note ? (problem ? " | " : "") + note : ""),
    isNewMachine: false,
    isNewPart: false,
    partKategori: "",
    partNama: sparePart,
    partUkuran: partSize,
    sourceOrderId: "WO-" + row,
  };

  var response = UrlFetchApp.fetch(reportUrl, {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
    followRedirects: true,
  });
  var code = response.getResponseCode();
  var text = response.getContentText();
  if (code < 200 || code >= 400)
    throw new Error("API Laporan HTTP " + code + ": " + text);
  try {
    var parsed = JSON.parse(text);
    if (clean_(parsed.status).toLowerCase() === "error") {
      throw new Error(parsed.message || "API Laporan menolak data.");
    }
    return parsed;
  } catch (error) {
    if (String(error.message || error).indexOf("API Laporan") === 0)
      throw error;
    return { status: "success", message: "Laporan diterima server." };
  }
}

function getAllOrders_(params) {
  var sheet = orderSheet_();
  var values = sheet.getDataRange().getValues();
  var includeClosed = String(params.includeClosed || params.all || "") === "1";
  var result = [];
  for (var i = 1; i < values.length; i++) {
    var row = values[i];
    var status = clean_(row[15] || "Open");
    if (!includeClosed && status.toLowerCase() !== "open") continue;
    result.push({
      rowIndex: i + 1,
      tanggal: formatDateTime_(row[0]),
      tanggal_order: formatCompactDateTime_(row[0]),
      bagianOrder: clean_(row[1]),
      namaOrder: clean_(row[2]),
      bagianTujuan: clean_(row[3]),
      kategoriMesin: clean_(row[4]),
      jenis: clean_(row[5]),
      namaMesin: clean_(row[6]),
      jenisPekerjaan: clean_(row[7]),
      kerusakan: clean_(row[8]),
      urgensi: clean_(row[9]),
      perbaikanDilakukan: clean_(row[10]),
      jamMulai: formatCompactDateTime_(row[11]),
      jamSelesai: formatCompactDateTime_(row[12]),
      statusMesin: clean_(row[13]),
      totalJam: Number(row[14] || 0),
      status: status,
      nilaiPerbaikan: clean_(row[16]),
    });
  }
  return json_(result);
}

function getStatus_(params) {
  var row = Number(params.rowIndex);
  var sheet = orderSheet_();
  if (!Number.isInteger(row) || row < 2 || row > sheet.getLastRow()) {
    return json_({ status: "error", message: "Order tidak ditemukan." });
  }
  return json_({
    status: clean_(sheet.getRange(row, 16).getDisplayValue() || "Open"),
    rowIndex: row,
  });
}

function getMachineByName_(machineName) {
  var sheet =
    SpreadsheetApp.getActiveSpreadsheet().getSheetByName(MACHINE_SHEET);
  if (!sheet) throw new Error("Sheet 'mesin' tidak ditemukan.");
  var data = sheet.getDataRange().getValues();
  if (!data.length) throw new Error("Sheet mesin kosong.");
  var headers = data[0].map(normalize_);
  var nameIndex = headers.indexOf("nama");
  var typeIndex = headers.indexOf("jenis");
  var categoryIndex = headers.indexOf("kategori");
  if (nameIndex < 0)
    throw new Error("Kolom Nama pada sheet mesin tidak ditemukan.");
  for (var i = 1; i < data.length; i++) {
    if (
      clean_(data[i][nameIndex]).toLowerCase() === machineName.toLowerCase()
    ) {
      return json_({
        status: "success",
        action: "open_form",
        namaMesin: clean_(data[i][nameIndex]),
        jenis: typeIndex >= 0 ? clean_(data[i][typeIndex]) : "",
        kategori: categoryIndex >= 0 ? clean_(data[i][categoryIndex]) : "Mesin",
        message: "Data mesin ditemukan.",
      });
    }
  }
  return json_({
    status: "success",
    action: "open_form",
    namaMesin: machineName,
    jenis: "",
    kategori: "Mesin",
    message: "Mesin belum ditemukan pada sheet mesin.",
  });
}

function sendWhatsAppNewOrder_(sheet, row) {
  try {
    var values = sheet.getRange(row, 1, 1, 10).getValues()[0];
    var machineName = clean_(values[6]);
    var repairLink = machineRepairLink_(machineName, row);
    var message =
      "🚨 *ORDER KERJA BARU* 🚨\n\n" +
      "⏰ Tanggal : " +
      formatDateTime_(values[0]) +
      "\n" +
      "🏭 Bagian  : " +
      clean_(values[1]) +
      "\n" +
      "👤 Pembuat : " +
      clean_(values[2]) +
      "\n" +
      "🛠️ Mesin   : " +
      machineName +
      "\n" +
      "⚠️ Masalah : " +
      clean_(values[8]) +
      "\n" +
      "🔥 Urgensi : " +
      clean_(values[9]) +
      "\n\n" +
      "Status: *OPEN*\n\n" +
      "Buka SiTeki untuk memproses order:\n" +
      repairLink;
    sendFonnte_(message);
  } catch (error) {
    console.error("Notifikasi order baru gagal: " + error);
  }
}

function sendWhatsAppOrderComplete_(sheet, row) {
  try {
    var values = sheet.getRange(row, 1, 1, 20).getValues()[0];
    var message =
      "✅ *ORDER SELESAI* ✅\n\n" +
      "🛠️ Mesin     : " +
      clean_(values[6]) +
      "\n" +
      "🔧 Perbaikan : " +
      (clean_(values[10]) || "-") +
      "\n" +
      "⏱️ Total Jam : " +
      (values[14] || 0) +
      " Jam\n" +
      "🏁 Status    : *CLOSED*";
    sendFonnte_(message);
  } catch (error) {
    console.error("Notifikasi order selesai gagal: " + error);
  }
}

function machineRepairLink_(machineName, row) {
  var machineSheet =
    SpreadsheetApp.getActiveSpreadsheet().getSheetByName(MACHINE_SHEET);
  var baseLink = "";
  if (machineSheet) {
    var data = machineSheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (clean_(data[i][0]).toLowerCase() === machineName.toLowerCase()) {
        baseLink = clean_(data[i][3]);
        break;
      }
    }
  }
  if (!baseLink) {
    baseLink =
      PropertiesService.getScriptProperties().getProperty("PUBLIC_BASE_URL") ||
      "https://siteki.xo.je/";
  }
  var separator = baseLink.indexOf("?") >= 0 ? "&" : "?";
  return (
    baseLink +
    separator +
    "rowIndex=" +
    row +
    "&namaMesin=" +
    encodeURIComponent(machineName)
  );
}

function sendFonnte_(message) {
  var properties = PropertiesService.getScriptProperties();
  var token = clean_(properties.getProperty("FONNTE_TOKEN"));
  var target = clean_(properties.getProperty("WHATSAPP_TARGET"));
  if (!token || !target) {
    console.log(
      "Notifikasi WhatsApp dilewati: Script Properties belum lengkap.",
    );
    return;
  }
  var response = UrlFetchApp.fetch("https://api.fonnte.com/send", {
    method: "post",
    headers: { Authorization: token },
    payload: { target: target, message: message, countryCode: "62" },
    muteHttpExceptions: true,
  });
  if (response.getResponseCode() < 200 || response.getResponseCode() >= 300) {
    throw new Error(
      "Fonnte HTTP " +
        response.getResponseCode() +
        ": " +
        response.getContentText(),
    );
  }
}

function orderSheet_() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ORDER_SHEET);
  if (!sheet) throw new Error("Sheet 'Kerja' tidak ditemukan.");
  return sheet;
}

function parseBody_(e) {
  if (!e || !e.postData || !e.postData.contents)
    throw new Error("Body permintaan kosong.");
  try {
    return JSON.parse(e.postData.contents);
  } catch (error) {
    throw new Error("Body harus berupa JSON yang valid.");
  }
}

function parseDateTime_(value) {
  var match = clean_(value).match(
    /^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{1,2}):(\d{2})$/,
  );
  if (!match) return null;
  var date = new Date(
    Number(match[3]),
    Number(match[2]) - 1,
    Number(match[1]),
    Number(match[4]),
    Number(match[5]),
    0,
    0,
  );
  return isNaN(date.getTime()) ? null : date;
}

function formatDateTime_(value) {
  var date = value instanceof Date ? value : new Date(value);
  if (isNaN(date.getTime())) return clean_(value);
  return Utilities.formatDate(date, ORDER_TIMEZONE, "dd MMM yyyy HH:mm");
}

function formatDateOnly_(value) {
  var date = value instanceof Date ? value : new Date(value);
  if (isNaN(date.getTime())) return clean_(value);
  return Utilities.formatDate(date, ORDER_TIMEZONE, "dd/MM/yyyy");
}

function formatCompactDateTime_(value) {
  var date = value instanceof Date ? value : new Date(value);
  if (isNaN(date.getTime())) return clean_(value);
  return Utilities.formatDate(date, ORDER_TIMEZONE, "dd/MM/yyyy HH:mm");
}

function required_(value, label) {
  var result = clean_(value);
  if (!result) throw new Error(label + " wajib diisi.");
  if (result.length > 1000) throw new Error(label + " terlalu panjang.");
  return result;
}

function safeCell_(value) {
  var result = clean_(value);
  return /^[=+\-@]/.test(result) ? "'" + result : result;
}

function clean_(value) {
  return String(value === null || value === undefined ? "" : value).trim();
}

function normalize_(value) {
  return clean_(value)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function json_(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(
    ContentService.MimeType.JSON,
  );
}
