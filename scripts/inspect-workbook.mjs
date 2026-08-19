import ExcelJS from "exceljs";

const path=process.argv[2];
const startRow=Math.max(1,Number(process.argv[3])||1);
const endRow=Math.max(startRow,Number(process.argv[4])||Math.min(45,startRow+44));
if(!path)throw new Error("Berikan path workbook.");
const workbook=new ExcelJS.Workbook();
await workbook.xlsx.readFile(path);
const summary=workbook.worksheets.map(sheet=>({
  name:sheet.name,rows:sheet.rowCount,columns:sheet.columnCount,
  mergedCells:sheet.model.merges?.length||0,state:sheet.state,
}));
console.log(JSON.stringify(summary,null,2));
for(const sheet of workbook.worksheets){
  console.log(`\n### ${sheet.name}`);
  for(let rowNumber=startRow;rowNumber<=Math.min(sheet.rowCount,endRow);rowNumber+=1){
    const values=[];
    sheet.getRow(rowNumber).eachCell({includeEmpty:false},(cell,column)=>{
      let value=cell.value;
      if(value&&typeof value==="object"){
        if(value.formula)value=`FORMULA:${value.formula}`;
        else if(Array.isArray(value.richText))value=value.richText.map(part=>part.text||"").join("");
        else if(value.text)value=value.text;
        else if(value.result!==undefined)value=value.result;
      }
      const text=String(value??"").replace(/\s+/g," ").slice(0,100);
      if(text)values.push(`${sheet.getColumn(column).letter}=${text}`);
    });
    if(values.length)console.log(`${rowNumber}: ${values.join(" | ")}`);
  }
}
