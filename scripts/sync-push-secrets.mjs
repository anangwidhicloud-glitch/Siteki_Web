import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";

const envFile=path.join(process.cwd(),".env.deploy.local"),required=["VAPID_PUBLIC_KEY","VAPID_PRIVATE_KEY","VAPID_SUBJECT"];
const values={};
(await readFile(envFile,"utf8")).split(/\r?\n/).forEach(line=>{
  const trimmed=line.trim();if(!trimmed||trimmed.startsWith("#"))return;
  const separator=trimmed.indexOf("=");if(separator<1)return;
  let value=trimmed.slice(separator+1).trim();if((value.startsWith('"')&&value.endsWith('"'))||(value.startsWith("'")&&value.endsWith("'")))value=value.slice(1,-1);
  values[trimmed.slice(0,separator).trim()]=value;
});
const missing=required.filter(key=>!values[key]);if(missing.length)throw new Error(`Kredensial Web Push belum tersedia: ${missing.join(", ")}`);
const wranglerCli=path.join(process.cwd(),"node_modules","wrangler","bin","wrangler.js");
for(const key of required){
  process.stdout.write(`Menyinkronkan ${key} ke Cloudflare Worker... `);
  const result=spawnSync(process.execPath,[wranglerCli,"secret","put",key],{cwd:process.cwd(),input:`${values[key]}\n`,encoding:"utf8",stdio:["pipe","pipe","pipe"]});
  if(result.status!==0){process.stdout.write("gagal.\n");throw new Error(result.error?.message||result.stderr?.trim()||result.stdout?.trim()||`Wrangler gagal menyimpan ${key}.`);}
  process.stdout.write("selesai.\n");
}
console.log("Kredensial Web Push berhasil disinkronkan tanpa menampilkan nilainya.");
