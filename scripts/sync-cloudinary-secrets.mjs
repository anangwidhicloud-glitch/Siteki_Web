import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";

const envFile=path.join(process.cwd(),".env.deploy.local");
const required=["CLOUDINARY_CLOUD_NAME","CLOUDINARY_API_KEY","CLOUDINARY_API_SECRET"];
const optional=["CLOUDINARY_BON_FOLDER"];

function parseEnv(contents) {
  const values={};
  contents.split(/\r?\n/).forEach(line=>{
    const trimmed=line.trim();
    if(!trimmed||trimmed.startsWith("#"))return;
    const separator=trimmed.indexOf("=");
    if(separator<1)return;
    const key=trimmed.slice(0,separator).trim();
    let value=trimmed.slice(separator+1).trim();
    if((value.startsWith('"')&&value.endsWith('"'))||(value.startsWith("'")&&value.endsWith("'")))value=value.slice(1,-1);
    values[key]=value;
  });
  return values;
}

const values=parseEnv(await readFile(envFile,"utf8"));
const missing=required.filter(key=>!values[key]);
if(missing.length) {
  throw new Error(`Isi kredensial berikut di .env.deploy.local: ${missing.join(", ")}`);
}

const wranglerCli=path.join(process.cwd(),"node_modules","wrangler","bin","wrangler.js");
for(const key of [...required,...optional]) {
  if(!values[key])continue;
  process.stdout.write(`Menyinkronkan ${key} ke Cloudflare Worker... `);
  const result=spawnSync(process.execPath,[wranglerCli,"secret","put",key],{
    cwd:process.cwd(),input:`${values[key]}\n`,encoding:"utf8",stdio:["pipe","pipe","pipe"],
  });
  if(result.status!==0) {
    process.stdout.write("gagal.\n");
    throw new Error(result.error?.message||result.stderr?.trim()||result.stdout?.trim()||`Wrangler gagal menyimpan ${key}.`);
  }
  process.stdout.write("selesai.\n");
}

console.log("Kredensial Cloudinary berhasil disinkronkan tanpa menampilkan nilainya.");
