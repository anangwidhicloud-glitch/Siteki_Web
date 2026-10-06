import ExcelJS from "exceljs";
import path from "node:path";
import fs from "node:fs/promises";

async function run() {
  const filePath = "d:\\01. Pribadi\\Website\\05. SiTeki\\Pengecekan.xlsx";
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);

  const worksheet = workbook.worksheets[0];
  console.log(`Worksheet: "${worksheet.name}" (${worksheet.rowCount} rows, ${worksheet.columnCount} cols)`);

  // Find header row containing item names
  let headerRowIdx = -1;
  let headers = [];

  worksheet.eachRow((row, rowNumber) => {
    const vals = row.values.slice(1).map(v => (v == null ? "" : String(v).trim()));
    if (vals.includes("Kategori") || vals.includes("JENIS") || vals.includes("NAMA MESIN")) {
      headerRowIdx = rowNumber;
      headers = vals;
    }
  });

  console.log(`Header row index: ${headerRowIdx}`);
  console.log("First 10 columns:", headers.slice(0, 10));
  console.log("Total column headers:", headers.length);
  console.log("Item column names (col 5 onwards):", headers.slice(4));

  const parsedTemplates = {};

  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber <= headerRowIdx) return;
    const vals = row.values.slice(1).map(v => (v == null ? "" : String(v).trim()));
    const [kategori, jenis, namaMesin, waktu] = vals;
    if (!namaMesin || !waktu) return;

    const code = waktu.toUpperCase().trim() === "B" ? "B" : "M";
    const key = `${namaMesin.toLowerCase().trim()}|${code}`;

    const checkedItems = [];
    for (let colIdx = 4; colIdx < headers.length; colIdx++) {
      const itemName = headers[colIdx];
      const val = (vals[colIdx] || "").toLowerCase().trim();
      if (itemName && val === "v") {
        checkedItems.push(itemName);
      }
    }

    parsedTemplates[key] = checkedItems;
  });

  console.log("\nParsed machines count:", Object.keys(parsedTemplates).length);

  // Sample check for DT39
  console.log("\nSample: Truck Dump DT39 | M items count:", parsedTemplates["truck dump dt39|m"]?.length);
  console.log("Truck Dump DT39 | M items:", parsedTemplates["truck dump dt39|m"]);

  console.log("\nSample: Truck Dump DT39 | B items count:", parsedTemplates["truck dump dt39|b"]?.length);
  console.log("Truck Dump DT39 | B items:", parsedTemplates["truck dump dt39|b"]);

  console.log("\nSample: Mobile Crane A | M items count:", parsedTemplates["mobile crane a|m"]?.length);
  console.log("Mobile Crane A | M items:", parsedTemplates["mobile crane a|m"]);

  console.log("\nSample: Mobile Crane A | B items count:", parsedTemplates["mobile crane a|b"]?.length);
  console.log("Mobile Crane A | B items:", parsedTemplates["mobile crane a|b"]);

  // Save to JSON for inspection / code generation
  await fs.writeFile(
    "src/lib/pengecekan_matrix_templates.json",
    JSON.stringify(parsedTemplates, null, 2)
  );
  console.log("\nSaved matrix templates to src/lib/pengecekan_matrix_templates.json");
}

run().catch(console.error);
