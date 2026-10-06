import ExcelJS from "exceljs";

async function run() {
  const filePath = "d:\\01. Pribadi\\Website\\05. SiTeki\\Pengecekan.xlsx";
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);

  const worksheet = workbook.worksheets[0];
  const headerRow = worksheet.getRow(1);
  const headers = [];
  headerRow.eachCell((cell, colNumber) => {
    headers[colNumber - 1] = String(cell.value || "").trim();
  });

  console.log("Total Header Columns:", headers.length);
  console.log("First 10 headers:", headers.slice(0, 10));

  const keys = [];
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const kategori = String(row.getCell(1).value || "").trim();
    const jenis = String(row.getCell(2).value || "").trim();
    const namaMesin = String(row.getCell(3).value || "").trim();
    const waktu = String(row.getCell(4).value || "").trim();

    if (!namaMesin) return;
    const key = `${namaMesin}|${waktu}`;
    keys.push({ rowNumber, kategori, jenis, namaMesin, waktu, key });
  });

  console.log("Total machine rows parsed:", keys.length);
  console.log("Sample 15 keys:", keys.slice(0, 15));
}

run().catch(console.error);
