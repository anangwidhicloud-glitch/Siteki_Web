import ExcelJS from "exceljs";

const path=process.argv[2];
if(!path)throw new Error("Berikan path workbook.");
const workbook=new ExcelJS.Workbook();
await workbook.xlsx.readFile(path);
const sheet=workbook.getWorksheet("det_rawat");
if(!sheet)throw new Error("Sheet det_rawat tidak ditemukan.");
const summary={rows:sheet.rowCount-1,columns:sheet.columnCount,date:{valid:0,blank:0,invalid:0,types:{},formats:{},samples:[]},dy:{header:sheet.getCell("DY1").value,formula:0,sharedFormula:0,resultObject:0,value:0,blank:0,months:{}},requiredMissing:0,blankRows:0,duplicates:0,duplicateSamples:[],unexpectedStatuses:{},unexpectedSamples:[],alternateLayoutRows:[]};
const identities=new Set();
let minDate=null,maxDate=null;
for(let rowNumber=2;rowNumber<=sheet.rowCount;rowNumber+=1){
  const row=sheet.getRow(rowNumber);
  const cell=row.getCell(1),value=cell.value;
  const type=value instanceof Date?"date":typeof value;
  summary.date.types[type]=(summary.date.types[type]||0)+1;
  let dateKey="";
  if(value instanceof Date&&!Number.isNaN(value.getTime())){
    dateKey=value.toISOString().slice(0,10);summary.date.valid+=1;
    summary.date.formats[cell.numFmt||"(none)"]=(summary.date.formats[cell.numFmt||"(none)"]||0)+1;
    if(summary.date.samples.length<5)summary.date.samples.push({row:rowNumber,iso:value.toISOString(),text:cell.text,numFmt:cell.numFmt});
    if(!minDate||dateKey<minDate)minDate=dateKey;if(!maxDate||dateKey>maxDate)maxDate=dateKey;
  }else if(value===null||value===undefined||value==="")summary.date.blank+=1;
  else summary.date.invalid+=1;
  const required=[2,3,4,5].map(column=>String(row.getCell(column).value??"").trim());
  const hasContent=row.values.some((value,index)=>index>1&&index<=128&&String(value??"").trim());
  if(!dateKey&&!hasContent)summary.blankRows+=1;
  if((dateKey||hasContent)&&(!dateKey||required.some(value=>!value)))summary.requiredMissing+=1;
  const identity=[dateKey,...required].map(value=>value.toLocaleLowerCase("id-ID")).join("|");
  if(dateKey){if(identities.has(identity)){summary.duplicates+=1;if(summary.duplicateSamples.length<10)summary.duplicateSamples.push({row:rowNumber,identity});}else identities.add(identity);}
  for(let column=6;column<=127;column+=1){
    const status=String(row.getCell(column).value??"").trim();
    if(status&&!/^(bagus|baik|perbaikan|rusak|x|-|t\.a|tidak berlaku)$/i.test(status)){summary.unexpectedStatuses[status]=(summary.unexpectedStatuses[status]||0)+1;if(summary.unexpectedSamples.length<20)summary.unexpectedSamples.push({row:rowNumber,column:sheet.getColumn(column).letter,header:sheet.getCell(1,column).value,status});}
  }
  if(/^(mingguan|bulanan)$/i.test(String(row.getCell(6).value??"").trim()))summary.alternateLayoutRows.push(rowNumber);
  const dy=row.getCell(129).value;
  if(dy&&typeof dy==="object"&&dy.formula)summary.dy.formula+=1;
  else if(dy&&typeof dy==="object"&&dy.sharedFormula)summary.dy.sharedFormula+=1;
  else if(dy&&typeof dy==="object"&&Object.prototype.hasOwnProperty.call(dy,"result")){summary.dy.resultObject+=1;const month=String(dy.result??"");summary.dy.months[month]=(summary.dy.months[month]||0)+1;}
  else if(dy===null||dy===undefined||dy==="")summary.dy.blank+=1;
  else {const month=String(dy);summary.dy.value+=1;summary.dy.months[month]=(summary.dy.months[month]||0)+1;}
}
summary.date.min=minDate;summary.date.max=maxDate;
const alternate=summary.alternateLayoutRows;
summary.alternateLayoutRanges=[];
for(const value of alternate){const last=summary.alternateLayoutRanges.at(-1);if(last&&value===last[1]+1)last[1]=value;else summary.alternateLayoutRanges.push([value,value]);}
delete summary.alternateLayoutRows;
console.log(JSON.stringify(summary,null,2));
