import ExcelJS from "exceljs";

const MAX_FILE_BYTES=15*1024*1024;
const MAX_TOTAL_ROWS=50000;

function safeCellValue(value,sheet,row,column){
  if(value===null||value===undefined)return null;
  if(value instanceof Date)return value.toISOString();
  if(typeof value==="string"||typeof value==="number"||typeof value==="boolean")return value;
  if(typeof value==="object"){
    if(Object.prototype.hasOwnProperty.call(value,"formula")||Object.prototype.hasOwnProperty.call(value,"sharedFormula")){
      throw new Error(`Formula tidak diizinkan (${sheet}, baris ${row}, kolom ${column}).`);
    }
    if(Array.isArray(value.richText))return value.richText.map(part=>part.text||"").join("");
    if(value.hyperlink)return String(value.text||value.hyperlink);
    if(Object.prototype.hasOwnProperty.call(value,"result"))return safeCellValue(value.result,sheet,row,column);
  }
  throw new Error(`Format sel tidak didukung (${sheet}, baris ${row}, kolom ${column}).`);
}

function styleHeader(row){
  row.height=24;
  row.font={bold:true,color:{argb:"FFFFFFFF"}};
  row.fill={type:"pattern",pattern:"solid",fgColor:{argb:"FF087F5B"}};
  row.alignment={vertical:"middle"};
}

const WORK_REPORT_HEADERS=[
  ["Tanggal","report_date"],["Bagian","department"],["Kategori Mesin","machine_category"],
  ["Jenis","machine_type"],["Nama Mesin","machine_name"],["Jenis Pekerjaan","job_type"],
  ["Laporan Pekerjaan","work_description"],["Jenis Komponen","component_type"],
  ["Jam Mulai","started_at"],["Jam Selesai","finished_at"],["Total Jam","total_hours"],
  ["Definisi","definition"],["Spare Part","legacy_part_name"],
  ["Ukuran Spare Part","legacy_part_size"],["Order","order_type"],
  ["Status Order","order_status"],["Nilai Perbaikan","repair_rating"],["Keterangan","notes"],
  ["Ukuran Part","legacy_size"],["Is New Machine","is_new_machine"],
  ["Is New Part","is_new_part"],["Part Kategori","part_category"],
  ["Part Nama","part_name"],["Part Ukuran","part_size"],
];

function dateCell(value){
  if(value instanceof Date&&!Number.isNaN(value.getTime())){
    return new Date(Date.UTC(value.getUTCFullYear(),value.getUTCMonth(),value.getUTCDate()));
  }
  const match=String(value??"").match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match?new Date(Date.UTC(Number(match[1]),Number(match[2])-1,Number(match[3]))):null;
}

function dateTimeCell(value){
  if(value instanceof Date&&!Number.isNaN(value.getTime())){
    return new Date(Date.UTC(value.getUTCFullYear(),value.getUTCMonth(),value.getUTCDate(),
      value.getUTCHours(),value.getUTCMinutes(),value.getUTCSeconds()));
  }
  const match=String(value??"").match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/);
  return match?new Date(Date.UTC(Number(match[1]),Number(match[2])-1,Number(match[3]),Number(match[4]),Number(match[5]),Number(match[6]||0))):null;
}

function formatOperationalSheet(sheet,dateColumns=[],dateTimeColumns=[]){
  sheet.views=[{state:"frozen",xSplit:Math.min(5,sheet.columnCount),ySplit:1}];
  styleHeader(sheet.getRow(1));
  sheet.autoFilter={from:{row:1,column:1},to:{row:Math.max(1,sheet.rowCount),column:sheet.columnCount}};
  for(let column=1;column<=sheet.columnCount;column+=1){
    const header=String(sheet.getRow(1).getCell(column).value||"");
    sheet.getColumn(column).width=column<=5?Math.max(13,Math.min(28,header.length+3)):Math.max(12,Math.min(24,header.length+2));
  }
  dateColumns.forEach(column=>{sheet.getColumn(column).numFmt="dd/mm/yyyy";});
  dateTimeColumns.forEach(column=>{sheet.getColumn(column).numFmt="dd/mm/yyyy hh:mm";});
}

export async function createDirectBackupWorkbook(documentType,payload){
  const workbook=new ExcelJS.Workbook();
  workbook.creator="SiTeki";
  workbook.created=new Date();
  if(documentType==="maintenance"){
    const sheet=workbook.addWorksheet("det_rawat");
    const items=Array.isArray(payload?.items)?payload.items:[];
    const machineItems=items.filter(item=>String(item.machine_category).toLocaleLowerCase("id-ID")==="mesin");
    const machineNames=new Set(machineItems.map(item=>String(item.name).toLocaleLowerCase("id-ID")));
    const armadaItems=items.filter(item=>String(item.machine_category).toLocaleLowerCase("id-ID")==="armada"&&
      (String(item.name).toLocaleLowerCase("id-ID")!=="kebersihan"||!machineNames.has("kebersihan")));
    const checks=[...machineItems.map(item=>({...item,shared:String(item.name).toLocaleLowerCase("id-ID")==="kebersihan"})),...armadaItems];
    sheet.addRow(["Tanggal","Kategori","Jenis","Nama Mesin","Waktu",...checks.map(item=>item.name),"Keterangan"]);
    for(const row of payload?.rows||[]){
      const category=String(row.machine_category||"");
      const normalizedCategory=category.toLocaleLowerCase("id-ID");
      const values=checks.map(item=>{
        const itemCategory=String(item.machine_category||"").toLocaleLowerCase("id-ID");
        if(!item.shared&&itemCategory!==normalizedCategory)return null;
        const key=`${normalizedCategory}|${String(item.name).toLocaleLowerCase("id-ID")}`;
        return row.checks?.[key]??null;
      });
      sheet.addRow([dateCell(row.inspected_on),category,row.machine_type||null,row.machine_name||null,
        row.schedule_code||null,...values,row.notes||null]);
    }
    formatOperationalSheet(sheet,[1]);
    return {buffer:await workbook.xlsx.writeBuffer(),filename:"Rekap Perawatan.xlsx"};
  }
  if(documentType==="work_reports"){
    const sheet=workbook.addWorksheet("lap_kerja");
    sheet.addRow(WORK_REPORT_HEADERS.map(([header])=>header));
    for(const row of payload?.rows||[]){
      const modernPart=Boolean(row.part_category||row.is_new_part);
      const mapped={...row,
        report_date:dateCell(row.report_date),started_at:dateTimeCell(row.started_at),finished_at:dateTimeCell(row.finished_at),
        is_new_machine:row.is_new_machine?true:null,is_new_part:row.is_new_part?true:null,
        legacy_part_name:modernPart?null:row.spare_part_name,legacy_part_size:modernPart?null:row.spare_part_size,
        legacy_size:null,part_name:modernPart?row.spare_part_name:null,part_size:modernPart?row.spare_part_size:null,
      };
      sheet.addRow(WORK_REPORT_HEADERS.map(([,key])=>mapped[key]??null));
    }
    formatOperationalSheet(sheet,[1],[9,10]);
    sheet.getColumn(7).width=42;
    sheet.getColumn(18).width=30;
    return {buffer:await workbook.xlsx.writeBuffer(),filename:"Laporan Kerja.xlsx"};
  }
  throw new Error("Jenis backup format master tidak dikenal.");
}

export async function createBackupWorkbook(manifest,loadDataset,onProgress=()=>{}){
  const workbook=new ExcelJS.Workbook();
  workbook.creator="SiTeki";
  workbook.created=new Date();
  const guide=workbook.addWorksheet("PETUNJUK");
  guide.columns=[{width:24},{width:105}];
  guide.addRows([
    ["BACKUP DATA SITEKI","Workbook ini dapat diunggah kembali melalui Pengaturan > Backup & Impor Data."],
    ["Cara menambah data","Tambahkan baris baru di bawah data terakhir. Biarkan kolom ID kosong agar database membuat ID baru."],
    ["Data lama","Baris yang memiliki ID dianggap data lama dan otomatis dilewati saat upload. Database tidak akan menimpa data lama."],
    ["Penting","Jangan mengganti nama sheet atau judul kolom. Jangan memakai formula. Data duplikat akan dilewati dan data yang tidak ada dalam workbook tidak akan dihapus."],
    ["Referensi ID","Kolom berakhiran _id mengacu ke ID pada sheet master terkait, misalnya machine_id ke sheet Mesin."],
    ["Keamanan","Hash kata sandi dan sesi login tidak disertakan dalam workbook."],
  ]);
  styleHeader(guide.getRow(1));
  guide.getColumn(1).font={bold:true};
  guide.eachRow(row=>{row.alignment={vertical:"top",wrapText:true};});

  const meta=workbook.addWorksheet("_META");
  meta.state="veryHidden";
  meta.addRow(["format","siteki-backup-v1"]);
  meta.addRow(["exported_at",new Date().toISOString()]);
  meta.addRow(["dataset","sheet","table"]);

  for(let index=0;index<manifest.datasets.length;index+=1){
    const definition=manifest.datasets[index];
    onProgress({current:index+1,total:manifest.datasets.length,label:definition.label});
    const result=await loadDataset(definition.key);
    const columns=definition.columns.map(column=>column.name);
    const sheet=workbook.addWorksheet(definition.sheet);
    sheet.views=[{state:"frozen",ySplit:1}];
    sheet.addRow(columns);
    styleHeader(sheet.getRow(1));
    for(const source of result.rows||[])sheet.addRow(columns.map(column=>source[column]??null));
    columns.forEach((column,columnIndex)=>{
      let width=Math.max(12,column.length+2);
      sheet.getColumn(columnIndex+1).eachCell({includeEmpty:false},cell=>{
        width=Math.min(32,Math.max(width,String(cell.value??"").length+2));
      });
      sheet.getColumn(columnIndex+1).width=width;
    });
    sheet.autoFilter={from:{row:1,column:1},to:{row:Math.max(1,sheet.rowCount),column:Math.max(1,columns.length)}};
    meta.addRow([definition.key,definition.sheet,definition.table]);
  }
  return workbook.xlsx.writeBuffer();
}

export async function parseBackupWorkbook(file,manifest){
  if(!file)throw new Error("Pilih file Excel terlebih dahulu.");
  if(file.size>MAX_FILE_BYTES)throw new Error("Ukuran workbook maksimal 15 MB.");
  const workbook=new ExcelJS.Workbook();
  await workbook.xlsx.load(await file.arrayBuffer());
  const format=workbook.getWorksheet("_META")?.getCell("B1")?.value;
  if(format!=="siteki-backup-v1")throw new Error("File bukan workbook backup SiTeki versi yang didukung.");
  const datasets=[];
  let totalRows=0;
  for(const definition of manifest.datasets){
    const sheet=workbook.getWorksheet(definition.sheet);
    if(!sheet)continue;
    const allowed=new Set(definition.columns.map(column=>column.name));
    const headers=[];
    sheet.getRow(1).eachCell({includeEmpty:false},(cell,column)=>{
      const header=String(cell.value||"").trim();
      if(!header)return;
      if(!allowed.has(header))throw new Error(`Kolom ${header} pada sheet ${definition.sheet} tidak dikenal.`);
      if(headers.some(item=>item.name===header))throw new Error(`Kolom ${header} pada sheet ${definition.sheet} duplikat.`);
      headers.push({name:header,column});
    });
    if(!headers.length)throw new Error(`Judul kolom sheet ${definition.sheet} kosong.`);
    const rows=[];
    for(let rowNumber=2;rowNumber<=sheet.rowCount;rowNumber+=1){
      const row={};
      let hasValue=false;
      for(const header of headers){
        const value=safeCellValue(sheet.getRow(rowNumber).getCell(header.column).value,definition.sheet,rowNumber,header.name);
        if(value!==null&&value!=="")hasValue=true;
        row[header.name]=value;
      }
      if(hasValue)rows.push(row);
    }
    totalRows+=rows.length;
    if(totalRows>MAX_TOTAL_ROWS)throw new Error("Jumlah data workbook maksimal 50.000 baris.");
    if(rows.length)datasets.push({...definition,rows});
  }
  if(!datasets.length)throw new Error("Workbook tidak memiliki sheet data SiTeki yang berisi baris.");
  return {datasets,totalRows,filename:file.name};
}

export function downloadWorkbook(buffer,filename){
  const blob=new Blob([buffer],{type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"});
  const url=URL.createObjectURL(blob);
  const anchor=document.createElement("a");
  anchor.href=url;
  anchor.download=filename;
  anchor.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
