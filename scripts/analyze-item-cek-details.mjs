import ExcelJS from "exceljs";
import path from "node:path";

async function run() {
  const filePath = path.resolve("..", "Item cek.xlsx");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const worksheet = workbook.getWorksheet("Cek") || workbook.worksheets[0];

  const categories = new Set();
  const jenisList = new Set();
  const machineList = new Set();
  const itemsByJenis = {};
  const itemsByMachine = {};
  const waktuCounts = { M: 0, B: 0, others: 0 };

  let totalDataRows = 0;

  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1 || rowNumber === 2) return; // headers
    const vals = row.values.slice(1).map(v => (v == null ? "" : String(v).trim()));
    const [kategori, jenis, namaMesin, waktu, item] = vals;
    if (!item) return;

    totalDataRows++;
    if (kategori) categories.add(kategori);
    if (jenis) jenisList.add(jenis);
    if (namaMesin) machineList.add(namaMesin);

    const w = (waktu || "").toUpperCase();
    if (w === "M") waktuCounts.M++;
    else if (w === "B") waktuCounts.B++;
    else waktuCounts.others++;

    // by jenis
    if (jenis) {
      if (!itemsByJenis[jenis]) itemsByJenis[jenis] = { M: new Set(), B: new Set(), machines: new Set() };
      if (namaMesin) itemsByJenis[jenis].machines.add(namaMesin);
      if (w === "M") itemsByJenis[jenis].M.add(item);
      else if (w === "B") itemsByJenis[jenis].B.add(item);
    }

    // by machine
    if (namaMesin) {
      if (!itemsByMachine[namaMesin]) itemsByMachine[namaMesin] = { jenis, kategori, M: [], B: [] };
      if (w === "M") itemsByMachine[namaMesin].M.push(item);
      else if (w === "B") itemsByMachine[namaMesin].B.push(item);
    }
  });

  console.log("=== RINGKASAN FILE ITEM CEK.XLSX ===");
  console.log("Total baris data checklist:", totalDataRows);
  console.log("Kategori:", Array.from(categories));
  console.log("Total Jenis Alat/Mesin:", jenisList.size);
  console.log("Daftar Jenis:", Array.from(jenisList));
  console.log("Total Mesin/Armada Unik:", machineList.size);
  console.log("Distribusi Waktu:", waktuCounts);

  console.log("\n=== PERBANDINGAN KHUSUS: Mobile Crane VS Dump ===");
  const craneM = Array.from(itemsByJenis["Mobile Crane"].M);
  const craneB = Array.from(itemsByJenis["Mobile Crane"].B);
  const dumpM = Array.from(itemsByJenis["Dump"].M);
  const dumpB = Array.from(itemsByJenis["Dump"].B);

  console.log("Item Mingguan (M) ada di Mobile Crane tapi TIDAK ADA di Dump:");
  console.log(craneM.filter(x => !dumpM.includes(x)));

  console.log("Item Bulanan (B) ada di Mobile Crane tapi TIDAK ADA di Dump:");
  console.log(craneB.filter(x => !dumpB.includes(x)));
}

run().catch(console.error);
