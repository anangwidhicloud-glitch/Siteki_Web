import { readFile } from "node:fs/promises";
import pg from "pg";

async function databaseUrl() {
  for (const file of [".env.deploy.local", ".env"]) {
    try {
      const contents=await readFile(file,"utf8");
      const line=contents.split(/\r?\n/).find(value=>/^\s*DATABASE_URL\s*=/.test(value));
      if(line)return line.replace(/^\s*DATABASE_URL\s*=\s*/,"").trim().replace(/^(['"])(.*)\1$/,"$2");
    } catch(error) {
      if(error?.code!=="ENOENT")throw error;
    }
  }
  throw new Error("DATABASE_URL tidak ditemukan di .env.deploy.local atau .env.");
}

const client=new pg.Client({connectionString:await databaseUrl(),ssl:{rejectUnauthorized:false}});
await client.connect();
try {
  const before=await client.query(`
    SELECT count(*)::integer AS legacy_count
    FROM part_requests
    WHERE transaction_id IS NULL
  `);
  const count=before.rows[0].legacy_count;
  console.log(`Bon Pesan legacy ditemukan: ${count}`);
  if(!process.argv.includes("--confirm")) {
    console.log("Mode pemeriksaan saja; tidak ada data yang dihapus.");
    process.exitCode=count?2:0;
  } else {
    const removed=await client.query(`
      DELETE FROM part_requests
      WHERE transaction_id IS NULL
      RETURNING id
    `);
    const after=await client.query(`SELECT count(*)::integer AS remaining FROM part_requests WHERE transaction_id IS NULL`);
    console.log(`Bon Pesan legacy dihapus: ${removed.rowCount}`);
    console.log(`Bon Pesan legacy tersisa: ${after.rows[0].remaining}`);
  }
} finally {
  await client.end();
}
