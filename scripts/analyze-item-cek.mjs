import ExcelJS from "exceljs";
import path from "node:path";

async function run() {
  const filePath = path.resolve("..", "Item cek.xlsx");
  console.log("Loading file via ExcelJS:", filePath);

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);

  console.log("Total worksheets:", workbook.worksheets.length);
  const sheetNames = workbook.worksheets.map(ws => ws.name);
  console.log("Worksheet names:", sheetNames);

  for (const worksheet of workbook.worksheets) {
    console.log(`\n========================================`);
    console.log(`WORKSHEET: "${worksheet.name}" (Row count: ${worksheet.rowCount}, Col count: ${worksheet.columnCount})`);
    console.log(`========================================`);
    
    // Print first 20 rows
    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber <= 25) {
        const values = row.values.slice(1).map(v => {
          if (v && typeof v === "object" && v.text) return v.text;
          if (v && typeof v === "object" && v.result) return v.result;
          return v;
        });
        // filter out nulls/undefined for display
        const display = values.map(v => v === null || v === undefined ? "" : String(v).trim());
        if (display.some(d => d !== "")) {
          console.log(`Row ${rowNumber}:`, JSON.stringify(display));
        }
      }
    });
  }
}

run().catch(console.error);
