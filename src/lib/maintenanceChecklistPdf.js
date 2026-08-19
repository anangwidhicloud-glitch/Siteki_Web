const MONTHS=["Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"];

const text=value=>String(value??"").trim();
const unique=values=>[...new Set(values.map(text).filter(Boolean))].sort((a,b)=>a.localeCompare(b,"id-ID"));

function dateParts(value){
  const source=text(value);
  let match=source.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if(match)return {year:Number(match[1]),month:Number(match[2]),day:Number(match[3]),iso:`${match[1]}-${match[2]}-${match[3]}`};
  match=source.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  return match?{year:Number(match[3]),month:Number(match[2]),day:Number(match[1]),iso:`${match[3]}-${match[2].padStart(2,"0")}-${match[1].padStart(2,"0")}`}:null;
}

function maintenanceLabel(row){
  const source=text(row.perawatan||row.jenis_perawatan||row.waktu).toLowerCase();
  if(source==="m"||source.includes("minggu"))return "Mingguan";
  if(source==="b"||source.includes("bulan"))return "Bulanan";
  return text(row.perawatan||row.jenis_perawatan||row.waktu)||"-";
}

export function normalizeMaintenancePrintRows(rows=[]){
  return rows.map(row=>{
    const date=dateParts(row.tanggal_iso||row.tanggal);
    return {...row,id:text(row.id||row.rowIndex),kategori:text(row.kategori)||"Mesin",jenis:text(row.jenis),
      nama_mesin:text(row.nama_mesin||row.nama),perawatan:maintenanceLabel(row),date,
      checks:(Array.isArray(row.checks)?row.checks:[]).map((check,index)=>({
        name:text(check.name)||`Item ${index+1}`,sortOrder:Number(check.sort_order??index+1),
        status:text(check.status),rawStatus:text(check.raw_status),
      })).sort((left,right)=>left.sortOrder-right.sortOrder||left.name.localeCompare(right.name,"id-ID")),
    };
  }).filter(row=>row.id&&row.date&&row.nama_mesin);
}

export function filterMaintenancePrintRows(rows,filters={}){
  return rows.filter(row=>(!filters.kategori||row.kategori===filters.kategori)
    &&(!filters.jenis||row.jenis===filters.jenis)
    &&(!filters.nama_mesin||row.nama_mesin===filters.nama_mesin)
    &&(!filters.perawatan||row.perawatan===filters.perawatan)
    &&(!filters.year||row.date.year===Number(filters.year))
    &&(!filters.month||row.date.month===Number(filters.month)));
}

export function maintenancePrintOptions(rows,filters={}){
  const selectedCategory=filters.kategori?rows.filter(row=>row.kategori===filters.kategori):rows;
  const selectedType=filters.jenis?selectedCategory.filter(row=>row.jenis===filters.jenis):selectedCategory;
  const selectedName=filters.nama_mesin?selectedType.filter(row=>row.nama_mesin===filters.nama_mesin):selectedType;
  const selectedMaintenance=filters.perawatan?selectedName.filter(row=>row.perawatan===filters.perawatan):selectedName;
  const selectedYear=filters.year?selectedMaintenance.filter(row=>row.date.year===Number(filters.year)):selectedMaintenance;
  const selectedMonth=filters.month?selectedYear.filter(row=>row.date.month===Number(filters.month)):selectedYear;
  return {
    kategori:unique(rows.map(row=>row.kategori)),jenis:unique(selectedCategory.map(row=>row.jenis)),
    nama_mesin:unique(selectedType.map(row=>row.nama_mesin)),perawatan:unique(selectedName.map(row=>row.perawatan)),
    years:[...new Set(selectedMaintenance.map(row=>row.date.year))].sort((a,b)=>b-a),
    months:[...new Set(selectedYear.map(row=>row.date.month))].sort((a,b)=>a-b),
    records:[...selectedMonth].sort((a,b)=>b.date.iso.localeCompare(a.date.iso)||a.nama_mesin.localeCompare(b.nama_mesin,"id-ID")),
  };
}

function conditionKind(check){
  const value=`${check.status} ${check.rawStatus}`.toLowerCase().trim();
  if(/not_applicable|t\.a|tidak ada|tidak berlaku|^x$/.test(value))return "na";
  if(/repair|perbaikan|rusak/.test(value))return "repair";
  if(/\b(good|bagus|baik|normal)\b/.test(value))return "good";
  return "other";
}

export function conditionSummary(checks=[]){
  const counts={good:0,repair:0,na:0,other:0};
  checks.forEach(check=>{counts[conditionKind(check)]+=1;});
  const total=Math.max(1,checks.length);
  return {...counts,total:checks.length,
    goodPercent:Math.round(counts.good/total*100),repairPercent:Math.round(counts.repair/total*100),naPercent:Math.round(counts.na/total*100)};
}

function displayStatus(check){
  const kind=conditionKind(check);
  if(kind==="good")return "Bagus";
  if(kind==="repair")return "Perbaikan";
  if(kind==="na")return "T.A";
  return check.rawStatus||check.status||"-";
}

const reportDate=row=>`${String(row.date.day).padStart(2,"0")} ${MONTHS[row.date.month-1]} ${row.date.year}`;
const PT_TO_MM=25.4/72;
const PAGE_WIDTH=210;
const PAGE_HEIGHT=330;
const PAGE_MARGIN=4;
const PRINT_WIDTH=PAGE_WIDTH-PAGE_MARGIN*2;
const COLUMN_WIDTH=PRINT_WIDTH/59;
const points=value=>value*PT_TO_MM;

function drawCell(doc,x,y,w,h,value,{align="left",bold=false,size=7.2,padding=.8}={}){
  doc.rect(x,y,w,h);
  doc.setFont("times",bold?"bold":"normal");doc.setFontSize(size);
  const lines=doc.splitTextToSize(text(value),Math.max(1,w-padding*2));
  const lineHeight=size*.36,maxLines=Math.max(1,Math.floor((h-.55)/lineHeight));
  const visible=lines.slice(0,maxLines),tx=align==="center"?x+w/2:align==="right"?x+w-padding:x+padding;
  const ty=y+h/2-(visible.length-1)*lineHeight/2+size*.115;
  doc.text(visible,tx,ty,{align,lineHeightFactor:1});
}

function drawHeader(doc){
  const x=PAGE_MARGIN,y=PAGE_MARGIN+points(9),rowH=points(18),h=rowH*4;
  const brandW=COLUMN_WIDTH*9,titleW=COLUMN_WIDTH*37,metaW=COLUMN_WIDTH*13;
  const titleX=x+brandW,metaX=titleX+titleW;
  doc.setDrawColor(0);doc.setLineWidth(.2);doc.rect(x,y,PRINT_WIDTH,h);
  doc.line(titleX,y,titleX,y+h);doc.line(metaX,y,metaX,y+h);
  doc.line(titleX,y+rowH,metaX,y+rowH);doc.line(titleX,y+rowH*3,metaX,y+rowH*3);
  for(let index=1;index<4;index+=1)doc.line(metaX,y+rowH*index,x+PRINT_WIDTH,y+rowH*index);
  doc.setTextColor(198,24,35);doc.setFont("times","bold");doc.setFontSize(22);doc.text("RB",x+brandW/2,y+h/2+2.3,{align:"center"});
  doc.setTextColor(0);doc.setFontSize(11);doc.text("FORMULIR",titleX+titleW/2,y+rowH/2+1.3,{align:"center"});
  doc.text("CHECKLIST PERAWATAN RUTIN",titleX+titleW/2,y+rowH*2+1.3,{align:"center"});
  doc.setFontSize(9);doc.text("KESELAMATAN DAN KESEHATAN KERJA",titleX+titleW/2,y+rowH*3.5+1,{align:"center"});
  [["No. Dok.","F.K3.1.04"],["Tanggal","05 Oktober 2020"],["Revisi","02"],["Halaman","1 dari 1"]].forEach(([label,value],index)=>{
    const baseline=y+rowH*index+rowH/2+1;
    doc.setFont("times","normal");doc.setFontSize(7.5);doc.text(label,metaX+1,baseline);
    doc.text(":",metaX+COLUMN_WIDTH*4,baseline);doc.text(value,metaX+COLUMN_WIDTH*5,baseline);
  });
  return y+h+points(8.45);
}

function drawMetaText(doc,label,value,labelX,valueX,y){
  doc.setFont("times","bold");doc.setFontSize(8);doc.text(label,labelX,y);
  doc.setFont("times","normal");doc.text(text(value)||"-",valueX,y);
}

function drawReport(doc,row,y,{first=false}={}){
  const x=PAGE_MARGIN,u=COLUMN_WIDTH,w=PRINT_WIDTH,metaRowH=points(15),metaH=metaRowH*2,headerH=points(12.95);
  doc.setDrawColor(0);doc.setTextColor(0);doc.setLineWidth(.18);doc.rect(x,y,w,metaH);doc.line(x,y+metaRowH,x+w,y+metaRowH);
  const firstBaseline=y+metaRowH/2+1,secondBaseline=y+metaRowH+metaRowH/2+1;
  drawMetaText(doc,"KATEGORI",row.kategori,x+u,x+u*6,firstBaseline);doc.text(":",x+u*5,firstBaseline);
  drawMetaText(doc,"NAMA",row.nama_mesin,x+u*14,x+u*18,firstBaseline);doc.text(":",x+u*17,firstBaseline);
  drawMetaText(doc,"PERAWATAN",row.perawatan,x+u*27,x+u*34,firstBaseline);doc.text(":",x+u*33,firstBaseline);
  drawMetaText(doc,"BULAN",MONTHS[row.date.month-1],x+u*40,x+u*46,firstBaseline);doc.text(":",x+u*45,firstBaseline);
  drawMetaText(doc,"JENIS",row.jenis||"-",x+u,x+u*6,secondBaseline);doc.text(":",x+u*5,secondBaseline);
  drawMetaText(doc,"TAHUN",row.date.year,x+u*27,x+u*34,secondBaseline);doc.text(":",x+u*33,secondBaseline);
  drawMetaText(doc,"TANGGAL",reportDate(row),x+u*40,x+u*46,secondBaseline);doc.text(":",x+u*45,secondBaseline);

  const tableY=y+metaH,rightX=x+u*30,noW=u*3,itemW=u*21,statusW=u*5;
  const drawHalfHeader=left=>{drawCell(doc,left,tableY,noW,headerH,"NO.",{align:"center",bold:true,size:8});drawCell(doc,left+noW,tableY,itemW,headerH,"ITEM",{align:"center",bold:true,size:8});drawCell(doc,left+noW+itemW,tableY,statusW,headerH,"KONDISI",{align:"center",bold:true,size:8});};
  drawHalfHeader(x);drawHalfHeader(rightX);
  const leftChecks=row.checks.slice(0,23),rightChecks=row.checks.slice(23,43),summary=conditionSummary(row.checks);
  let rowY=tableY+headerH;
  for(let index=0;index<23;index+=1){
    const rowH=index===0&&first?points(15):points(12.4),left=leftChecks[index];
    drawCell(doc,x,rowY,noW,rowH,left?index+1:"",{align:"center",size:7.5});
    drawCell(doc,x+noW,rowY,itemW,rowH,left?.name||"",{size:7});
    drawCell(doc,x+noW+itemW,rowY,statusW,rowH,left?displayStatus(left):"",{align:"center",size:6.8});
    const right=rightChecks[index];
    if(index<20){
      drawCell(doc,rightX,rowY,noW,rowH,right?index+24:"",{align:"center",size:7.5});
      drawCell(doc,rightX+noW,rowY,itemW,rowH,right?.name||"",{size:7});
      drawCell(doc,rightX+noW+itemW,rowY,statusW,rowH,right?displayStatus(right):"",{align:"center",size:6.8});
    }else{
      const labels=[["% Kondisi Bagus",summary.goodPercent],["% Kondisi Rusak",summary.repairPercent],["% Kondisi Tidak Ada (T.A)",summary.naPercent]],entry=labels[index-20];
      drawCell(doc,rightX,rowY,u,rowH,"");drawCell(doc,rightX+u,rowY,u*14,rowH,entry[0],{bold:true,size:7});
      drawCell(doc,rightX+u*15,rowY,u,rowH,":",{align:"center",bold:true,size:7});drawCell(doc,rightX+u*16,rowY,u*13,rowH,`${entry[1]}%`,{align:"center",bold:true,size:7.5});
    }
    rowY+=rowH;
  }
  const noteTitleH=points(12),noteBodyH=points(17.1);
  doc.rect(x,rowY,w,noteTitleH+noteBodyH);doc.line(x,rowY+noteTitleH,x+w,rowY+noteTitleH);
  doc.setFont("times","normal");doc.setFontSize(8);doc.text("Keterangan :",x+u,rowY+noteTitleH/2+1);
  doc.setFontSize(7.5);const noteLines=doc.splitTextToSize(text(row.printNote),w-u*2).slice(0,2);
  if(noteLines.length)doc.text(noteLines,x+u,rowY+noteTitleH+3.1,{lineHeightFactor:1.15});
  return rowY+noteTitleH+noteBodyH;
}

function drawSignatures(doc,category,printedOn,y){
  const x=PAGE_MARGIN,u=COLUMN_WIDTH,widths=[u*17,u*14,u*14,u*14],roleH=points(12.4),signatureH=points(49.6),fieldH=points(12.4);
  const roles=["H.S.E","KABAG","KASUBAG","PELAKSANA"];
  const names=["A. S. Feriyanto","Yani Mustofa","Anang Widhi P",category.toLowerCase()==="armada"?"Agung Sujarwanto":"Machfiroch"];
  let left=x;
  widths.forEach((width,index)=>{
    doc.rect(left,y,width,roleH);doc.rect(left,y+roleH,width,signatureH);doc.rect(left,y+roleH+signatureH,width,fieldH);doc.rect(left,y+roleH+signatureH+fieldH,width,fieldH);
    doc.setFont("times","bold");doc.setFontSize(9);doc.text(roles[index],left+width/2,y+roleH/2+1.2,{align:"center"});
    doc.setFont("times","normal");doc.setFontSize(7.2);doc.text(`NAMA     : ${names[index]}`,left+1,y+roleH+signatureH+fieldH/2+1);
    doc.text(`TANGGAL : ${printedOn}`,left+1,y+roleH+signatureH+fieldH+fieldH/2+1);
    left+=width;
  });
}

export async function createMaintenanceChecklistPdf({first,second,printedOn=new Date().toISOString().slice(0,10)}){
  if(!first||!second)throw new Error("Pilih dua laporan perawatan.");
  if(first.id===second.id)throw new Error("Laporan pertama dan kedua harus berbeda.");
  if(first.kategori!==second.kategori)throw new Error("Dua laporan harus berada dalam satu kategori.");
  const {jsPDF}=await import("jspdf");
  const doc=new jsPDF({orientation:"portrait",unit:"mm",format:[PAGE_WIDTH,PAGE_HEIGHT],compress:true,putOnlyUsedFonts:true});
  doc.setProperties({title:`Checklist Perawatan ${first.kategori}`,subject:"Checklist perawatan rutin",author:"SiTeki"});
  const firstY=drawHeader(doc),secondY=drawReport(doc,first,firstY,{first:true}),signaturesY=drawReport(doc,second,secondY);
  const printed=dateParts(printedOn)||dateParts(new Date().toISOString().slice(0,10));
  drawSignatures(doc,first.kategori,`${String(printed.day).padStart(2,"0")} ${MONTHS[printed.month-1]} ${printed.year}`,signaturesY+points(9));
  return {doc,filename:`Checklist-Perawatan-${first.kategori}-${printed.iso}.pdf`};
}

export async function downloadMaintenanceChecklistPdf(options){
  const {doc,filename}=await createMaintenanceChecklistPdf(options);
  doc.save(filename);
}

export {MONTHS as MAINTENANCE_PRINT_MONTHS};
