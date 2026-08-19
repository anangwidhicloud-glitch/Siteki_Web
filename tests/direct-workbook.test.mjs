import test from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { parseDirectWorkbook } from "../src/lib/directWorkbook.js";

async function fileFromWorkbook(name,workbook){
  const buffer=await workbook.xlsx.writeBuffer();
  return {name,size:buffer.byteLength,arrayBuffer:async()=>buffer};
}

test("Rekap Perawatan dikenali dari nama file, sheet, dan header",async()=>{
  const workbook=new ExcelJS.Workbook();
  const sheet=workbook.addWorksheet("det_rawat");
  sheet.addRow(["Tanggal","Kategori","Jenis","Nama Mesin","Waktu","Kebersihan","Keterangan"]);
  sheet.addRow([new Date(Date.UTC(2026,5,29)),"Mesin","Perakitan","Line 01","M","Bagus","Normal"]);
  const parsed=await parseDirectWorkbook(await fileFromWorkbook("Rekap Perawatan.xlsx",workbook));
  assert.equal(parsed.kind,"direct");
  assert.equal(parsed.datasets[0].documentType,"maintenance");
  assert.equal(parsed.datasets[0].rows[0].inspected_on,"2026-06-29");
  assert.deepEqual(parsed.datasets[0].rows[0].checks,[{name:"Kebersihan",raw_status:"Bagus"}]);
});

test("Laporan Kerja dikenali dan dipetakan ke kolom database",async()=>{
  const workbook=new ExcelJS.Workbook();
  const sheet=workbook.addWorksheet("lap_kerja");
  sheet.addRow(["Tanggal","Bagian","Kategori Mesin","Jenis","Nama Mesin","Jenis Pekerjaan","Laporan Pekerjaan","Jam Mulai","Jam Selesai","Total Jam"]);
  sheet.addRow([new Date(Date.UTC(2026,5,29)),"Tek. Shift A","Mesin","Perakitan","Line 01","Perbaikan","Ganti bearing","08:00","09:30",1.5]);
  const parsed=await parseDirectWorkbook(await fileFromWorkbook("Laporan Kerja.xlsx",workbook));
  const row=parsed.datasets[0].rows[0];
  assert.equal(parsed.datasets[0].documentType,"work_reports");
  assert.equal(row.started_at,"2026-06-29T08:00:00+07:00");
  assert.equal(row.total_hours,1.5);
});

test("Laporan Kerja identik dilewati tetapi perbedaan status order dipertahankan",async()=>{
  const workbook=new ExcelJS.Workbook();
  const sheet=workbook.addWorksheet("lap_kerja");
  sheet.addRow(["Tanggal","Bagian","Kategori Mesin","Jenis","Nama Mesin","Jenis Pekerjaan","Laporan Pekerjaan","Jam Mulai","Jam Selesai","Total Jam","Order","Status Order"]);
  const base=[new Date(Date.UTC(2026,5,29)),"Bengkel","Armada","Forklift","Forklift A","Perbaikan","Ganti bearing","08:00","09:30"];
  sheet.addRow([...base,1.5,"Tanpa Order","Close"]);
  sheet.addRow([...base,1.5000000001,"Tanpa Order","Close"]);
  sheet.addRow([...base,1.5,"Order","Close"]);
  const parsed=await parseDirectWorkbook(await fileFromWorkbook("Laporan Kerja.xlsx",workbook));
  assert.equal(parsed.datasets[0].rows.length,2);
  assert.equal(parsed.warnings.duplicatesInFile,1);
  assert.deepEqual(parsed.duplicateRows,[{source_row:3,duplicate_of:2}]);
});

test("nama file operasional yang berubah ditolak",async()=>{
  const workbook=new ExcelJS.Workbook();
  workbook.addWorksheet("det_rawat").addRow(["Tanggal"]);
  await assert.rejects(
    parseDirectWorkbook(await fileFromWorkbook("Rekap Perawatan salinan.xlsx",workbook)),
    /Nama file tidak dikenal/,
  );
});

test("identitas perawatan ganda dalam satu file ditolak",async()=>{
  const workbook=new ExcelJS.Workbook();
  const sheet=workbook.addWorksheet("det_rawat");
  sheet.addRow(["Tanggal","Kategori","Jenis","Nama Mesin","Waktu","Kebersihan","Keterangan"]);
  const row=[new Date(Date.UTC(2026,5,29)),"Mesin","Perakitan","Line 01","M","Bagus",""];
  sheet.addRow(row);sheet.addRow(row);
  await assert.rejects(parseDirectWorkbook(await fileFromWorkbook("Rekap Perawatan.xlsx",workbook)),/data Rekap Perawatan ganda/i);
});
