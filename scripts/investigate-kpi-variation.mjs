import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

async function run() {
  const backupPath = path.join(process.cwd(), ".deploy-backups", "maintenance-tables-backup-2026-09-25T18-11-20-046Z.json");
  const backupStr = await readFile(backupPath, "utf8");
  const backupData = JSON.parse(backupStr);

  const inspections = backupData.maintenance_inspections || [];
  const results = backupData.maintenance_check_results || [];

  console.log(`Total Inspections in Backup: ${inspections.length}`);
  console.log(`Total Check Results in Backup: ${results.length}`);

  // Create lookup for inspection results
  const resultsByInspection = {};
  results.forEach(r => {
    if (!resultsByInspection[r.inspection_id]) resultsByInspection[r.inspection_id] = [];
    resultsByInspection[r.inspection_id].push(r);
  });

  // Group inspections by month (YYYY-MM)
  const monthlyData = {};

  inspections.forEach(i => {
    const mKey = new Date(i.inspected_on).toISOString().slice(0, 7);
    if (!monthlyData[mKey]) {
      monthlyData[mKey] = {
        inspections: [],
        machines: new Map(), // machine_name -> { M: 0, B: 0, total: 0 }
        goodChecks: 0,
        repairChecks: 0,
        taChecks: 0,
        totalChecks: 0
      };
    }

    monthlyData[mKey].inspections.push(i);

    // Machine counts
    const mName = String(i.machine_name || "").trim().toLowerCase();
    const code = (i.schedule_code || i.maintenance_type || "").toUpperCase().includes("B") ? "B" : "M";
    if (!monthlyData[mKey].machines.has(mName)) {
      monthlyData[mKey].machines.set(mName, { name: i.machine_name, M: 0, B: 0, total: 0 });
    }
    const mObj = monthlyData[mKey].machines.get(mName);
    mObj[code]++;
    mObj.total++;

    // Check results
    const checkList = resultsByInspection[i.id] || [];
    checkList.forEach(c => {
      monthlyData[mKey].totalChecks++;
      const st = String(c.status || c.raw_status || "").toLowerCase();
      if (st.includes("good") || st.includes("bagus")) monthlyData[mKey].goodChecks++;
      else if (st.includes("repair") || st.includes("perbaikan")) monthlyData[mKey].repairChecks++;
      else monthlyData[mKey].taChecks++;
    });
  });

  console.log("\n============================================================");
  console.log("ANALISIS VARIASI DATA PERAWATAN BULANAN (BACKUP MASTER DATA)");
  console.log("============================================================");

  for (const [month, data] of Object.entries(monthlyData)) {
    console.log(`\n--- BULAN: ${month} ---`);
    console.log(`Total Inspections (Aktual): ${data.inspections.length}`);
    console.log(`Jumlah Mesin Unik Dikerjakan: ${data.machines.size} mesin`);

    // Machines with full 4x (3M + 1B)
    let full4xCount = 0;
    let incompleteMachines = [];

    for (const [mKey, mObj] of data.machines.entries()) {
      if (mObj.M >= 3 && mObj.B >= 1) {
        full4xCount++;
      } else {
        incompleteMachines.push(mObj);
      }
    }

    console.log(`Mesin dengan Perawatan Lengkap (>=3M + >=1B): ${full4xCount} dari ${data.machines.size} mesin`);
    if (incompleteMachines.length > 0 && incompleteMachines.length <= 10) {
      console.log("Contoh Mesin Tidak Lengkap (<4x):", incompleteMachines.map(x => `${x.name} (${x.M}M, ${x.B}B)`).join(", "));
    } else if (incompleteMachines.length > 10) {
      console.log(`Ada ${incompleteMachines.length} mesin yang perawatannya < 4x (3M+1B). Contoh:`, incompleteMachines.slice(0, 5).map(x => `${x.name} (${x.M}M, ${x.B}B)`).join(", "));
    }

    // Check items stats
    console.log(`Total Point Checklist: ${data.totalChecks}`);
    console.log(`- Bagus: ${data.goodChecks} (${((data.goodChecks/data.totalChecks)*100).toFixed(1)}%)`);
    console.log(`- Perbaikan: ${data.repairChecks} (${((data.repairChecks/data.totalChecks)*100).toFixed(1)}%)`);
    console.log(`- T.A / x: ${data.taChecks} (${((data.taChecks/data.totalChecks)*100).toFixed(1)}%)`);

    // Various possible formulas
    const totalMachinesMaster = 67; // or 68
    const targetInspectionsPerMonth = totalMachinesMaster * 4; // 268
    const ratioByTarget268 = (data.inspections.length / targetInspectionsPerMonth) * 100;
    const ratioGoodChecks = data.totalChecks > 0 ? (data.goodChecks / (data.goodChecks + data.repairChecks)) * 100 : 0;
    const ratioCompletedMachines = (full4xCount / totalMachinesMaster) * 100;

    console.log(`Rasio 1 (Aktual Inspeksi / ${targetInspectionsPerMonth}): ${ratioByTarget268.toFixed(1)}%`);
    console.log(`Rasio 2 (Kondisi Bagus / Bagus+Perbaikan): ${ratioGoodChecks.toFixed(1)}%`);
    console.log(`Rasio 3 (Mesin Selesai Lengkap 4x / ${totalMachinesMaster}): ${ratioCompletedMachines.toFixed(1)}%`);
  }
}

run().catch(console.error);
