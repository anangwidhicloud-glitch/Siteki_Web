// SiTeki - API Login dan Manajemen Teknisi
// Tempelkan seluruh isi file ini ke Code.gs, lalu buat deployment Web App baru.
// Execute as: Me. Who has access: Anyone.

var USER_SHEET = "User";
var OVERTIME_SPREADSHEET_ID = "1C6qxrpwlNPuXvLhU2cHWHb4V658tnJLQZteHgZR2S7U";
var SESSION_TTL_SECONDS = 21600; // 6 jam
var NATIONAL_HOLIDAYS = {
  "2026-01-01":"Tahun Baru Masehi",
  "2026-01-16":"Isra Mikraj Nabi Muhammad SAW",
  "2026-02-17":"Tahun Baru Imlek",
  "2026-03-19":"Hari Suci Nyepi",
  "2026-03-21":"Hari Raya Idulfitri",
  "2026-03-22":"Hari Raya Idulfitri",
  "2026-04-03":"Wafat Yesus Kristus",
  "2026-04-05":"Hari Kebangkitan Yesus Kristus",
  "2026-05-01":"Hari Buruh Internasional",
  "2026-05-14":"Kenaikan Yesus Kristus",
  "2026-05-27":"Hari Raya Iduladha",
  "2026-05-31":"Hari Raya Waisak",
  "2026-06-01":"Hari Lahir Pancasila",
  "2026-06-16":"Tahun Baru Islam",
  "2026-08-17":"Hari Kemerdekaan RI",
  "2026-08-25":"Maulid Nabi Muhammad SAW",
  "2026-12-25":"Hari Raya Natal"
};

function doGet(e) {
  try {
    var action = String((e && e.parameter && e.parameter.action) || "");
    if (action === "getAllUser" || action === "getAllUsers" || action === "login") {
      return json_({ status:"error", message:"Gunakan metode POST untuk operasi ini." });
    }
    if (action === "getAllMesin") return json_(getAllMesinData_());
    if (action === "getRawatMaster") return json_(getRawatMasterData_());
    if (action === "getMesin" || !action) return json_(getMesinData_());
    return json_({ status:"error", message:"Action tidak dikenali." });
  } catch (err) {
    return json_({ status:"error", message:String(err.message || err) });
  }
}

function doPost(e) {
  try {
    var body = JSON.parse((e && e.postData && e.postData.contents) || "{}");
    var action = String(body.action || "");
    if (action === "login") return login_(body);
    if (action === "logout") return logout_(body);
    if (action === "getAllUser" || action === "getAllUsers") return getAllUsers_(body);
    if (action === "getMyProfile") return getMyProfile_(body);
    if (action === "getOvertimeCalendar") return getOvertimeCalendar_(body);
    if (action === "saveOvertime") return saveOvertime_(body);
    if (action === "deleteOvertime") return deleteOvertime_(body);
    if (action === "getOvertimeChart") return getOvertimeChart_(body);
    if (action === "getOvertimeAdmin") return getOvertimeAdmin_(body);
    if (action === "updateOrCreateUser") return updateOrCreateUser_(body);
    return json_({ status:"error", message:"Action tidak dikenali." });
  } catch (err) {
    return json_({ status:"error", message:String(err.message || err) });
  }
}

function login_(body) {
  var username = clean_(body.username);
  var password = String(body.password || "");
  if (!username || !password) return json_({ status:"failed", message:"Username dan password wajib diisi." });

  var sheet = userSheet_();
  var values = sheet.getDataRange().getDisplayValues();
  for (var i = 1; i < values.length; i++) {
    if (clean_(values[i][0]).toLowerCase() === username.toLowerCase() && String(values[i][1]) === password) {
      var profile = { username:String(values[i][0]), nama:String(values[i][2]), role:String(values[i][3] || "Lainnya") };
      var token = Utilities.getUuid() + Utilities.getUuid().replace(/-/g, "");
      CacheService.getScriptCache().put("session:" + token, JSON.stringify(profile), SESSION_TTL_SECONDS);
      return json_({ status:"success", token:token, expiresIn:SESSION_TTL_SECONDS, profile:profile });
    }
  }
  return json_({ status:"failed", message:"Username atau password salah." });
}

function logout_(body) {
  if (body.token) CacheService.getScriptCache().remove("session:" + String(body.token));
  return json_({ status:"success" });
}

function getAllUsers_(body) {
  requireAdmin_(body.token);
  var values = userSheet_().getDataRange().getValues();
  var users = [];
  for (var i = 1; i < values.length; i++) {
    if (values[i][0] || values[i][2]) users.push(userObject_(values[i]));
  }
  return json_({ status:"success", data:users });
}

function getMyProfile_(body) {
  var session = requireSession_(body.token);
  var values = userSheet_().getDataRange().getValues();
  for (var i = 1; i < values.length; i++) {
    if (clean_(values[i][0]).toLowerCase() === clean_(session.username).toLowerCase()) {
      return json_({ status:"success", data:userObject_(values[i]) });
    }
  }
  return json_({ status:"error", message:"Profil tidak ditemukan." });
}

function getOvertimeCalendar_(body) {
  var session = requireSession_(body.token);
  var year = Number(body.year) || new Date().getFullYear();
  var month = Number(body.month) || new Date().getMonth() + 1;
  if (month < 1 || month > 12) throw new Error("Bulan tidak valid.");

  var sheet = overtimeSheet_();
  var values = sheet.getDataRange().getValues();
  var headers = values.length ? values[0].map(normalizeHeader_) : [];
  var dateIndex = headerIndex_(headers, ["tanggal"]);
  var nameIndex = headerIndex_(headers, ["nama"]);
  var hoursIndex = headerIndex_(headers, ["jamlembur"]);
  var typeIndex = headerIndex_(headers, ["jenislembur"]);
  var wageIndex = headerIndex_(headers, ["totalupah"]);
  var noteIndex = headerIndex_(headers, ["keterangan"]);
  var entries = [];
  var cutoffStart = new Date(year, month - 1, 22, 0, 0, 0, 0);
  var cutoffEnd = new Date(year, month, 21, 23, 59, 59, 999);
  var cutoffSummary = {jumlahData:0,totalJam:0,totalUpah:0};

  for (var i = 1; i < values.length; i++) {
    var date = parseSheetDate_(values[i][dateIndex]);
    var name = clean_(values[i][nameIndex]);
    if (!date || name.toLowerCase() !== clean_(session.nama).toLowerCase()) continue;
    var rowHours = number_(values[i][hoursIndex]);
    var rowWage = wageIndex >= 0 ? number_(values[i][wageIndex]) : 0;
    if (date >= cutoffStart && date <= cutoffEnd) {
      cutoffSummary.jumlahData++;
      cutoffSummary.totalJam += rowHours;
      cutoffSummary.totalUpah += rowWage;
    }
    if (date.getFullYear() === year && date.getMonth() + 1 === month) {
      var holiday = holidayInfo_(date);
      entries.push({
        tanggal:dateKey_(date),
        jam:rowHours,
        jenis:typeIndex >= 0 ? clean_(values[i][typeIndex]) : "",
        totalUpah:rowWage,
        keterangan:noteIndex >= 0 ? clean_(values[i][noteIndex]) : "",
        hariBesar:holiday.isHoliday,
        namaLibur:holiday.name
      });
    }
  }
  cutoffSummary.totalJam = Math.round(cutoffSummary.totalJam * 100) / 100;
  cutoffSummary.totalUpah = Math.round(cutoffSummary.totalUpah);
  cutoffSummary.tanggalAwal = dateKey_(cutoffStart);
  cutoffSummary.tanggalAkhir = dateKey_(cutoffEnd);

  return json_({
    status:"success", year:year, month:month, data:entries,
    holidays:holidaysForMonth_(year, month),
    cutoff:cutoffSummary
  });
}

function saveOvertime_(body) {
  var session = requireSession_(body.token);
  var date = parseIsoDate_(body.tanggal);
  var hours = number_(body.jam);
  var note = clean_(body.keterangan);
  if (!date) throw new Error("Tanggal lembur tidak valid.");
  if (hours <= 0 || hours > 24) throw new Error("Jam lembur harus lebih dari 0 dan maksimal 24 jam.");
  if (!note) throw new Error("Keterangan pekerjaan lembur wajib diisi.");

  var user = findUserByUsername_(session.username);
  var basicSalary = number_(user[23]);
  if (basicSalary <= 0) throw new Error("Gaji pokok pengguna belum tersedia pada Data User.");

  var holiday = holidayInfo_(date);
  var type = holiday.isHoliday ? "HariBesar" : (hours < 2 ? "Normal_Kecil" : "Normal_Besar");
  var hourlySalary = basicSalary / 173;
  var totalWage = calculateOvertimeWage_(basicSalary, hours, type);
  var sheet = overtimeSheet_();
  var values = sheet.getDataRange().getValues();
  var targetRow = 0;

  for (var i = 1; i < values.length; i++) {
    var rowDate = parseSheetDate_(values[i][1]);
    var rowName = clean_(values[i][2]);
    if (rowDate && dateKey_(rowDate) === dateKey_(date) && rowName.toLowerCase() === clean_(session.nama).toLowerCase()) {
      targetRow = i + 1;
      break;
    }
  }

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var rowData = [new Date(), date, session.nama, session.role, hours, type, hourlySalary, totalWage, note];
    if (targetRow) {
      rowData[0] = sheet.getRange(targetRow, 1).getValue() || new Date();
      sheet.getRange(targetRow, 1, 1, 9).setValues([rowData]);
    } else {
      sheet.getRange(Math.max(2, sheet.getLastRow() + 1), 1, 1, 9).setValues([rowData]);
    }
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }
  return json_({
    status:"success",
    message:targetRow ? "Data lembur diperbarui." : "Data lembur disimpan.",
    data:{tanggal:dateKey_(date),jam:hours,jenis:type,totalUpah:totalWage,keterangan:note,hariBesar:holiday.isHoliday,namaLibur:holiday.name}
  });
}

function deleteOvertime_(body) {
  var session = requireSession_(body.token);
  var date = parseIsoDate_(body.tanggal);
  if (!date) throw new Error("Tanggal lembur tidak valid.");
  var sheet = overtimeSheet_();
  var values = sheet.getDataRange().getValues();
  for (var i = values.length - 1; i >= 1; i--) {
    var rowDate = parseSheetDate_(values[i][1]);
    var rowName = clean_(values[i][2]);
    if (rowDate && dateKey_(rowDate) === dateKey_(date) && rowName.toLowerCase() === clean_(session.nama).toLowerCase()) {
      sheet.deleteRow(i + 1);
      return json_({status:"success",message:"Data lembur dihapus."});
    }
  }
  return json_({status:"error",message:"Data lembur pada tanggal tersebut tidak ditemukan."});
}

function getOvertimeChart_(body) {
  var session = requireSession_(body.token);
  var viewerRole = clean_(session.role).toLowerCase();
  if (viewerRole !== "admin" && viewerRole !== "teknik") throw new Error("Grafik lembur hanya dapat diakses Admin dan Teknik.");
  var year = Number(body.year) || new Date().getFullYear();
  var allowedUsers = overtimeReportUsers_();
  var values = overtimeSheet_().getDataRange().getValues();
  var monthly = [];
  for (var month = 1; month <= 12; month++) monthly.push({
    bulan:["Jan","Feb","Mar","Apr","Mei","Jun","Jul","Agu","Sep","Okt","Nov","Des"][month - 1],
    totalJam:0,
    jumlahData:0
  });
  for (var i = 1; i < values.length; i++) {
    var date = parseSheetDate_(values[i][1]);
    var nameKey = clean_(values[i][2]).toLowerCase();
    if (!date || date.getFullYear() !== year || !allowedUsers[nameKey]) continue;
    monthly[date.getMonth()].totalJam += number_(values[i][4]);
    monthly[date.getMonth()].jumlahData++;
  }
  monthly.forEach(function(item) { item.totalJam = Math.round(item.totalJam * 100) / 100; });
  return json_({status:"success",year:year,data:monthly});
}

function getOvertimeAdmin_(body) {
  requireAdmin_(body.token);
  var year = Number(body.year) || new Date().getFullYear();
  var month = Number(body.month) || (new Date().getMonth() + 1);
  if (month < 1 || month > 12) throw new Error("Filter bulan tidak valid.");
  var cutoffStart = new Date(year, month - 1, 22, 0, 0, 0, 0);
  var cutoffEnd = new Date(year, month, 21, 23, 59, 59, 999);

  var sheet = overtimeSheet_();
  var values = sheet.getDataRange().getValues();
  if (values.length < 2) return json_({
    status:"success", year:year, month:month,
    cutoff:{tanggalAwal:dateKey_(cutoffStart),tanggalAkhir:dateKey_(cutoffEnd)},
    summary:{jumlahKaryawan:0,totalJam:0,totalUpah:0,jumlahData:0}, data:[]
  });

  var headers = values[0].map(normalizeHeader_);
  var dateIndex = headerIndex_(headers, ["tanggal"]);
  var nameIndex = headerIndex_(headers, ["nama"]);
  var hoursIndex = headerIndex_(headers, ["jamlembur"]);
  var wageIndex = headerIndex_(headers, ["totalupah"]);
  if ([dateIndex,nameIndex,hoursIndex,wageIndex].some(function(index) { return index < 0; })) {
    throw new Error("Kolom Tanggal, Nama, Jam_Lembur, atau Total_Upah tidak ditemukan.");
  }

  var grouped = {};
  var allowedUsers = overtimeReportUsers_();
  var totalHours = 0, totalWage = 0, totalRows = 0;
  for (var i = 1; i < values.length; i++) {
    var date = parseSheetDate_(values[i][dateIndex]);
    var name = clean_(values[i][nameIndex]);
    var allowedUser = allowedUsers[name.toLowerCase()];
    if (!date || !name || !allowedUser || date < cutoffStart || date > cutoffEnd) continue;
    var hours = number_(values[i][hoursIndex]);
    var wage = number_(values[i][wageIndex]);
    var key = name.toLowerCase();
    if (!grouped[key]) grouped[key] = {
      nama:allowedUser.nama, role:allowedUser.role,
      totalJam:0, totalUpah:0, jumlahData:0
    };
    grouped[key].totalJam += hours;
    grouped[key].totalUpah += wage;
    grouped[key].jumlahData++;
    totalHours += hours;
    totalWage += wage;
    totalRows++;
  }

  var data = Object.keys(grouped).map(function(key) {
    var item = grouped[key];
    item.totalJam = Math.round(item.totalJam * 100) / 100;
    item.totalUpah = Math.round(item.totalUpah);
    return item;
  }).sort(function(a,b) { return b.totalJam - a.totalJam || a.nama.localeCompare(b.nama); });

  return json_({
    status:"success", year:year, month:month,
    cutoff:{tanggalAwal:dateKey_(cutoffStart),tanggalAkhir:dateKey_(cutoffEnd)},
    summary:{
      jumlahKaryawan:data.length,
      totalJam:Math.round(totalHours * 100) / 100,
      totalUpah:Math.round(totalWage),
      jumlahData:totalRows
    },
    data:data
  });
}

function updateOrCreateUser_(body) {
  var session = requireSession_(body.token);
  var isAdmin = String(session.role).toLowerCase() === "admin";

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sheet = userSheet_();
    var values = sheet.getDataRange().getValues();
    var originalNik = isAdmin ? clean_(body.originalNik || body.nik) : "";
    var originalUsername = isAdmin
      ? clean_(body.originalUsername || body.username).toLowerCase()
      : clean_(session.username).toLowerCase();
    var targetRow = 0;

    for (var i = 1; i < values.length; i++) {
      var rowNik = clean_(values[i][5]);
      var rowUsername = clean_(values[i][0]).toLowerCase();
      if (rowNik === originalNik || rowUsername === originalUsername) targetRow = i + 1;
    }
    if (!isAdmin && !targetRow) throw new Error("Profil pengguna tidak ditemukan.");
    if (!isAdmin) {
      var own = values[targetRow - 1];
      body.username = own[0];
      body.password = "";
      body.role = own[3];
      body.nik = own[5];
      body.statusGaji = own[15];
      body.tunjangan = own[16];
      body.gajiPokok = own[23];
      body.gajiHarian = own[24];
    }
    ["username","nama","nik"].forEach(function(key) {
      if (!clean_(body[key])) throw new Error(key + " wajib diisi.");
    });
    for (var j = 1; j < values.length; j++) {
      var sheetRow = j + 1;
      if (sheetRow === targetRow) continue;
      if (clean_(values[j][0]).toLowerCase() === clean_(body.username).toLowerCase()) throw new Error("Username sudah digunakan.");
      if (clean_(values[j][5]) === clean_(body.nik)) throw new Error("NIK sudah digunakan.");
    }

    var oldPassword = targetRow ? String(sheet.getRange(targetRow, 2).getDisplayValue() || "") : "";
    var password = String(body.password || "") || oldPassword;
    if (!password) throw new Error("Password wajib diisi untuk teknisi baru.");

    var rowData = [
      clean_(body.username), password, clean_(body.nama), clean_(body.role) || "Lainnya",
      clean_(body.fungsi), clean_(body.nik), clean_(body.jabatan), clean_(body.bagian),
      clean_(body.regu), dateValue_(body.tglMasuk), "", dateValue_(body.kontrakTerakhir),
      clean_(body.pendidikan), clean_(body.jurusan), clean_(body.statusPegawai),
      clean_(body.statusGaji), number_(body.tunjangan), clean_(body.tLahir),
      dateValue_(body.tglLahir), "", clean_(body.alamat), clean_(body.noTelp),
      clean_(body.noTelpDarurat), number_(body.gajiPokok), number_(body.gajiHarian),
      clean_(body.keterangan)
    ];

    if (!targetRow) {
      targetRow = Math.max(2, sheet.getLastRow() + 1);
      sheet.getRange(targetRow, 1, 1, 26).setValues([rowData]);
      copyFormulaFromPrevious_(sheet, targetRow, 11);
      copyFormulaFromPrevious_(sheet, targetRow, 20);
    } else {
      var formulaLamaKerja = sheet.getRange(targetRow, 11).getFormula();
      var formulaUsia = sheet.getRange(targetRow, 20).getFormula();
      var oldLamaKerja = sheet.getRange(targetRow, 11).getValue();
      var oldUsia = sheet.getRange(targetRow, 20).getValue();
      rowData[10] = oldLamaKerja;
      rowData[19] = oldUsia;
      sheet.getRange(targetRow, 1, 1, 26).setValues([rowData]);
      if (formulaLamaKerja) sheet.getRange(targetRow, 11).setFormula(formulaLamaKerja);
      if (formulaUsia) sheet.getRange(targetRow, 20).setFormula(formulaUsia);
    }
    SpreadsheetApp.flush();
    return json_({ status:"success", message:"Data teknisi berhasil disimpan.", data:userObject_(sheet.getRange(targetRow, 1, 1, 26).getValues()[0]) });
  } finally {
    lock.releaseLock();
  }
}

function requireSession_(token) {
  token = String(token || "");
  if (!token) throw new Error("Token sesi tidak tersedia. Silakan login kembali.");
  var raw = CacheService.getScriptCache().get("session:" + token);
  if (!raw) throw new Error("Sesi berakhir. Silakan login kembali.");
  CacheService.getScriptCache().put("session:" + token, raw, SESSION_TTL_SECONDS);
  return JSON.parse(raw);
}

function requireAdmin_(token) {
  var session = requireSession_(token);
  if (String(session.role).toLowerCase() !== "admin") throw new Error("Akses hanya untuk Admin.");
  return session;
}

function userObject_(row) {
  return {
    username:String(row[0] || ""), password:"", hasPassword:Boolean(row[1]), nama:String(row[2] || ""),
    role:String(row[3] || "Lainnya"), fungsi:String(row[4] || ""), nik:String(row[5] || ""),
    jabatan:String(row[6] || ""), bagian:String(row[7] || ""), regu:String(row[8] || ""),
    tglMasuk:formatTanggal_(row[9]), lamaKerja:String(row[10] || ""),
    kontrakTerakhir:formatTanggal_(row[11]), pendidikan:String(row[12] || ""),
    jurusan:String(row[13] || ""), statusPegawai:String(row[14] || ""),
    statusGaji:String(row[15] || ""), tunjangan:String(row[16] || ""), tLahir:String(row[17] || ""),
    tglLahir:formatTanggal_(row[18]), usia:String(row[19] || ""), alamat:String(row[20] || ""),
    noTelp:String(row[21] || ""), noTelpDarurat:String(row[22] || ""),
    gajiPokok:String(row[23] || "0"), gajiHarian:String(row[24] || "0"),
    keterangan:String(row[25] || "")
  };
}

function userSheet_() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(USER_SHEET);
  if (!sheet) throw new Error("Tab 'User' tidak ditemukan.");
  return sheet;
}

function overtimeSheet_() {
  var spreadsheet = SpreadsheetApp.openById(OVERTIME_SPREADSHEET_ID);
  var sheets = spreadsheet.getSheets();
  for (var i = 0; i < sheets.length; i++) {
    if (sheets[i].getLastRow() < 1) continue;
    var headers = sheets[i].getRange(1, 1, 1, sheets[i].getLastColumn()).getValues()[0].map(normalizeHeader_);
    if (headers.indexOf("nama") >= 0 && headers.indexOf("jamlembur") >= 0 && headers.indexOf("totalupah") >= 0) return sheets[i];
  }
  throw new Error("Sheet database lembur tidak ditemukan.");
}

function findUserByUsername_(username) {
  var values = userSheet_().getDataRange().getValues();
  var target = clean_(username).toLowerCase();
  for (var i = 1; i < values.length; i++) {
    if (clean_(values[i][0]).toLowerCase() === target) return values[i];
  }
  throw new Error("Data pengguna tidak ditemukan.");
}

function overtimeReportUsers_() {
  var values = userSheet_().getDataRange().getValues();
  var users = {};
  for (var i = 1; i < values.length; i++) {
    var name = clean_(values[i][2]);
    var role = clean_(values[i][3]);
    var normalizedRole = role.toLowerCase();
    if (name && (normalizedRole === "admin" || normalizedRole === "teknik")) {
      users[name.toLowerCase()] = {nama:name,role:role};
    }
  }
  return users;
}

function parseIsoDate_(value) {
  var match = clean_(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  var date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12);
  return isNaN(date.getTime()) ? null : date;
}

function dateKey_(date) {
  return Utilities.formatDate(date, Session.getScriptTimeZone(), "yyyy-MM-dd");
}

function holidayInfo_(date) {
  var key = dateKey_(date);
  if (NATIONAL_HOLIDAYS[key]) return {isHoliday:true,name:NATIONAL_HOLIDAYS[key]};
  if (date.getDay() === 0) return {isHoliday:true,name:"Hari Minggu"};
  return {isHoliday:false,name:""};
}

function holidaysForMonth_(year, month) {
  var result = [];
  var days = new Date(year, month, 0, 12).getDate();
  for (var day = 1; day <= days; day++) {
    var date = new Date(year, month - 1, day, 12);
    var holiday = holidayInfo_(date);
    if (holiday.isHoliday) result.push({tanggal:dateKey_(date),nama:holiday.name});
  }
  return result;
}

function calculateOvertimeWage_(basicSalary, hours, type) {
  if (type === "HariBesar") return roundOvertimeWage_(basicSalary, 2, hours);
  if (hours > 1) {
    return roundOvertimeWage_(basicSalary, 1.5, 1) +
      roundOvertimeWage_(basicSalary, 2, hours - 1);
  }
  return roundOvertimeWage_(basicSalary, 1.5, hours);
}

function roundOvertimeWage_(nominal, factor, hours) {
  var raw = factor * 0.005781035 * nominal * hours;
  var rounded = Math.round(raw);
  var hundreds = Math.floor(rounded / 100) * 100;
  var remainder = rounded % 100;
  if (remainder === 0) return hundreds;
  return remainder < 50 ? hundreds + 50 : hundreds + 100;
}

function normalizeHeader_(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function headerIndex_(headers, candidates) {
  for (var i = 0; i < candidates.length; i++) {
    var index = headers.indexOf(candidates[i]);
    if (index >= 0) return index;
  }
  return -1;
}

function parseSheetDate_(value) {
  if (value instanceof Date && !isNaN(value.getTime())) return value;
  var text = clean_(value);
  var match = text.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
  if (match) return new Date(Number(match[3]), Number(match[2]) - 1, Number(match[1]), 12);
  var parsed = new Date(text);
  return isNaN(parsed.getTime()) ? null : parsed;
}

function getMesinData_() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Mesin_per");
  if (!sheet) throw new Error("Tab 'Mesin_per' tidak ditemukan.");
  var data = sheet.getDataRange().getValues(), result = [];
  for (var i = 1; i < data.length; i++) result.push({ jenis:String(data[i][0] || ""), nama_mesin:String(data[i][1] || "") });
  return result;
}

function getRawatMasterData_() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Rawat");
  if (!sheet) throw new Error("Tab 'Rawat' tidak ditemukan.");
  var data = sheet.getDataRange().getValues(), result = [];
  for (var i = 1; i < data.length; i++) if (data[i][0] !== "") result.push({
    kategori:data[i][0], jenis:data[i][1], nama:data[i][2], waktu:data[i][3], item:data[i][4], label:data[i][5]
  });
  return result;
}

function getAllMesinData_() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("mesin");
  if (!sheet) throw new Error("Tab 'mesin' tidak ditemukan.");
  var data = sheet.getDataRange().getValues(), result = [];
  for (var i = 1; i < data.length; i++) result.push({
    nama:clean_(data[i][2]), kategori:clean_(data[i][0]) || "Mesin", jenis:clean_(data[i][1])
  });
  return result;
}

function copyFormulaFromPrevious_(sheet, targetRow, column) {
  if (targetRow <= 2) return;
  var formula = sheet.getRange(targetRow - 1, column).getFormulaR1C1();
  if (formula) sheet.getRange(targetRow, column).setFormulaR1C1(formula);
}

function dateValue_(value) {
  var text = clean_(value);
  var match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12) : text;
}

function formatTanggal_(raw) {
  if (raw instanceof Date) return Utilities.formatDate(raw, Session.getScriptTimeZone(), "dd/MM/yyyy");
  return raw ? String(raw) : "";
}

function number_(value) {
  var parsed = Number(String(value == null ? "" : value).replace(/[^0-9.-]/g, ""));
  return isNaN(parsed) ? 0 : parsed;
}

function clean_(value) {
  return String(value == null ? "" : value).trim();
}

function json_(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}
