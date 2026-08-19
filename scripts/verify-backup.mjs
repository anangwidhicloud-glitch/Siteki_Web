import { readFile } from "node:fs/promises";
import { neon } from "@neondatabase/serverless";
import { DATASETS } from "../worker/handlers/backup.js";

const env=Object.fromEntries((await readFile(new URL("../.env",import.meta.url),"utf8"))
  .split(/\r?\n/).filter(line=>line&&!line.trim().startsWith("#")&&line.includes("="))
  .map(line=>{
    const split=line.indexOf("=");
    const value=line.slice(split+1).trim().replace(/^(['"])(.*)\1$/,"$2");
    return [line.slice(0,split).trim(),value];
  }));
if(!env.DATABASE_URL)throw new Error("DATABASE_URL tidak ditemukan.");
const sql=neon(env.DATABASE_URL);
const tables=DATASETS.map(dataset=>dataset.table);
const columns=await sql.query(
  `SELECT table_name,column_name FROM information_schema.columns
    WHERE table_schema='public' AND table_name=ANY($1::text[])`,[tables]
);
const byTable=new Map();
for(const row of columns){
  if(!byTable.has(row.table_name))byTable.set(row.table_name,new Set());
  byTable.get(row.table_name).add(row.column_name);
}
for(const dataset of DATASETS){
  const available=byTable.get(dataset.table);
  if(!available)throw new Error(`Tabel ${dataset.table} tidak ditemukan.`);
  for(const key of dataset.keyColumns)if(!available.has(key))throw new Error(`Kunci ${dataset.table}.${key} tidak ditemukan.`);
}
const duplicateSheets=DATASETS.filter((dataset,index)=>DATASETS.findIndex(item=>item.sheet===dataset.sheet)!==index);
if(duplicateSheets.length)throw new Error(`Nama sheet duplikat: ${duplicateSheets.map(item=>item.sheet).join(", ")}`);
console.log(`Backup siap: ${DATASETS.length} kelompok data, seluruh tabel dan kunci cocok dengan NeonDB.`);
