import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { parse } from "csv-parse/sync";
import pg from "pg";

const { Client }=pg;
const SPREADSHEET_ID="1nbmqEBQWJMy-1CYSGtIiTHDXgbXR485xe1Np-THWR9U";
const apply=process.argv.includes("--apply");

function value(input) { return String(input??"").trim(); }
function identity(category,name,size) {
  return [category,name,size].map(item=>value(item).replace(/\s+/g," ").toLocaleLowerCase("id-ID")).join("|");
}
function databaseUrl(contents) {
  const line=contents.split(/\r?\n/).find(entry=>/^\s*DATABASE_URL\s*=/.test(entry));
  if(!line)throw new Error("DATABASE_URL tidak ditemukan dalam .env.");
  return line.replace(/^\s*DATABASE_URL\s*=\s*/,"").trim().replace(/^(['"])(.*)\1$/,"$2");
}

const url=new URL(`https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq`);
url.searchParams.set("tqx","out:csv");url.searchParams.set("sheet","Part");
const response=await fetch(url);
if(!response.ok)throw new Error(`Sheet Part gagal dibaca (HTTP ${response.status}).`);
const sheetRows=parse(await response.text(),{columns:true,bom:true,relax_column_count:true,skip_empty_lines:true,trim:true})
  .filter(row=>value(row.Nama));
if(!sheetRows.length||!Object.hasOwn(sheetRows[0],"Satuan"))throw new Error("Kolom Satuan tidak ditemukan pada sheet Part.");

const sheetUnits=new Map();
const conflicts=[];
for(const row of sheetRows) {
  const key=identity(row.Kategori,row.Nama,row.Ukuran),unit=value(row.Satuan);
  if(!unit)continue;
  if(sheetUnits.has(key)&&sheetUnits.get(key)!==unit)conflicts.push({key,left:sheetUnits.get(key),right:unit});
  else sheetUnits.set(key,unit);
}
if(conflicts.length)throw new Error(`${conflicts.length} identitas part memiliki satuan berbeda pada sheet Part.`);

const env=await readFile(path.join(process.cwd(),".env"),"utf8");
const client=new Client({connectionString:databaseUrl(env)});
try {
  await client.connect();
  const databaseRows=(await client.query(`SELECT id,category,name,size,unit FROM parts ORDER BY category,name,size`)).rows;
  const matched=[],unmatched=[];
  for(const row of databaseRows) {
    const unit=sheetUnits.get(identity(row.category,row.name,row.size));
    if(unit)matched.push({...row,sheetUnit:unit});
    else unmatched.push(row);
  }
  const changed=matched.filter(row=>value(row.unit)!==row.sheetUnit);
  console.log(`Sheet Part: ${sheetRows.length} baris, ${sheetUnits.size} identitas dengan satuan.`);
  console.log(`Neon: ${databaseRows.length} master part; cocok ${matched.length}; perlu diperbarui ${changed.length}; tidak cocok ${unmatched.length}.`);
  if(unmatched.length)console.log("Tidak cocok:",unmatched.slice(0,20).map(row=>`${row.category} | ${row.name} | ${row.size}`).join("\n"));
  if(!apply) {
    console.log("Dry-run selesai. Jalankan dengan --apply untuk menyimpan perubahan.");
    process.exitCode=changed.length||unmatched.length?2:0;
  } else {
    await client.query("BEGIN");
    try {
      for(const row of matched) {
        await client.query(`UPDATE parts SET unit=$1 WHERE id=$2 AND unit IS DISTINCT FROM $1`,[row.sheetUnit,row.id]);
        await client.query(`
          UPDATE inventory_balances SET unit=$1
          WHERE (part_id=$2 OR (
            part_id IS NULL AND lower(coalesce(category,''))=lower($3)
            AND lower(coalesce(part_name,''))=lower($4)
            AND lower(coalesce(part_size,''))=lower($5)
          )) AND unit IS DISTINCT FROM $1
        `,[row.sheetUnit,row.id,row.category||"",row.name||"",row.size||""]);
      }
      await client.query("COMMIT");
      console.log(`Sinkronisasi selesai: ${matched.length} master diperiksa dan ${changed.length} satuan master diperbarui.`);
    } catch(error) {
      await client.query("ROLLBACK");throw error;
    }
  }
} finally { await client.end().catch(()=>{}); }
