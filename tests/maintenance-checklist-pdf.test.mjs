import assert from "node:assert/strict";
import test from "node:test";
import {
  conditionSummary,createMaintenanceChecklistPdf,filterMaintenancePrintRows,maintenancePrintOptions,normalizeMaintenancePrintRows,
} from "../src/lib/maintenanceChecklistPdf.js";

const rows=normalizeMaintenancePrintRows([
  {id:"a",tanggal_iso:"2026-08-01",kategori:"Mesin",jenis:"Line",nama_mesin:"Line 01",perawatan:"Mingguan",checks:[
    {name:"Kebersihan",sort_order:1,status:"good",raw_status:"Bagus"},
    {name:"Baut",sort_order:2,status:"repair_needed",raw_status:"Perbaikan"},
  ]},
  {id:"b",tanggal:"08/08/2026",kategori:"Mesin",jenis:"Line",nama_mesin:"Line 01",waktu:"M",checks:[
    {name:"Pelindung",sort_order:1,status:"not_applicable",raw_status:"T.A"},
  ]},
  {id:"c",tanggal_iso:"2026-07-02",kategori:"Armada",jenis:"Forklift",nama_mesin:"Forklift A",waktu:"B"},
]);

test("normalisasi tanggal dan kode perawatan mengikuti data existing",()=>{
  assert.equal(rows[1].date.iso,"2026-08-08");
  assert.equal(rows[1].perawatan,"Mingguan");
  assert.equal(rows[2].perawatan,"Bulanan");
});

test("dropdown bertingkat hanya menawarkan data yang tersedia",()=>{
  const category=maintenancePrintOptions(rows);
  assert.deepEqual(category.kategori,["Armada","Mesin"]);
  const machine=maintenancePrintOptions(rows,{kategori:"Mesin",jenis:"Line",nama_mesin:"Line 01",perawatan:"Mingguan",year:2026,month:8});
  assert.deepEqual(machine.jenis,["Line"]);
  assert.deepEqual(machine.months,[8]);
  assert.deepEqual(machine.records.map(item=>item.id),["b","a"]);
});

test("filter dua laporan tetap dapat dibatasi pada satu kategori",()=>{
  const result=filterMaintenancePrintRows(rows,{kategori:"Mesin",year:2026,month:8});
  assert.deepEqual(result.map(item=>item.id),["a","b"]);
});

test("ringkasan kondisi menghitung Bagus, Perbaikan, dan T.A",()=>{
  const summary=conditionSummary([...rows[0].checks,...rows[1].checks]);
  assert.deepEqual({good:summary.good,repair:summary.repair,na:summary.na,total:summary.total},{good:1,repair:1,na:1,total:3});
  assert.equal(summary.goodPercent,33);
});

test("generator menghasilkan satu dokumen PDF format F4 untuk dua laporan berbeda",async()=>{
  const {doc,filename}=await createMaintenanceChecklistPdf({first:{...rows[0],printNote:"Keterangan manual laporan pertama"},second:{...rows[1],printNote:"Keterangan manual laporan kedua"},printedOn:"2026-08-19"});
  const bytes=new Uint8Array(doc.output("arraybuffer"));
  assert.equal(new TextDecoder().decode(bytes.slice(0,5)),"%PDF-");
  assert.ok(bytes.length>5000);
  assert.equal(doc.getNumberOfPages(),1);
  assert.ok(Math.abs(doc.internal.pageSize.getWidth()-210)<.1);
  assert.ok(Math.abs(doc.internal.pageSize.getHeight()-330)<.1);
  assert.equal(filename,"Checklist-Perawatan-Mesin-2026-08-19.pdf");
});
