import ExcelJS from "exceljs";

const path=process.argv[2];
if(!path)throw new Error("Berikan path template checklist perawatan.");
const workbook=new ExcelJS.Workbook();
await workbook.xlsx.readFile(path);
for(const sheet of workbook.worksheets){
  console.log(JSON.stringify({
    sheet:sheet.name,rowCount:sheet.rowCount,columnCount:sheet.columnCount,
    pageSetup:sheet.pageSetup,pageMargins:sheet.pageMargins,
    views:sheet.views,images:sheet.getImages().map(image=>({imageId:image.imageId,range:image.range?.range||image.range?.tl?.nativeCol!==undefined?{
      tl:{col:image.range.tl.nativeCol,row:image.range.tl.nativeRow},br:{col:image.range.br.nativeCol,row:image.range.br.nativeRow},
    }:String(image.range||"")})),merges:sheet.model.merges,
  },null,2));
  console.log("\nMASTER CELLS");
  sheet.eachRow({includeEmpty:false},row=>row.eachCell({includeEmpty:false},cell=>{
    if(cell.isMerged&&cell.master.address!==cell.address)return;
    let value=cell.value;
    if(value&&typeof value==="object"){
      if(value.formula)value=`FORMULA:${value.formula}`;
      else if(Array.isArray(value.richText))value=value.richText.map(part=>part.text||"").join("");
      else if(value.text)value=value.text;
    }
    const text=String(value??"").replace(/\s+/g," ").trim();
    if(!text)return;
    const color=cell.font?.color?.argb||cell.font?.color?.indexed||"";
    const merge=sheet.model.merges?.find(range=>sheet.getCell(range.split(":")[0]).address===cell.address)||"";
    console.log(`${cell.address}${merge?` [${merge}]`:""} color=${color} value=${text.slice(0,240)}`);
  }));
  console.log("\nDIMENSIONS");
  console.log(JSON.stringify({
    columns:Array.from({length:59},(_,index)=>({column:index+2,width:sheet.getColumn(index+2).width||null})),
    rows:Array.from({length:72},(_,index)=>({row:index+1,height:sheet.getRow(index+1).height||null})),
  },null,2));
  console.log("\nREPRESENTATIVE STYLES");
  for(const address of ["K2","K3","B5","B7","B9","B10","E10","BD10","C33","C34","B66","B67","B71"]){
    const cell=sheet.getCell(address);
    console.log(JSON.stringify({address,font:cell.font,alignment:cell.alignment,fill:cell.fill,border:cell.border,numFmt:cell.numFmt}));
  }
}
