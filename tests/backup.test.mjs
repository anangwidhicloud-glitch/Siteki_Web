import test from "node:test";
import assert from "node:assert/strict";
import {
  buildUpsertStatement, prepareDirectMaintenanceRow, prepareDirectWorkReportRow, prepareImportRow,
  workReportInsert,
} from "../worker/handlers/backup.js";

const columns=[
  {name:"id",type:"uuid"},
  {name:"machine_name",type:"text"},
  {name:"notes",type:"text"},
];
const dataset={table:"work_orders",keyColumns:["id"]};

test("baris baru menghapus ID dan nilai kosong agar default database berlaku",()=>{
  const result=prepareImportRow({id:"",machine_name:"  Mesin A  ",notes:""},columns,["id"]);
  assert.equal(result.hasKey,false);
  assert.deepEqual(result.source,{machine_name:"Mesin A"});
});

test("baris lama dengan ID ditandai untuk dilewati",()=>{
  const id="0f6c5163-22a3-4cc8-a49b-dc60996d83aa";
  const result=buildUpsertStatement(dataset,columns,{id,machine_name:"Mesin A",notes:""});
  assert.equal(result.mode,"skip");
  assert.equal(result.statement,"");
});

test("query upsert hanya memakai tabel dan kolom yang sudah diizinkan",()=>{
  const result=buildUpsertStatement(dataset,columns,{id:"",machine_name:"Mesin B","evil;drop table users":"x"});
  assert.match(result.statement,/INSERT INTO "work_orders" \("machine_name"\) VALUES \(\$1\)/);
  assert.match(result.statement,/ON CONFLICT DO NOTHING/);
  assert.doesNotMatch(result.statement,/evil|drop/i);
  assert.deepEqual(result.values,["Mesin B"]);
  assert.equal(result.mode,"insert");
});

test("baris kosong ditolak",()=>{
  assert.throws(()=>prepareImportRow({id:"",notes:""},columns,["id"]),/Baris kosong/);
});

test("baris Rekap Perawatan langsung dinormalisasi",()=>{
  const row=prepareDirectMaintenanceRow({
    inspected_on:"2026-06-29",machine_category:"Mesin",machine_type:"Perakitan",
    machine_name:"Line 01",schedule_code:"m",checks:[{name:"Kebersihan",raw_status:"Bagus"}],
  });
  assert.equal(row.schedule_code,"M");
  assert.equal(row.maintenance_type,"Mingguan");
});

test("baris Laporan Kerja langsung mewajibkan tanggal dan isi pekerjaan",()=>{
  assert.throws(()=>prepareDirectWorkReportRow({report_date:"",machine_name:"Line 01",work_description:"Tes"}),/Tanggal laporan/);
  const row=prepareDirectWorkReportRow({report_date:"2026-06-29",machine_name:"Line 01",work_description:"Tes"});
  assert.equal(row.report_date,"2026-06-29");
});

test("deduplikasi Laporan Kerja mempertimbangkan status order dan seluruh isi",()=>{
  const row=prepareDirectWorkReportRow({
    report_date:"2026-06-29",machine_name:"Line 01",work_description:"Tes",
    order_type:"Order",order_status:"Close",total_hours:1.5,
  });
  const query=workReportInsert(row);
  assert.match(query.statement,/saved\.order_type/);
  assert.match(query.statement,/saved\.order_status/);
  assert.match(query.statement,/saved\.total_hours/);
  assert.equal(query.values[14],"Order");
  assert.equal(query.values[15],"Close");
});
