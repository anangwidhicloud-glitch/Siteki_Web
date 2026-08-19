import test from "node:test";
import assert from "node:assert/strict";
import { createBackupWorkbook, createDirectBackupWorkbook, parseBackupWorkbook } from "../src/lib/dataWorkbook.js";
import { parseDirectWorkbook } from "../src/lib/directWorkbook.js";

const manifest={datasets:[{
  key:"machines",label:"Mesin",table:"machines",sheet:"Mesin",keyColumns:["id"],
  columns:[{name:"id",type:"uuid"},{name:"name",type:"text"}],
}]};

test("workbook backup dapat dibaca kembali tanpa mengubah data",async()=>{
  const id="0f6c5163-22a3-4cc8-a49b-dc60996d83aa";
  const buffer=await createBackupWorkbook(manifest,async()=>({rows:[{id,name:"Mesin A"}]}));
  const file={name:"backup.xlsx",size:buffer.byteLength,arrayBuffer:async()=>buffer};
  const result=await parseBackupWorkbook(file,manifest);
  assert.equal(result.totalRows,1);
  assert.deepEqual(result.datasets[0].rows[0],{id,name:"Mesin A"});
});

test("workbook selektif tidak mewajibkan semua sheet manifest",async()=>{
  const selected={datasets:[manifest.datasets[0]]};
  const buffer=await createBackupWorkbook(selected,async()=>({rows:[{id:"",name:"Mesin Baru"}]}));
  const expanded={datasets:[...manifest.datasets,{key:"parts",label:"Part",table:"parts",sheet:"Suku Cadang",keyColumns:["id"],columns:[{name:"id"},{name:"name"}]}]};
  const file={name:"pilihan.xlsx",size:buffer.byteLength,arrayBuffer:async()=>buffer};
  const result=await parseBackupWorkbook(file,expanded);
  assert.equal(result.datasets.length,1);
  assert.equal(result.datasets[0].key,"machines");
});

test("backup perawatan format master dapat langsung dibaca untuk upload",async()=>{
  const created=await createDirectBackupWorkbook("maintenance",{
    items:[
      {machine_category:"Mesin",name:"Kebersihan",sort_order:1},
      {machine_category:"Mesin",name:"Oli Mesin",sort_order:2},
      {machine_category:"Armada",name:"Kebersihan",sort_order:1},
      {machine_category:"Armada",name:"Oli Mesin",sort_order:2},
      {machine_category:"Armada",name:"Ban",sort_order:3},
    ],
    rows:[{inspected_on:"2026-08-18",machine_category:"Armada",machine_type:"Forklift",
      machine_name:"Forklift A",schedule_code:"M",notes:"Normal",
      checks:{"armada|kebersihan":"Bagus","armada|oli mesin":"Bagus","armada|ban":"Perbaikan"}}],
  });
  const parsed=await parseDirectWorkbook({name:created.filename,size:created.buffer.byteLength,arrayBuffer:async()=>created.buffer});
  assert.equal(created.filename,"Rekap Perawatan.xlsx");
  assert.equal(parsed.totalRows,1);
  assert.deepEqual(parsed.datasets[0].rows[0].checks,[
    {name:"Kebersihan",raw_status:"Bagus"},{name:"Oli Mesin",raw_status:"Bagus"},{name:"Ban",raw_status:"Perbaikan"},
  ]);
});

test("backup laporan kerja format master dapat langsung dibaca untuk upload",async()=>{
  const created=await createDirectBackupWorkbook("work_reports",{rows:[{
    report_date:"2026-08-18",department:"Tek. Shift A",machine_category:"Mesin",machine_type:"Perakitan",
    machine_name:"Line 01",job_type:"Perbaikan",work_description:"Ganti bearing",component_type:"Mekanikal",
    started_at:"2026-08-18T08:00:00+07:00",finished_at:"2026-08-18T09:30:00+07:00",total_hours:1.5,
    order_type:"Order",order_status:"Close",repair_rating:"Bagus",notes:"Selesai",
    spare_part_name:"Bearing",spare_part_size:"6204",part_category:"Bearing",is_new_part:true,
  }]});
  const parsed=await parseDirectWorkbook({name:created.filename,size:created.buffer.byteLength,arrayBuffer:async()=>created.buffer});
  const row=parsed.datasets[0].rows[0];
  assert.equal(created.filename,"Laporan Kerja.xlsx");
  assert.equal(row.report_date,"2026-08-18");
  assert.equal(row.started_at,"2026-08-18T08:00:00+07:00");
  assert.equal(row.spare_part_name,"Bearing");
});
