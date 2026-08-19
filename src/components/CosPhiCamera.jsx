import React, { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Camera, Check, RefreshCw, Upload, X } from "lucide-react";
import { analyzeCosPhiCanvas, cameraErrorMessage, stopMediaStream } from "../lib/cosPhiMeter.js";

const DEBUG = import.meta.env.DEV && new URLSearchParams(window.location.search).get("cosPhiDebug") === "1";

export function CosPhiCamera({ open, onClose, onUse }) {
  const videoRef = useRef(null), canvasRef = useRef(null), streamRef = useRef(null), fileRef = useRef(null);
  const cameraRequestRef = useRef(0);
  const [stage, setStage] = useState("camera");
  const [message, setMessage] = useState("");
  const [result, setResult] = useState(null);

  const release = useCallback(() => {
    cameraRequestRef.current += 1;
    stopMediaStream(streamRef.current); streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);
  const clearFrame = useCallback(() => {
    const canvas = canvasRef.current;
    canvas?.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
    if (canvas) { canvas.width = 1; canvas.height = 1; }
  }, []);
  const close = useCallback(() => { release(); clearFrame(); setResult(null); setMessage(""); onClose(); }, [clearFrame, onClose, release]);

  const startCamera = useCallback(async () => {
    release(); setResult(null); setMessage(""); setStage("camera");
    const requestId = cameraRequestRef.current;
    if (!navigator.mediaDevices?.getUserMedia) { setMessage("Browser ini tidak mendukung akses kamera. Pilih foto sementara atau isi COS Phi secara manual."); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 1280 } }, audio: false });
      if (requestId !== cameraRequestRef.current) { stopMediaStream(stream); return; }
      streamRef.current = stream;
      if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play(); }
    } catch (error) { setMessage(cameraErrorMessage(error)); }
  }, [release]);

  useEffect(() => { if (open) startCamera(); else { release(); clearFrame(); } return release; }, [clearFrame, open, release, startCamera]);
  useEffect(() => {
    if (!open) return undefined;
    const escape = event => { if (event.key === "Escape") close(); };
    window.addEventListener("keydown", escape); return () => window.removeEventListener("keydown", escape);
  }, [close, open]);

  const processCanvas = async () => {
    setStage("processing"); setMessage("Membaca posisi jarum…");
    await new Promise(resolve => requestAnimationFrame(resolve));
    try {
      const reading = analyzeCosPhiCanvas(canvasRef.current);
      if (DEBUG && reading.debug) {
        const canvas = canvasRef.current, context = canvas.getContext("2d");
        const { pivot, angle } = reading.debug, radians = angle * Math.PI / 180, radius = Math.min(canvas.width, canvas.height) * .57;
        context.strokeStyle = "#59e29e"; context.lineWidth = Math.max(2, canvas.width / 300); context.strokeRect(4, 4, canvas.width - 8, canvas.height - 8);
        context.beginPath(); context.arc(pivot.x, pivot.y, Math.max(5, canvas.width / 80), 0, Math.PI * 2); context.stroke();
        context.beginPath(); context.moveTo(pivot.x, pivot.y); context.lineTo(pivot.x + Math.cos(radians) * radius, pivot.y - Math.sin(radians) * radius); context.stroke();
      }
      setResult(reading); setMessage(reading.ok ? "" : reading.message); setStage("result");
    } catch { setMessage("Terjadi kesalahan saat membaca meter. Silakan foto ulang atau isi manual."); setStage("result"); }
  };

  const drawSource = async (source, sourceWidth, sourceHeight) => {
    const canvas = canvasRef.current;
    const size = Math.min(sourceWidth, sourceHeight);
    const sx = (sourceWidth - size) / 2, sy = (sourceHeight - size) / 2;
    const output = Math.min(900, size);
    canvas.width = output; canvas.height = output;
    canvas.getContext("2d", { willReadFrequently: true }).drawImage(source, sx, sy, size, size, 0, 0, output, output);
    release(); await processCanvas();
  };
  const capture = () => {
    const video = videoRef.current;
    if (!video?.videoWidth) { setMessage("Preview kamera belum siap. Tunggu sebentar lalu coba lagi."); return; }
    drawSource(video, video.videoWidth, video.videoHeight);
  };
  const chooseFile = async event => {
    const file = event.target.files?.[0]; event.target.value = "";
    if (!file) return;
    let bitmap;
    try { bitmap = await createImageBitmap(file); await drawSource(bitmap, bitmap.width, bitmap.height); }
    catch { setMessage("Foto tidak dapat dibaca. Pilih foto lain atau gunakan input manual."); }
    finally { bitmap?.close(); }
  };
  const retake = () => { clearFrame(); startCamera(); };
  if (!open) return null;

  return <div className="cosphi-camera-overlay" role="dialog" aria-modal="true" aria-labelledby="cosphi-camera-title">
    <section className="cosphi-camera-modal">
      <header><div><small>Pembacaan lokal · foto tidak disimpan</small><h3 id="cosphi-camera-title">Baca Meter COS φ</h3></div><button type="button" onClick={close} aria-label="Tutup kamera"><X size={21}/></button></header>
      <div className={`cosphi-camera-view ${stage}`}>
        <video ref={videoRef} playsInline muted className={stage === "camera" ? "visible" : ""}/>
        <canvas ref={canvasRef} className={stage !== "camera" ? "visible" : ""}/>
        {stage === "camera" && <div className="cosphi-camera-guide"><span/><p>Posisikan seluruh bingkai meter di dalam kotak</p></div>}
        {stage === "processing" && <div className="cosphi-camera-processing"><span className="spinner"/><b>Membaca posisi jarum…</b><small>Mendeteksi meter dan menghitung COS Phi</small></div>}
      </div>
      {message && <div className="cosphi-camera-message"><AlertTriangle size={18}/><span>{message}</span></div>}
      {stage === "result" && result?.ok && <div className={`cosphi-reading ${result.level}`}>
        <div><small>COS Phi</small><strong>{result.value.toFixed(2)}</strong></div><div><small>Kondisi</small><strong>{result.state}</strong></div><div><small>Confidence</small><strong>{result.confidence}%</strong></div>
        {result.level === "medium" && <p><AlertTriangle size={15}/> Hasil perlu diperiksa sebelum digunakan.</p>}
        {DEBUG && <pre>Needle angle : {result.debug.angle.toFixed(1)}°{"\n"}Segment      : {result.debug.segment}{"\n"}Interpolated : {result.value.toFixed(2)}</pre>}
      </div>}
      <footer>
        {stage === "camera" && <><button type="button" className="secondary" onClick={close}>Batal</button><button type="button" className="secondary" onClick={() => fileRef.current?.click()}><Upload size={17}/> Pilih Foto</button><button type="button" className="primary cosphi-capture" onClick={capture}><Camera size={20}/> Foto</button></>}
        {stage === "result" && <><button type="button" className="secondary" onClick={retake}><RefreshCw size={17}/> Foto Ulang</button>{result?.ok && <button type="button" className="primary" onClick={() => { onUse(result); close(); }}><Check size={18}/> Gunakan Nilai</button>}</>}
      </footer>
      <input ref={fileRef} className="cosphi-file-input" type="file" accept="image/*" capture="environment" onChange={chooseFile}/>
    </section>
  </div>;
}
