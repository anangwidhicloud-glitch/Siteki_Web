const MAX_SOURCE_BYTES = 12 * 1024 * 1024;
const TARGET_BYTES = 600 * 1024;
const MAX_DIMENSION = 1800;
const OUTPUT_FORMATS = [
  { mimeType:"image/avif", extension:"avif" },
  { mimeType:"image/webp", extension:"webp" },
  { mimeType:"image/jpeg", extension:"jpg" },
];

const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));

function distance(left, right) {
  return Math.hypot(right.x - left.x, right.y - left.y);
}

function fitLine(points, dependent) {
  if (points.length < 3) return null;
  const independent = dependent === "x" ? "y" : "x";
  const fit = source => {
    const meanA = source.reduce((sum, point) => sum + point[independent], 0) / source.length;
    const meanB = source.reduce((sum, point) => sum + point[dependent], 0) / source.length;
    const denominator = source.reduce((sum, point) => sum + (point[independent] - meanA) ** 2, 0);
    const slope = denominator ? source.reduce((sum, point) => sum + (point[independent] - meanA) * (point[dependent] - meanB), 0) / denominator : 0;
    return { slope, intercept:meanB - slope * meanA };
  };
  let line = fit(points);
  const residuals = points.map(point => Math.abs(point[dependent] - (line.slope * point[independent] + line.intercept))).sort((a,b) => a-b);
  const median = residuals[Math.floor(residuals.length / 2)] || 0;
  const filtered = points.filter(point => Math.abs(point[dependent] - (line.slope * point[independent] + line.intercept)) <= Math.max(7, median * 2.4));
  if (filtered.length >= 3) line = fit(filtered);
  return line;
}

function lineIntersection(vertical, horizontal) {
  const denominator = 1 - vertical.slope * horizontal.slope;
  if (Math.abs(denominator) < 0.05) return null;
  const x = (vertical.slope * horizontal.intercept + vertical.intercept) / denominator;
  return { x, y:horizontal.slope * x + horizontal.intercept };
}

function expandDocumentCorners(corners, width, height, ratio = .08) {
  const center=corners.reduce((result,point)=>({x:result.x+point.x/corners.length,y:result.y+point.y/corners.length}),{x:0,y:0});
  return corners.map(point=>({
    x:clamp(center.x+(point.x-center.x)*(1+ratio),0,width-1),
    y:clamp(center.y+(point.y-center.y)*(1+ratio),0,height-1),
  }));
}

function addDocumentMargin(sourceCanvas, ratio = .018) {
  const margin=Math.max(8,Math.round(Math.max(sourceCanvas.width,sourceCanvas.height)*ratio));
  const output=document.createElement("canvas");
  output.width=sourceCanvas.width+margin*2;
  output.height=sourceCanvas.height+margin*2;
  const context=output.getContext("2d",{alpha:false});
  context.fillStyle="#fff";
  context.fillRect(0,0,output.width,output.height);
  context.drawImage(sourceCanvas,margin,margin);
  return output;
}

function detectDocument(sourceCanvas) {
  const scale = Math.min(1, 640 / Math.max(sourceCanvas.width, sourceCanvas.height));
  const width = Math.max(120, Math.round(sourceCanvas.width * scale));
  const height = Math.max(120, Math.round(sourceCanvas.height * scale));
  const analysis = document.createElement("canvas");
  analysis.width = width;
  analysis.height = height;
  const context = analysis.getContext("2d", { willReadFrequently:true, alpha:false });
  context.drawImage(sourceCanvas, 0, 0, width, height);
  const pixels = context.getImageData(0, 0, width, height).data;
  const luminance = new Uint8Array(width * height);
  for (let index = 0, pixel = 0; index < luminance.length; index += 1, pixel += 4) {
    luminance[index] = Math.round(pixels[pixel] * .299 + pixels[pixel + 1] * .587 + pixels[pixel + 2] * .114);
  }

  const verticalScore = (x,y) => {
    let score = 0;
    for (let offset = -3; offset <= 3; offset += 1) {
      const row = clamp(y + offset, 0, height - 1) * width;
      score += Math.abs(luminance[row + x + 2] - luminance[row + x - 2]);
    }
    return score / 7;
  };
  const horizontalScore = (x,y) => {
    let score = 0;
    for (let offset = -3; offset <= 3; offset += 1) {
      const column = clamp(x + offset, 0, width - 1);
      score += Math.abs(luminance[(y + 2) * width + column] - luminance[(y - 2) * width + column]);
    }
    return score / 7;
  };
  const strongest = (start,end,scoreAt,biasAt) => {
    let coordinate = start, score = -1;
    for (let value = start; value <= end; value += 2) {
      const current = scoreAt(value) * biasAt(value);
      if (current > score) { coordinate = value;score = current; }
    }
    return { coordinate, score };
  };

  const left=[],right=[],top=[],bottom=[],strength=[];
  for (let step = 1; step <= 12; step += 1) {
    const y=Math.round(height * (.08 + step * .065));
    const leftEdge=strongest(3,Math.round(width*.47),x=>verticalScore(x,y),x=>1.18-x/width*.35);
    const rightEdge=strongest(Math.round(width*.53),width-4,x=>verticalScore(x,y),x=>.83+x/width*.35);
    left.push({x:leftEdge.coordinate,y});right.push({x:rightEdge.coordinate,y});strength.push(leftEdge.score,rightEdge.score);
  }
  for (let step = 1; step <= 12; step += 1) {
    const x=Math.round(width * (.08 + step * .065));
    const topEdge=strongest(3,Math.round(height*.47),y=>horizontalScore(x,y),y=>1.18-y/height*.35);
    const bottomEdge=strongest(Math.round(height*.53),height-4,y=>horizontalScore(x,y),y=>.83+y/height*.35);
    top.push({x,y:topEdge.coordinate});bottom.push({x,y:bottomEdge.coordinate});strength.push(topEdge.score,bottomEdge.score);
  }
  const lines={left:fitLine(left,"x"),right:fitLine(right,"x"),top:fitLine(top,"y"),bottom:fitLine(bottom,"y")};
  if (Object.values(lines).some(line=>!line)) return null;
  const corners=[
    lineIntersection(lines.left,lines.top),lineIntersection(lines.right,lines.top),
    lineIntersection(lines.right,lines.bottom),lineIntersection(lines.left,lines.bottom),
  ];
  if (corners.some(point=>!point)) return null;
  const outsideTolerance=Math.max(width,height)*.05;
  if(corners.some(point=>point.x < -outsideTolerance||point.x > width-1+outsideTolerance||point.y < -outsideTolerance||point.y > height-1+outsideTolerance))return null;
  corners.forEach(point=>{ point.x=clamp(point.x,0,width-1);point.y=clamp(point.y,0,height-1); });
  const [topLeft,topRight,bottomRight,bottomLeft]=corners;
  const area=Math.abs(corners.reduce((sum,point,index)=>sum+point.x*corners[(index+1)%4].y-corners[(index+1)%4].x*point.y,0))/2;
  const averageStrength=strength.reduce((sum,value)=>sum+value,0)/strength.length;
  const widthRatio=(distance(topLeft,topRight)+distance(bottomLeft,bottomRight))/2/width;
  const heightRatio=(distance(topLeft,bottomLeft)+distance(topRight,bottomRight))/2/height;
  if (area < width*height*.24 || widthRatio < .42 || heightRatio < .42 || averageStrength < 13) return null;
  const inverseScale=1/scale;
  const sourceCorners=corners.map(point=>({x:point.x*inverseScale,y:point.y*inverseScale}));
  return {
    corners:expandDocumentCorners(sourceCorners,sourceCanvas.width,sourceCanvas.height),
    confidence:Math.round(clamp((averageStrength-10)*2.2,20,96)),
  };
}

function warpDocument(sourceCanvas, corners) {
  const [topLeft,topRight,bottomRight,bottomLeft]=corners;
  const measuredWidth=Math.max(1,(distance(topLeft,topRight)+distance(bottomLeft,bottomRight))/2);
  const measuredHeight=Math.max(1,(distance(topLeft,bottomLeft)+distance(topRight,bottomRight))/2);
  const outputScale=Math.min(1,MAX_DIMENSION/Math.max(measuredWidth,measuredHeight));
  const width=Math.max(1,Math.round(measuredWidth*outputScale));
  const height=Math.max(1,Math.round(measuredHeight*outputScale));
  const output=document.createElement("canvas");
  output.width=width;output.height=height;
  const sourceContext=sourceCanvas.getContext("2d",{willReadFrequently:true});
  const source=sourceContext.getImageData(0,0,sourceCanvas.width,sourceCanvas.height);
  const targetContext=output.getContext("2d",{alpha:false});
  const target=targetContext.createImageData(width,height);
  const dx1=topRight.x-bottomRight.x,dx2=bottomLeft.x-bottomRight.x,dx3=topLeft.x-topRight.x+bottomRight.x-bottomLeft.x;
  const dy1=topRight.y-bottomRight.y,dy2=bottomLeft.y-bottomRight.y,dy3=topLeft.y-topRight.y+bottomRight.y-bottomLeft.y;
  const denominator=dx1*dy2-dx2*dy1;
  if(Math.abs(denominator)<.001)return sourceCanvas;
  const projectU=(dx3*dy2-dx2*dy3)/denominator;
  const projectV=(dx1*dy3-dx3*dy1)/denominator;
  const ax=topRight.x-topLeft.x+projectU*topRight.x,ay=topRight.y-topLeft.y+projectU*topRight.y;
  const bx=bottomLeft.x-topLeft.x+projectV*bottomLeft.x,by=bottomLeft.y-topLeft.y+projectV*bottomLeft.y;
  for(let y=0;y<height;y+=1){
    const v=height===1?0:y/(height-1);
    for(let x=0;x<width;x+=1){
      const u=width===1?0:x/(width-1);
      const divisor=1+projectU*u+projectV*v;
      const sourceX=clamp(Math.round((topLeft.x+ax*u+bx*v)/divisor),0,sourceCanvas.width-1);
      const sourceY=clamp(Math.round((topLeft.y+ay*u+by*v)/divisor),0,sourceCanvas.height-1);
      const sourceIndex=(sourceY*sourceCanvas.width+sourceX)*4,targetIndex=(y*width+x)*4;
      target.data[targetIndex]=source.data[sourceIndex];target.data[targetIndex+1]=source.data[sourceIndex+1];target.data[targetIndex+2]=source.data[sourceIndex+2];target.data[targetIndex+3]=255;
    }
  }
  targetContext.putImageData(target,0,0);
  return output;
}

function canvasBlob(canvas, mimeType, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      blob => blob ? resolve(blob) : reject(new Error("Foto bon gagal dikompres.")),
      mimeType,
      quality,
    );
  });
}

async function encodeSmallestClearImage(canvas, scanMode, targetBytes = TARGET_BYTES) {
  const qualities=scanMode?[.94,.9,.86,.82]:[.92,.88,.84,.8];
  let fallback=null;
  for(const quality of qualities) {
    const candidates=[];
    for(const format of OUTPUT_FORMATS) {
      const blob=await canvasBlob(canvas,format.mimeType,quality);
      if(blob.type===format.mimeType)candidates.push({...format,blob,quality});
    }
    const smallest=candidates.sort((left,right)=>left.blob.size-right.blob.size)[0];
    if(!smallest)continue;
    if(!fallback||smallest.blob.size<fallback.blob.size)fallback=smallest;
    if(smallest.blob.size<=targetBytes)return smallest;
  }
  if(!fallback)throw new Error("Browser tidak mendukung format gambar untuk foto bon.");
  return fallback;
}

function blobDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Hasil kompresi foto tidak dapat dibaca."));
    reader.readAsDataURL(blob);
  });
}

async function loadImage(file) {
  if (typeof createImageBitmap === "function") {
    let bitmap;
    try { bitmap = await createImageBitmap(file, { imageOrientation:"from-image" }); }
    catch { bitmap = await createImageBitmap(file); }
    return { source:bitmap, width:bitmap.width, height:bitmap.height, close:() => bitmap.close?.() };
  }
  const url = URL.createObjectURL(file);
  const image = new Image();
  await new Promise((resolve, reject) => {
    image.onload = resolve;
    image.onerror = () => reject(new Error("Format foto bon tidak dapat dibaca."));
    image.src = url;
  });
  return { source:image, width:image.naturalWidth, height:image.naturalHeight, close:() => URL.revokeObjectURL(url) };
}

function validateImageFile(file) {
  if (!file?.type?.startsWith("image/")) throw new Error("Pilih file foto berformat JPG, PNG, atau WebP.");
  if (file.size > MAX_SOURCE_BYTES) throw new Error("Foto asli maksimal 12 MB.");
}

async function createSourceCanvas(file, maxDimension) {
  const loaded=await loadImage(file);
  try {
    const scale=Math.min(1,maxDimension/Math.max(loaded.width,loaded.height));
    const width=Math.max(1,Math.round(loaded.width*scale));
    const height=Math.max(1,Math.round(loaded.height*scale));
    const canvas=document.createElement("canvas");
    canvas.width=width;canvas.height=height;
    const context=canvas.getContext("2d",{alpha:false});
    context.fillStyle="#fff";context.fillRect(0,0,width,height);
    context.drawImage(loaded.source,0,0,width,height);
    return canvas;
  } finally {
    loaded.close();
  }
}

function normalizedCorners(corners,width,height) {
  return corners.map(point=>({x:clamp(point.x/width,0,1),y:clamp(point.y/height,0,1)}));
}

function sourceCorners(corners,width,height) {
  if(!Array.isArray(corners)||corners.length!==4)return null;
  const parsed=corners.map(point=>({x:Number(point?.x)*width,y:Number(point?.y)*height}));
  return parsed.every(point=>Number.isFinite(point.x)&&Number.isFinite(point.y))?parsed:null;
}

export async function inspectBonImage(file,{maxDimension=1400}={}) {
  validateImageFile(file);
  const canvas=await createSourceCanvas(file,maxDimension);
  const detection=detectDocument(canvas);
  const marginX=canvas.width*.025,marginY=canvas.height*.025;
  const corners=detection?.corners||[
    {x:marginX,y:marginY},{x:canvas.width-marginX,y:marginY},
    {x:canvas.width-marginX,y:canvas.height-marginY},{x:marginX,y:canvas.height-marginY},
  ];
  return {
    previewUrl:canvas.toDataURL("image/jpeg",.9),width:canvas.width,height:canvas.height,
    corners:normalizedCorners(corners,canvas.width,canvas.height),
    detected:Boolean(detection),confidence:detection?.confidence||0,
  };
}

export function cropToAspectRatio(sourceCanvas, targetRatio = 3 / 4) {
  if (!sourceCanvas || !sourceCanvas.width || !sourceCanvas.height) return sourceCanvas;
  const ratioNum = typeof targetRatio === "number" ? targetRatio : (targetRatio === "3:4" ? 3 / 4 : 3 / 4);
  const currentRatio = sourceCanvas.width / sourceCanvas.height;
  
  let cropWidth = sourceCanvas.width;
  let cropHeight = sourceCanvas.height;
  let cropX = 0;
  let cropY = 0;

  if (currentRatio > ratioNum) {
    cropWidth = Math.max(1, Math.round(sourceCanvas.height * ratioNum));
    cropX = Math.round((sourceCanvas.width - cropWidth) / 2);
  } else if (currentRatio < ratioNum) {
    cropHeight = Math.max(1, Math.round(sourceCanvas.width / ratioNum));
    cropY = Math.round((sourceCanvas.height - cropHeight) / 2);
  } else {
    return sourceCanvas;
  }

  const cropped = document.createElement("canvas");
  cropped.width = cropWidth;
  cropped.height = cropHeight;
  const ctx = cropped.getContext("2d", { alpha: false });
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, cropWidth, cropHeight);
  ctx.drawImage(sourceCanvas, cropX, cropY, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);
  return cropped;
}

export async function prepareBonImage(file, { scanMode = true, targetBytes = TARGET_BYTES, maxDimension = MAX_DIMENSION, manualCorners = null, aspectRatio = null } = {}) {
  validateImageFile(file);
  const sourceCanvas=await createSourceCanvas(file,maxDimension);
  try {
    let width=sourceCanvas.width,height=sourceCanvas.height;
    const manual=scanMode?sourceCorners(manualCorners,width,height):null;
    const detection=scanMode?(manual?{corners:manual,confidence:100,manual:true}:detectDocument(sourceCanvas)):null;
    let preparedSource=detection?addDocumentMargin(warpDocument(sourceCanvas,detection.corners)):sourceCanvas;
    if (aspectRatio) {
      preparedSource = cropToAspectRatio(preparedSource, aspectRatio);
    }
    width=preparedSource.width;height=preparedSource.height;
    const canvas = document.createElement("canvas");
    let encoded;

    for (let resize = 0; resize < 3; resize += 1) {
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d", { alpha:false });
      context.fillStyle = "#fff";
      context.fillRect(0, 0, width, height);
      context.filter = scanMode ? "grayscale(1) contrast(1.18) brightness(1.06)" : "none";
      context.drawImage(preparedSource, 0, 0, width, height);
      context.filter = "none";

      encoded=await encodeSmallestClearImage(canvas,scanMode,targetBytes);
      if (encoded.blob.size <= targetBytes) break;
      width = Math.max(1, Math.round(width * 0.82));
      height = Math.max(1, Math.round(height * 0.82));
    }

    return {
      dataUrl:await blobDataUrl(encoded.blob),
      fileName:String(file.name || "bon-pesan").replace(/\.[^.]+$/, "")+`.${encoded.extension}`,
      mimeType:encoded.mimeType,
      extension:encoded.extension,
      quality:encoded.quality,
      bytes:encoded.blob.size,
      originalBytes:file.size,
      compressionRatio:file.size?Math.round((1-encoded.blob.size/file.size)*100):0,
      width:canvas.width,
      height:canvas.height,
      scanEnhanced:Boolean(scanMode),
      documentDetected:Boolean(detection),
      manualCrop:Boolean(detection?.manual),
      cropConfidence:detection?.confidence||0,
    };
  } finally {}
}

export function formatImageBytes(value) {
  const bytes = Number(value || 0);
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(bytes >= 1024 * 100 ? 0 : 1)} KB`;
}
