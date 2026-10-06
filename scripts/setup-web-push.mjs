import { readFile,writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import webpush from "web-push";

const envFile=path.join(process.cwd(),".env.deploy.local");
const contents=await readFile(envFile,"utf8");
const values={};
contents.split(/\r?\n/).forEach(line=>{
  const match=line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if(!match)return;
  values[match[1]]=match[2].trim().replace(/^(['"])(.*)\1$/,"$2");
});
const keys=values.VAPID_PUBLIC_KEY&&values.VAPID_PRIVATE_KEY
  ?{publicKey:values.VAPID_PUBLIC_KEY,privateKey:values.VAPID_PRIVATE_KEY}
  :webpush.generateVAPIDKeys();
const additions={
  VAPID_PUBLIC_KEY:keys.publicKey,
  VAPID_PRIVATE_KEY:keys.privateKey,
  VAPID_SUBJECT:values.VAPID_SUBJECT||"mailto:admin@siteki.xo.je",
};
let output=contents;
for(const [key,value] of Object.entries(additions)){
  const pattern=new RegExp(`^\\s*${key}\\s*=.*$`,`m`);
  if(pattern.test(output))output=output.replace(pattern,`${key}=${value}`);
  else output+=`${output.endsWith("\n")?"":"\n"}${key}=${value}\n`;
}
await writeFile(envFile,output,"utf8");
console.log("Kunci Web Push tersedia di .env.deploy.local tanpa menampilkan nilai privat.");
