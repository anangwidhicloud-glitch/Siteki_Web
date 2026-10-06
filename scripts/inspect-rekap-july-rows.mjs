import { readFile } from "node:fs/promises";
import path from "node:path";

async function run() {
  const backupPath = path.join(process.cwd(), ".deploy-backups", "maintenance-tables-backup-2026-09-25T18-11-20-046Z.json");
  const backupStr = await readFile(backupPath, "utf8");
  const backupData = JSON.parse(backupStr);

  const inspections = backupData.maintenance_inspections || [];

  // Filter July inspections (month 7)
  const julyInspections = inspections.filter(i => {
    const dt = new Date(i.inspected_on);
    // use UTC month/year or local
    return dt.getUTCFullYear() === 2026 && dt.getUTCMonth() === 6; // 0-indexed: 6 is July
  });

  console.log(`Total July Inspections in Backup: ${julyInspections.length}`);

  // Group by machine_name
  const machineMap = {};
  julyInspections.forEach(i => {
    const norm = String(i.machine_name || "").trim().toLowerCase();
    if (!machineMap[norm]) machineMap[norm] = { name: i.machine_name, count: 0, items: [] };
    machineMap[norm].count++;
    machineMap[norm].items.push(i);
  });

  console.log("\n=== MESIN DENGAN PEMERIKSAAN < 4 KALI DI JULI 2026 (DATABASE LAMA) ===");
  for (const [key, data] of Object.entries(machineMap)) {
    if (data.count < 4) {
      console.log(`\n• Nama Mesin: "${data.name}" -> Hanya terisi ${data.count} kali (Harusnya 4 kali)`);
      data.items.forEach((item, idx) => {
        const dStr = new Date(item.inspected_on).toISOString().slice(0, 10);
        console.log(`   #${idx + 1}: Tanggal ${dStr} (${item.schedule_code || item.maintenance_type})`);
      });
    }
  }
}

run().catch(console.error);
