import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import pg from "pg";

async function loadEnvironment() {
  const values={};
  for(const file of [".env", ".env.deploy.local"]){
    try{
      const contents=await readFile(file,"utf8");
      for(const line of contents.split(/\r?\n/)){
        const match=line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
        if(match)values[match[1]]=match[2].replace(/^(['"])(.*)\1$/,"$2");
      }
    }catch(error){if(error?.code!=="ENOENT")throw error;}
  }
  if(!values.DATABASE_URL)throw new Error("DATABASE_URL tidak ditemukan.");
  return values;
}

async function removeCloudinaryPhoto(env,publicId){
  if(!publicId||!env.CLOUDINARY_CLOUD_NAME||!env.CLOUDINARY_API_KEY||!env.CLOUDINARY_API_SECRET)return false;
  const timestamp=Math.floor(Date.now()/1000);
  const signature=createHash("sha1").update(`public_id=${publicId}&timestamp=${timestamp}${env.CLOUDINARY_API_SECRET}`).digest("hex");
  const form=new FormData();
  form.append("public_id",publicId);form.append("api_key",env.CLOUDINARY_API_KEY);
  form.append("timestamp",String(timestamp));form.append("signature",signature);
  const response=await fetch(`https://api.cloudinary.com/v1_1/${encodeURIComponent(env.CLOUDINARY_CLOUD_NAME)}/image/destroy`,{method:"POST",body:form});
  return response.ok;
}

const env=await loadEnvironment();
const client=new pg.Client({connectionString:env.DATABASE_URL,ssl:{rejectUnauthorized:false}});
await client.connect();
try{
  const summary=await client.query(`
    SELECT
      (SELECT count(*)::integer FROM part_request_transactions) AS transactions,
      (SELECT count(*)::integer FROM part_requests) AS items,
      (SELECT count(*)::integer FROM stock_movements) AS movements,
      (SELECT count(*)::integer FROM inventory_balances WHERE coalesce(incoming_quantity,0)<>0 OR coalesce(outgoing_quantity,0)<>0 OR coalesce(current_quantity,0)<>0) AS nonzero_balances,
      ((SELECT count(*)::integer FROM part_request_transactions WHERE photo_public_id IS NOT NULL AND btrim(photo_public_id)<>'')+
       (SELECT count(*)::integer FROM part_requests WHERE sample_photo_public_id IS NOT NULL AND btrim(sample_photo_public_id)<>'')) AS photos
  `);
  const counts=summary.rows[0];
  console.log(`Transaksi Bon Pesan: ${counts.transactions}`);
  console.log(`Item Bon Pesan: ${counts.items}`);
  console.log(`Riwayat stok/pemakaian: ${counts.movements}`);
  console.log(`Saldo stok tidak nol: ${counts.nonzero_balances}`);
  console.log(`Foto Cloudinary terkait: ${counts.photos}`);
  if(!process.argv.includes("--confirm")){
    console.log("Mode pemeriksaan saja; tidak ada data yang dihapus.");
  }else{
    const photos=await client.query(`
      SELECT photo_public_id AS public_id FROM part_request_transactions WHERE photo_public_id IS NOT NULL AND btrim(photo_public_id)<>''
      UNION ALL
      SELECT sample_photo_public_id AS public_id FROM part_requests WHERE sample_photo_public_id IS NOT NULL AND btrim(sample_photo_public_id)<>''
    `);
    await client.query("BEGIN");
    try{
      await client.query("DELETE FROM stock_movements");
      await client.query("DELETE FROM part_requests");
      await client.query("DELETE FROM part_request_transactions");
      await client.query("UPDATE inventory_balances SET incoming_quantity=0,outgoing_quantity=0,current_quantity=0");
      await client.query("COMMIT");
    }catch(error){await client.query("ROLLBACK");throw error;}
    let removedPhotos=0;
    for(const row of photos.rows)if(await removeCloudinaryPhoto(env,row.public_id).catch(()=>false))removedPhotos+=1;
    const after=await client.query(`SELECT
      (SELECT count(*)::integer FROM part_request_transactions) AS transactions,
      (SELECT count(*)::integer FROM part_requests) AS items,
      (SELECT count(*)::integer FROM stock_movements) AS movements,
      (SELECT count(*)::integer FROM inventory_balances WHERE coalesce(incoming_quantity,0)<>0 OR coalesce(outgoing_quantity,0)<>0 OR coalesce(current_quantity,0)<>0) AS nonzero_balances`);
    console.log(`Transaksi tersisa: ${after.rows[0].transactions}`);
    console.log(`Item tersisa: ${after.rows[0].items}`);
    console.log(`Riwayat stok/pemakaian tersisa: ${after.rows[0].movements}`);
    console.log(`Saldo stok tidak nol tersisa: ${after.rows[0].nonzero_balances}`);
    console.log(`Foto Cloudinary dibersihkan: ${removedPhotos}/${photos.rowCount}`);
  }
}finally{await client.end();}
