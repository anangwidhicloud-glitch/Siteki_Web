import { spawn } from "node:child_process";
import process from "node:process";

const scripts = [
  "verify-master-data.mjs",
  "verify-inventory.mjs",
  "verify-work-orders.mjs",
  "verify-report-kpi.mjs",
  "verify-maintenance-kpi.mjs",
  "verify-overtime.mjs",
  "verify-electricity.mjs",
  "verify-stang.mjs",
  "verify-transformers.mjs",
  "verify-oil-monitoring.mjs",
];

function run(script) {
  return new Promise((resolve, reject) => {
    console.log(`\n### ${script}`);
    const child = spawn(process.execPath, [`scripts/${script}`], {
      cwd: process.cwd(),
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${script} gagal (${signal || `exit ${code}`}).`));
    });
  });
}

for (const script of scripts) await run(script);
console.log("\nSeluruh verifikasi migrasi Spreadsheet ke Neon berhasil.");
