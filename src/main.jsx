import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { createRoot } from "react-dom/client";
import {
  Activity, AlertTriangle, AppWindow, ArrowLeft, ArrowRight, BarChart3, Bell,
  BookOpen, Boxes, CalendarDays, Camera, Check, CheckCircle2, ChevronDown, ClipboardCheck,
  ClipboardList, Clock3, Database, Download, Droplets, Edit3, Eye, EyeOff, FileBarChart,
  FilePlus2, Gauge, HardHat, History, Home, ImagePlus, Info, ExternalLink, LogOut, Menu, MoreHorizontal, Package, Printer,
  LockKeyhole, Maximize2, Minimize2, Monitor, Moon, Plus, QrCode, RefreshCw, Search, Settings,
  ScanLine, ShieldCheck, SlidersHorizontal, Sparkles, Sun, TimerReset, Trash2, TrendingDown, Upload,
  TrendingUp, UserRound, Users, Warehouse, Wrench, X, Zap
} from "lucide-react";
import "./styles.css";
import { apiGet, apiPost, asArray, ENDPOINTS, isSuccess } from "./lib/api";
import { calculateElectricityAssessment } from "./lib/electricity";
import { useRemoteData } from "./hooks/useRemoteData";
import { getOilMonitoring, saveOilCheck } from "./lib/oilApi";
import { formatImageBytes, inspectBonImage, prepareBonImage } from "./lib/bonImage";
import { MaintenanceKpiPanel } from "./components/MaintenanceKpiPanel";
import { CosPhiCamera } from "./components/CosPhiCamera";
import { NotificationSettings } from "./components/NotificationSettings";
import { downloadElectricityHistoryPdf } from "./lib/electricityHistoryPdf";
import {
  MAINTENANCE_PRINT_MONTHS, conditionSummary, downloadMaintenanceChecklistPdf,
  maintenancePrintOptions, normalizeMaintenancePrintRows,
} from "./lib/maintenanceChecklistPdf";
import { loadDataWorkbook, loadDirectWorkbook, preloadWorkbookModules } from "./lib/workbookLoader";
import { getChecklistItems } from "./lib/maintenanceChecklistTemplates";

const normalizeOrder = (o, index = 0) => ({
  ...o,
  rowIndex: o.rowIndex ?? o.row ?? index + 2,
  tanggal: o.tanggal || "",
  namaMesin: o.namaMesin || o.mesin || "",
  kerusakan: o.kerusakan || o.keluhan || "",
  urgensi: o.urgensi || "-",
  status: o.status || "",
  bagianOrder: o.bagian_order || o.bagianOrder || "",
  namaOrder: o.nama_order || o.namaOrder || "",
  bagianTujuan: o.bagian_tujuan || o.bagianTujuan || ""
});

const currentIndonesianMonth = () =>
  new Intl.DateTimeFormat("id-ID", { month: "long", year: "numeric" }).format(new Date());

const toIdDate = (value) => {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return value || "";
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
};

const toDateInput = (value) => {
  const match = String(value || "").match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
  return match ? `${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}` : String(value || "").slice(0, 10);
};

function DateInput({ value, onChange, required, name, className = "", style, defaultValue, readOnly: isReadOnly }) {
  const dateRef = useRef(null);
  const [internalValue, setInternalValue] = useState(() => value !== undefined ? value : (defaultValue || ""));

  const valToUse = value !== undefined ? value : internalValue;

  const toIso = (val) => {
    if (!val) return "";
    if (/^\d{4}-\d{2}-\d{2}$/.test(val)) return val;
    const match = String(val).match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
    if (match) {
      return `${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`;
    }
    return "";
  };

  const toDisplay = (val) => {
    if (!val) return "";
    if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(val)) return val;
    const match = String(val).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (match) {
      return `${match[3]}/${match[2]}/${match[1]}`;
    }
    return val;
  };

  const isoValue = toIso(valToUse);
  const displayValue = toDisplay(valToUse);

  const handleNativeChange = (e) => {
    const newIso = e.target.value;
    if (value === undefined) setInternalValue(newIso);
    if (onChange) {
      onChange({ target: { name, value: newIso } });
    }
  };

  const triggerPicker = () => {
    if (isReadOnly) return;
    if (dateRef.current) {
      if (typeof dateRef.current.showPicker === "function") {
        try {
          dateRef.current.showPicker();
        } catch {
          dateRef.current.click();
        }
      } else {
        dateRef.current.click();
      }
    }
  };

  return (
    <div className={`date-input-custom-wrapper ${className}`} style={{ position: "relative", display: "flex", alignItems: "center", width: "100%", ...style }}>
      <input
        type="text"
        name={name}
        value={displayValue}
        onClick={triggerPicker}
        placeholder="dd/mm/yyyy"
        required={required}
        readOnly
        style={{ cursor: isReadOnly ? "default" : "pointer", paddingRight: "36px", width: "100%" }}
      />
      <button
        type="button"
        onClick={triggerPicker}
        tabIndex={-1}
        disabled={isReadOnly}
        style={{
          position: "absolute",
          right: "10px",
          background: "none",
          border: "none",
          color: "var(--text-muted, #94a3b8)",
          cursor: isReadOnly ? "default" : "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "4px"
        }}
      >
        <CalendarDays size={16} />
      </button>
      <input
        ref={dateRef}
        type="date"
        value={isoValue}
        onChange={handleNativeChange}
        tabIndex={-1}
        style={{
          position: "absolute",
          opacity: 0,
          pointerEvents: "none",
          width: "1px",
          height: "1px",
          top: 0,
          left: 0
        }}
      />
    </div>
  );
}

async function loadMachineMaster() {
  const sourceRows = asArray(await apiGet(ENDPOINTS.maintenanceMaster, { action: "getRawatMaster" }));
  const read = (item, keys) => {
    for (const key of keys) {
      const value = item?.[key];
      if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
    }
    return "";
  };
  const normalized = sourceRows.map(item => ({
    ...item,
    Kategori: read(item, ["Kategori", "kategori", "kategoriMesin", "kategori_mesin", "category"]) || "Mesin",
    Jenis: read(item, ["Jenis", "jenis", "jenisMesin", "jenis_mesin", "type"]),
    Nama: read(item, ["Nama", "nama", "namaMesin", "nama_mesin", "mesin"])
  })).filter(item => item.Jenis && item.Nama);
  const unique = new Map();
  normalized.forEach(item => {
    const key = `${item.Kategori}|${item.Jenis}|${item.Nama}`.toLocaleLowerCase("id-ID");
    unique.set(key, item);
  });
  if (!unique.size) {
    throw new Error("Master mesin tidak tersedia.");
  }
  return [...unique.values()];
}

const pageMeta = {
  dashboard: ["Dashboard", "Ringkasan operasional teknik hari ini"],
  monitoringWall: ["Monitoring Layar", "Tampilan operasional untuk monitor dinding"],
  orders: ["Order Kerja", "Daftar dan status pekerjaan perbaikan"],
  orderDetail: ["Detail Order", "Informasi lengkap permintaan perbaikan"],
  finishOrder: ["Penyelesaian Order", "Catat tindakan dan hasil perbaikan"],
  createOrder: ["Buat Order Kerja", "Buat permintaan pekerjaan baru"],
  maintenance: ["Perawatan", "Monitoring jadwal dan aktual perawatan"],
  schedule: ["Jadwal Perawatan", "Kalender preventive maintenance"],
  maintenanceForm: ["Isi Perawatan", "Rekam hasil aktivitas perawatan"],
  maintenancePrint: ["Cetak Perawatan", "Pilih dua checklist dalam satu kategori dan unduh sebagai PDF"],
  kpi: ["KPI Teknik", "Kinerja, pencapaian, dan downtime"],
  kpiFull: ["KPI Maintenance", "MTTR, MTBF, status, prioritas, dan repeat failure"],
  kpiMaintenance: ["Detail KPI Perawatan", "Analisis kepatuhan preventive maintenance"],
  kpiDowntime: ["Detail Downtime", "Analisis durasi dan sumber gangguan"],
  electricity: ["Pengecekan Listrik", "Input pemeriksaan energi dan panel"],
  electricityData: ["Data Listrik", "Riwayat hasil pemeriksaan kelistrikan"],
  oil: ["Cek Oli", "Monitoring level dan volume oli mesin"],
  jobs: ["Laporan Kerja", "Riwayat aktivitas tim teknik"],
  jobForm: ["Isi Laporan", "Dokumentasikan pekerjaan teknisi"],
  stock: ["Stok Part", "Ketersediaan komponen dan material"],
  stockUsage: ["Pemakaian Stok Part", "Catat sparepart yang keluar dan kurangi saldo stok"],
  partOrder: ["Bon Pesan", "Buat satu transaksi untuk maksimal 10 barang"],
  partRequests: ["Daftar Bon Pesan", "Riwayat transaksi permintaan barang"],
  stang: ["Logistik Stang", "Sirkulasi stang dan perlengkapan produksi"],
  more: ["Menu Lainnya", "Sub-sistem pendukung SiTeki"],
  catalog: ["Katalog", "Referensi komponen teknik"],
  transformer: ["Inspeksi Trafo Las", "Pemeriksaan dan database trafo las"],
  transformerForm: ["Isi Inspeksi Trafo Las", "Rekam kondisi trafo las"],
  transformerData: ["Data Trafo Las", "Master aset transformator las"],
  overtime: ["Lemburan", "Pengajuan serta riwayat kerja lembur"],
  overtimeRecap: ["Rekap Lembur", "Ringkasan upah lembur seluruh pengguna"],
  users: ["Manajemen Teknisi", "Sinkronisasi akses dan profil pengguna"],
  scanner: ["Pemindai QR", "Buka mesin dari kode identifikasi"],
  settings: ["Pengaturan", "Preferensi tampilan dan sistem"]
};

const navItems = [
  ["dashboard", "Beranda", Home],
  ["maintenance", "Perawatan", Wrench],
  ["oil", "Cek Oli", Droplets, ["Admin", "Teknik"]],
  ["electricity", "Listrik", Zap, ["Admin", "Teknik"]],
  ["orders", "Order Kerja", ClipboardList],
  ["jobs", "Laporan Kerja", FileBarChart],
  ["stock", "Stok Part", Boxes],
  ["kpi", "KPI", BarChart3],
  ["kpiFull", "KPI Lengkap", Gauge, ["Admin", "Teknik"]],
  ["users", "Teknisi", Users, ["Admin"]],
  ["transformer", "Trafo", Zap],
  ["overtime", "Lemburan", Clock3],
  ["overtimeRecap", "Rekap Lembur", FileBarChart, ["Admin"]],
  ["catalog", "Katalog", BookOpen],
  ["settings", "Pengaturan", Settings]
];

const categoryAccess = {
  Admin: ["maintenance", "oil", "jobs", "kpi", "electricity", "stang", "orders", "stock", "more"],
  Teknik: ["maintenance", "oil", "jobs", "kpi", "electricity", "stang", "orders", "stock", "more"],
  Gudang: ["kpi", "stang", "stock", "more"],
  Operator: ["kpi", "orders", "more"]
};

function publicOrderRequest() {
  const params = new URLSearchParams(window.location.search);
  const active = params.has("buatorder") || params.has("mesin") || params.has("namaMesin") || window.location.pathname.toLowerCase().includes("buatorder");
  return {
    active,
    machine: String(params.get("mesin") || params.get("namaMesin") || "").trim()
  };
}

const ELECTRICITY_QR_MODES = ["pln", "panel_1", "panel_2", "panel_3", "panel_4"];
const ELECTRICITY_PANELS = [
  { code: "panel_1", name: "Panel 1" }, { code: "panel_2", name: "Panel 2" },
  { code: "panel_3", name: "Panel 3" }, { code: "panel_4", name: "Panel 4" },
];
const ELECTRICITY_OFFICER_NAMES = ["Dody Kumala", "Herwidodo", "Irham Abdurahman", "M. Rizal Adi P."];
const REPORTING_SECTIONS = ["Tek. Shift A", "Tek. Shift B", "Bengkel", "Konstruksi"];
function electricityQrRequest(value = window.location.href) {
  try {
    const url = new URL(value, window.location.origin);
    const mode = String(url.searchParams.get("listrik") || "").toLowerCase();
    return { mode: ELECTRICITY_QR_MODES.includes(mode) ? mode : "" };
  } catch {
    const mode = String(value || "").trim().toLowerCase();
    return { mode: ELECTRICITY_QR_MODES.includes(mode) ? mode : "" };
  }
}

function App() {
  const [session, setSession] = useState(() => {
    try {
      return (
        JSON.parse(localStorage.getItem("siteki-session") || "null") ||
        JSON.parse(sessionStorage.getItem("siteki-session") || "null")
      );
    } catch {
      return null;
    }
  });
  const [initialElectricityMode] = useState(() => electricityQrRequest().mode);
  const [initialNotificationPage] = useState(() => { const target = new URLSearchParams(window.location.search).get("open"); return target && pageMeta[target] ? target : ""; });
  const [page, setPage] = useState(() => {
    if (initialElectricityMode) return "electricity";
    if (initialNotificationPage) return initialNotificationPage;
    try {
      const hash = window.location.hash.replace(/^#/, "");
      if (hash && pageMeta[hash]) return hash;
      const saved = sessionStorage.getItem("siteki-active-page");
      if (saved && pageMeta[saved]) return saved;
      const hist = window.history.state?.page;
      if (hist && pageMeta[hist]) return hist;
    } catch { }
    return "dashboard";
  });
  const [selectedOrder, setSelectedOrder] = useState(() => initialElectricityMode ? { electricityMode: initialElectricityMode, fromQr: true } : null);
  const [toast, setToast] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [themeMode, setThemeMode] = useState(() => {
    const saved = localStorage.getItem("siteki-theme");
    if (saved === "dark" || saved === "light") return saved;
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  });

  useEffect(() => {
    document.documentElement.dataset.theme = themeMode;
    document.documentElement.style.colorScheme = themeMode;
    localStorage.setItem("siteki-theme", themeMode);
  }, [themeMode]);
  useEffect(() => {
    if ("serviceWorker" in navigator) navigator.serviceWorker.register(new URL(`${import.meta.env.BASE_URL}sw.js`, window.location.href).href, { scope: new URL(import.meta.env.BASE_URL, window.location.href).pathname }).catch(() => { });
    const url = new URL(window.location.href);
    if (url.searchParams.has("open")) { url.searchParams.delete("open"); window.history.replaceState(window.history.state, "", url); }
  }, []);
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(""), 3200);
      return () => clearTimeout(timer);
    }
  }, [toast]);
  useEffect(() => {
    const handleExpired = () => {
      setSession(null);
      setToast("Sesi telah berakhir. Silakan login kembali.");
    };
    window.addEventListener("siteki-session-expired", handleExpired);
    return () => window.removeEventListener("siteki-session-expired", handleExpired);
  }, []);
  const publicOrder = useMemo(publicOrderRequest, []);

  useEffect(() => {
    if (!publicOrder.active && pageMeta[page]) {
      try {
        sessionStorage.setItem("siteki-active-page", page);
        if (window.location.hash !== `#${page}`) {
          window.history.replaceState({
            ...(window.history.state || {}),
            sitekiNavigation: true,
            sitekiDepth: Number(window.history.state?.sitekiDepth) || 0,
            page,
            selectedOrder
          }, "", `#${page}`);
        }
      } catch { }
    }
  }, [page, selectedOrder, publicOrder.active]);

  useEffect(() => {
    if (publicOrder.active) return undefined;
    const currentState = window.history.state || {};
    window.history.replaceState({
      ...currentState,
      sitekiNavigation: true,
      sitekiDepth: Number(currentState.sitekiDepth) || 0,
      page,
      selectedOrder
    }, "");
    const handleBrowserBack = event => {
      const navigation = event.state;
      if (!navigation?.sitekiNavigation || !pageMeta[navigation.page]) return;
      setPage(navigation.page);
      setSelectedOrder(navigation.selectedOrder || null);
      setSidebarOpen(false);
      window.scrollTo({ top: 0, behavior: "auto" });
    };
    window.addEventListener("popstate", handleBrowserBack);
    return () => window.removeEventListener("popstate", handleBrowserBack);
  }, [publicOrder.active]);

  const go = (target, data) => {
    if (target === page && !data) {
      setSidebarOpen(false);
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    try {
      sessionStorage.setItem("siteki-active-page", target);
    } catch { }
    const nextSelectedOrder = data || (["createOrder", "electricity"].includes(target) ? null : selectedOrder);
    const currentDepth = Number(window.history.state?.sitekiDepth) || 0;
    window.history.pushState({
      sitekiNavigation: true,
      sitekiDepth: currentDepth + 1,
      page: target,
      selectedOrder: nextSelectedOrder
    }, "", `#${target}`);
    setSelectedOrder(nextSelectedOrder);
    setPage(target);
    setSidebarOpen(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const back = () => {
    const navigation = window.history.state;
    if (navigation?.sitekiNavigation && Number(navigation.sitekiDepth) > 0) {
      window.history.back();
      return;
    }
    try {
      sessionStorage.setItem("siteki-active-page", "dashboard");
    } catch { }
    window.history.replaceState({ sitekiNavigation: true, sitekiDepth: 0, page: "dashboard", selectedOrder: null }, "", "#dashboard");
    setSelectedOrder(null);
    setPage("dashboard");
    setSidebarOpen(false);
    window.scrollTo({ top: 0, behavior: "auto" });
  };
  const logout = () => {
    apiPost(ENDPOINTS.users, { action: "logout", token: session?.token || "" }, { timeout: 5000 }).catch(() => { });
    try {
      localStorage.removeItem("siteki-session");
      sessionStorage.removeItem("siteki-session");
      sessionStorage.removeItem("siteki-active-page");
      window.location.hash = "";
    } catch { }
    setSession(null);
    setPage("dashboard");
    setSelectedOrder(null);
    window.history.replaceState({ sitekiNavigation: true, sitekiDepth: 0, page: "dashboard", selectedOrder: null }, "", "");
  };

  if (publicOrder.active) return <PublicWorkOrder initialMachine={publicOrder.machine} />;

  if (!session) return <Login onLogin={(user) => {
    try {
      localStorage.setItem("siteki-session", JSON.stringify(user));
      sessionStorage.setItem("siteki-session", JSON.stringify(user));
    } catch { }
    setSession(user);
  }} />;

  if (page === "monitoringWall") return <MonitoringWall session={session} onExit={back} />;

  return (
    <div className="app-shell">
      <Sidebar page={page} role={session.role} open={sidebarOpen} onClose={() => setSidebarOpen(false)} go={go} logout={logout} />
      <main className="main">
        <Topbar session={session} page={page} onMenu={() => setSidebarOpen(true)} go={go} logout={logout} notify={setToast} />
        <div className="page">
          {page !== "dashboard" && <button className="back-link" onClick={back}><ArrowLeft size={17} /> Kembali</button>}
          <PageHeader page={page} />
          <PageRouter page={page} go={go} session={session} selectedOrder={selectedOrder} notify={setToast} themeMode={themeMode} setThemeMode={setThemeMode} />
        </div>
      </main>
      <MobileNav page={page} go={go} />
      {toast && <div className="toast"><CheckCircle2 size={19} />{toast}</div>}
    </div>
  );
}

function PublicWorkOrder({ initialMachine }) {
  const [message, setMessage] = useState("");
  const [completed, setCompleted] = useState(false);
  if (completed) return <div className="public-order-page">
    <div className="public-order-shell public-order-success">
      <span className="icon-box mint"><CheckCircle2 /></span>
      <p className="eyebrow">Order berhasil dikirim</p>
      <h1>Terima kasih.</h1>
      <p>Permintaan perbaikan sudah masuk ke sistem SiTeki dan dapat langsung ditindaklanjuti tim Teknik.</p>
      <button className="primary" onClick={() => { setCompleted(false); setMessage(""); }}>Buat order lainnya</button>
    </div>
  </div>;
  return <div className="public-order-page">
    <header className="public-order-header"><div className="brand-mark"><span>ST</span></div><div><b>SiTeki</b><small>Form Order Kerja Publik</small></div><span className="public-access"><ShieldCheck size={15} /> Akses terbatas</span></header>
    <main className="public-order-shell">
      <div className="public-order-intro"><p className="eyebrow">PT. Pabrik Besi Beton Raja Besi</p><h1>Buat Order Kerja</h1><p>Laporkan kerusakan mesin tanpa akun. Halaman ini hanya dapat mengirim order dan tidak dapat membuka data internal SiTeki.</p></div>
      {message && <div className="public-order-message"><CheckCircle2 size={17} />{message}</div>}
      <WorkOrderForm initialMachine={initialMachine} notify={setMessage} onSuccess={() => setCompleted(true)} />
    </main>
  </div>;
}

function Login({ onLogin }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function submit(e) {
    e.preventDefault();
    if (loading) return;
    const cleanUser = String(username || "").trim();
    const cleanPass = String(password || "").trim();
    if (!cleanUser || !cleanPass) return setError("Username dan password wajib diisi.");
    setLoading(true); setError("");
    try {
      const result = await apiPost(
        ENDPOINTS.users,
        { action: "login", username: cleanUser, password: cleanPass },
        { timeout: 45000, retries: 1 }
      );
      if (String(result.status).toLowerCase() !== "success") throw new Error(result.message || "Kredensial tidak dikenali.");
      if (!result.token) throw new Error("Server login belum menggunakan sesi aman. Silakan hubungi admin.");
      const profile = result.profile || {};
      onLogin({ username: profile.username || cleanUser, name: profile.nama || "Karyawan Raja Besi", role: profile.role || "Operator", token: result.token || "" });
    } catch (err) {
      const rawMsg = String(err?.message || "");
      if (/aborted/i.test(rawMsg) || /timeout/i.test(rawMsg) || err?.name === "AbortError") {
        setError("Waktu verifikasi habis atau koneksi terputus. Pastikan internet stabil dan coba lagi.");
      } else if (/failed to fetch|network|load failed/i.test(rawMsg)) {
        setError("Tidak dapat terhubung ke server. Periksa koneksi internet Anda dan coba lagi.");
      } else {
        setError(rawMsg || "Tidak dapat terhubung ke server login.");
      }
    } finally { setLoading(false); }
  }

  return (
    <div className="login-page">
      <div className="login-art">
        <div className="login-brand">
          <div className="brand-mark large"><span>ST</span></div>
          <div><b>SiTeki</b><small>Sistem Informasi Teknik</small></div>
        </div>
        <div className="login-art-content">
          <span className="login-kicker"><span /> Engineering operations platform</span>
          <h1>Kinerja teknik.<br /><em>Lebih terukur.</em></h1>
          <p className="login-copy">Kelola perawatan, order kerja, inspeksi, dan inventori dalam satu sistem operasional yang terintegrasi.</p>
          <div className="login-capabilities">
            <div><span><Activity size={18} /></span><p><b>Monitoring terpusat</b><small>Ringkasan operasional dalam satu tampilan</small></p></div>
            <div><span><Database size={18} /></span><p><b>Data terdokumentasi</b><small>Riwayat pekerjaan tersimpan dan terlacak</small></p></div>
          </div>
        </div>
        <div className="login-art-footer"><span><i /> Sistem operasional aktif</span><small>PT. Pabrik Besi Beton Raja Besi</small></div>
      </div>
      <div className="login-access">
        <form className="login-card" onSubmit={submit}>
          <div className="mobile-brand"><div className="brand-mark"><span>ST</span></div><div><b>SiTeki</b><small>Sistem Informasi Teknik</small></div></div>
          <div className="mobile-login-intro">
            <span><i /> Sistem operasional aktif</span>
            <h1>Operasional teknik.<br /><em>Dalam satu kendali.</em></h1>
          </div>
          <div className="login-card-head">
            <span className="login-secure-icon"><LockKeyhole size={20} /></span>
            <p className="eyebrow">Portal internal</p>
            <h2>Selamat datang kembali</h2>
            <p className="muted">Masukkan kredensial akun untuk melanjutkan ke ruang kerja Anda.</p>
          </div>
          <label className="login-field">
            <span>Username</span>
            <div><UserRound size={18} /><input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Masukkan username" autoComplete="username" autoCapitalize="none" autoFocus /></div>
          </label>
          <label className="login-field">
            <span>Password</span>
            <div><LockKeyhole size={18} /><input type={showPassword ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Masukkan password" autoComplete="current-password" /><button type="button" className="password-toggle" onClick={() => setShowPassword(value => !value)} aria-label={showPassword ? "Sembunyikan password" : "Tampilkan password"}>{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button></div>
          </label>
          {error && <p className="error login-error" role="alert"><AlertTriangle size={16} />{error}</p>}
          <button className="primary wide login-submit" disabled={loading}>{loading ? <><span className="spinner" />Memverifikasi akses...</> : <><span>Masuk ke sistem</span><ArrowRight size={18} /></>}</button>
          <div className="login-note"><ShieldCheck size={17} /><p><b>Akses terlindungi</b><span>Kredensial Anda diverifikasi melalui sistem pengguna SiTeki.</span></p></div>
        </form>
        <p className="login-copyright">&copy; {new Date().getFullYear()} SiTeki &middot; Engineering Department</p>
      </div>
    </div>
  );
}

function Sidebar({ page, role, open, onClose, go, logout }) {
  const visibleNavItems = navItems.filter(([, , , roles]) => !roles || roles.includes(role));
  return <>
    {open && <div className="overlay" onClick={onClose} />}
    <aside className={`sidebar ${open ? "open" : ""}`}>
      <div className="brand"><div className="brand-mark"><span>ST</span></div><div><b>SiTeki</b><small>Engineering System</small></div><button className="close-side" onClick={onClose}><X /></button></div>
      <nav>
        <p className="nav-label">Workspace</p>
        {visibleNavItems.map(([id, label, Icon]) => <button key={id} className={page === id ? "active" : ""} onClick={() => go(id)}><Icon size={19} /><span>{label}</span></button>)}
      </nav>
      <div className="sidebar-bottom">
        <div className="role-chip"><ShieldCheck size={16} /><span>Akses {role}</span></div>
        <button onClick={logout}><LogOut size={18} />Keluar sistem</button>
      </div>
    </aside>
  </>;
}

function Topbar({ session, page, onMenu, go, logout, notify }) {
  const [mobileHidden, setMobileHidden] = useState(false);
  useEffect(() => {
    let lastY = window.scrollY, travel = 0, direction = 0, frame = 0;
    const update = () => {
      frame = 0;
      if (window.innerWidth > 820) { setMobileHidden(false); lastY = window.scrollY; return; }
      const currentY = Math.max(0, window.scrollY);
      const delta = currentY - lastY;
      if (Math.abs(delta) < 1.5) return;
      const nextDirection = delta > 0 ? 1 : -1;
      if (nextDirection !== direction) { direction = nextDirection; travel = 0; }
      travel += Math.abs(delta);
      if (currentY <= 18) setMobileHidden(false);
      else if (direction > 0 && currentY > 70 && travel >= 10) setMobileHidden(true);
      else if (direction < 0 && travel >= 8) setMobileHidden(false);
      lastY = currentY;
    };
    const schedule = () => { if (!frame) frame = window.requestAnimationFrame(update); };
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => { window.removeEventListener("scroll", schedule); window.removeEventListener("resize", schedule); if (frame) window.cancelAnimationFrame(frame); };
  }, []);
  return <header className={`topbar ${mobileHidden ? "mobile-hidden" : ""}`}>
    <button type="button" className="menu-toggle" onClick={onMenu} aria-label="Buka menu navigasi" title="Buka menu"><Menu /></button>
    <div className="crumb"><span>SiTeki</span><b>/</b><strong>{pageMeta[page]?.[0] || "Workspace"}</strong></div>
    <div className="top-actions">
      <button className="icon-button" onClick={() => go("scanner")}><QrCode size={19} /></button>
      <button className="icon-button notification" onClick={() => go("settings")} title="Pengaturan notifikasi"><Bell size={19} /><i /></button>
      <div className="user-menu">
        <div className="avatar">{session.name.split(" ").map((x) => x[0]).slice(0, 2).join("")}</div>
        <div><b>{session.name}</b><small>{session.role}</small></div>
        <ChevronDown size={16} />
        <button className="user-logout" onClick={logout}>Keluar</button>
      </div>
    </div>
  </header>;
}

function MobileNav({ page, go }) {
  return <nav className="mobile-nav">{[
    ["dashboard", Home, "Beranda"], ["maintenance", Wrench, "Rawat"], ["scanner", QrCode, "Scan"], ["jobs", FileBarChart, "Laporan"], ["more", MoreHorizontal, "Lainnya"]
  ].map(([id, Icon, label]) => <button key={id} className={page === id ? "active" : ""} onClick={() => go(id)}><Icon size={id === "scanner" ? 23 : 19} /><span>{label}</span></button>)}</nav>;
}

function PageHeader({ page }) {
  const meta = pageMeta[page] || ["Workspace", "Sistem informasi teknik"];
  return <div className="page-heading"><div><p className="eyebrow">PT. Pabrik Besi Beton Raja Besi</p><h1>{meta[0]}</h1><p>{meta[1]}</p></div><div className="live"><span /> Sistem aktif</div></div>;
}

function PageRouter({ page, go, session, selectedOrder, notify, themeMode, setThemeMode }) {
  const props = { go, notify, session };
  switch (page) {
    case "dashboard": return <Dashboard {...props} />;
    case "orders": return <Orders {...props} />;
    case "orderDetail": return selectedOrder ? <OrderDetail {...props} order={selectedOrder} /> : <RemoteState empty />;
    case "finishOrder": return selectedOrder ? <FinishOrder {...props} order={selectedOrder} /> : <RemoteState empty />;
    case "createOrder": return <WorkOrderForm {...props} initialMachine={selectedOrder?.fromScanner ? selectedOrder.namaMesin : ""} />;
    case "maintenance": return <Maintenance {...props} />;
    case "schedule": return <Schedule {...props} />;
    case "maintenanceForm": return <MaintenanceForm {...props} selectedOrder={selectedOrder} />;
    case "maintenancePrint": return <MaintenancePrint {...props} />;
    case "kpi": return <KPI {...props} />;
    case "kpiFull": return ["Admin", "Teknik"].includes(session.role)
      ? <MaintenanceKpiPage />
      : <SecurityLocked title="KPI maintenance hanya untuk Admin dan Teknik" />;
    case "kpiMaintenance": return <KPIDetail {...props} kind="Perawatan" />;
    case "kpiDowntime": return <KPIDetail {...props} kind="Downtime" />;
    case "electricity": return <Electricity {...props} selectedOrder={selectedOrder} />;
    case "electricityData": return <ElectricityDataPage {...props} />;
    case "oil": return ["Admin", "Teknik"].includes(session.role)
      ? <OilMonitoring {...props} />
      : <SecurityLocked title="Menu cek oli hanya untuk Admin dan Teknik" />;
    case "jobs": return <Jobs {...props} />;
    case "jobForm": return <JobForm {...props} />;
    case "stock": return <Stock {...props} />;
    case "stockUsage": return ["Admin", "Teknik", "Gudang"].includes(session.role)
      ? <StockUsage {...props} />
      : <SecurityLocked title="Pemakaian stok hanya untuk Admin, Teknik, dan Gudang" />;
    case "partOrder": return <PartOrder {...props} />;
    case "partRequests": return <PartRequests {...props} />;
    case "more": return <More {...props} />;
    case "transformer": return <TransformerMenu {...props} />;
    case "transformerForm": return <TransformerForm {...props} />;
    case "transformerData": return <DataTablePage {...props} kind="travo" />;
    case "overtime": return <OvertimeEntry {...props} />;
    case "overtimeRecap": return session.role === "Admin" ? <OvertimeAdmin {...props} /> : <SecurityLocked title="Rekap lembur dikunci" />;
    case "users": return <UserManagement {...props} />;
    case "catalog": return <Catalog />;
    case "stang": return <Stang {...props} />;
    case "scanner": return <Scanner {...props} />;
    case "settings": return <SettingsPage notify={notify} themeMode={themeMode} onThemeChange={setThemeMode} session={session} />;
    default: return <Dashboard {...props} />;
  }
}

function Dashboard({ go, session }) {
  const canViewOvertimeChart = ["admin", "teknik"].includes(String(session.role || "").toLowerCase());
  const today = new Date();
  const currentPeriodEnd = today.getMonth() + 1;
  const currentYear = today.getFullYear();
  const ordersRemote = useRemoteData(async () =>
    asArray(await apiGet(ENDPOINTS.dashboardOrders, { action: "getAllOrders" }))
      .map(normalizeOrder)
      .filter((o) => o.status.toLowerCase() === "open")
  );
  const maintenanceRemote = useRemoteData(async () =>
    asArray(await apiGet(ENDPOINTS.maintenance, { action: "getPerawatan" }))
  );
  const kpiRemote = useRemoteData(async () => asArray(await apiGet(ENDPOINTS.kpi)));
  const kpiCombinedRemote = useRemoteData(async () =>
    asArray(await apiGet(ENDPOINTS.kpiCombined), ["rekap"])
  );
  const dailyKpiRemote = useRemoteData(async () => {
    const result = await apiGet(ENDPOINTS.kpiDaily, { year: currentYear });
    if (!isSuccess(result)) throw new Error(result.message || "KPI harian tidak dapat dimuat.");
    return result.data || {};
  }, [currentYear]);
  const overtimeSummaryRemote = useRemoteData(async () => {
    if (!canViewOvertimeChart) return [];
    const result = await apiPost(ENDPOINTS.users, { action: "getOvertimeChart", token: session.token, year: new Date().getFullYear() }, { timeout: 90000 });
    if (!isSuccess(result)) throw new Error(result.message || "Grafik lembur tidak dapat diakses.");
    return result;
  }, [session.token, canViewOvertimeChart]);
  const monthlyKvarhRemote = useRemoteData(async () => {
    const result = await apiGet(ENDPOINTS.electricity, { action: "getMonthlyKvarh", year: currentYear });
    return asArray(result?.data);
  }, [currentYear]);
  const electricityChecksRemote = useRemoteData(async () => asArray(await apiGet(ENDPOINTS.electricity, { action: "getData" })));
  const cosPhiChartRemote = useRemoteData(async () => asArray(await apiGet(ENDPOINTS.electricity, { action: "getPanelData" })));
  const partRequestsRemote = useRemoteData(async () =>
    asArray(await apiGet(ENDPOINTS.partRequests, { action: "getDaftarBon" }, { cache: false, timeout: 45000 }))
      .filter(item => String(item.status || "").toLowerCase() === "open")
  );
  const activeOrders = ordersRemote.data;
  const actualMaintenance = maintenanceRemote.data;
  const maintenanceAgenda = useMemo(
    () => buildMaintenanceAgenda(actualMaintenance, new Date()),
    [actualMaintenance]
  );
  const yearToDateLabel = `Jan–${new Intl.DateTimeFormat("id-ID", { month: "short" }).format(today)} ${currentYear}`;
  const maintenanceKpi = trimChartSeries(kpiRemote.data
    .map(x => ({ label: monthName(x.bulan), value: Math.round(Number(x.pencapaian || 0) * 100) }))
    .slice(0, currentPeriodEnd));
  const downtimeKpi = trimChartSeries(kpiCombinedRemote.data
    .map(x => ({ label: monthName(x.bulan), value: Number(x.jam || 0) }))
    .slice(0, currentPeriodEnd));
  const orderKpi = trimChartSeries(kpiCombinedRemote.data
    .map(x => ({ label: monthName(x.bulan), value: Number(x.order || 0) }))
    .slice(0, currentPeriodEnd));
  const overtimeKpi = trimChartSeries(asArray(overtimeSummaryRemote.data)
    .map(x => ({ label: monthName(x.bulan), value: Number(x.totalJam || 0) }))
    .slice(0, currentPeriodEnd));
  const latestMaintenanceIndex = Math.max(0, maintenanceKpi.findLastIndex(x => x.value > 0));
  const latestCombinedIndex = Math.max(0, kpiCombinedRemote.data.findLastIndex(x => Number(x.jam || 0) > 0 || Number(x.order || 0) > 0));
  const health = maintenanceKpi[latestMaintenanceIndex]?.value || 0;
  const maintenanceTarget = Math.round(Number(kpiRemote.data[latestMaintenanceIndex]?.target || .8) * 100);
  const downtimeTarget = Number(kpiCombinedRemote.data[latestCombinedIndex]?.target || 500);
  const downtimeYearToDate = kpiCombinedRemote.data
    .slice(0, today.getMonth() + 1)
    .reduce((total, item) => total + Number(item.jam || 0), 0);
  const downtimeYearToDateLabel = new Intl.NumberFormat("id-ID", {
    minimumFractionDigits: 1, maximumFractionDigits: 1
  }).format(downtimeYearToDate);
  const downtimeDateRange = `1 Jan–${new Intl.DateTimeFormat("id-ID", {
    day: "numeric", month: "short", year: "numeric"
  }).format(today)}`;
  const openPartRequests = partRequestsRemote.data;
  const access = categoryAccess[session.role] || categoryAccess.Operator;
  const categories = [
    ["maintenance", "Perawatan", Wrench, "Jadwal & aktual", "mint"],
    ["oil", "Cek Oli", Droplets, "Level & volume", "blue"],
    ["jobs", "Laporan Kerja", FileBarChart, "Aktivitas teknisi", "blue"],
    ["kpi", "KPI", BarChart3, "Performa teknik", "amber"],
    ["electricity", "Listrik", Zap, "Panel & energi", "violet"],
    ["stang", "Stang", SlidersHorizontal, "Sirkulasi alat", "blue"],
    ["orders", "Order Kerja", ClipboardList, "Permintaan kerja", "amber"],
    ["stock", "Part", Package, "Stok & permintaan", "violet"],
    ["more", "Lainnya", AppWindow, "Sub sistem", "mint"]
  ].filter(([id]) => access.includes(id));
  return <>
    <section className="hero-panel">
      <div className="hero-content"><p className="hero-eyebrow">{new Intl.DateTimeFormat("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date())}</p><h2>Selamat bekerja, {session.name.split(" ")[0]}.</h2><p className="hero-desc">Data langsung dari sistem. Ada <b>{activeOrders.length} order terbuka</b> dan <b>{actualMaintenance.length} catatan perawatan</b> pada basis data.</p>
        <div className="hero-actions"><button className="btn-hero btn-primary" onClick={() => go("partOrder")}><Plus size={20} /> Buat bon</button><button className="btn-hero btn-secondary" onClick={() => go("schedule")}><CalendarDays size={20} /> Lihat jadwal</button></div>
      </div>
      <div className="health-ring-container">
        <div className="health-ring ring-1"></div>
        <div className="health-ring ring-2"></div>
        <div className="health-ring ring-3"></div>
        <div className="health-center">
          <Activity size={32} />
          <strong>{kpiRemote.loading ? "..." : `${health}%`}</strong>
          <span>KPI</span>
        </div>
      </div>
    </section>
    <div className="stats-grid">
      <ModernStatCard icon={ClipboardList} label="Order terbuka" value={ordersRemote.loading ? 0 : activeOrders.length} detail="Data Neon" color="mint" delay={0} />
      <ModernStatCard icon={TimerReset} label="Downtime YTD" value={kpiCombinedRemote.loading ? 0 : downtimeYearToDate} unit=" jam" detail={downtimeDateRange} color="blue" delay={100} />
      <ModernStatCard icon={Gauge} label="KPI Perawatan" value={kpiRemote.loading ? 0 : health} unit="%" detail="Data KPI terbaru" color="amber" delay={200} />
      <ModernStatCard icon={Package} label="Bon Sparepart Open" value={partRequestsRemote.loading ? 0 : openPartRequests.length} detail={partRequestsRemote.error ? "Data bon gagal dimuat" : "Klik untuk melihat daftar lengkap"} previewItems={openPartRequests.map(item => item.nama).filter(Boolean)} color="violet" delay={300} onClick={() => go("partRequests")} />
    </div>
    <div className="section-title dashboard-kpi-title"><div><p className="eyebrow">Live performance</p><h2>Ringkasan KPI Teknik</h2></div><div className="dashboard-kpi-actions"><button className="secondary small" onClick={() => go("monitoringWall")}><Monitor size={15} /> Mode monitor</button><button className="secondary small" onClick={() => go("kpiFull")}>Lihat KPI lengkap <ArrowRight size={15} /></button></div></div>
    <div className="dashboard-kpi-grid">
      <ModernKpiCard title="Downtime" subtitle="Akumulasi gangguan mesin" dailySubtitle="Downtime aktual per hari" icon={TimerReset} value={kpiCombinedRemote.loading ? 0 : downtimeYearToDate} decimals={1} unit="jam" period={yearToDateLabel} data={downtimeKpi} dailyData={asArray(dailyKpiRemote.data?.downtime)} year={currentYear} enablePeriod target={downtimeTarget} targetLabel={`Batas ${downtimeTarget} jam/bulan`} color="#ff9f1c" onClick={() => go("kpiDowntime")} />
      <ModernKpiCard title="Perawatan" subtitle="Pencapaian preventive maintenance" dailySubtitle="Jumlah pemeriksaan aktual per hari" icon={Wrench} value={kpiRemote.loading ? 0 : health} unit="%" dailyUnit="cek" period={`${maintenanceKpi.at(-1)?.label || "-"} ${currentYear}`} data={maintenanceKpi} dailyData={asArray(dailyKpiRemote.data?.maintenance)} year={currentYear} enablePeriod target={maintenanceTarget} targetLabel={`Target ${maintenanceTarget}%`} color="#22c55e" onClick={() => go("kpiMaintenance")} />
      <ModernKpiCard title="Order Kerja" subtitle="Permintaan pekerjaan bulanan" dailySubtitle="Laporan/order tercatat per hari" icon={ClipboardList} value={kpiCombinedRemote.loading ? 0 : orderKpi.at(-1)?.value || 0} unit="WO" period={`${orderKpi.at(-1)?.label || "-"} ${currentYear}`} data={orderKpi} dailyData={asArray(dailyKpiRemote.data?.orders)} year={currentYear} enablePeriod color="#ec4899" onClick={() => go("kpi")} />
      {canViewOvertimeChart && <ModernKpiCard title="Jam Lembur" subtitle="Akumulasi Admin & Teknik" dailySubtitle="Jam lembur aktual per hari" icon={Clock3} value={overtimeSummaryRemote.loading ? 0 : overtimeKpi.reduce((a, b) => a + b.value, 0)} decimals={1} unit="jam" period={yearToDateLabel} data={overtimeKpi} dailyData={asArray(overtimeSummaryRemote.data?.daily)} year={currentYear} enablePeriod color="#22d3ee" />}
    </div>
    <MonthlyKvarhCard data={monthlyKvarhRemote.data} rawData={electricityChecksRemote.data} loading={monthlyKvarhRemote.loading} rawLoading={electricityChecksRemote.loading} error={monthlyKvarhRemote.error} rawError={electricityChecksRemote.error} year={currentYear} onRetry={() => { monthlyKvarhRemote.reload(); electricityChecksRemote.reload(); }} />
    <CosPhiPanelChart data={cosPhiChartRemote.data} loading={cosPhiChartRemote.loading} error={cosPhiChartRemote.error} year={currentYear} onRetry={cosPhiChartRemote.reload} />
    <div className="section-title"><div><p className="eyebrow">Quick access</p><h2>Kategori kerja</h2></div></div>
    <div className="category-grid">{categories.map(([id, label, Icon, sub, tone]) => <button className="category-card" key={id} onClick={() => go(id)}><span className={`icon-box ${tone}`}><Icon size={23} /></span><b>{label}</b><small>{sub}</small><ArrowRight size={17} /></button>)}</div>
    <div className="dashboard-columns">
      <Panel title="Order kerja aktif" action={<button onClick={() => go("orders")}>Lihat semua <ArrowRight size={15} /></button>}>
        <RemoteState loading={ordersRemote.loading} error={ordersRemote.error} empty={!activeOrders.length} onRetry={ordersRemote.reload} />
        {!ordersRemote.loading && !ordersRemote.error && activeOrders.length > 0 && <OrderTable orders={activeOrders.slice(0, 5)} onClick={(o) => go("orderDetail", o)} />}
      </Panel>
      <Panel title="Agenda terdekat" action={<button onClick={() => go("schedule")}>Jadwal</button>}>
        <RemoteState loading={maintenanceRemote.loading} error={maintenanceRemote.error} onRetry={maintenanceRemote.reload} />
        {!maintenanceRemote.loading && !maintenanceRemote.error && <>
          <div className={`agenda-context ${maintenanceAgenda.source === "previous-week" ? "overdue" : ""}`}>
            <CalendarDays size={16} />
            <span>
              <b>{maintenanceAgenda.title}</b>
              <small>{maintenanceAgenda.description}</small>
            </span>
          </div>
          {maintenanceAgenda.items.length > 0
            ? <div className="agenda">{maintenanceAgenda.items.map((item) =>
              <button
                key={`${item.name}-${item.date}`}
                onClick={() => go("maintenanceForm", { schedule: { name: item.name, date: item.isoDate, status: item.status } })}
              >
                <span className={`date-box ${maintenanceAgenda.source === "today" ? "today" : "overdue"}`}>
                  <b>{String(item.day).padStart(2, "0")}</b>
                  <small>{String(item.month).padStart(2, "0")}</small>
                </span>
                <span>
                  <b>{item.name}</b>
                  <small><em className={`agenda-type ${item.status === "B" ? "monthly" : "weekly"}`}>{item.type}</em> · {item.note}</small>
                </span>
                <ArrowRight size={16} />
              </button>)}</div>
            : <div className="agenda-empty"><CheckCircle2 size={22} /><b>Tidak ada perawatan tertunda</b><small>Jadwal hari ini dan minggu sebelumnya sudah selesai atau memang kosong.</small></div>}
        </>}
      </Panel>
    </div>
  </>;
}

function MonitoringWall({ session, onExit }) {
  const canViewOvertimeChart = ["admin", "teknik"].includes(String(session.role || "").toLowerCase());
  const [refreshKey, setRefreshKey] = useState(0);
  const [clock, setClock] = useState(new Date());
  const [isFullscreen, setIsFullscreen] = useState(Boolean(document.fullscreenElement));
  const [chartPickerOpen, setChartPickerOpen] = useState(false);
  const [focusedChart, setFocusedChart] = useState("");
  const [energySlideIndex, setEnergySlideIndex] = useState(0);
  const [workSlideIndex, setWorkSlideIndex] = useState(0);
  const [reportSlideIndex, setReportSlideIndex] = useState(0);
  const [missingReportIndex, setMissingReportIndex] = useState(0);
  const [agendaSlideIndex, setAgendaSlideIndex] = useState(0);
  const [selectedCharts, setSelectedCharts] = useState({ kvarh: false, cosphi: false, orders: false, overtime: false, downtime: false, maintenance: false, reports: false, active_orders: false, part_requests: false, maintenance_due: false });
  const visibleCharts = { kvarh: true, cosphi: true, orders: true, overtime: true, downtime: true, maintenance: true };
  const wakeLockRef = useRef(null);
  const dataVersionRef = useRef(null);
  const today = clock, currentYear = today.getFullYear(), currentPeriodEnd = today.getMonth() + 1;
  useEffect(() => {
    let stopped = false;
    const clockTimer = window.setInterval(() => setClock(new Date()), 1000);
    const checkForChanges = async () => {
      try {
        const result = await apiGet(ENDPOINTS.monitoringVersion, {}, { cache: false, timeout: 5000 });
        if (stopped) return;
        const version = Number(result?.version || 0);
        if (dataVersionRef.current === null) dataVersionRef.current = version;
        else if (version !== dataVersionRef.current) { dataVersionRef.current = version; setRefreshKey(key => key + 1); }
      } catch {/* Tombol refresh manual tetap tersedia ketika pemeriksaan versi terputus. */ }
    };
    checkForChanges();
    const versionTimer = window.setInterval(checkForChanges, 3000);
    const fullscreenChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", fullscreenChange);
    return () => { stopped = true; window.clearInterval(clockTimer); window.clearInterval(versionTimer); document.removeEventListener("fullscreenchange", fullscreenChange); wakeLockRef.current?.release?.().catch(() => { }); };
  }, []);
  useEffect(() => {
    const keepSessionAlive = () => apiPost(ENDPOINTS.users, { action: "getMyProfile", token: session.token }, { timeout: 10000 }).catch(() => { });
    const keepAliveTimer = window.setInterval(keepSessionAlive, 4 * 60 * 60 * 1000);
    return () => window.clearInterval(keepAliveTimer);
  }, [session.token]);
  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) { await document.exitFullscreen(); screen.orientation?.unlock?.(); wakeLockRef.current?.release?.().catch(() => { }); wakeLockRef.current = null; }
      else { await document.documentElement.requestFullscreen(); await screen.orientation?.lock?.("landscape")?.catch(() => { }); if (navigator.wakeLock?.request) wakeLockRef.current = await navigator.wakeLock.request("screen"); }
    } catch {/* Browser dapat menolak fullscreen/wake lock; tampilan monitor tetap dapat digunakan. */ }
  };
  const leave = async () => { if (document.fullscreenElement) await document.exitFullscreen().catch(() => { }); onExit(); };
  const kpiRemote = useRemoteData(async () => asArray(await apiGet(ENDPOINTS.kpi, {}, { cache: false })), [refreshKey], { silentRefresh: true });
  const combinedRemote = useRemoteData(async () => asArray(await apiGet(ENDPOINTS.kpiCombined, {}, { cache: false }), ["rekap"]), [refreshKey], { silentRefresh: true });
  const ordersRemote = useRemoteData(async () => asArray(await apiGet(ENDPOINTS.dashboardOrders, { action: "getAllOrders" }, { cache: false })).map(normalizeOrder).filter(order => order.status.toLowerCase() === "open"), [refreshKey], { silentRefresh: true });
  const partRequestsRemote = useRemoteData(async () => asArray(await apiGet(ENDPOINTS.partRequests, { action: "getDaftarBon" }, { cache: false, timeout: 45000 })).filter(item => String(item.status || "").toLowerCase() === "open"), [refreshKey], { silentRefresh: true });
  const maintenanceRemote = useRemoteData(async () => asArray(await apiGet(ENDPOINTS.maintenance, { action: "getPerawatan" }, { cache: false })), [refreshKey], { silentRefresh: true });
  const reportsRemote = useRemoteData(async () => asArray(await apiGet(ENDPOINTS.jobs, { action: "getLaporanKerja", bulan: "", tglAwal: "", tglAkhir: "" }, { cache: false })), [refreshKey], { silentRefresh: true });
  const overtimeRemote = useRemoteData(async () => {
    if (!canViewOvertimeChart) return [];
    const result = await apiPost(ENDPOINTS.users, { action: "getOvertimeChart", token: session.token, year: currentYear }, { timeout: 90000 });
    if (!isSuccess(result)) throw new Error(result.message || "Grafik lembur tidak dapat diakses.");
    return asArray(result);
  }, [refreshKey, session.token, currentYear, canViewOvertimeChart], { silentRefresh: true });
  const monthlyKvarhRemote = useRemoteData(async () => {
    const result = await apiGet(ENDPOINTS.electricity, { action: "getMonthlyKvarh", year: currentYear }, { cache: false }); return asArray(result?.data);
  }, [refreshKey, currentYear], { silentRefresh: true });
  const electricityChecksRemote = useRemoteData(async () => asArray(await apiGet(ENDPOINTS.electricity, { action: "getData" }, { cache: false })), [refreshKey], { silentRefresh: true });
  const cosPhiRemote = useRemoteData(async () => asArray(await apiGet(ENDPOINTS.electricity, { action: "getPanelData" }, { cache: false })), [refreshKey], { silentRefresh: true });
  const maintenanceKpi = trimChartSeries(kpiRemote.data.map(item => ({ label: monthName(item.bulan), value: Math.round(Number(item.pencapaian || 0) * 100) })).slice(0, currentPeriodEnd));
  const downtimeKpi = trimChartSeries(combinedRemote.data.map(item => ({ label: monthName(item.bulan), value: Number(item.jam || 0) })).slice(0, currentPeriodEnd));
  const orderKpi = trimChartSeries(combinedRemote.data.map(item => ({ label: monthName(item.bulan), value: Number(item.order || 0) })).slice(0, currentPeriodEnd));
  const overtimeKpi = trimChartSeries(overtimeRemote.data.map(item => ({ label: monthName(item.bulan), value: Number(item.totalJam || 0) })).slice(0, currentPeriodEnd));
  const latestMaintenanceIndex = Math.max(0, maintenanceKpi.findLastIndex(item => item.value > 0));
  const latestCombinedIndex = Math.max(0, combinedRemote.data.findLastIndex(item => Number(item.jam || 0) > 0 || Number(item.order || 0) > 0));
  const health = maintenanceKpi[latestMaintenanceIndex]?.value || 0;
  const maintenanceTarget = Math.round(Number(kpiRemote.data[latestMaintenanceIndex]?.target || .8) * 100);
  const downtimeTarget = Number(combinedRemote.data[latestCombinedIndex]?.target || 500);
  const downtimeYearToDate = combinedRemote.data.slice(0, currentPeriodEnd).reduce((total, item) => total + Number(item.jam || 0), 0);
  const openPartRequests = partRequestsRemote.data;
  const maintenanceAgenda = useMemo(() => buildMaintenanceAgenda(maintenanceRemote.data, today), [maintenanceRemote.data, today.getFullYear(), today.getMonth(), today.getDate()]);
  const showingPartRequests = agendaSlideIndex % 2 === 0;
  const periodLabel = `Jan–${new Intl.DateTimeFormat("id-ID", { month: "short" }).format(today)} ${currentYear}`;
  const refresh = () => setRefreshKey(key => key + 1);
  const kvarhMiniData = monthlyKvarhRemote.data.filter(item => Number(item.checkCount) > 0).map(item => ({ label: item.label, value: Number(item.reactiveKvarh) || 0 }));
  const latestKvarh = kvarhMiniData.at(-1)?.value || 0;
  const cosPhiMonthlyLatest = new Map();
  asArray(cosPhiRemote.data).forEach(item => {
    const match = String(item.tanggal || "").match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    const month = Number(match?.[2]), itemYear = Number(match?.[3]), value = Number(item.cos_phi);
    if (itemYear !== currentYear || month < 1 || month > 12 || !Number.isFinite(value)) return;
    const key = `${item.code}-${month}`;
    if (!cosPhiMonthlyLatest.has(key)) cosPhiMonthlyLatest.set(key, value);
  });
  const cosPhiMiniData = Array.from({ length: currentPeriodEnd }, (_, index) => {
    const values = ["panel_1", "panel_2", "panel_3", "panel_4"].map(code => cosPhiMonthlyLatest.get(`${code}-${index + 1}`)).filter(Number.isFinite);
    return values.length ? { label: SCHEDULE_MONTHS[index].slice(0, 3), value: Math.min(...values) } : null;
  }).filter(Boolean);
  const latestCosPhi = cosPhiMiniData.at(-1)?.value || 0;
  const latestReportDate = reportsRemote.data[0]?.tanggal || "";
  const latestReports = reportsRemote.data.filter(report => report.tanggal === latestReportDate);
  const reportedSections = new Set(latestReports.map(report => {
    const section = String(report.bagian || "").trim();
    if (section === "Teknik A") return "Tek. Shift A";
    if (section === "Teknik B") return "Tek. Shift B";
    return section;
  }));
  const missingReportSections = REPORTING_SECTIONS.filter(section => !reportedSections.has(section));
  const missingReportSection = missingReportSections[missingReportIndex % Math.max(1, missingReportSections.length)] || "Semua sudah melapor";
  const chartOptions = [
    ["kvarh", "Energi Reaktif PLN"], ["cosphi", "Faktor Daya"], ["orders", "Order Kerja"],
    ["overtime", "Jam Lembur"], ["downtime", "Downtime"], ["maintenance", "Perawatan"],
    ["reports", "Tabel Laporan Kerja"], ["active_orders", "Tabel Order Aktif"],
    ["part_requests", "Bon Sparepart Open"], ["maintenance_due", "Agenda Terdekat"],
  ].filter(([id]) => id !== "overtime" || canViewOvertimeChart);
  const toggleChart = id => setSelectedCharts(current => ({ ...current, [id]: !current[id] }));
  const focusedContent = {
    kvarh: <MonthlyKvarhCard data={monthlyKvarhRemote.data} rawData={electricityChecksRemote.data} loading={monthlyKvarhRemote.loading} rawLoading={electricityChecksRemote.loading} error={monthlyKvarhRemote.error} rawError={electricityChecksRemote.error} year={currentYear} onRetry={refresh} />,
    cosphi: <CosPhiPanelChart data={cosPhiRemote.data} loading={cosPhiRemote.loading} error={cosPhiRemote.error} year={currentYear} onRetry={refresh} />,
    downtime: <ModernKpiCard title="Downtime" subtitle="Akumulasi gangguan mesin" icon={TimerReset} value={combinedRemote.loading ? 0 : downtimeYearToDate} decimals={1} unit="jam" period={periodLabel} data={downtimeKpi} target={downtimeTarget} targetLabel={`Batas ${downtimeTarget} jam/bulan`} color="#ff9f1c" />,
    maintenance: <ModernKpiCard title="Perawatan" subtitle="Pencapaian preventive maintenance" icon={Wrench} value={kpiRemote.loading ? 0 : health} unit="%" period={`${maintenanceKpi.at(-1)?.label || "-"} ${currentYear}`} data={maintenanceKpi} target={maintenanceTarget} targetLabel={`Target ${maintenanceTarget}%`} color="#22c55e" />,
    orders: <ModernKpiCard title="Order Kerja" subtitle="Permintaan pekerjaan bulanan" icon={ClipboardList} value={combinedRemote.loading ? 0 : orderKpi.at(-1)?.value || 0} unit="WO" period={`${orderKpi.at(-1)?.label || "-"} ${currentYear}`} data={orderKpi} color="#ec4899" />,
    overtime: <ModernKpiCard title="Jam Lembur" subtitle="Akumulasi Admin & Teknik" icon={Clock3} value={overtimeRemote.loading ? 0 : overtimeKpi.reduce((total, item) => total + item.value, 0)} decimals={1} unit="jam" period={periodLabel} data={overtimeKpi} color="#22d3ee" />,
    reports: <section className="monitoring-selected-table"><div className="monitoring-selected-table-head"><div><p className="eyebrow">Tanggal data terbaru</p><h2>Laporan kerja {latestReportDate || "-"}</h2></div><span>{latestReports.length} laporan</span></div><div className="table-wrap"><table><thead><tr><th>Bagian</th><th>Mesin</th><th>Laporan pekerjaan</th><th>Mulai</th><th>Selesai</th><th>Durasi</th></tr></thead><tbody>{latestReports.map((report, index) => <tr key={report.id || report.rowIndex || index}><td>{report.bagian || "-"}</td><td><b>{report.namaMesin || report.mesin || "-"}</b></td><td>{report.laporan || report.laporanPekerjaan || "-"}</td><td>{report.jamMulai || "-"}</td><td>{report.jamSelesai || "-"}</td><td>{Number(report.totalJam) > 0 ? `${Number(report.totalJam).toLocaleString("id-ID", { maximumFractionDigits: 2 })} jam` : "-"}</td></tr>)}</tbody></table></div></section>,
    active_orders: <section className="monitoring-selected-table"><div className="monitoring-selected-table-head"><div><p className="eyebrow">Operasional teknik</p><h2>Seluruh order kerja aktif</h2></div><span>{ordersRemote.data.length} order</span></div><RemoteState loading={ordersRemote.loading} error={ordersRemote.error} empty={!ordersRemote.data.length} onRetry={ordersRemote.reload} />{!ordersRemote.loading && !ordersRemote.error && ordersRemote.data.length > 0 && <OrderTable orders={ordersRemote.data} onClick={() => { }} />}</section>,
    part_requests: <section className="monitoring-selected-table"><div className="monitoring-selected-table-head"><div><p className="eyebrow">Kebutuhan sparepart</p><h2>Bon Sparepart Open</h2></div><span>{openPartRequests.length} barang</span></div><RemoteState loading={partRequestsRemote.loading} error={partRequestsRemote.error} empty={!openPartRequests.length} onRetry={partRequestsRemote.reload} />{!partRequestsRemote.loading && !partRequestsRemote.error && openPartRequests.length > 0 && <div className="table-wrap"><table><thead><tr><th>Tanggal</th><th>Nomor bon</th><th>Nama barang</th><th>Jumlah</th><th>Pemesan</th><th>Mesin / kebutuhan</th></tr></thead><tbody>{openPartRequests.map((item, index) => <tr key={item.id || index}><td>{item.tglPesan || item.tanggal || "-"}</td><td><b>{item.transactionNumber || "-"}</b></td><td>{item.nama || "-"}<small>{[item.kategori, item.ukuran].filter(Boolean).join(" · ")}</small></td><td>{Number(item.jmlPesan || 0).toLocaleString("id-ID")} {item.satuan || ""}</td><td>{item.pemesan || "-"}</td><td>{item.mesin || "-"}</td></tr>)}</tbody></table></div>}</section>,
    maintenance_due: <section className="monitoring-selected-table"><div className="monitoring-selected-table-head"><div><p className="eyebrow">Perawatan tertunda</p><h2>{maintenanceAgenda.title}</h2></div><span>{maintenanceAgenda.items.length} aset</span></div><RemoteState loading={maintenanceRemote.loading} error={maintenanceRemote.error} empty={!maintenanceAgenda.items.length} onRetry={maintenanceRemote.reload} />{!maintenanceRemote.loading && !maintenanceRemote.error && maintenanceAgenda.items.length > 0 && <div className="table-wrap"><table><thead><tr><th>Tanggal</th><th>Mesin / aset</th><th>Frekuensi</th><th>Status</th><th>Keterangan</th></tr></thead><tbody>{maintenanceAgenda.items.map((item, index) => <tr key={`${item.name}-${item.date}-${index}`}><td>{item.date || `${String(item.day).padStart(2, "0")}/${String(item.month).padStart(2, "0")}`}</td><td><b>{item.name}</b></td><td>{item.type}</td><td>{maintenanceAgenda.source === "previous-week" ? "Tertunda" : "Belum dikerjakan"}</td><td>{item.note || "-"}</td></tr>)}</tbody></table></div>}</section>,
  };
  const selectedChartIds = chartOptions.map(([id]) => id).filter(id => selectedCharts[id]);
  const clearSelectedCharts = () => setSelectedCharts({ kvarh: false, cosphi: false, orders: false, overtime: false, downtime: false, maintenance: false, reports: false, active_orders: false, part_requests: false, maintenance_due: false });
  const showOnlySelection = id => setSelectedCharts({ kvarh: false, cosphi: false, orders: false, overtime: false, downtime: false, maintenance: false, reports: false, active_orders: false, part_requests: false, maintenance_due: false, [id]: true });
  const openTableCard = event => {
    if (event.target.closest("button,a,input,select")) return;
    const card = event.target.closest(".monitoring-latest-reports,.monitoring-orders-panel,.monitoring-agenda-panel");
    if (!card) return;
    if (card.classList.contains("monitoring-latest-reports")) showOnlySelection("reports");
    else if (card.classList.contains("monitoring-orders-panel")) showOnlySelection("active_orders");
    else showOnlySelection(showingPartRequests ? "part_requests" : "maintenance_due");
  };
  const featuredCount = 2;
  const topChartCards = [
    { id: "kvarh", node: <ModernKpiCard title="Energi Reaktif PLN" subtitle="Aktual kVArh bulanan" icon={Zap} value={monthlyKvarhRemote.loading ? 0 : latestKvarh} decimals={2} unit="kVArh" period={periodLabel} data={kvarhMiniData} color="#a78bfa" onClick={() => setFocusedChart("kvarh")} /> },
    { id: "cosphi", node: <ModernKpiCard title="Faktor Daya" subtitle="Cos φ terendah Panel 1–4" icon={Activity} value={cosPhiRemote.loading ? 0 : latestCosPhi} decimals={2} period={periodLabel} data={cosPhiMiniData} target={.85} targetLabel="Minimum 0,85" color="#22d3ee" onClick={() => setFocusedChart("cosphi")} /> },
    { id: "orders", node: <ModernKpiCard title="Order Kerja" subtitle="Permintaan pekerjaan bulanan" icon={ClipboardList} value={combinedRemote.loading ? 0 : orderKpi.at(-1)?.value || 0} unit="WO" period={`${orderKpi.at(-1)?.label || "-"} ${currentYear}`} data={orderKpi} color="#ec4899" onClick={() => setFocusedChart("orders")} /> },
    canViewOvertimeChart && { id: "overtime", node: <ModernKpiCard title="Jam Lembur" subtitle="Akumulasi Admin & Teknik" icon={Clock3} value={overtimeRemote.loading ? 0 : overtimeKpi.reduce((total, item) => total + item.value, 0)} decimals={1} unit="jam" period={periodLabel} data={overtimeKpi} color="#22d3ee" onClick={() => setFocusedChart("overtime")} /> },
  ].filter(Boolean);
  const energyCards = topChartCards.filter(item => ["kvarh", "cosphi"].includes(item.id));
  const workCards = topChartCards.filter(item => ["orders", "overtime"].includes(item.id));
  const activeEnergyCard = energyCards[energySlideIndex % Math.max(1, energyCards.length)];
  const activeWorkCard = workCards[workSlideIndex % Math.max(1, workCards.length)];
  const reportsPerSlide = 2;
  const reportSlideCount = Math.max(1, Math.ceil(latestReports.length / reportsPerSlide));
  const activeReportSlide = reportSlideIndex % reportSlideCount;
  const visibleLatestReports = latestReports.slice(activeReportSlide * reportsPerSlide, activeReportSlide * reportsPerSlide + reportsPerSlide);
  useEffect(() => {
    if (energyCards.length <= 1) return;
    const timer = window.setInterval(() => setEnergySlideIndex(index => (index + 1) % energyCards.length), 8000);
    return () => window.clearInterval(timer);
  }, [energyCards.map(item => item.id).join("|")]);
  useEffect(() => {
    if (workCards.length <= 1) return;
    const timer = window.setInterval(() => setWorkSlideIndex(index => (index + 1) % workCards.length), 9000);
    return () => window.clearInterval(timer);
  }, [workCards.map(item => item.id).join("|")]);
  useEffect(() => {
    setEnergySlideIndex(0);
    setWorkSlideIndex(0);
  }, [topChartCards.map(item => item.id).join("|")]);
  useEffect(() => {
    setReportSlideIndex(0);
    if (reportSlideCount <= 1) return;
    const timer = window.setInterval(() => setReportSlideIndex(index => (index + 1) % reportSlideCount), 7000);
    return () => window.clearInterval(timer);
  }, [latestReportDate, reportSlideCount]);
  useEffect(() => {
    const timer = window.setInterval(() => setAgendaSlideIndex(index => (index + 1) % 2), 8000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    if (missingReportSections.length <= 1) { setMissingReportIndex(0); return; }
    const timer = window.setInterval(() => setMissingReportIndex(index => (index + 1) % missingReportSections.length), 4500);
    return () => window.clearInterval(timer);
  }, [missingReportSections.join("|")]);
  return <div className="monitoring-wall">
    <div className="monitoring-rotate-device"><Monitor size={34} /><b>Putar ponsel ke landscape</b><span>Tampilan monitor tersedia dalam posisi mendatar.</span></div>
    <header className="monitoring-wall-header">
      <div className="monitoring-wall-brand"><div className="brand-mark"><span>ST</span></div><div><p className="eyebrow">Live engineering performance</p><h1>SiTeki Monitoring</h1></div></div>
      <div className="monitoring-wall-clock"><strong>{new Intl.DateTimeFormat("id-ID", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(clock)}</strong><span>{new Intl.DateTimeFormat("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(clock)}</span></div>
      <div className="monitoring-wall-actions"><span className="monitoring-auto"><i /> Live saat data berubah</span><div className="monitoring-chart-picker"><button onClick={() => setChartPickerOpen(open => !open)}><BarChart3 size={17} /><span>Pilih grafik{selectedChartIds.length ? ` (${selectedChartIds.length})` : ""}</span></button>{chartPickerOpen && <div className="monitoring-chart-menu"><div><b>Grafik memenuhi layar</b><small>Centang grafik pilihan. Kosongkan semua untuk dashboard lengkap.</small></div>{chartOptions.map(([id, label]) => <div className="monitoring-chart-option" key={id}><label title="Pilih grafik untuk layar"><input type="checkbox" checked={Boolean(selectedCharts[id])} onChange={() => toggleChart(id)} /><Check size={12} /></label><button onClick={() => { setFocusedChart(id); setChartPickerOpen(false); }}>{label}<Maximize2 size={12} /></button></div>)}{selectedChartIds.length > 0 && <button className="monitoring-chart-reset" onClick={clearSelectedCharts}><X size={13} /> Dashboard lengkap</button>}</div>}</div><button onClick={refresh} title="Perbarui sekarang"><RefreshCw size={17} /></button><button onClick={toggleFullscreen} title={isFullscreen ? "Keluar layar penuh" : "Layar penuh"}>{isFullscreen ? <Minimize2 size={17} /> : <Maximize2 size={17} />}<span>{isFullscreen ? "Perkecil" : "Layar penuh"}</span></button><button className="monitoring-exit" onClick={leave}><X size={17} /><span>Tutup</span></button></div>
    </header>
    {selectedChartIds.length > 0 && <main className={`monitoring-selected-charts count-${selectedChartIds.length}`}><button className="monitoring-selection-close" onClick={clearSelectedCharts}><X size={16} /> Kembali ke monitor</button>{selectedChartIds.map(id => <section key={id} className={`monitoring-selected-chart selected-${id}`}>{focusedContent[id]}</section>)}</main>}
    <main className={`monitoring-wall-content ${selectedChartIds.length ? "selection-hidden" : ""}`} onClick={openTableCard}>
      <section className="monitoring-wall-stats">
        <ModernStatCard icon={ClipboardList} label="Order terbuka" value={ordersRemote.loading ? 0 : ordersRemote.data.length} color="mint" delay={0} />
        <ModernStatCard icon={TimerReset} label="Downtime YTD" value={combinedRemote.loading ? 0 : downtimeYearToDate} unit=" jam" color="blue" delay={50} />
        <ModernStatCard icon={Gauge} label="KPI Perawatan" value={kpiRemote.loading ? 0 : health} unit="%" color="amber" delay={100} />
        <ModernStatCard key={missingReportSection} icon={ClipboardCheck} label="Belum laporan kerja" displayValue={reportsRemote.loading ? "Memuat…" : missingReportSection} detail={latestReportDate ? `Acuan ${latestReportDate} · ${missingReportSections.length} bagian` : "Belum ada laporan"} color={missingReportSections.length ? "rose" : "violet"} delay={150} className="missing-report-stat" />
      </section>
      <section className="monitoring-wall-body">
        <div className="monitoring-wall-chart-column">
          <section className="monitoring-wall-top-slides">
            <div className="monitoring-wall-carousel">
              {activeEnergyCard ? <div key={activeEnergyCard.id} className="monitoring-wall-kpis monitoring-carousel-page count-1">{activeEnergyCard.node}</div> : <div className="monitoring-carousel-empty"><BarChart3 size={24} /><b>Pilih kVAr atau cos phi</b></div>}
              {energyCards.length > 1 && <div className="monitoring-carousel-dots" aria-label="Navigasi energi dan faktor daya">{energyCards.map((item, index) => <button key={item.id} className={index === energySlideIndex % energyCards.length ? "active" : ""} onClick={() => setEnergySlideIndex(index)} aria-label={item.id} />)}</div>}
            </div>
            <div className="monitoring-wall-carousel">
              {activeWorkCard ? <div key={activeWorkCard.id} className="monitoring-wall-kpis monitoring-carousel-page count-1">{activeWorkCard.node}</div> : <div className="monitoring-carousel-empty"><BarChart3 size={24} /><b>Pilih order atau lembur</b></div>}
              {workCards.length > 1 && <div className="monitoring-carousel-dots" aria-label="Navigasi order dan lembur">{workCards.map((item, index) => <button key={item.id} className={index === workSlideIndex % workCards.length ? "active" : ""} onClick={() => setWorkSlideIndex(index)} aria-label={item.id} />)}</div>}
            </div>
          </section>
          <section className="monitoring-wall-details">
            <div className="monitoring-downtime-slot">{visibleCharts.downtime && <ModernKpiCard title="Downtime" subtitle="Akumulasi gangguan mesin" icon={TimerReset} value={combinedRemote.loading ? 0 : downtimeYearToDate} decimals={1} unit="jam" period={periodLabel} data={downtimeKpi} target={downtimeTarget} targetLabel={`Batas ${downtimeTarget} jam/bulan`} color="#ff9f1c" onClick={() => setFocusedChart("downtime")} />}</div>
            <div className="monitoring-maintenance-slot">{visibleCharts.maintenance && <ModernKpiCard title="Perawatan" subtitle="Pencapaian preventive maintenance" icon={Wrench} value={kpiRemote.loading ? 0 : health} unit="%" period={`${maintenanceKpi.at(-1)?.label || "-"} ${currentYear}`} data={maintenanceKpi} target={maintenanceTarget} targetLabel={`Target ${maintenanceTarget}%`} color="#22c55e" onClick={() => setFocusedChart("maintenance")} />}</div>
            <div className={`monitoring-wall-operations ${featuredCount ? "" : "full"}`}>
              <section className="monitoring-wall-panel monitoring-orders-panel"><div className="monitoring-panel-head"><h2>Order kerja aktif</h2><span>{ordersRemote.data.length} order terbuka</span></div><RemoteState loading={ordersRemote.loading} error={ordersRemote.error} empty={!ordersRemote.data.length} onRetry={ordersRemote.reload} />{!ordersRemote.loading && !ordersRemote.error && ordersRemote.data.length > 0 && <OrderTable orders={ordersRemote.data.slice(0, 5)} onClick={() => { }} />}</section>
              <section className="monitoring-wall-panel monitoring-agenda-panel">
                <div key={agendaSlideIndex} className="monitoring-agenda-slide">
                  {showingPartRequests ? <>
                    <div className="monitoring-panel-head"><h2>Bon sparepart open</h2><span>{openPartRequests.length} barang</span></div>
                    <RemoteState loading={partRequestsRemote.loading} error={partRequestsRemote.error} empty={!openPartRequests.length} onRetry={partRequestsRemote.reload} />
                    {!partRequestsRemote.loading && !partRequestsRemote.error && openPartRequests.length > 0 && <div className="agenda">{openPartRequests.slice(0, 5).map(item => {
                      const [day = "--", month = "--"] = String(item.tglPesan || item.tanggal || "").split("/");
                      return <div className="monitoring-agenda-item" key={item.id}><span className="date-box today"><b>{day}</b><small>{month}</small></span><span><b>{item.nama || "Tanpa nama barang"}</b><small><em className="agenda-type weekly">{Number(item.jmlPesan || 0).toLocaleString("id-ID")} {item.satuan || ""}</em> · {item.transactionNumber || "Bon"} · {item.pemesan || "-"}</small></span></div>;
                    })}</div>}
                  </> : <>
                    <div className="monitoring-panel-head"><h2>Agenda terdekat</h2><span>{maintenanceAgenda.items.length} aset</span></div>
                    <RemoteState loading={maintenanceRemote.loading} error={maintenanceRemote.error} empty={!maintenanceAgenda.items.length} onRetry={maintenanceRemote.reload} />
                    {!maintenanceRemote.loading && !maintenanceRemote.error && <>
                      <div className={`agenda-context ${maintenanceAgenda.source === "previous-week" ? "overdue" : ""}`}><CalendarDays size={16} /><span><b>{maintenanceAgenda.title}</b><small>{maintenanceAgenda.description}</small></span></div>
                      {maintenanceAgenda.items.length > 0 && <div className="agenda">{maintenanceAgenda.items.slice(0, 5).map(item => <div className="monitoring-agenda-item" key={`${item.name}-${item.date}`}><span className={`date-box ${maintenanceAgenda.source === "today" ? "today" : "overdue"}`}><b>{String(item.day).padStart(2, "0")}</b><small>{String(item.month).padStart(2, "0")}</small></span><span><b>{item.name}</b><small><em className={`agenda-type ${item.type === "Bulanan" ? "monthly" : "weekly"}`}>{item.type}</em> · {item.note || "Belum dikerjakan"}</small></span></div>)}</div>}
                    </>}
                  </>}
                </div>
                <div className="monitoring-carousel-dots monitoring-agenda-dots" aria-label="Navigasi bon sparepart dan agenda"><button className={showingPartRequests ? "active" : ""} onClick={() => setAgendaSlideIndex(0)} aria-label="Bon sparepart open" /><button className={!showingPartRequests ? "active" : ""} onClick={() => setAgendaSlideIndex(1)} aria-label="Agenda terdekat" /></div>
              </section>
            </div>
          </section>
        </div>
        <section className="monitoring-wall-panel monitoring-latest-reports">
          <div className="monitoring-panel-head"><div><h2>Laporan pekerjaan terakhir</h2><small>Aktivitas pada tanggal data terbaru</small></div><span>{latestReportDate || "Belum ada data"}</span></div>
          <RemoteState loading={reportsRemote.loading} error={reportsRemote.error} empty={!latestReports.length} onRetry={reportsRemote.reload} />
          {!reportsRemote.loading && !reportsRemote.error && latestReports.length > 0 && <div key={activeReportSlide} className="monitoring-report-list">{visibleLatestReports.map((report, index) => <article key={report.id || report.rowIndex || `${report.tanggal}-${index}`}><span className="monitoring-report-number">{String(activeReportSlide * reportsPerSlide + index + 1).padStart(2, "0")}</span><div><b>{report.namaMesin || report.mesin || "Tanpa nama mesin"}</b><p>{report.laporan || report.laporanPekerjaan || "Tanpa uraian pekerjaan"}</p><small>{report.bagian || "Tanpa bagian"}{Number(report.totalJam) > 0 ? ` · ${Number(report.totalJam).toLocaleString("id-ID", { maximumFractionDigits: 2 })} jam` : ""}</small></div></article>)}</div>}
          {reportSlideCount > 1 && <div className="monitoring-report-pagination"><span>{activeReportSlide + 1}/{reportSlideCount}</span>{Array.from({ length: reportSlideCount }, (_, index) => <button key={index} className={index === activeReportSlide ? "active" : ""} onClick={() => setReportSlideIndex(index)} aria-label={`Halaman laporan ${index + 1}`} />)}</div>}
        </section>
      </section>
    </main>
    {focusedChart && <div className="monitoring-focus-overlay" role="dialog" aria-modal="true" aria-label={`Grafik ${chartOptions.find(([id]) => id === focusedChart)?.[1] || "monitoring"}`}><div className="monitoring-focus-head"><div><p className="eyebrow">Tampilan fokus</p><h2>{chartOptions.find(([id]) => id === focusedChart)?.[1]}</h2></div><button onClick={() => setFocusedChart("")}><X size={19} /> Tutup</button></div><div className={`monitoring-focus-content focus-${focusedChart}`}>{focusedContent[focusedChart]}</div></div>}
  </div>;
}

function Stat({ icon: Icon, label, value, detail, tone }) {
  return <article className="stat"><span className={`icon-box ${tone}`}><Icon size={21} /></span><div><small>{label}</small><strong>{value}</strong><p><span>↗</span> {detail}</p></div></article>;
}

/* ============================================
   ANIMATED COUNTER
   ============================================ */
function AnimatedCounter({ value, duration = 1500, decimals = 0 }) {
  const [display, setDisplay] = useState(0);

  useEffect(() => {
    const start = 0;
    const end = parseFloat(value) || 0;
    const startTime = Date.now();

    const animate = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const easeOut = 1 - Math.pow(1 - progress, 3);
      const current = start + (end - start) * easeOut;
      setDisplay(current);

      if (progress < 1) {
        requestAnimationFrame(animate);
      }
    };

    requestAnimationFrame(animate);
  }, [value, duration]);

  return (
    <span className="animated-counter">
      {decimals > 0 ? display.toFixed(decimals) : Math.round(display).toLocaleString('id-ID')}
    </span>
  );
}

/* ============================================
   MODERN STAT CARD WITH TREND
   ============================================ */
function ModernStatCard({ icon: Icon, label, value, displayValue, detail, previewItems = [], trend, trendValue, color = 'mint', delay = 0, unit = '', className = '', onClick }) {
  const [isVisible, setIsVisible] = useState(false);
  const cardRef = useRef(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setTimeout(() => setIsVisible(true), delay);
        }
      },
      { threshold: 0.1 }
    );

    if (cardRef.current) {
      observer.observe(cardRef.current);
    }

    return () => observer.disconnect();
  }, [delay]);

  const isPositive = trend === 'up';
  const TrendIcon = isPositive ? TrendingUp : TrendingDown;

  const colorVar = {
    mint: 'var(--accent-mint)',
    blue: 'var(--accent-cyan)',
    amber: 'var(--accent-amber)',
    violet: 'var(--accent-violet)',
    rose: 'var(--accent-rose)'
  }[color] || 'var(--accent-mint)';

  return (
    <div
      ref={cardRef}
      className={`modern-stat-card ${className} ${onClick ? 'interactive' : ''} ${isVisible ? 'visible' : ''}`}
      style={{ '--accent-color': colorVar }}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={onClick ? event => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onClick();
        }
      } : undefined}
    >
      <div className="stat-icon">
        <Icon size={24} />
      </div>
      <div className="stat-content">
        <span className="stat-label">{label}</span>
        <span className="stat-value">
          {displayValue !== undefined ? displayValue : <AnimatedCounter value={value} />}
          {unit && <span className="stat-unit">{unit}</span>}
        </span>
        {detail && <small className="stat-detail">{detail}</small>}
        {previewItems.length > 0 && <span className="stat-preview-items" aria-label="Barang bon yang masih open">
          {previewItems.slice(0, 2).map((item, index) => <em key={`${item}-${index}`}>{item}</em>)}
          {previewItems.length > 2 && <em>+{previewItems.length - 2} lainnya</em>}
        </span>}
        {trend && (
          <span className={`stat-trend ${isPositive ? 'positive' : 'negative'}`}>
            <TrendIcon size={14} />
            <span>{trendValue}%</span>
            <span className="trend-period">vs last mo</span>
          </span>
        )}
      </div>
      <div className="stat-glow" />
    </div>
  );
}

/* ============================================
   MODERN KPI CARD - SIMPLE CLEAN LAYOUT
   ============================================ */
function ModernKpiCard({
  title, subtitle, icon: Icon, value, unit = "", decimals = 0, period = "",
  data = [], dailyData = [], dailyUnit = "", dailySubtitle = "", year = new Date().getFullYear(),
  enablePeriod = false, target = 0, targetLabel = "", color = "#6366f1", onClick
}) {
  const [animated, setAnimated] = useState(false);
  const [activePoint, setActivePoint] = useState(null);
  const [periodChoice, setPeriodChoice] = useState("year");
  const [chartWidth, setChartWidth] = useState(640);
  const ref = useRef(null);
  const chartRef = useRef(null);
  const touchTimerRef = useRef(null);
  useEffect(() => {
    const o = new IntersectionObserver(([e]) => { if (e.isIntersecting) setAnimated(true); }, { threshold: 0.2 });
    if (ref.current) o.observe(ref.current);
    return () => {
      o.disconnect();
      if (touchTimerRef.current) window.clearTimeout(touchTimerRef.current);
    };
  }, []);
  const H = 190, W = chartWidth, pL = 14, pR = 14, pT = 14, pB = 34;
  useEffect(() => {
    const element = chartRef.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const update = () => {
      const { width, height } = element.getBoundingClientRect();
      if (width <= 0 || height <= 0) return;
      const next = Math.round(Math.min(1800, Math.max(640, H * (width / height))));
      setChartWidth(current => Math.abs(current - next) > 2 ? next : current);
    };
    const observer = new ResizeObserver(update);
    observer.observe(element);
    update();
    return () => observer.disconnect();
  }, []);
  const iW = W - pL - pR, iH = H - pT - pB;
  const today = new Date(), currentMonth = today.getMonth() + 1;
  const selectedMonth = periodChoice === "year" ? null : Number(periodChoice);
  const selectableMonthCount = Number(year) === today.getFullYear() ? currentMonth : 12;
  const visibleLastDay = selectedMonth
    ? (Number(year) === today.getFullYear() && selectedMonth === currentMonth ? today.getDate() : new Date(Number(year), selectedMonth, 0).getDate())
    : 12;
  const parseDate = value => {
    const source = String(value || "");
    let match = source.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
    match = source.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
    return match ? { year: Number(match[3]), month: Number(match[2]), day: Number(match[1]) } : null;
  };
  const selectedRows = selectedMonth ? asArray(dailyData).filter(item => {
    const parts = parseDate(item.tanggal || item.date);
    return parts?.year === Number(year) && parts.month === selectedMonth && parts.day <= visibleLastDay;
  }) : [];
  const dailyByDay = new Map(selectedRows.map(item => [parseDate(item.tanggal || item.date)?.day, Number(item.value) || 0]));
  const displayedData = selectedMonth ? (selectedRows.length ? Array.from({ length: visibleLastDay }, (_, index) => ({ label: String(index + 1), slot: index, value: dailyByDay.get(index + 1) || 0 })) : []) : data;
  const axisLabels = selectedMonth ? Array.from({ length: visibleLastDay }, (_, index) => String(index + 1)) : SCHEDULE_MONTHS.map(name => name.slice(0, 3));
  const pointSlot = (item, index) => {
    if (selectedMonth) return Number.isFinite(Number(item?.slot)) ? Number(item.slot) : index;
    const label = String(item?.label || "").slice(0, 3).toLocaleLowerCase("id-ID");
    const slot = axisLabels.findIndex(month => month.toLocaleLowerCase("id-ID") === label);
    return slot >= 0 ? slot : Math.min(index, axisLabels.length - 1);
  };
  const effectiveTarget = selectedMonth ? 0 : target;
  const effectiveTargetLabel = selectedMonth ? "" : targetLabel;
  const effectiveUnit = selectedMonth ? (dailyUnit || unit) : unit;
  const effectiveSubtitle = selectedMonth ? (dailySubtitle || subtitle) : subtitle;
  const effectiveValue = selectedMonth ? selectedRows.reduce((total, item) => total + (Number(item.value) || 0), 0) : value;
  const effectivePeriod = selectedMonth ? `1–${visibleLastDay} ${SCHEDULE_MONTHS[selectedMonth - 1]} ${year}` : period;
  const mx = Math.max(1, Number(effectiveTarget) || 0, ...displayedData.map(d => Math.abs(Number(d.value) || 0))) * 1.12;
  const gX = slot => pL + (slot / Math.max(1, axisLabels.length - 1)) * iW;
  const gY = v => pT + iH - (Math.max(0, Number(v) || 0) / mx) * iH;
  const chartPoints = displayedData.map((item, index) => ({ x: gX(pointSlot(item, index)), y: gY(item.value) }));
  const smoothPath = chartPoints.length
    ? chartPoints.slice(1).reduce((path, point, index) => {
      const previousPrevious = chartPoints[index - 1] || chartPoints[index];
      const previous = chartPoints[index];
      const next = chartPoints[index + 2] || point;
      const minY = Math.min(previous.y, point.y), maxY = Math.max(previous.y, point.y);
      const clampY = value => Math.min(maxY, Math.max(minY, value));
      const control1 = {
        x: previous.x + (point.x - previousPrevious.x) / 6,
        y: clampY(previous.y + (point.y - previousPrevious.y) / 6)
      };
      const control2 = {
        x: point.x - (next.x - previous.x) / 6,
        y: clampY(point.y - (next.y - previous.y) / 6)
      };
      return `${path} C ${control1.x},${control1.y} ${control2.x},${control2.y} ${point.x},${point.y}`;
    }, `M ${chartPoints[0].x},${chartPoints[0].y}`)
    : "";
  const areaPath = smoothPath
    ? `${smoothPath} L ${chartPoints.at(-1).x},${pT + iH} L ${chartPoints[0].x},${pT + iH} Z`
    : "";
  const gid = "c" + title.replace(/[^a-z0-9]/gi, "_");
  const targetY = effectiveTarget > 0 ? gY(effectiveTarget) : null;
  const formatValue = number => new Intl.NumberFormat("id-ID", {
    maximumFractionDigits: decimals
  }).format(Number(number) || 0);
  const selectChartPoint = event => {
    if (!chartPoints.length) return;
    event.stopPropagation();
    if (touchTimerRef.current) window.clearTimeout(touchTimerRef.current);
    const bounds = event.currentTarget.getBoundingClientRect();
    const pointerX = ((event.clientX - bounds.left) / Math.max(1, bounds.width)) * W;
    const nearest = chartPoints.reduce((best, point, index) => (
      Math.abs(point.x - pointerX) < Math.abs(chartPoints[best].x - pointerX) ? index : best
    ), 0);
    setActivePoint(nearest);
  };
  const keepTouchValueVisible = event => {
    event.stopPropagation();
    if (touchTimerRef.current) window.clearTimeout(touchTimerRef.current);
    touchTimerRef.current = window.setTimeout(() => setActivePoint(null), 2400);
  };
  const selected = activePoint !== null && displayedData[activePoint] && chartPoints[activePoint]
    ? { ...displayedData[activePoint], ...chartPoints[activePoint] }
    : null;
  return (
    <div
      ref={ref}
      className={"kpi-card " + (animated ? "in " : "") + (onClick ? "clickable" : "")}
      onClick={onClick}
      onKeyDown={event => {
        if (event.target.closest?.("select,input,button")) return;
        if (onClick && (event.key === "Enter" || event.key === " ")) onClick();
      }}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      style={{ "--chart-color": color }}
    >
      <div className="kpi-top">
        <div className="kpi-icon-wrap" style={{ background: color + "22", color: color }}><Icon size={18} /></div>
        <div className="kpi-text">
          <div className="kpi-label">{title}</div>
          <div className="kpi-val"><b>{formatValue(effectiveValue)}</b>{effectiveUnit && <span>{effectiveUnit}</span>}</div>
          {effectiveSubtitle && <div className="kpi-card-subtitle">{effectiveSubtitle}</div>}
        </div>
        {enablePeriod && <label className="kpi-period-control" onClick={event => event.stopPropagation()}><span>Periode</span><select value={periodChoice} onChange={event => { setPeriodChoice(event.target.value); setActivePoint(null); }}><option value="year">Tahunan {year}</option>{SCHEDULE_MONTHS.slice(0, selectableMonthCount).map((month, index) => <option key={month} value={index + 1}>{month} {year}</option>)}</select></label>}
        {onClick && <div className="kpi-arr" aria-hidden="true">→</div>}
      </div>
      <div ref={chartRef} className="kpi-chart" onClick={event => event.stopPropagation()}>
        {displayedData.length ? <svg
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label={`Grafik ${title}, ${effectivePeriod}`}
          onPointerDown={selectChartPoint}
          onPointerMove={event => {
            if (event.pointerType === "mouse") selectChartPoint(event);
          }}
          onPointerUp={keepTouchValueVisible}
          onPointerCancel={keepTouchValueVisible}
          onPointerLeave={event => {
            if (event.pointerType === "mouse") setActivePoint(null);
          }}
        >
          <defs>
            <linearGradient id={"area" + gid} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity=".3" />
              <stop offset="55%" stopColor={color} stopOpacity=".1" />
              <stop offset="100%" stopColor={color} stopOpacity="0" />
            </linearGradient>
            <filter id={"glow" + gid} x="-20%" y="-40%" width="140%" height="180%">
              <feGaussianBlur stdDeviation="2.2" result="blur" />
              <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
          </defs>
          {[0, .2, .4, .6, .8, 1].map(step => <line key={`h-${step}`} x1={pL} x2={W - pR} y1={pT + iH - (iH * step)} y2={pT + iH - (iH * step)} className="kpi-grid-line" />)}
          {targetY !== null && <g className="kpi-target"><line x1={pL} x2={W - pR} y1={targetY} y2={targetY} className="kpi-target-line" /><text x={pL + 6} y={Math.max(pT + 10, targetY - 7)} className="kpi-target-label">{effectiveTargetLabel || `Target ${formatValue(effectiveTarget)} ${effectiveUnit}`}</text></g>}
          {areaPath && <path d={areaPath} fill={`url(#area${gid})`} className="kpi-area" />}
          {smoothPath && <path d={smoothPath} fill="none" stroke={color} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" opacity=".12" filter={`url(#glow${gid})`} className="kpi-line-glow" />}
          {smoothPath && <path d={smoothPath} pathLength="1" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="kpi-line" />}
          {displayedData.map((d, i) => <g key={`${d.label}-${i}`}>
            <circle cx={gX(pointSlot(d, i))} cy={gY(d.value)} r={activePoint === i ? "9" : "6"} fill={color} opacity={animated ? (activePoint === i ? .24 : .12) : 0} />
            <circle cx={gX(pointSlot(d, i))} cy={gY(d.value)} r={activePoint === i ? "5" : "3.5"} fill="#101827" stroke={color} strokeWidth="2" opacity={animated ? 1 : 0} className="kpi-point-ring">
              <title>{`${selectedMonth ? `Tanggal ${d.label}` : d.label}: ${formatValue(d.value)} ${effectiveUnit}`}</title>
            </circle>
            {(!selectedMonth || Number(d.value) !== 0) && <text x={gX(pointSlot(d, i))} y={Math.max(pT + 9, gY(d.value) - 9)} textAnchor="middle" className="kpi-point-value" style={{ fill: color }}>{formatValue(d.value)}</text>}
          </g>)}
          {axisLabels.map((label, index) => <text key={`${label}-${index}`} x={gX(index)} y={H - 9} textAnchor="middle" className={selectedMonth ? "kpi-day-label" : "kpi-month-label"}>{label}</text>)}
        </svg> : <div className="kpi-chart-empty">Belum ada data grafik</div>}
        {selected && <div
          className="kpi-touch-tooltip"
          style={{
            left: `${Math.min(88, Math.max(12, (selected.x / W) * 100))}%`,
            top: `${Math.max(5, (selected.y / H) * 100)}%`,
            "--chart-color": color
          }}
        >
          <span>{selectedMonth ? `Tanggal ${selected.label} ${SCHEDULE_MONTHS[selectedMonth - 1]}` : selected.label}</span>
          <b>{formatValue(selected.value)} {effectiveUnit}</b>
        </div>}
      </div>
      <div className="kpi-mobile-chart-hint"><ArrowRight size={12} /> Sentuh grafik untuk melihat nilai</div>
      <div className="kpi-chart-legend">
        <span><i className="actual" style={{ background: color }} />Aktual</span>
        {effectiveTarget > 0 && <span><i className="target" />{effectiveTargetLabel || `Target ${formatValue(effectiveTarget)} ${effectiveUnit}`}</span>}
        {effectivePeriod && <span className="period">{effectivePeriod}</span>}
      </div>
    </div>
  );
}

function MonthlyKvarhCard({ data = [], rawData = [], loading, rawLoading, error, rawError, year, onRetry }) {
  const today = new Date();
  const currentMonth = today.getMonth() + 1;
  const currentDay = today.getDate();
  const [periodChoice, setPeriodChoice] = useState("year");
  const [activePoint, setActivePoint] = useState(null);
  const touchTimerRef = useRef(null);
  useEffect(() => () => { if (touchTimerRef.current) window.clearTimeout(touchTimerRef.current); }, []);
  const selectedMonth = periodChoice === "year" ? null : Number(periodChoice);
  const selectedMonthName = selectedMonth ? SCHEDULE_MONTHS[selectedMonth - 1] : "";
  const visibleLastDay = selectedMonth ? (selectedMonth === currentMonth ? currentDay : new Date(Number(year), selectedMonth, 0).getDate()) : 12;
  const dailyData = selectedMonth ? Array.from({ length: visibleLastDay }, (_, index) => ({
    slot: index + 1, day: index + 1, label: `${index + 1} ${SCHEDULE_MONTHS[selectedMonth - 1].slice(0, 3)}`,
    activeKwh: 0, reactiveKvarh: 0, reactiveLimitKvarh: 0, excessReactiveKvarh: 0,
    conclusion: "AMAN", checkCount: 0, lastEntryDay: index + 1, isPartial: selectedMonth === currentMonth,
  })) : [];
  if (selectedMonth) {
    const itemsByDay = new Map();
    asArray(rawData).forEach(item => {
      const match = String(item.tanggal || "").match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
      const day = Number(match?.[1]), month = Number(match?.[2]), itemYear = Number(match?.[3]);
      if (itemYear !== Number(year) || month !== selectedMonth || day < 1 || day > visibleLastDay) return;
      const active = Number(item.pemakaian_kwh), reactive = Number(item.nilai_kvar);
      if (!Number.isFinite(active) || !Number.isFinite(reactive) || active < 0 || reactive < 0) return;
      if (!itemsByDay.has(day)) itemsByDay.set(day, []);
      itemsByDay.get(day).push({ ...item, active, reactive });
    });
    itemsByDay.forEach((items, day) => {
      items.sort((a, b) => String(a.checked_at || a.jam || a.tanggal || "").localeCompare(String(b.checked_at || b.jam || b.tanggal || "")));
      const firstHasContent = items[0] && (items[0].active > 0 || items[0].reactive > 0);
      const chosen = firstHasContent ? items[0] : (items.find(it => it.active > 0 || it.reactive > 0) || items[0]);
      if (chosen) {
        dailyData[day - 1].activeKwh = chosen.active;
        dailyData[day - 1].reactiveKvarh = chosen.reactive;
        dailyData[day - 1].checkCount = items.length;
      }
    });
  }
  dailyData.forEach(item => {
    item.reactiveLimitKvarh = item.activeKwh * .62;
    item.excessReactiveKvarh = Math.max(0, item.reactiveKvarh - item.reactiveLimitKvarh);
    item.conclusion = item.reactiveKvarh > item.reactiveLimitKvarh ? "POTENSI DENDA" : "AMAN";
  });
  const allDailyItems = [];
  const rawItemsByDay = new Map();
  asArray(rawData).forEach(item => {
    const match = String(item.tanggal || "").match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    const day = Number(match?.[1]), month = Number(match?.[2]), itemYear = Number(match?.[3]);
    if (itemYear !== Number(year) || (selectedMonth && month !== selectedMonth) || day < 1) return;
    const active = Number(item.pemakaian_kwh), reactive = Number(item.nilai_kvar);
    if (!Number.isFinite(active) || !Number.isFinite(reactive) || active < 0 || reactive < 0) return;
    const key = `${month}-${day}`;
    if (!rawItemsByDay.has(key)) rawItemsByDay.set(key, []);
    rawItemsByDay.get(key).push({ ...item, active, reactive, day, month, itemYear });
  });
  rawItemsByDay.forEach((items) => {
    items.sort((a, b) => String(a.checked_at || a.jam || a.tanggal || "").localeCompare(String(b.checked_at || b.jam || b.tanggal || "")));
    const firstHasContent = items[0] && (items[0].active > 0 || items[0].reactive > 0);
    const chosen = firstHasContent ? items[0] : (items.find(it => it.active > 0 || it.reactive > 0) || items[0]);
    if (chosen) {
      const activeKwh = chosen.active;
      const reactiveKvarh = chosen.reactive;
      const reactiveLimitKvarh = activeKwh * .62;
      allDailyItems.push({
        day: chosen.day, month: chosen.month, label: `${chosen.day} ${SCHEDULE_MONTHS[chosen.month - 1].slice(0, 3)}`,
        activeKwh, reactiveKvarh, reactiveLimitKvarh,
        excessReactiveKvarh: Math.max(0, reactiveKvarh - reactiveLimitKvarh),
        conclusion: reactiveKvarh > reactiveLimitKvarh ? "POTENSI DENDA" : "AMAN",
        checkCount: items.length, isPartial: chosen.month === currentMonth,
      });
    }
  });
  allDailyItems.sort((a, b) => a.month - b.month || a.day - b.day);
  const latestDaily = allDailyItems.at(-1);
  const annualData = asArray(data).map(item => ({ ...item, slot: Number(item.month) }));
  const displayData = selectedMonth ? dailyData : annualData;
  const populated = displayData.filter(item => Number(item.checkCount) > 0);
  const latest = latestDaily || populated.at(-1);
  const axisLabels = selectedMonth ? Array.from({ length: visibleLastDay }, (_, index) => String(index + 1)) : SCHEDULE_MONTHS.map(name => name.slice(0, 3));
  const activeLoading = selectedMonth ? rawLoading : loading, activeError = selectedMonth ? rawError : error;
  const W = 1100, H = 270, pL = 24, pR = 24, pT = 35, pB = 42, iW = W - pL - pR, iH = H - pT - pB;
  const maxValue = Math.max(1, ...populated.flatMap(item => [Number(item.reactiveKvarh) || 0, Number(item.reactiveLimitKvarh) || 0])) * 1.18;
  const x = slot => pL + ((Number(slot) - 1) / Math.max(1, axisLabels.length - 1)) * iW;
  const y = value => pT + iH - (Math.max(0, Number(value) || 0) / maxValue) * iH;
  const actualPoints = populated.map(item => ({ x: x(item.slot), y: y(item.reactiveKvarh), item }));
  const limitPoints = populated.map(item => ({ x: x(item.slot), y: y(item.reactiveLimitKvarh), item }));
  const line = points => points.map((point, index) => `${index ? "L" : "M"} ${point.x} ${point.y}`).join(" ");
  const area = actualPoints.length ? `${line(actualPoints)} L ${actualPoints.at(-1).x} ${pT + iH} L ${actualPoints[0].x} ${pT + iH} Z` : "";
  const number = value => new Intl.NumberFormat("id-ID", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value) || 0);
  const choosePoint = event => {
    if (!actualPoints.length) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const pointerX = ((event.clientX - bounds.left) / Math.max(1, bounds.width)) * W;
    const nearest = actualPoints.reduce((best, point, index) => Math.abs(point.x - pointerX) < Math.abs(actualPoints[best].x - pointerX) ? index : best, 0);
    setActivePoint(nearest);
  };
  const keepVisible = () => { if (touchTimerRef.current) window.clearTimeout(touchTimerRef.current); touchTimerRef.current = window.setTimeout(() => setActivePoint(null), 3000); };
  const selected = activePoint === null ? null : actualPoints[activePoint];
  const title = selectedMonth ? `Monitoring kVArh harian · ${selectedMonthName} ${year}` : `Monitoring kVArh bulanan · ${year}`;
  const subtitle = selectedMonth ? `Akumulasi per hari, tanggal 1–${visibleLastDay}.` : `Akumulasi tanggal 1–akhir bulan; bulan berjalan sampai hari ini.`;
  return <article className="monthly-kvarh-card">
    <div className="monthly-kvarh-head">
      <div className="monthly-kvarh-title"><span className="kpi-icon-wrap"><Zap size={19} /></span><div><p className="eyebrow">Energi reaktif PLN</p><h3>{title}</h3><small>{subtitle}</small></div></div>
      <div className="monthly-kvarh-controls"><label><span>Pilih periode</span><select value={periodChoice} onChange={event => { setPeriodChoice(event.target.value); setActivePoint(null); }}><option value="year">Bulanan — 1 tahun</option>{SCHEDULE_MONTHS.slice(0, currentMonth).map((month, index) => <option key={month} value={index + 1}>{month} {year}</option>)}</select></label>{latest && <div className={`monthly-kvarh-status ${latest.conclusion === "AMAN" ? "safe" : "penalty"}`}><span>{latest.label} {year}{latest.isPartial ? " · Sementara" : ""}</span><b>{latest.conclusion}</b><small>Selisih {latest.reactiveLimitKvarh - latest.reactiveKvarh >= 0 ? "+" : "−"}{number(Math.abs(latest.reactiveLimitKvarh - latest.reactiveKvarh))} kVArh</small></div>}</div>
    </div>
    {activeLoading ? <div className="kvarh-state">Memuat grafik kVArh…</div> : activeError ? <div className="kvarh-state error">Grafik gagal dimuat. <button type="button" onClick={onRetry}>Coba lagi</button></div> : !populated.length ? <div className="kvarh-state">Belum ada isian stand meter pada {selectedMonth ? `${selectedMonthName} ` : ""}{year}.</div> : <>
      <div className="monthly-kvarh-chart">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${title}, aktual dan batas aman`}
          onPointerDown={choosePoint} onPointerMove={event => { if (event.pointerType === "mouse" && !event.buttons) choosePoint(event); }}
          onPointerUp={keepVisible} onPointerCancel={keepVisible} onPointerLeave={event => { if (event.pointerType === "mouse") setActivePoint(null); }}>
          <defs><linearGradient id="kvarhArea" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#a78bfa" stopOpacity=".32" /><stop offset="100%" stopColor="#a78bfa" stopOpacity="0" /></linearGradient></defs>
          {[0, .25, .5, .75, 1].map(step => <line key={step} x1={pL} x2={W - pR} y1={pT + iH - iH * step} y2={pT + iH - iH * step} className="kpi-grid-line" />)}
          {area && <path d={area} fill="url(#kvarhArea)" />}<path d={line(limitPoints)} className="kvarh-limit-line" /><path d={line(actualPoints)} className="kvarh-actual-line" />
          {limitPoints.map(({ x: cx, y: cy, item }) => <g key={`limit-${item.slot}`}><circle cx={cx} cy={cy} r="3" className="kvarh-limit-point" /><text x={cx} y={Math.min(pT + iH - 14, cy + 15)} textAnchor="middle" className="kvarh-limit-value">{number(item.reactiveLimitKvarh)}</text><text x={cx} y={pT + iH - 3} textAnchor="middle" className={`kvarh-difference-value ${item.conclusion === "AMAN" ? "safe" : "penalty"}`}>Δ {item.reactiveLimitKvarh - item.reactiveKvarh >= 0 ? "+" : "−"}{number(Math.abs(item.reactiveLimitKvarh - item.reactiveKvarh))}</text></g>)}
          {actualPoints.map(({ x: cx, y: cy, item }, index) => <g key={`actual-${item.slot}`}><circle cx={cx} cy={cy} r={activePoint === index ? 8 : 6} className={`kvarh-point-halo ${item.conclusion === "AMAN" ? "safe" : "penalty"}`} /><circle cx={cx} cy={cy} r="3.5" className={`kvarh-actual-point ${item.conclusion === "AMAN" ? "safe" : "penalty"}`} /><text x={cx} y={Math.max(12, cy - 11)} textAnchor="middle" className={`kvarh-actual-value ${item.conclusion === "AMAN" ? "safe" : "penalty"}`}>{number(item.reactiveKvarh)}</text></g>)}
          {axisLabels.map((label, index) => <text key={`${label}-${index}`} x={x(index + 1)} y={H - 11} textAnchor="middle" className={selectedMonth ? "kvarh-day-label" : "kpi-month-label"}>{label}</text>)}
        </svg>
        {selected && <div className="kvarh-tooltip" style={{ left: `${Math.min(90, Math.max(10, (selected.x / W) * 100))}%`, top: `${Math.max(4, (selected.y / H) * 100)}%` }}><b>{selected.item.label} {year}{selected.item.isPartial ? " (sementara)" : ""}</b><span>Aktual: {number(selected.item.reactiveKvarh)} kVArh</span><span>Batas: {number(selected.item.reactiveLimitKvarh)} kVArh</span><span>Selisih: {selected.item.reactiveLimitKvarh - selected.item.reactiveKvarh >= 0 ? "+" : "−"}{number(Math.abs(selected.item.reactiveLimitKvarh - selected.item.reactiveKvarh))} kVArh</span><strong className={selected.item.conclusion === "AMAN" ? "safe" : "penalty"}>{selected.item.conclusion}</strong><small>{selected.item.checkCount} isian{selectedMonth ? "" : ` · terakhir tgl ${selected.item.lastEntryDay}`}</small></div>}
      </div>
      <div className="monthly-kvarh-foot"><span><i className="actual" />Aktual kVArh</span><span><i className="limit" />Batas aman 62% × kWh</span><span><i className="difference" />Δ Selisih batas − aktual</span><span><i className="safe" />Aman</span><span><i className="penalty" />Potensi denda</span><em>Sentuh grafik untuk rincian nilai</em></div>
    </>}
  </article>;
}

function CosPhiPanelChart({ data = [], loading, error, year, onRetry }) {
  const minimumAllowed = .85;
  const today = new Date();
  const currentMonth = today.getMonth() + 1;
  const currentYear = today.getFullYear();
  const [selectedMonth, setSelectedMonth] = useState(currentMonth);
  const selectedMonthDate = new Date(Number(year), selectedMonth - 1, 1);
  const selectedMonthName = new Intl.DateTimeFormat("id-ID", { month: "long" }).format(selectedMonthDate);
  const visibleLastDay = new Date(Number(year), selectedMonth, 0).getDate();
  const selectableMonths = Number(year) === currentYear ? SCHEDULE_MONTHS.slice(0, currentMonth) : SCHEDULE_MONTHS;
  const panels = [
    { code: "panel_1", name: "Panel 1", color: "#22d3ee" },
    { code: "panel_2", name: "Panel 2", color: "#a78bfa" },
    { code: "panel_3", name: "Panel 3", color: "#f59e0b" },
    { code: "panel_4", name: "Panel 4", color: "#ec4899" },
  ];
  const [selectedPanel, setSelectedPanel] = useState("panel_1");
  const [activePoint, setActivePoint] = useState(null);
  const readings = [];
  asArray(data).forEach(item => {
    const match = String(item.tanggal || "").match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    const day = Number(match?.[1]), month = Number(match?.[2]), itemYear = Number(match?.[3]), value = Number(item.cos_phi);
    if (itemYear !== Number(year) || month !== selectedMonth || day < 1 || day > visibleLastDay || !Number.isFinite(value)) return;
    const timeMatch = String(item.jam || String(item.tanggal || "").match(/\s(\d{1,2}:\d{2})/)?.[1] || "").match(/(\d{1,2}):(\d{2})/);
    const hour = Math.max(0, Math.min(23, Number(timeMatch?.[1]) || 0));
    const minute = Math.max(0, Math.min(59, Number(timeMatch?.[2]) || 0));
    const session = hour < 12 ? "pagi" : "sore";
    readings.push({ ...item, day, value, hour, minute, session, sessionLabel: session === "pagi" ? "Pagi" : "Sore", timeLabel: timeMatch ? `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}` : "Jam tidak tercatat", position: (day - 1) + (hour * 60 + minute) / 1440 });
  });
  const series = panels.map(panel => ({ ...panel, points: readings.filter(item => item.code === panel.code).sort((a, b) => a.position - b.position || Number(a.id) - Number(b.id)) }));
  const allPoints = series.flatMap(panel => panel.points);
  const latestByPanel = series.map(panel => ({ ...panel, latest: panel.points.at(-1) }));
  const number = value => Number(value).toLocaleString("id-ID", { minimumFractionDigits: 2, maximumFractionDigits: 3 });
  const selectedSeries = series.find(panel => panel.code === selectedPanel) || series[0];
  const attentionPanels = latestByPanel.filter(panel => panel.latest && panel.latest.value < minimumAllowed);
  const W = 1100, H = 260, pL = 44, pR = 22, pT = 24, pB = 43, iW = W - pL - pR, iH = H - pT - pB;
  const lowest = selectedSeries.points.length ? Math.min(...selectedSeries.points.map(point => point.value), minimumAllowed) : minimumAllowed;
  const domainMin = Math.max(0, Math.min(.8, Math.floor((lowest - .03) * 20) / 20));
  const x = position => pL + (position / Math.max(1, visibleLastDay)) * iW;
  const y = value => pT + iH - ((Math.max(domainMin, Math.min(1, Number(value))) - domainMin) / (1 - domainMin)) * iH;
  const path = selectedSeries.points.map((point, index) => `${index ? "L" : "M"} ${x(point.position)} ${y(point.value)}`).join(" ");
  const labelStep = visibleLastDay > 20 ? 2 : 1;
  const dayLabels = Array.from({ length: visibleLastDay }, (_, index) => index + 1).filter(day => day === 1 || day === visibleLastDay || day % labelStep === 0);
  const selectReading = event => {
    if (!selectedSeries.points.length) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const pointerX = ((event.clientX - bounds.left) / Math.max(1, bounds.width)) * W;
    setActivePoint(selectedSeries.points.reduce((best, point) => Math.abs(x(point.position) - pointerX) < Math.abs(x(best.position) - pointerX) ? point : best, selectedSeries.points[0]));
  };
  return <article className="cosphi-chart-card">
    <div className="cosphi-chart-head">
      <div className="cosphi-chart-title"><span className="kpi-icon-wrap"><Activity size={19} /></span><div><p className="eyebrow">Monitoring faktor daya panel</p><h3>Grafik cos φ · {selectedSeries.name}</h3><small>Dua pemeriksaan harian ditampilkan berdasarkan tanggal dan jam pencatatan.</small></div></div>
      <div className="cosphi-chart-controls"><label><span>Pilih bulan</span><select value={selectedMonth} onChange={event => { setSelectedMonth(Number(event.target.value)); setActivePoint(null); }}>{selectableMonths.map((month, index) => <option key={month} value={index + 1}>{month} {year}</option>)}</select></label><div className="cosphi-allowed"><span>Batas monitoring</span><b>0,85–1,00</b><small>Di bawah 0,85 perlu perhatian</small></div></div>
    </div>
    {attentionPanels.length ? <div className="cosphi-panel-alert"><AlertTriangle size={17} /><span><b>Panel perlu perhatian</b><small>{attentionPanels.map(panel => `${panel.name} (${number(panel.latest.value)})`).join(" · ")} berdasarkan pembacaan terakhir.</small></span></div> : <div className="cosphi-panel-alert safe"><CheckCircle2 size={17} /><span><b>Seluruh panel dalam batas</b><small>Pembacaan terakhir semua panel berada pada nilai minimum 0,85 atau lebih.</small></span></div>}
    <div className="cosphi-panel-selector" role="tablist" aria-label="Pilih grafik panel">{latestByPanel.map(panel => {
      const needsAttention = panel.latest && panel.latest.value < minimumAllowed;
      return <button type="button" role="tab" aria-selected={selectedPanel === panel.code} key={panel.code} className={`${selectedPanel === panel.code ? "active" : ""} ${needsAttention ? "warning" : !panel.latest ? "empty" : "safe"}`} style={{ "--panel-color": panel.color }} onClick={() => { setSelectedPanel(panel.code); setActivePoint(null); }}><span><i style={{ background: panel.color }} />{panel.name}</span><b>{panel.latest ? number(panel.latest.value) : "–"}</b><small>{!panel.latest ? "Belum ada data" : needsAttention ? "Perlu perhatian" : "Dalam batas"}</small></button>;
    })}</div>
    {loading ? <div className="kvarh-state">Memuat grafik cos φ…</div> : error ? <div className="kvarh-state error">Grafik gagal dimuat. <button type="button" onClick={onRetry}>Coba lagi</button></div> : !allPoints.length ? <div className="kvarh-state">Belum ada pembacaan cos φ panel pada {selectedMonthName} {year}.</div> : <>
      {!selectedSeries.points.length ? <div className="kvarh-state">Belum ada pembacaan {selectedSeries.name} pada {selectedMonthName} {year}.</div> : <div className="cosphi-single-chart-scroll">
        <div className="cosphi-single-chart-stage">
          <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Grafik cos phi ${selectedSeries.name} bulan ${selectedMonthName} ${year}`} onPointerDown={selectReading} onPointerMove={event => { if (event.pointerType === "mouse" && !event.buttons) selectReading(event); }} onPointerLeave={event => { if (event.pointerType === "mouse") setActivePoint(null); }}>
            <rect x={pL} y={y(1)} width={iW} height={y(minimumAllowed) - y(1)} className="cosphi-safe-area" />
            {[domainMin, minimumAllowed, .9, .95, 1].filter((value, index, list) => list.indexOf(value) === index).map(value => <g key={value}><line x1={pL} x2={W - pR} y1={y(value)} y2={y(value)} className={value === minimumAllowed ? "cosphi-limit-line" : "kpi-grid-line"} /><text x={pL - 7} y={y(value) + 3} textAnchor="end" className="cosphi-axis-label">{number(value)}</text></g>)}
            <text x={pL + 8} y={Math.max(pT + 11, y(minimumAllowed) - 7)} className="cosphi-limit-label">Batas minimum 0,85</text>
            {path && <path d={path} fill="none" stroke={selectedSeries.color} className="cosphi-series-line" />}
            {selectedSeries.points.map((point, index) => <g key={`${selectedSeries.code}-${point.id || `${point.day}-${point.timeLabel}`}-${index}`}><circle cx={x(point.position)} cy={y(point.value)} r={activePoint === point ? 6.5 : 5} fill={point.value >= minimumAllowed ? selectedSeries.color : "#fb7185"} opacity=".18" /><circle cx={x(point.position)} cy={y(point.value)} r="2.8" fill="#101827" stroke={point.value >= minimumAllowed ? selectedSeries.color : "#fb7185"} strokeWidth="1.8" /></g>)}
            {dayLabels.map(day => <text key={day} x={x(day - .5)} y={H - 11} textAnchor="middle" className="cosphi-day-label">{day}</text>)}
          </svg>
          {activePoint && activePoint.code === selectedSeries.code && <div className="cosphi-tooltip cosphi-single-tooltip" style={{ left: `${Math.min(92, Math.max(8, (x(activePoint.position) / W) * 100))}%` }}><b>{selectedSeries.name} · {activePoint.day} {selectedMonthName} {year}</b><span>{activePoint.sessionLabel} · {activePoint.timeLabel}</span><span>Cos φ: <strong className={activePoint.value >= minimumAllowed ? "safe" : "warning"}>{number(activePoint.value)}</strong></span><small>{activePoint.petugas ? `Petugas: ${activePoint.petugas}` : activePoint.value >= minimumAllowed ? "Dalam batas monitoring" : "Perlu perhatian"}</small></div>}
        </div>
      </div>}
      <div className="cosphi-chart-legend"><span><i style={{ background: selectedSeries.color }} />{selectedSeries.name}</span><span><i className="limit" />Minimum 0,85</span><span><i className="heat-danger" />Titik perlu perhatian</span><em>Sentuh grafik untuk melihat tanggal, jam, dan nilai</em></div>
    </>}
  </article>;
}

function DashboardKpiChart({ title, subtitle, icon: Icon, data, target = 0, maxValue, color, unit, decimals = 0, loading, error, onClick }) {
  const chartRef = useRef(null);
  const [chartSize, setChartSize] = useState({ width: 600, height: 125 });
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const update = () => setChartSize({
      width: Math.max(280, Math.round(chart.clientWidth)),
      height: Math.max(110, Math.round(chart.clientHeight))
    });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(chart);
    return () => observer.disconnect();
  }, []);
  const visible = trimChartSeries(data);
  const latest = visible.at(-1) || {};
  const previous = visible.at(-2);
  const delta = previous ? Number(latest.value || 0) - Number(previous.value || 0) : null;
  const detail = [
    latest.label || "-",
    target > 0 ? `Target ${target}${unit}` : "",
    delta === null ? "" : `${delta > 0 ? "+" : ""}${delta.toLocaleString("id-ID", { maximumFractionDigits: decimals })}${unit}`
  ].filter(Boolean).join(" · ");
  const { width, height } = chartSize, padX = 18, padTop = 15, padBottom = 22;
  const chartHeight = height - padTop - padBottom, safeMax = Math.max(1, maxValue || 0, target, ...visible.map(x => Number(x.value || 0)));
  const pointX = i => padX + (visible.length > 1 ? i * (width - padX * 2) / (visible.length - 1) : (width - padX * 2) / 2);
  const pointY = value => padTop + chartHeight - Math.min(Math.max(Number(value || 0), 0), safeMax) / safeMax * chartHeight;
  const points = visible.map((item, i) => `${pointX(i)},${pointY(item.value)}`).join(" ");
  const area = visible.length ? `${padX},${padTop + chartHeight} ${points} ${pointX(visible.length - 1)},${padTop + chartHeight}` : "";
  return <button className="dashboard-kpi-card" onClick={onClick}>
    <div className="dashboard-kpi-head"><span className="dashboard-kpi-icon" style={{ color, background: `${color}16` }}><Icon size={19} /></span><div><b>{title}</b><small>{subtitle}</small></div><ArrowRight size={16} /></div>
    {loading ? <div className="dashboard-chart-state"><span className="spinner dark" />Memuat data…</div> : error ? <div className="dashboard-chart-state error-text">Data tidak tersedia</div> : <>
      <div className="dashboard-kpi-value"><strong>{Number(latest.value || 0).toLocaleString("id-ID", { maximumFractionDigits: 1 })}{unit}</strong><span>{detail}</span></div>
      <svg ref={chartRef} className="dashboard-sparkline" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Grafik ${title}`}>
        {[.25, .5, .75].map(p => <line key={p} x1={padX} x2={width - padX} y1={padTop + chartHeight * p} y2={padTop + chartHeight * p} className="spark-grid" />)}
        {target > 0 && <line x1={padX} x2={width - padX} y1={pointY(target)} y2={pointY(target)} className="spark-target" />}
        <polygon points={area} fill={color} opacity=".055" />
        <polyline points={points} fill="none" stroke={color} strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" />
        {visible.map((item, i) => <g key={i}>
          <text className="spark-value" x={pointX(i)} y={Math.max(9, pointY(item.value) - 9)} textAnchor="middle">{Number(item.value || 0).toLocaleString("id-ID", { maximumFractionDigits: decimals })}{unit === "%" ? "%" : ""}</text>
          <circle cx={pointX(i)} cy={pointY(item.value)} r={i === visible.length - 1 ? 3.5 : 2.25} fill={i === visible.length - 1 ? "white" : color} stroke={color} strokeWidth={i === visible.length - 1 ? 2 : 0} />
        </g>)}
        {visible.length > 0 && <><text x={padX} y={height - 3}>{String(visible[0].label).slice(0, 3)}</text><text x={width - padX} y={height - 3} textAnchor="end">{String(latest.label).slice(0, 3)}</text></>}
      </svg>
    </>}
  </button>;
}

function Panel({ title, action, children, className = "" }) {
  return <section className={`panel ${className}`}><div className="panel-head"><h3>{title}</h3>{action}</div>{children}</section>;
}

function Orders({ go, session, notify }) {
  const [query, setQuery] = useState("");
  const [month, setMonth] = useState("Semua Bulan");
  const [selected, setSelected] = useState(() => new Set());
  const [deleting, setDeleting] = useState(false);
  const remote = useRemoteData(async () =>
    asArray(await apiGet(ENDPOINTS.orders, { action: "getAllOrders" })).map(normalizeOrder)
  );
  const isAdmin = String(session?.role || "").toLocaleLowerCase("id-ID") === "admin";
  useEffect(() => setSelected(new Set()), [query, month]);
  const months = ["Semua Bulan", "Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
  const monthAliases = [[], ["jan"], ["feb"], ["mar"], ["apr"], ["mei", "may"], ["jun"], ["jul"], ["agu", "aug"], ["sep"], ["okt", "oct"], ["nov"], ["des", "dec"]];
  const rows = remote.data.filter((o) => {
    const matchesQuery = `${o.namaMesin} ${o.kerusakan} ${o.bagianOrder}`.toLowerCase().includes(query.toLowerCase());
    const dateText = String(o.tanggal).toLowerCase();
    const matchesMonth = month === "Semua Bulan" || monthAliases[months.indexOf(month)].some(alias => dateText.includes(alias));
    return matchesQuery && matchesMonth;
  });
  const visibleIds = rows.map(order => String(order.rowIndex));
  const selectedCount = selected.size;
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every(id => selected.has(id));
  const toggleOrder = order => setSelected(current => { const next = new Set(current), id = String(order.rowIndex); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const toggleAll = () => setSelected(current => { const next = new Set(current); if (allVisibleSelected) visibleIds.forEach(id => next.delete(id)); else visibleIds.forEach(id => next.add(id)); return next; });
  const deleteSelected = async () => {
    if (!isAdmin || deleting || !selectedCount) return;
    if (!window.confirm(`Hapus ${selectedCount} order kerja yang dipilih?\n\nData order tidak dapat dipulihkan. Laporan pekerjaan yang sudah terbentuk tetap disimpan sebagai riwayat.`)) return;
    setDeleting(true);
    try {
      const result = await apiPost(ENDPOINTS.orders, { action: "deleteOrders", token: session.token, orderIds: [...selected] }, { timeout: 120000 });
      if (!isSuccess(result) || !Number(result?.data?.deletedCount)) throw new Error(result?.message || "Order kerja gagal dihapus.");
      setSelected(new Set());
      notify(result.message || "Order kerja terpilih berhasil dihapus.");
      await remote.reload();
    } catch (error) { notify(error?.message || "Order kerja gagal dihapus."); }
    finally { setDeleting(false); }
  };
  return <Panel title="Daftar order" action={<button className="primary small" onClick={() => go("createOrder")}><Plus size={16} /> Buat order</button>}>
    <Toolbar query={query} setQuery={setQuery}><select value={month} onChange={(e) => setMonth(e.target.value)}>{months.map(value => <option key={value}>{value}</option>)}</select></Toolbar>
    {isAdmin && !remote.loading && !remote.error && rows.length > 0 && <div className={`order-selection-bar ${selectedCount ? "active" : ""}`}><label><input type="checkbox" checked={allVisibleSelected} onChange={toggleAll} /><span><b>{allVisibleSelected ? "Batalkan semua" : "Pilih semua hasil"}</b><small>{selectedCount ? `${selectedCount} order dipilih` : `${rows.length} order dalam tampilan`}</small></span></label><button type="button" className="danger-button" disabled={!selectedCount || deleting} onClick={deleteSelected}>{deleting ? <><span className="spinner dark" />Menghapus…</> : <><Trash2 size={15} />Hapus terpilih{selectedCount ? ` (${selectedCount})` : ""}</>}</button></div>}
    <RemoteState loading={remote.loading} error={remote.error} empty={!rows.length} onRetry={remote.reload} />
    {!remote.loading && !remote.error && rows.length > 0 && <OrderTable orders={rows} onClick={(o) => go("orderDetail", o)} selectable={isAdmin} selected={selected} onToggle={toggleOrder} />}
  </Panel>;
}

function OrderTable({ orders, onClick, selectable = false, selected = new Set(), onToggle = () => { } }) {
  return <div className={`table-wrap order-table ${selectable ? "selectable" : ""}`}><table><thead><tr>{selectable && <th className="order-select-head">Pilih</th>}<th>Tanggal</th><th>Mesin / Kerusakan</th><th>Pengorder</th><th>Urgensi</th><th>Status</th><th /></tr></thead><tbody>{orders.map((o) => { const checked = selected.has(String(o.rowIndex)); return <tr key={o.rowIndex} className={checked ? "selected" : ""} onClick={() => onClick(o)}>{selectable && <td className="order-select-cell" onClick={event => event.stopPropagation()}><label aria-label={`Pilih order ${o.namaMesin}`}><input type="checkbox" checked={checked} onChange={() => onToggle(o)} /><span><Check size={13} /></span></label></td>}<td className="order-date-cell">{o.tanggal}</td><td className="order-machine-cell"><b>{o.namaMesin}</b><small>{o.kerusakan}</small></td><td className="order-requester-cell"><b>{o.namaOrder}</b><small>{o.bagianOrder} → {o.bagianTujuan}</small></td><td className="order-urgency-cell"><Badge text={o.urgensi} /></td><td className="order-status-cell"><Badge text={o.status} /></td><td className="order-arrow-cell"><ArrowRight size={17} /></td></tr> })}</tbody></table></div>;
}

function OrderDetail({ order, go }) {
  const download = () => exportCsv(
    ["Field", "Nilai"],
    [
      ["Nomor order", `WO-${String(order.rowIndex).padStart(4, "0")}`],
      ["Tanggal order", order.tanggal],
      ["Mesin / aset", order.namaMesin],
      ["Kerusakan", order.kerusakan],
      ["Urgensi", order.urgensi],
      ["Nama pengorder", order.namaOrder],
      ["Bagian pengorder", order.bagianOrder],
      ["Bagian tujuan", order.bagianTujuan],
      ["Status", order.status]
    ],
    `order-WO-${order.rowIndex}`
  );
  return <div className="detail-grid">
    <Panel title={`WO-${String(order.rowIndex).padStart(4, "0")}`} action={<Badge text={order.status} />}>
      <div className="detail-hero"><span className="icon-box amber"><Wrench /></span><div><p>MESIN / ASET</p><h2>{order.namaMesin}</h2><span>{order.kerusakan}</span></div></div>
      <div className="info-grid">{[["Tanggal order", order.tanggal], ["Tingkat urgensi", order.urgensi], ["Nama pengorder", order.namaOrder], ["Bagian pengorder", order.bagianOrder], ["Bagian tujuan", order.bagianTujuan], ["Status pekerjaan", order.status]].map(([a, b]) => <div key={a}><small>{a}</small><b>{b}</b></div>)}</div>
    </Panel>
    <Panel title="Tindakan selanjutnya"><div className="action-stack"><button className="primary wide" onClick={() => go("finishOrder")}><ClipboardCheck size={18} /> Lakukan perbaikan</button><button className="secondary wide" onClick={download}><Download size={18} /> Unduh detail order</button></div><p className="hint"><ShieldCheck size={16} /> Pastikan kondisi mesin aman sebelum memulai pekerjaan.</p></Panel>
  </div>;
}

function WorkOrderForm({ notify, go, initialMachine = "", onSuccess }) {
  const machines = useRemoteData(loadMachineMaster);
  const [category, setCategory] = useState("");
  const [destination, setDestination] = useState("");
  const [machineName, setMachineName] = useState(initialMachine);
  const [machineType, setMachineType] = useState("");
  const orderSections = ["Bahan Baku", "Finishgood", "Gudang Part", "HRD", "Muat", "Opt. Crane", "Pengecatan", "Perakitan", "Pipa ERW", "PPID", "QC", "Slitting", "Tek. Shift A", "Tek. Shift B", "Bengkel", "Umum", "Konstruksi"];
  const destinationSections = ["Tek. Shift A", "Tek. Shift B", "Bengkel", "Umum", "Konstruksi"];
  const workTypes = ["Perbaikan", "Pemeriksaan", "Pemasangan", "Pemindahan", "Pembuatan", "Setting", "Kalibrasi"];
  const typeOptions = [...new Set(machines.data.filter(item => !category || String(item.Kategori || item.kategori || "") === category).map(item => item.Jenis || item.jenis).filter(Boolean))].sort();
  const machineOptions = machines.data.filter(item => (!category || String(item.Kategori || item.kategori || "") === category) && (!machineType || String(item.Jenis || item.jenis || "") === machineType));
  useEffect(() => {
    if (!initialMachine || !machines.data.length) return;
    const target = machines.data.find(item => String(item.Nama || item.nama || "").trim().toLowerCase() === String(initialMachine).trim().toLowerCase());
    if (!target) return;
    setMachineName(target.Nama || target.nama || initialMachine);
    setCategory(target.Kategori || target.kategori || "");
    setMachineType(target.Jenis || target.jenis || "");
    if (String(target.Kategori || target.kategori || "").toLowerCase() === "armada") setDestination("Bengkel");
  }, [initialMachine, machines.data]);
  const changeDestination = value => {
    setDestination(value);
    const nextCategory = value === "Bengkel" ? "Armada" : "Mesin";
    if (nextCategory !== category) {
      setCategory(nextCategory);
      setMachineType("");
      setMachineName("");
    }
  };
  const submit = async (data) => {
    const result = await apiPost(ENDPOINTS.createOrder, { action: "create", ...data });
    if (!isSuccess(result)) throw new Error(result.message || "Order gagal dikirim.");
    notify?.("Order kerja berhasil dikirim dan tersinkron.");
    if (onSuccess) onSuccess(result);
    else go?.("dashboard");
  };
  return <FormPanel title="Informasi permintaan" onSubmit={submit} submit="Kirim order kerja">
    <Field label="Bagian order"><select name="bagianOrder" required defaultValue=""><option value="" disabled>Pilih bagian order</option>{orderSections.map(value => <option key={value}>{value}</option>)}</select></Field>
    <Field label="Nama pengorder"><input name="namaOrder" placeholder="Nama lengkap" required /></Field>
    <Field label="Bagian tujuan"><select name="bagianTujuan" value={destination} onChange={event => changeDestination(event.target.value)} required><option value="">Pilih bagian tujuan</option>{destinationSections.map(value => <option key={value}>{value}</option>)}</select></Field>
    <Field label="Kategori perangkat"><input name="kategoriMesin" value={category} placeholder="Otomatis dari bagian tujuan" readOnly required /></Field>
    <Field label={category === "Armada" ? "Jenis armada" : "Jenis mesin"}><select name="jenis" value={machineType} onChange={event => { setMachineType(event.target.value); setMachineName(""); }} required><option value="">Pilih jenis</option>{typeOptions.map(value => <option key={value}>{value}</option>)}</select></Field>
    <Field label="Nama mesin / aset"><select name="namaMesin" value={machineName} onChange={event => {
      const value = event.target.value;
      setMachineName(value);
      const target = machines.data.find(item => (item.Nama || item.nama) === value);
      if (target) {
        setCategory(target.Kategori || target.kategori || "");
        setMachineType(target.Jenis || target.jenis || "");
      }
    }} required><option value="">Pilih nama</option>{machineName && !machines.data.some(x => (x.Nama || x.nama) === machineName) && <option value={machineName}>{machineName}</option>}{machineOptions.map(x => <option key={x.id} value={x.Nama || x.nama}>{x.Nama || x.nama}</option>)}</select></Field>
    <Field label="Jenis pekerjaan"><select name="jenisPekerjaan" required defaultValue=""><option value="" disabled>Pilih jenis pekerjaan</option>{workTypes.map(value => <option key={value}>{value}</option>)}</select></Field>
    <Field label="Urgensi"><select name="urgensi" defaultValue="Biasa"><option>Biasa</option><option>Penting</option><option>Penting Sekali</option></select></Field>
    <Field label="Deskripsi kerusakan" wide><textarea name="kerusakan" placeholder="Jelaskan gejala atau kerusakan..." required /></Field>
  </FormPanel>;
}

function FinishOrder({ order, notify, go }) {
  const parts = useRemoteData(async () => asArray(await apiGet(ENDPOINTS.partMaster, { action: "getPart" }), ["stok", "parts"]));
  const [partMode, setPartMode] = useState("none");
  const [partCategory, setPartCategory] = useState("");
  const [partName, setPartName] = useState("Tidak Pakai");
  const [partSize, setPartSize] = useState("Tidak Pakai");
  const partRows = parts.data.map(item => Array.isArray(item)
    ? { Kategori: item[0], Nama: item[1], Ukuran: item[2] }
    : item
  );
  const partCategories = [...new Set(partRows.map(item => item.Kategori || item.kategori).filter(Boolean))].sort();
  const partNames = [...new Set(partRows.filter(item => !partCategory || (item.Kategori || item.kategori) === partCategory).map(item => item.Nama || item.nama).filter(Boolean))].sort();
  const partSizes = [...new Set(partRows.filter(item => (item.Kategori || item.kategori) === partCategory && (item.Nama || item.nama) === partName).map(item => item.Ukuran || item.ukuran).filter(Boolean))].sort();
  const localDate = () => { const date = new Date(), offset = date.getTimezoneOffset(); return new Date(date.getTime() - offset * 60000).toISOString().slice(0, 10); };
  const localTime = () => new Date().toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", hour12: false }).replace(".", ":");
  const submit = async (data) => {
    if (partMode !== "none" && (!partName || !partSize)) throw new Error("Nama dan ukuran spare part wajib dilengkapi.");
    const result = await apiPost(ENDPOINTS.completeOrder, {
      action: "complete", rowIndex: order.rowIndex,
      perbaikanDilakukan: data.perbaikanDilakukan,
      jamMulai: `${toIdDate(data.tglMulai)} ${data.waktuMulai}`,
      jamSelesai: `${toIdDate(data.tglSelesai)} ${data.waktuSelesai}`,
      statusMesin: data.statusMesin, nilaiPerbaikan: data.nilaiPerbaikan,
      sparePart: partName, ukuranSparePart: partSize, keterangan: data.keterangan
    });
    if (!isSuccess(result)) throw new Error(result.message || "Penyelesaian order gagal disimpan.");
    notify(result.message || "Order ditandai selesai dan tersinkron.");
    go("dashboard");
  };
  return <FormPanel title={`Penyelesaian · ${order.namaMesin}`} onSubmit={submit} submit="Selesaikan order">
    <Field label="Tindakan perbaikan" wide><textarea name="perbaikanDilakukan" placeholder="Uraikan tindakan yang dilakukan..." required /></Field>
    <Field label="Tanggal mulai"><input name="tglMulai" type="date" lang="id-ID" defaultValue={localDate()} required /></Field>
    <Field label="Waktu mulai"><input name="waktuMulai" type="time" defaultValue={localTime()} required /></Field>
    <Field label="Tanggal selesai"><input name="tglSelesai" type="date" lang="id-ID" defaultValue={localDate()} required /></Field>
    <Field label="Waktu selesai"><input name="waktuSelesai" type="time" defaultValue={localTime()} required /></Field>
    <Field label="Status mesin"><select name="statusMesin" required defaultValue=""><option value="" disabled>Pilih status</option>{["Repair", "Breakdown", "Tunggu Part", "Overhoul Mesin", "Yang Lain"].map(value => <option key={value}>{value}</option>)}</select></Field>
    <Field label="Nilai perbaikan"><select name="nilaiPerbaikan" defaultValue="Bagus"><option>Bagus</option><option>Cukup</option><option>Tidak Bagus</option></select></Field>
    <Field label="Pemakaian spare part"><select value={partMode} onChange={event => {
      const mode = event.target.value; setPartMode(mode); setPartCategory("");
      if (mode === "none") { setPartName("Tidak Pakai"); setPartSize("Tidak Pakai"); }
      else { setPartName(""); setPartSize(""); }
    }}><option value="none">Tidak Pakai</option><option value="master">Pilih dari master part</option><option value="manual">Input manual</option></select></Field>
    {partMode === "master" && <><Field label="Kategori part"><select value={partCategory} onChange={event => { setPartCategory(event.target.value); setPartName(""); setPartSize(""); }}><option value="">Pilih kategori</option>{partCategories.map(value => <option key={value}>{value}</option>)}</select></Field><Field label="Nama spare part"><select value={partName} onChange={event => { setPartName(event.target.value); setPartSize(""); }}><option value="">Pilih part</option>{partNames.map(value => <option key={value}>{value}</option>)}</select></Field><Field label="Ukuran spare part"><select value={partSize} onChange={event => setPartSize(event.target.value)}><option value="">Pilih ukuran</option>{partSizes.map(value => <option key={value}>{value}</option>)}</select></Field></>}
    {partMode === "manual" && <><Field label="Nama spare part"><input value={partName} onChange={event => setPartName(event.target.value)} placeholder="Nama part" /></Field><Field label="Ukuran spare part"><input value={partSize} onChange={event => setPartSize(event.target.value)} placeholder="Ukuran" /></Field></>}
    <Field label="Keterangan" wide><textarea name="keterangan" /></Field>
  </FormPanel>;
}

function Maintenance({ go }) {
  const remote = useRemoteData(async () =>
    asArray(await apiGet(ENDPOINTS.maintenance, { action: "getPerawatan" }))
  );
  const recent = remote.data.slice(-10).reverse();
  return <>
    <div className="stats-grid three"><Stat icon={CalendarDays} label="Catatan perawatan" value={remote.loading ? "…" : remote.data.length} detail="Seluruh data" tone="blue" /><Stat icon={CheckCircle2} label="Terealisasi" value={remote.loading ? "…" : recent.length} detail="Data terbaru" tone="mint" /><Stat icon={AlertTriangle} label="Sumber data" value="Live" detail="Neon PostgreSQL" tone="amber" /></div>
    <div className="split-actions maintenance-actions"><button className="choice-card" onClick={() => go("schedule")}><span className="icon-box blue"><CalendarDays /></span><div><b>Lihat jadwal</b><small>Kalender perawatan seluruh aset</small></div><ArrowRight /></button><button className="choice-card" onClick={() => go("maintenanceForm")}><span className="icon-box mint"><ClipboardCheck /></span><div><b>Isi perawatan</b><small>Rekam aktivitas yang dikerjakan</small></div><ArrowRight /></button><button className="choice-card" onClick={() => go("maintenancePrint")}><span className="icon-box violet"><Printer /></span><div><b>Cetak checklist</b><small>Dua laporan dalam satu PDF</small></div><ArrowRight /></button></div>
    <Panel title="Aktual perawatan terbaru"><RemoteState loading={remote.loading} error={remote.error} empty={!recent.length} onRetry={remote.reload} /><div className="maintenance-list">{recent.map((m, i) => <div key={`${m.nama_mesin}-${m.tanggal}-${i}`}><span className="machine-icon"><Wrench /></span><div><b>{m.nama_mesin || m.nama || "-"}</b><small>{m.jenis_perawatan || m.waktu || "-"}</small></div><span>{m.tanggal}</span><Badge text="Selesai" /><button onClick={() => go("maintenanceForm")}>Isi lagi</button></div>)}</div></Panel>
  </>;
}

const EMPTY_MAINTENANCE_PRINT_FILTER = { jenis: "", nama_mesin: "", perawatan: "", year: "", month: "", recordId: "", note: "" };

function MaintenancePrintSelector({ number, rows, kategori, value, onChange, otherRecordId }) {
  const options = maintenancePrintOptions(rows, { kategori, ...value });
  const record = rows.find(row => row.id === value.recordId) || null;
  const select = (key, next) => {
    const order = ["jenis", "nama_mesin", "perawatan", "year", "month", "recordId"], index = order.indexOf(key);
    const updated = { ...value, [key]: next };
    order.slice(index + 1).forEach(field => { updated[field] = ""; });
    if (key === "recordId") {
      const selectedRow = rows.find(row => row.id === next);
      updated.note = selectedRow?.keterangan || selectedRow?.notes || selectedRow?.hasil_pemeriksaan || "";
    } else if (key !== "note") {
      updated.note = "";
    }
    onChange(updated);
  };
  const dateLabel = row => `${String(row.date.day).padStart(2, "0")} ${MAINTENANCE_PRINT_MONTHS[row.date.month - 1]} ${row.date.year}`;
  const summary = record ? conditionSummary(record.checks) : null;
  return <section className="maintenance-print-selector">
    <div className="maintenance-print-selector-head"><span>{number}</span><div><p className="eyebrow">Pilihan laporan</p><h3>Checklist perawatan {number}</h3></div>{record && <CheckCircle2 size={20} />}</div>
    <div className="maintenance-print-fields">
      <label><span>Jenis</span><select value={value.jenis} onChange={event => select("jenis", event.target.value)} disabled={!kategori}><option value="">Pilih jenis</option>{options.jenis.map(item => <option key={item}>{item}</option>)}</select></label>
      <label><span>Nama mesin / armada</span><select value={value.nama_mesin} onChange={event => select("nama_mesin", event.target.value)} disabled={!value.jenis}><option value="">Pilih nama</option>{options.nama_mesin.map(item => <option key={item}>{item}</option>)}</select></label>
      <label><span>Perawatan</span><select value={value.perawatan} onChange={event => select("perawatan", event.target.value)} disabled={!value.nama_mesin}><option value="">Pilih perawatan</option>{options.perawatan.map(item => <option key={item}>{item}</option>)}</select></label>
      <label><span>Tahun</span><select value={value.year} onChange={event => select("year", event.target.value)} disabled={!value.perawatan}><option value="">Pilih tahun</option>{options.years.map(item => <option key={item} value={item}>{item}</option>)}</select></label>
      <label><span>Bulan</span><select value={value.month} onChange={event => select("month", event.target.value)} disabled={!value.year}><option value="">Pilih bulan</option>{options.months.map(item => <option key={item} value={item}>{MAINTENANCE_PRINT_MONTHS[item - 1]}</option>)}</select></label>
      <label><span>Tanggal yang tersedia</span><select value={value.recordId} onChange={event => select("recordId", event.target.value)} disabled={!value.month}><option value="">Pilih tanggal</option>{options.records.map(item => <option key={item.id} value={item.id} disabled={item.id === otherRecordId}>{dateLabel(item)}{item.id === otherRecordId ? " · sudah dipilih" : ""}</option>)}</select></label>
    </div>
    {record && <div className="maintenance-print-record"><div><b>{record.nama_mesin}</b><small>{dateLabel(record)} · {record.perawatan}</small></div><span><b>{record.checks.length}</b><small>item</small></span><span className="good"><b>{summary.goodPercent}%</b><small>bagus</small></span><span className="repair"><b>{summary.repairPercent}%</b><small>perbaikan</small></span></div>}
    <label className="maintenance-print-note"><span>Keterangan untuk laporan {number}</span><textarea value={value.note} onChange={event => onChange({ ...value, note: event.target.value })} maxLength={400} placeholder="Isi keterangan yang akan dicetak pada PDF..." disabled={!record} /><small>Keterangan hanya dipakai pada PDF dan tidak mengubah data perawatan.</small></label>
  </section>;
}

function MaintenancePrint({ notify, go }) {
  const remote = useRemoteData(async () => normalizeMaintenancePrintRows(asArray(await apiGet(ENDPOINTS.maintenance, { action: "getPrintData" }, { cache: false, timeout: 90000 }))));
  const [kategori, setKategori] = useState("");
  const [filters, setFilters] = useState([{ ...EMPTY_MAINTENANCE_PRINT_FILTER }, { ...EMPTY_MAINTENANCE_PRINT_FILTER }]);
  const [printedOn, setPrintedOn] = useState(() => new Date().toISOString().slice(0, 10));
  const [generating, setGenerating] = useState(false), [error, setError] = useState("");
  const categories = maintenancePrintOptions(remote.data).kategori;
  useEffect(() => { if (!kategori && categories.length === 1) setKategori(categories[0]); }, [kategori, categories.join("|")]);
  const changeCategory = value => { setKategori(value); setFilters([{ ...EMPTY_MAINTENANCE_PRINT_FILTER }, { ...EMPTY_MAINTENANCE_PRINT_FILTER }]); setError(""); };
  const selected = filters.map(filter => remote.data.find(row => row.id === filter.recordId) || null);
  const generate = async () => {
    setGenerating(true); setError("");
    try { await downloadMaintenanceChecklistPdf({ first: { ...selected[0], printNote: filters[0].note }, second: { ...selected[1], printNote: filters[1].note }, printedOn }); notify?.("PDF checklist perawatan berhasil dibuat."); }
    catch (reason) { setError(reason?.message || "PDF checklist gagal dibuat."); }
    finally { setGenerating(false); }
  };
  return <>
    <div className="maintenance-print-intro"><div><p className="eyebrow">Format F.K3.1.04 · revisi 02</p><h2>Cetak dua checklist dalam satu PDF</h2><p>Dropdown hanya menampilkan kombinasi yang benar-benar memiliki data. Kedua laporan boleh berbeda jenis, nama, periode, atau tanggal, tetapi wajib memakai kategori yang sama.</p></div><button className="secondary" onClick={() => go("maintenance")}><ArrowLeft size={17} /> Kembali</button></div>
    <RemoteState loading={remote.loading} error={remote.error} empty={!remote.loading && !remote.data.length} onRetry={remote.reload} />
    {!remote.loading && !remote.error && remote.data.length > 0 && <>
      <Panel title="Pengaturan dokumen" className="maintenance-print-settings"><div className="maintenance-print-main-fields"><label><span>Kategori bersama</span><select value={kategori} onChange={event => changeCategory(event.target.value)}><option value="">Pilih kategori</option>{categories.map(item => <option key={item}>{item}</option>)}</select><small>Kategori ini berlaku untuk kedua laporan.</small></label><label><span>Tanggal cetak / tanda tangan</span><input type="date" lang="id-ID" value={printedOn} onChange={event => setPrintedOn(event.target.value)} /><small>Diisi otomatis dengan tanggal hari ini.</small></label></div></Panel>
      <div className="maintenance-print-grid">{filters.map((filter, index) => <MaintenancePrintSelector key={index} number={index + 1} rows={remote.data} kategori={kategori} value={filter} otherRecordId={filters[index ? 0 : 1].recordId} onChange={next => setFilters(current => current.map((item, itemIndex) => itemIndex === index ? next : item))} />)}</div>
      {error && <div className="remote-error"><AlertTriangle size={17} /><span>{error}</span></div>}
      <div className="maintenance-print-footer"><div><ShieldCheck size={18} /><span><b>Output hanya PDF</b><small>Data tidak diubah dan tidak membuat file Excel baru.</small></span></div><button className="primary" onClick={generate} disabled={generating || !selected[0] || !selected[1] || selected[0]?.id === selected[1]?.id}>{generating ? <><span className="spinner" />Membuat PDF…</> : <><Printer size={18} /> Unduh PDF</>}</button></div>
    </>}
  </>;
}

const SCHEDULE_MONTHS = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
const SCHEDULE_MACHINES = [
  "Mobile Crane B", "Truck Dump DT39", "Truck Trailler H1983HG", "Mobile Crane C",
  "Forklift A FD35", "Truck Dump DT52", "Truck Trailler H8318QO", "Mobile Crane D",
  "Truck Dump DT55", "Panther H8629JA", "Truck Trailler H8696OA", "Mobile Crane E",
  "Truck Dump DT98", "Truck Trailler H8697OA", "Panther H1669SQ", "Mobile Crane A",
  "Truck Dump DT139", "Truck Trailler H1358KS", "Forklift B FD250", "Suzuki APV",
  "Kop C", "Kop D", "Kop E", "Kop F", "Line 13", "Line 14", "Line 15",
  "Lakop D", "Slitting", "Line 16", "Line 17", "Line 18", "Tes Bending TELKOM",
  "Tes Jatuh Telkom", "Bevel", "Tes Bending PLN", "Verloop D", "Verloop H", "Verloop E",
  "Verloop F", "Kompressor 01", "Line 01", "Line 02", "Line 03", "Verloop A", "Lakop A",
  "Kop A", "Kop B", "Kompressor 02", "Line 04", "Line 05", "Line 06", "Verloop B",
  "Verloop C", "Lakop B", "Lakop C", "Line 07", "Line 08", "Line 09", "Pipa ERW",
  "Verloop G", "Potong Bahan A", "Potong Spiral", "Genset 01", "Line 10", "Line 11", "Line 12"
];
const SCHEDULE_RULES = Object.fromEntries([
  ["Mobile Crane B", 1, [3]], ["Truck Dump DT39", 1, [2]], ["Truck Trailler H1983HG", 1, [1]], ["Mobile Crane C", 1, [4]],
  ["Kop C", 1, [3]], ["Kop D", 1, [2]], ["Kop E", 1, [1]], ["Kop F", 1, [4]], ["Line 13", 1, [2]], ["Line 14", 1, [1]], ["Line 15", 1, [4]], ["Lakop D", 1, [3]],
  ["Forklift A FD35", 2, [3]], ["Truck Dump DT52", 2, [2]], ["Truck Trailler H8318QO", 2, [1]], ["Mobile Crane D", 2, [4]],
  ["Slitting", 2, [2]], ["Line 16", 2, [1]], ["Line 17", 2, [4]], ["Line 18", 2, [3]], ["Tes Bending TELKOM", 2, [2]], ["Tes Jatuh Telkom", 2, [1]], ["Bevel", 2, [4]], ["Tes Bending PLN", 2, [3]], ["Verloop D", 2, [2]],
  ["Truck Dump DT55", 3, [3]], ["Panther H8629JA", 3, [2]], ["Truck Trailler H8696OA", 3, [1]], ["Mobile Crane E", 3, [4]],
  ["Verloop H", 3, [1]], ["Verloop E", 3, [4]], ["Verloop F", 3, [3]], ["Kompressor 01", 3, [2]], ["Line 01", 3, [1]], ["Line 02", 3, [4]], ["Line 03", 3, [3]], ["Verloop A", 3, [2]], ["Lakop A", 3, [1]],
  ["Truck Dump DT98", 4, [3]], ["Truck Trailler H8697OA", 4, [2]], ["Panther H1669SQ", 4, [1]], ["Kop A", 4, [4]], ["Kop B", 4, [3]], ["Kompressor 02", 4, [2]], ["Line 04", 4, [1]], ["Line 05", 4, [4]], ["Line 06", 4, [3]], ["Verloop B", 4, [2]], ["Verloop C", 4, [1]], ["Lakop B", 4, [3]],
  ["Lakop C", 5, [3]], ["Mobile Crane A", 5, [3]], ["Truck Dump DT139", 5, [2]], ["Truck Trailler H1358KS", 5, [1]],
  ["Line 07", 5, [2]], ["Line 08", 5, [1]], ["Line 09", 5, [4]], ["Pipa ERW", 5, [3]], ["Verloop G", 5, [2]], ["Potong Bahan A", 5, [1]],
  ["Forklift B FD250", 6, [1]], ["Suzuki APV", 6, [3]], ["Potong Spiral", 6, [4]], ["Genset 01", 6, [3]], ["Line 10", 6, [2]], ["Line 11", 6, [1]], ["Line 12", 6, [3]]
].map(([name, weekday, weeks]) => [name, { weekday, weeks }]));
const SCHEDULE_HOLIDAYS = {
  2024: { 1: [1], 2: [8, 10], 3: [11, 29, 31], 4: [10, 11], 5: [1, 9, 23], 6: [1, 17], 7: [7], 8: [17], 9: [16], 12: [25] },
  2025: { 1: [1, 27, 29], 2: [10], 3: [28, 29, 31], 4: [1, 18], 5: [1, 12, 29], 6: [1, 7, 27], 8: [17], 9: [5], 12: [25] },
  2026: { 1: [1, 19], 2: [17], 3: [20, 21, 28], 4: [3, 5], 5: [1, 14, 31], 6: [1, 22], 8: [17], 9: [5], 12: [25] }
};

const monthlyPlanCache = new Map();

function buildMonthlyPlanSchedule(month, year) {
  const cacheKey = `${year}-${month}`;
  if (monthlyPlanCache.has(cacheKey)) {
    return monthlyPlanCache.get(cacheKey);
  }

  const totalDays = new Date(year, month + 1, 0).getDate();
  const holidays = SCHEDULE_HOLIDAYS[year]?.[month + 1] || [];

  const isHoliday = (day) => {
    const d = new Date(year, month, day, 12);
    return d.getDay() === 0 || holidays.includes(day);
  };

  // All working days in the month (Monday-Saturday, non-holiday)
  const workingDays = [];
  for (let d = 1; d <= totalDays; d++) {
    if (!isHoliday(d)) workingDays.push(d);
  }

  // Weekday occurrences
  const weekdayDates = {};
  for (let d = 1; d <= totalDays; d++) {
    const wd = new Date(year, month, d, 12).getDay();
    if (wd >= 1 && wd <= 6) {
      if (!weekdayDates[wd]) weekdayDates[wd] = [];
      weekdayDates[wd].push(d);
    }
  }

  // Final schedule: machineName -> { day: status (M/B) }
  const schedule = {};
  SCHEDULE_MACHINES.forEach(name => schedule[name] = {});

  // Group machines by their assigned weekday
  const machinesByWeekday = {};
  for (let wd = 1; wd <= 6; wd++) machinesByWeekday[wd] = [];
  SCHEDULE_MACHINES.forEach(name => {
    const rule = SCHEDULE_RULES[name];
    if (rule) machinesByWeekday[rule.weekday].push(name);
  });

  const displaced = [];

  // Step 1: Assign 4 regular occurrences
  for (let wd = 1; wd <= 6; wd++) {
    const days = weekdayDates[wd] || [];
    const machines = machinesByWeekday[wd];

    for (let occ = 0; occ < 4; occ++) {
      const day = days[occ];
      if (!day) continue;

      const occNum = occ + 1;
      const onHoliday = isHoliday(day);

      machines.forEach(name => {
        const rule = SCHEDULE_RULES[name];
        const type = rule.weeks.includes(occNum) ? "B" : "M";

        if (!onHoliday) {
          schedule[name][day] = type;
        } else {
          displaced.push({ name, type, originalDay: day, weekday: wd, occNum });
        }
      });
    }
  }

  // Step 2: Handle displaced machines (holiday rescheduling)
  const remainingDisplaced = [];

  displaced.forEach(item => {
    const wdDays = weekdayDates[item.weekday] || [];
    const has5thWeek = wdDays.length >= 5;
    const fifthDay = has5thWeek ? wdDays[4] : null;

    if (has5thWeek && fifthDay && !isHoliday(fifthDay) && !schedule[item.name][fifthDay]) {
      schedule[item.name][fifthDay] = item.type;
    } else {
      remainingDisplaced.push(item);
    }
  });

  // Distribute remaining displaced machines across subsequent working days (1 machine per day)
  const byHolidayDay = {};
  remainingDisplaced.forEach(item => {
    if (!byHolidayDay[item.originalDay]) byHolidayDay[item.originalDay] = [];
    byHolidayDay[item.originalDay].push(item);
  });

  for (const [holDayStr, items] of Object.entries(byHolidayDay)) {
    const holDay = Number(holDayStr);
    const subsequentWorkingDays = workingDays.filter(d => d > holDay);
    const priorWorkingDays = workingDays.filter(d => d < holDay);
    const candidateDays = [...subsequentWorkingDays, ...priorWorkingDays];

    let candidatePointer = 0;

    items.forEach(item => {
      let foundDay = null;
      for (let attempts = 0; attempts < candidateDays.length; attempts++) {
        const checkDay = candidateDays[(candidatePointer + attempts) % candidateDays.length];
        if (!schedule[item.name][checkDay]) {
          foundDay = checkDay;
          candidatePointer = (candidatePointer + attempts + 1) % candidateDays.length;
          break;
        }
      }

      if (foundDay) {
        schedule[item.name][foundDay] = item.type;
      } else {
        const anyWorkingDay = workingDays.find(d => !schedule[item.name][d]);
        if (anyWorkingDay) {
          schedule[item.name][anyWorkingDay] = item.type;
        }
      }
    });
  }

  monthlyPlanCache.set(cacheKey, schedule);
  return schedule;
}

function scheduleStatus(name, day, month, year) {
  const sched = buildMonthlyPlanSchedule(month, year);
  return sched[name]?.[day] || "";
}

function scheduleDate(day, month, year) {
  return `${String(day).padStart(2, "0")}/${String(month + 1).padStart(2, "0")}/${year}`;
}

function normalizeMaintenanceDate(value) {
  const raw = String(value || "").trim();
  let match = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (match) return `${String(match[1]).padStart(2, "0")}/${String(match[2]).padStart(2, "0")}/${match[3]}`;
  match = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (match) return `${String(match[3]).padStart(2, "0")}/${String(match[2]).padStart(2, "0")}/${match[1]}`;
  const timestamp = Date.parse(raw);
  if (Number.isNaN(timestamp)) return raw;
  const date = new Date(timestamp);
  return scheduleDate(date.getDate(), date.getMonth(), date.getFullYear());
}

function maintenanceAgendaKey(name, date) {
  return `${String(name || "").trim().toLocaleLowerCase("id-ID")}|${normalizeMaintenanceDate(date)}`;
}

function getMachineMonthlyMaintenanceCounts(records, machineName, monthIndex, yearNumber) {
  let countM = 0;
  let countB = 0;
  if (!Array.isArray(records) || !machineName) return { countM, countB, total: 0, isQuotaReached: false };

  const normTarget = String(machineName).trim().toLowerCase();
  for (const item of records) {
    const name = String(item.nama_mesin || item.nama || "").trim().toLowerCase();
    if (name !== normTarget) continue;

    let d, m, y;
    const strTanggal = String(item.tanggal || "").trim();
    if (strTanggal.includes("/")) {
      const parts = strTanggal.split("/").map(Number);
      d = parts[0];
      m = parts[1] - 1;
      y = parts[2];
    } else if (strTanggal.includes("-")) {
      const parts = strTanggal.split("-").map(Number);
      y = parts[0];
      m = parts[1] - 1;
      d = parts[2];
    } else {
      continue;
    }

    if (m === monthIndex && y === yearNumber) {
      const waktu = String(item.waktu || item.jenis_perawatan || "").trim().toUpperCase();
      if (waktu === "B" || /bulanan/i.test(waktu)) {
        countB++;
      } else {
        countM++;
      }
    }
  }

  const isQuotaReached = countM >= 3 && countB >= 1;
  return { countM, countB, total: countM + countB, isQuotaReached };
}

function maintenanceTasksForDate(date, completed) {
  const day = date.getDate(), month = date.getMonth(), year = date.getFullYear();
  return SCHEDULE_MACHINES.flatMap(name => {
    const status = scheduleStatus(name, day, month, year);
    const idDate = scheduleDate(day, month, year);
    if (!status || completed.has(maintenanceAgendaKey(name, idDate))) return [];
    return [{
      name, status, date: idDate, day, month: month + 1,
      isoDate: `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
      type: status === "B" ? "Bulanan" : "Mingguan"
    }];
  });
}

function buildMaintenanceAgenda(actualRows, today) {
  const completed = new Set(
    actualRows
      .map(item => maintenanceAgendaKey(item.nama_mesin || item.nama, item.tanggal))
      .filter(key => !key.startsWith("|") && !key.endsWith("|"))
  );
  const localToday = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 12);
  const todaysItems = maintenanceTasksForDate(localToday, completed).map(item => ({
    ...item, note: "Jadwal hari ini"
  }));
  if (todaysItems.length) return {
    source: "today",
    title: "Perawatan hari ini",
    description: `${todaysItems.length} mesin menunggu pemeriksaan`,
    items: todaysItems
  };

  const currentMonday = new Date(localToday);
  currentMonday.setDate(localToday.getDate() - ((localToday.getDay() + 6) % 7));
  const previousMonday = new Date(currentMonday);
  previousMonday.setDate(currentMonday.getDate() - 7);
  const overdue = [];
  for (let offset = 0; offset < 7; offset++) {
    const date = new Date(previousMonday);
    date.setDate(previousMonday.getDate() + offset);
    overdue.push(...maintenanceTasksForDate(date, completed).map(item => ({
      ...item, note: `Tertunda dari ${item.date}`
    })));
  }
  return {
    source: overdue.length ? "previous-week" : "empty",
    title: overdue.length ? "Tertunda minggu sebelumnya" : "Agenda perawatan bersih",
    description: overdue.length
      ? `${overdue.length} jadwal belum memiliki catatan aktual`
      : "Tidak ada pekerjaan yang perlu ditindaklanjuti",
    items: overdue
  };
}

function MaintenanceRecordModal({ item, session, onClose, onUpdated, onDeleted, notify, container }) {
  const isAdmin = String(session?.role || "").toLocaleLowerCase("id-ID") === "admin";
  const [editing, setEditing] = useState(Boolean(item.isNew));
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  const initialDate = toDateInput(item.tanggal || "");
  const isMonthly = item.waktu === "B" || /bulanan/i.test(item.jenis_perawatan || item.waktu || "");

  const [form, setForm] = useState({
    tanggal: initialDate,
    waktu: isMonthly ? "Bulanan" : "Mingguan",
    kondisi_mesin: item.kondisi_mesin || "Baik",
    hasil_pemeriksaan: item.hasil_pemeriksaan || "",
    keterangan: item.keterangan || ""
  });

  const [checks, setChecks] = useState([]);
  const [loadingChecks, setLoadingChecks] = useState(true);
  const [customItemName, setCustomItemName] = useState("");

  // Load checklist items from database
  useEffect(() => {
    let active = true;
    setLoadingChecks(true);
    const scheduleCode = isMonthly ? "B" : "M";
    const templateItems = getChecklistItems(item.nama_mesin || item.nama, item.jenis, item.kategori, scheduleCode);
    const templateSet = new Set(templateItems.map(n => String(n).toLowerCase().trim()));

    if (!item.id) {
      setChecks(templateItems.map((name, i) => ({
        id: i + 1,
        name,
        sort_order: i + 1,
        status: "Bagus",
        raw_status: "Bagus",
        notes: ""
      })));
      setLoadingChecks(false);
      return () => { active = false; };
    }

    apiGet(ENDPOINTS.maintenance, { action: "getInspectionChecks", id: item.id })
      .then(res => {
        if (!active) return;
        if (res && Array.isArray(res.data) && res.data.length > 0) {
          const relevantData = res.data.filter(c => {
            const normName = String(c.name || "").toLowerCase().trim();
            const rawStatus = String(c.raw_status || c.status || "");
            const isNA = /not_applicable|t\.a|tidak|^\s*x\s*$/i.test(c.status || rawStatus);
            if (templateSet.has(normName)) return true;
            if (!isNA) return true;
            return false;
          });
          const listToUse = relevantData.length > 0 ? relevantData : templateItems.map(name => ({ name, status: "Bagus", raw_status: "Bagus" }));

          setChecks(listToUse.map((c, i) => {
            const rawStatus = String(c.raw_status || c.status || "");
            const isRepair = /perbaikan|repair/i.test(c.status || rawStatus);
            const isNA = /not_applicable|t\.a|tidak|^\s*x\s*$/i.test(c.status || rawStatus);
            const status = isRepair ? "Perbaikan" : isNA ? "T.A" : "Bagus";
            const notes = rawStatus.includes("-") ? rawStatus.split("-").slice(1).join("-").trim() : "";
            return {
              id: i + 1,
              name: c.name,
              sort_order: c.sort_order || i + 1,
              status,
              raw_status: rawStatus,
              notes
            };
          }));
        } else {
          const defaultStatus = /rusak|perbaikan/i.test(item.kondisi_mesin) ? "Perbaikan" : "Bagus";
          setChecks(templateItems.map((name, i) => ({
            id: i + 1,
            name,
            sort_order: i + 1,
            status: defaultStatus,
            raw_status: defaultStatus,
            notes: ""
          })));
        }
      })
      .catch(() => {
        if (!active) return;
        setChecks(templateItems.map((name, i) => ({
          id: i + 1,
          name,
          sort_order: i + 1,
          status: "Bagus",
          raw_status: "Bagus",
          notes: ""
        })));
      })
      .finally(() => {
        if (active) setLoadingChecks(false);
      });
    return () => { active = false; };
  }, [item.id, item.nama_mesin, item.nama, item.jenis, item.kategori, item.kondisi_mesin, isMonthly]);

  // When changing waktu in edit mode, reload template if needed
  const handleWaktuChangeInEdit = (newWaktu) => {
    setForm(prev => ({ ...prev, waktu: newWaktu }));
    const code = newWaktu === "Bulanan" ? "B" : "M";
    const templateItems = getChecklistItems(item.nama_mesin || item.nama, item.jenis, item.kategori, code);
    setChecks(templateItems.map((name, i) => ({
      id: i + 1,
      name,
      sort_order: i + 1,
      status: "Bagus",
      raw_status: "Bagus",
      notes: ""
    })));
  };

  const handleStatusChange = (index, newStatus) => {
    setChecks(prev => {
      const next = prev.map((c, i) => i === index ? { ...c, status: newStatus } : c);
      const hasRepair = next.some(c => c.status === "Perbaikan");
      if (hasRepair && form.kondisi_mesin === "Baik") {
        setForm(f => ({ ...f, kondisi_mesin: "Perlu perhatian" }));
      } else if (!hasRepair && form.kondisi_mesin === "Perlu perhatian") {
        setForm(f => ({ ...f, kondisi_mesin: "Baik" }));
      }
      return next;
    });
  };

  const handleNotesChange = (index, notes) => {
    setChecks(prev => prev.map((c, i) => i === index ? { ...c, notes } : c));
  };

  const handleSetAllBagus = () => {
    setChecks(prev => prev.map(c => ({ ...c, status: "Bagus" })));
    if (form.kondisi_mesin === "Perlu perhatian") {
      setForm(f => ({ ...f, kondisi_mesin: "Baik" }));
    }
  };

  const handleAddCustomItem = (e) => {
    if (e) e.preventDefault();
    const trimmed = customItemName.trim();
    if (!trimmed) return;
    setChecks(prev => [
      ...prev,
      {
        id: prev.length + 1,
        name: trimmed,
        sort_order: prev.length + 1,
        status: "Bagus",
        notes: ""
      }
    ]);
    setCustomItemName("");
  };

  const counts = useMemo(() => {
    const total = checks.length;
    const good = checks.filter(c => c.status === "Bagus").length;
    const repair = checks.filter(c => c.status === "Perbaikan").length;
    const na = checks.filter(c => c.status === "T.A").length;
    return { total, good, repair, na };
  }, [checks]);

  const handleUpdate = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const repairItems = checks.filter(c => c.status === "Perbaikan");
      const hasilPemeriksaanSummary = repairItems.length > 0
        ? `Perbaikan: ${repairItems.map(c => `${c.name}${c.notes ? ` (${c.notes})` : ""}`).join("; ")}`
        : "";

      const finalKeterangan = form.keterangan
        ? (hasilPemeriksaanSummary && !form.keterangan.includes(hasilPemeriksaanSummary)
            ? `${hasilPemeriksaanSummary} — ${form.keterangan}`
            : form.keterangan)
        : hasilPemeriksaanSummary;

      if (item.isNew) {
        const payload = {
          kategori: item.kategori || "Mesin",
          jenis: item.jenis || "",
          nama_mesin: item.nama_mesin || item.nama,
          tanggal: toIdDate(form.tanggal),
          waktu: form.waktu === "Bulanan" ? "B" : "M",
          kondisi: form.kondisi_mesin,
          kondisi_mesin: form.kondisi_mesin,
          hasil_pemeriksaan: finalKeterangan,
          keterangan: finalKeterangan,
          checks: checks.map(c => ({
            name: c.name,
            sort_order: c.sort_order,
            status: c.status === "Bagus" ? "good" : c.status === "Perbaikan" ? "repair_needed" : "not_applicable",
            raw_status: c.status + (c.notes ? ` - ${c.notes}` : "")
          }))
        };
        const res = await apiPost(ENDPOINTS.maintenance, payload);
        if (!isSuccess(res)) throw new Error(res?.message || "Gagal menyimpan data perawatan.");
        notify(`Data perawatan ${item.nama_mesin || item.nama} berhasil disimpan.`);
      } else {
        const payload = {
          action: "update",
          id: item.id,
          token: session?.token,
          nama_mesin: item.nama_mesin || item.nama,
          kategori: item.kategori || "Mesin",
          jenis: item.jenis || "",
          tanggal: form.tanggal,
          waktu: form.waktu === "Bulanan" ? "B" : "M",
          kondisi: form.kondisi_mesin,
          kondisi_mesin: form.kondisi_mesin,
          hasil_pemeriksaan: finalKeterangan,
          keterangan: finalKeterangan,
          checks: checks.map(c => ({
            name: c.name,
            sort_order: c.sort_order,
            status: c.status === "Bagus" ? "good" : c.status === "Perbaikan" ? "repair_needed" : "not_applicable",
            raw_status: c.status + (c.notes ? ` - ${c.notes}` : "")
          }))
        };
        const res = await apiPost(ENDPOINTS.maintenance, payload);
        if (!isSuccess(res)) throw new Error(res?.message || "Gagal memperbarui data perawatan.");
        notify("Data perawatan dan seluruh point checklist berhasil diperbarui.");
      }
      onUpdated();
      onClose();
    } catch (err) {
      setError(err?.message || "Gagal menyimpan data perawatan.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    setError("");
    try {
      const res = await apiPost(ENDPOINTS.maintenance, {
        action: "delete",
        id: item.id,
        token: session?.token
      });
      if (!isSuccess(res)) throw new Error(res?.message || "Gagal menghapus data perawatan.");
      notify("Data perawatan berhasil dihapus.");
      onDeleted();
      onClose();
    } catch (err) {
      setError(err?.message || "Gagal menghapus data perawatan.");
    } finally {
      setDeleting(false);
      setConfirmDelete(false);
    }
  };

  const targetContainer = typeof document !== "undefined" ? (document.fullscreenElement || document.body) : null;
  if (!targetContainer) return null;

  return createPortal(
    <div className="modal-overlay" onMouseDown={e => e.target === e.currentTarget && !saving && !deleting && onClose()}>
      <div className="modal-card maintenance-record-modal">
        <div className="modal-head">
          <div>
            <p className="eyebrow">{item.isNew ? "Isi Perawatan & Checklist Baru" : editing ? "Mode Edit Data & Checklist" : "Detail Aktual Perawatan Mesin"}</p>
            <h3>{item.nama_mesin || item.nama}</h3>
            <small>{item.tanggal} · {isMonthly ? "Perawatan Bulanan (✓✓)" : "Perawatan Mingguan (✓)"}</small>
          </div>
          <button type="button" onClick={onClose} disabled={saving || deleting} aria-label="Tutup"><X size={18} /></button>
        </div>

        {error && <div className="remote-error"><AlertTriangle size={16} /><span>{error}</span></div>}

        {!editing ? (
          <div className="maintenance-detail-content">
            <div className="maintenance-detail-summary">
              <div className="detail-item">
                <span>Nama Mesin</span>
                <b>{item.nama_mesin || item.nama}</b>
              </div>
              <div className="detail-item">
                <span>Tanggal Pelaksanaan</span>
                <b>{item.tanggal || "-"}</b>
              </div>
              <div className="detail-item">
                <span>Jenis Perawatan</span>
                <span className={`badge ${isMonthly ? "info" : "success"}`}>
                  {isMonthly ? "Bulanan (✓✓)" : "Mingguan (✓)"}
                </span>
              </div>
              <div className="detail-item">
                <span>Kondisi Mesin</span>
                <Badge text={item.kondisi_mesin || "Baik"} />
              </div>
              <div className="detail-item wide">
                <span>Keterangan</span>
                <p>{item.keterangan || item.hasil_pemeriksaan || "Tidak ada catatan."}</p>
              </div>
            </div>

            {/* Checklist View in Modal */}
            <div className="modal-checklist-view">
              <div className="modal-checklist-view-header">
                <h4><ClipboardCheck size={16} /> Point Pemeriksaan &amp; Hasil Checklist</h4>
                <div className="maintenance-summary-badges">
                  <span className="badge-pill good"><Check size={13} /> {counts.good} Bagus</span>
                  {counts.repair > 0 && <span className="badge-pill repair"><AlertTriangle size={13} /> {counts.repair} Perbaikan</span>}
                  {counts.na > 0 && <span className="badge-pill na"><MoreHorizontal size={13} /> {counts.na} T.A</span>}
                </div>
              </div>
              {loadingChecks ? (
                <div className="remote-state" style={{ padding: "20px 0" }}><span className="spinner dark" /> Memuat rincian checklist...</div>
              ) : (
                <div className="modal-checklist-grid">
                  {checks.map((c, i) => (
                    <div key={i} className={`modal-checklist-item-card ${c.status.toLowerCase()}`}>
                      <div className="modal-checklist-item-main">
                        <span className="item-num">{i + 1}.</span>
                        <span className="item-name">{c.name}</span>
                        <span className={`badge-pill ${c.status === "Bagus" ? "good" : c.status === "Perbaikan" ? "repair" : "na"}`}>
                          {c.status}
                        </span>
                      </div>
                      {c.notes && (
                        <div className="item-note">
                          <AlertTriangle size={13} />
                          <span>{c.notes}</span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {confirmDelete && (
              <div className="maintenance-delete-confirm-box">
                <AlertTriangle size={20} className="danger-icon" />
                <div>
                  <b>Hapus data perawatan ini?</b>
                  <p>Catatan perawatan untuk <strong>{item.nama_mesin || item.nama}</strong> pada tanggal <strong>{item.tanggal}</strong> akan dihapus permanen dari basis data.</p>
                </div>
                <div className="confirm-buttons">
                  <button type="button" className="secondary small" onClick={() => setConfirmDelete(false)} disabled={deleting}>Batal</button>
                  <button type="button" className="danger-btn small" onClick={handleDelete} disabled={deleting}>
                    {deleting ? <><span className="spinner dark" /> Menghapus…</> : <><Trash2 size={14} /> Ya, Hapus</>}
                  </button>
                </div>
              </div>
            )}

            <div className="modal-actions">
              {isAdmin ? (
                <>
                  {!confirmDelete && (
                    <button type="button" className="danger-btn outline" onClick={() => setConfirmDelete(true)} disabled={deleting}>
                      <Trash2 size={16} /> Hapus Data
                    </button>
                  )}
                  <div style={{ flex: 1 }} />
                  <button type="button" className="secondary" onClick={onClose} disabled={deleting}>Tutup</button>
                  <button type="button" className="primary" onClick={() => setEditing(true)} disabled={deleting}>
                    <Edit3 size={16} /> Edit Data &amp; Checklist
                  </button>
                </>
              ) : (
                <>
                  <small className="field-help" style={{ margin: 0, alignSelf: "center" }}>Hanya akun Admin yang dapat mengedit atau menghapus data ini.</small>
                  <div style={{ flex: 1 }} />
                  <button type="button" className="secondary" onClick={onClose}>Tutup</button>
                </>
              )}
            </div>
          </div>
        ) : (
          <form onSubmit={handleUpdate} className="maintenance-edit-form">
            <div className="form-grid">
              <Field label="Tanggal Perawatan">
                <DateInput
                  name="tanggal"
                  value={form.tanggal}
                  onChange={e => setForm(prev => ({ ...prev, tanggal: e.target.value }))}
                  required
                />
              </Field>
              <Field label="Jenis Perawatan">
                <select
                  value={form.waktu}
                  onChange={e => handleWaktuChangeInEdit(e.target.value)}
                >
                  <option value="Mingguan">Mingguan (✓)</option>
                  <option value="Bulanan">Bulanan (✓✓)</option>
                </select>
              </Field>
              <Field label="Kondisi Mesin">
                <select
                  value={form.kondisi_mesin}
                  onChange={e => setForm(prev => ({ ...prev, kondisi_mesin: e.target.value }))}
                >
                  <option value="Baik">Baik</option>
                  <option value="Perlu perhatian">Perlu perhatian</option>
                  <option value="Rusak">Rusak</option>
                </select>
              </Field>
            </div>

            {/* Editable Checklist in Edit Mode */}
            <div className="maintenance-checklist-section" style={{ margin: "14px 0" }}>
              <div className="checklist-section-header">
                <div>
                  <h4><ClipboardCheck size={16} /> Edit Checklist Pemeriksaan</h4>
                  <p className="checklist-hint">Ubah status pengecekan atau tambahkan catatan temuan kerusakan:</p>
                </div>
                <button
                  type="button"
                  className="set-all-good-btn"
                  onClick={handleSetAllBagus}
                  title="Set seluruh item menjadi Bagus"
                >
                  <Check size={14} /> Set Semua Bagus
                </button>
              </div>

              <div className="checklist-items-table">
                {checks.map((c, idx) => (
                  <div key={c.id || idx} className={`checklist-item-row ${c.status.toLowerCase()}`}>
                    <div className="checklist-item-main">
                      <span className="item-num">{idx + 1}</span>
                      <span className="item-title">{c.name}</span>
                      <div className="item-status-buttons">
                        <button
                          type="button"
                          className={`status-btn good ${c.status === "Bagus" ? "active" : ""}`}
                          onClick={() => handleStatusChange(idx, "Bagus")}
                        >
                          Bagus
                        </button>
                        <button
                          type="button"
                          className={`status-btn repair ${c.status === "Perbaikan" ? "active" : ""}`}
                          onClick={() => handleStatusChange(idx, "Perbaikan")}
                        >
                          Perbaikan
                        </button>
                        <button
                          type="button"
                          className={`status-btn na ${c.status === "T.A" ? "active" : ""}`}
                          onClick={() => handleStatusChange(idx, "T.A")}
                        >
                          T.A
                        </button>
                      </div>
                    </div>
                    {c.status === "Perbaikan" && (
                      <div className="checklist-repair-note">
                        <AlertTriangle size={14} />
                        <input
                          type="text"
                          placeholder="Tuliskan temuan / kerusakan untuk item ini..."
                          value={c.notes || ""}
                          onChange={e => handleNotesChange(idx, e.target.value)}
                        />
                      </div>
                    )}
                  </div>
                ))}
              </div>

              <div className="add-checklist-custom-row">
                <input
                  type="text"
                  placeholder="Tambah point pemeriksaan lain..."
                  value={customItemName}
                  onChange={e => setCustomItemName(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); handleAddCustomItem(e); } }}
                />
                <button type="button" className="secondary small" onClick={handleAddCustomItem}>
                  <Plus size={14} /> Tambah Point
                </button>
              </div>
            </div>

            <div className="form-grid">
              <Field label="Catatan Tambahan (Opsional)" wide>
                <textarea
                  value={form.keterangan}
                  onChange={e => setForm(prev => ({ ...prev, keterangan: e.target.value }))}
                  placeholder="Catatan tambahan teknisi..."
                  rows={2}
                />
              </Field>
            </div>

            <div className="modal-actions" style={{ marginTop: 18 }}>
              <button type="button" className="secondary" onClick={() => { if (item.isNew) onClose(); else { setEditing(false); setError(""); } }} disabled={saving}>Batal</button>
              <button type="submit" className="primary" disabled={saving}>
                {saving ? <><span className="spinner" /> Menyimpan…</> : <><Check size={16} /> {item.isNew ? "Simpan Data Perawatan" : "Simpan Perubahan"}</>}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>,
    targetContainer
  );
}

const inspectionChecksCache = new Map();

function MaintenancePopover({ item, anchorEl, onClose, onOpenDetail, onMouseEnter, onMouseLeave }) {
  const [checks, setChecks] = useState([]);
  const [loading, setLoading] = useState(true);
  const popoverRef = useRef(null);
  const [coords, setCoords] = useState({ top: 0, left: 0, placement: "bottom", isMobile: false });

  const isMonthly = item.waktu === "B" || /bulanan/i.test(item.jenis_perawatan || item.waktu || "");

  useEffect(() => {
    let active = true;
    if (!item?.id) {
      setChecks([]);
      setLoading(false);
      return;
    }
    if (inspectionChecksCache.has(item.id)) {
      setChecks(inspectionChecksCache.get(item.id));
      setLoading(false);
      return;
    }
    setLoading(true);
    apiGet(ENDPOINTS.maintenance, { action: "getInspectionChecks", id: item.id })
      .then(res => {
        if (!active) return;
        const data = (res && Array.isArray(res.data)) ? res.data : [];
        inspectionChecksCache.set(item.id, data);
        setChecks(data);
      })
      .catch(() => {
        if (active) setChecks([]);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [item?.id]);

  useEffect(() => {
    if (!anchorEl) return;
    const rect = anchorEl.getBoundingClientRect();
    const isMobile = window.innerWidth <= 768;

    if (isMobile) {
      setCoords({ isMobile: true });
    } else {
      const popWidth = 330;
      let left = rect.left + rect.width / 2 - popWidth / 2;
      let top = rect.bottom + 8;
      let placement = "bottom";

      if (left < 12) left = 12;
      if (left + popWidth > window.innerWidth - 12) left = window.innerWidth - popWidth - 12;

      if (top + 320 > window.innerHeight) {
        top = Math.max(12, rect.top - 8);
        placement = "top";
      }

      setCoords({ top, left, placement, isMobile: false });
    }
  }, [anchorEl]);

  useEffect(() => {
    const handleOutsideClick = (e) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target) && anchorEl && !anchorEl.contains(e.target)) {
        onClose();
      }
    };
    const handleKeyDown = (e) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", handleOutsideClick);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [anchorEl, onClose]);

  const repairItems = useMemo(() => {
    return checks.filter(c => {
      const rawStatus = String(c.raw_status || c.status || "");
      return /perbaikan|repair/i.test(c.status || rawStatus);
    });
  }, [checks]);

  const targetContainer = typeof document !== "undefined" ? (document.fullscreenElement || document.body) : null;
  if (!targetContainer) return null;

  return createPortal(
    <div
      className={`maintenance-popover-backdrop ${coords.isMobile ? "mobile" : ""}`}
      onClick={onClose}
    >
      <div
        ref={popoverRef}
        className={`maintenance-popover-card ${coords.placement || "bottom"} ${coords.isMobile ? "is-mobile" : ""}`}
        style={!coords.isMobile ? { top: `${coords.top}px`, left: `${coords.left}px` } : {}}
        onClick={e => e.stopPropagation()}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
      >
        <div className="popover-head">
          <div className="popover-title-area">
            <span className="popover-eyebrow">{isMonthly ? "Perawatan Bulanan (✓✓)" : "Perawatan Mingguan (✓)"}</span>
            <h4 className="popover-machine-name">{item.nama_mesin || item.nama}</h4>
            <span className="popover-date">{item.tanggal}</span>
          </div>
          <button type="button" className="popover-close-btn" onClick={onClose} aria-label="Tutup">
            <X size={14} />
          </button>
        </div>

        <div className="popover-body">
          <div className="popover-condition-row">
            <span className="popover-label">Kondisi Mesin:</span>
            <span className={`popover-badge ${/perlu|rusak/i.test(item.kondisi_mesin) ? "warning" : "good"}`}>
              {/perlu|rusak/i.test(item.kondisi_mesin) ? <AlertTriangle size={12} /> : <Check size={12} />}
              {item.kondisi_mesin || "Baik"}
            </span>
          </div>

          <div className="popover-section">
            <div className="popover-section-title">
              <Wrench size={13} />
              <span>Temuan Kerusakan &amp; Catatan:</span>
            </div>

            {loading ? (
              <div className="popover-loading">
                <span className="spinner dark small" /> Memuat detail temuan...
              </div>
            ) : repairItems.length > 0 ? (
              <div className="popover-repair-list">
                {repairItems.map((c, i) => (
                  <div key={i} className="popover-repair-item">
                    <AlertTriangle size={13} className="repair-icon" />
                    <div className="repair-text">
                      <strong className="repair-name">{c.name}</strong>
                      {c.raw_status && c.raw_status.includes("-") && (
                        <span className="repair-note">({c.raw_status.split("-").slice(1).join("-").trim()})</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : item.hasil_pemeriksaan && /perbaikan/i.test(item.hasil_pemeriksaan) ? (
              <div className="popover-repair-summary">
                <AlertTriangle size={13} className="repair-icon" />
                <span>{item.hasil_pemeriksaan}</span>
              </div>
            ) : (
              <div className="popover-all-good">
                <Check size={14} />
                <span>Tidak ada temuan kerusakan (Semua item checklist kondisi Baik).</span>
              </div>
            )}

            {item.keterangan && (
              <div className="popover-notes">
                <small>Catatan: {item.keterangan}</small>
              </div>
            )}
          </div>

          <div className="popover-hint">
            <Info size={13} />
            <span>Klik <b>1x</b> pada tanda {isMonthly ? "✓✓" : "✓"} untuk membuka detail &amp; edit.</span>
          </div>
        </div>

        <div className="popover-actions">
          <button
            type="button"
            className="popover-detail-btn"
            onClick={onOpenDetail}
          >
            <span>Buka Detail Lengkap (Klik 1x)</span>
            <ExternalLink size={13} />
          </button>
        </div>
      </div>
    </div>,
    targetContainer
  );
}

const MaintenanceRow = React.memo(function MaintenanceRow({
  name,
  monthDaysMeta,
  planMatrix,
  actualIndex,
  isQuotaReached,
  onOpenForm,
  onSelectActual,
  onMouseEnterCell,
  onMouseLeaveCell
}) {
  return (
    <tr className={isQuotaReached ? "row-quota-reached" : ""}>
      <th className="machine-column" title={isQuotaReached ? `${name} (Batas perawatan bulan ini lengkap 4x: 3x M, 1x B)` : name}>
        <div className="machine-column-content">
          <span className="machine-name-text">{name}</span>
          {isQuotaReached && (
            <span className="quota-completed-badge" title="Perawatan bulan ini sudah lengkap (3x M, 1x B)">
              ✓ 4/4 Selesai
            </span>
          )}
        </div>
      </th>
      {monthDaysMeta.map(({ day, dateKey }) => {
        const status = planMatrix.get(`${name}|${day}`) || "";
        const actualItem = actualIndex.get(`${name}|${dateKey}`);
        const actual = actualItem ? (actualItem.jenis_perawatan || actualItem.waktu || "M") : "";
        const actualMark = actualItem ? (actual === "B" || /bulanan/i.test(actual) ? "✓✓" : "✓") : "";
        return (
          <React.Fragment key={day}>
            <td>
              <button
                type="button"
                className={`matrix-cell plan-cell ${status === "M" ? "weekly" : status === "B" ? "monthly" : ""}`}
                onClick={() => onOpenForm(name, day, status)}
                aria-label={`${name}, rencana ${dateKey}`}
                title={isQuotaReached && !actualItem ? "Batas perawatan bulan ini sudah lengkap (3x M, 1x B)" : undefined}
              >
                {status}
              </button>
            </td>
            <td>
              <button
                type="button"
                className={`matrix-cell actual-cell ${actualMark === "✓✓" ? "monthly-done" : actualMark === "✓" ? "weekly-done" : ""}`}
                onClick={() => onSelectActual(actualItem, name, day, status, actual)}
                onMouseEnter={actualItem ? (e) => onMouseEnterCell(e, actualItem) : undefined}
                onMouseLeave={actualItem ? onMouseLeaveCell : undefined}
                title={actualItem ? undefined : isQuotaReached ? "Batas perawatan bulan ini sudah lengkap (3x M, 1x B)" : "Isi perawatan baru"}
                aria-label={`${name}, aktual ${dateKey}`}
              >
                {actualMark}
              </button>
            </td>
          </React.Fragment>
        );
      })}
    </tr>
  );
});

function Schedule({ go, notify, session }) {
  const isAdmin = String(session?.role || "").toLocaleLowerCase("id-ID") === "admin";
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth());
  const [year, setYear] = useState(now.getFullYear());
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [selectedRecord, setSelectedRecord] = useState(null);
  const [activePopover, setActivePopover] = useState(null);
  const [ioBusy, setIoBusy] = useState("");
  const [uploadModal, setUploadModal] = useState(null);
  const uploadInputRef = useRef(null);
  const hoverTimerRef = useRef(null);
  const closeTimerRef = useRef(null);
  const matrixScrollRef = useRef(null);
  const panelRef = useRef(null);

  useEffect(() => {
    const scrollEl = matrixScrollRef.current;
    if (!scrollEl) return;

    const handleWheel = (e) => {
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        if (scrollEl.scrollHeight <= scrollEl.clientHeight + 2) {
          window.scrollBy({ top: e.deltaY, behavior: "auto" });
        }
      }
    };

    scrollEl.addEventListener("wheel", handleWheel, { passive: true });
    return () => {
      scrollEl.removeEventListener("wheel", handleWheel);
    };
  }, []);

  const handleCellMouseEnter = useCallback((e, actualItem) => {
    if (!actualItem) return;
    const target = e.currentTarget;
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = setTimeout(() => {
      setActivePopover({ item: actualItem, anchorEl: target });
    }, 300);
  }, []);

  const handleCellMouseLeave = useCallback(() => {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    closeTimerRef.current = setTimeout(() => {
      setActivePopover(null);
    }, 180);
  }, []);

  const handlePopoverMouseEnter = useCallback(() => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
  }, []);

  const handlePopoverMouseLeave = useCallback(() => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    closeTimerRef.current = setTimeout(() => {
      setActivePopover(null);
    }, 180);
  }, []);

  const monthDaysMeta = useMemo(() => {
    const totalDays = new Date(year, month + 1, 0).getDate();
    const holidays = SCHEDULE_HOLIDAYS[year]?.[month + 1] || [];
    const list = [];
    for (let day = 1; day <= totalDays; day++) {
      const date = new Date(year, month, day, 12);
      const weekday = date.getDay();
      const isHoliday = weekday === 0 || holidays.includes(day);
      const isSaturday = weekday === 6;
      const isToday = date.toDateString() === now.toDateString();
      const dateKey = scheduleDate(day, month, year);
      list.push({ day, weekday, isHoliday, isSaturday, isToday, dateKey });
    }
    return list;
  }, [month, year]);

  const planMatrix = useMemo(() => {
    const map = new Map();
    const sched = buildMonthlyPlanSchedule(month, year);
    for (const name of SCHEDULE_MACHINES) {
      const machinePlan = sched[name] || {};
      for (const [dayStr, status] of Object.entries(machinePlan)) {
        map.set(`${name}|${Number(dayStr)}`, status);
      }
    }
    return map;
  }, [month, year]);

  const remote = useRemoteData(async () => asArray(await apiGet(ENDPOINTS.maintenance, { action: "getPerawatan" }, { timeout: 90000 })));
  const machineMaster = useRemoteData(async () => asArray(await apiGet(ENDPOINTS.maintenanceMaster, { action: "getRawatMaster" })));

  const actualIndex = useMemo(() => {
    const map = new Map();
    remote.data.forEach(item => {
      const [d, m, y] = String(item.tanggal || "").trim().split("/").map(Number);
      if (!d || !m || !y) return;
      const dateKey = scheduleDate(d, m - 1, y);
      const machineKey = `${item.nama_mesin || item.nama}|${dateKey}`;
      map.set(machineKey, item);
    });
    return map;
  }, [remote.data]);

  const monthlyStats = useMemo(() => {
    let plannedCount = 0;
    let actualCount = 0;
    let plannedCompletedCount = 0;

    for (const name of SCHEDULE_MACHINES) {
      for (const { day, dateKey } of monthDaysMeta) {
        const planStatus = planMatrix.get(`${name}|${day}`);
        const actualItem = actualIndex.get(`${name}|${dateKey}`);

        if (planStatus) {
          plannedCount++;
          if (actualItem) {
            plannedCompletedCount++;
          }
        }
        if (actualItem) {
          actualCount++;
        }
      }
    }

    const percentage = plannedCount > 0
      ? Math.min(100, Math.round((actualCount / plannedCount) * 1000) / 10)
      : 0;

    return {
      plannedCount,
      actualCount,
      plannedCompletedCount,
      percentage
    };
  }, [monthDaysMeta, planMatrix, actualIndex]);

  const years = Array.from(new Set([2024, 2025, 2026, now.getFullYear(), now.getFullYear() + 1])).sort();

  useEffect(() => {
    const handleFullscreenChange = () => {
      const active = Boolean(document.fullscreenElement && document.fullscreenElement === panelRef.current);
      setIsFullscreen(active);
    };
    const handleKeyDown = (event) => {
      if (event.key === "Escape" && isFullscreen) {
        if (document.fullscreenElement) {
          document.exitFullscreen().catch(() => { });
        }
        setIsFullscreen(false);
      }
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    document.addEventListener("webkitfullscreenchange", handleFullscreenChange);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
      document.removeEventListener("webkitfullscreenchange", handleFullscreenChange);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isFullscreen]);

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
        setIsFullscreen(false);
      } else if (panelRef.current?.requestFullscreen) {
        await panelRef.current.requestFullscreen();
        setIsFullscreen(true);
      } else {
        setIsFullscreen(prev => !prev);
      }
    } catch {
      setIsFullscreen(prev => !prev);
    }
  };

  const machineQuotas = useMemo(() => {
    const map = new Map();
    for (const name of SCHEDULE_MACHINES) {
      map.set(name, getMachineMonthlyMaintenanceCounts(remote.data, name, month, year));
    }
    return map;
  }, [remote.data, month, year]);

  const openForm = useCallback((name, day, status) => {
    const quota = getMachineMonthlyMaintenanceCounts(remote.data, name, month, year);
    if (quota.isQuotaReached) {
      notify(`Mesin ${name} sudah mencapai batas maksimal perawatan bulan ${SCHEDULE_MONTHS[month]} ${year} (3x Mingguan & 1x Bulanan). Perawatan tidak dapat ditambah lagi.`, "warning");
      return;
    }
    const formattedDate = `${String(day).padStart(2, "0")}/${String(month + 1).padStart(2, "0")}/${year}`;
    const mInfo = (machineMaster.data || []).find(x => String(x.Nama || x.nama || "").toLowerCase().trim() === String(name || "").toLowerCase().trim());
    setSelectedRecord({
      isNew: true,
      nama_mesin: name,
      nama: name,
      kategori: mInfo?.kategori || mInfo?.Kategori || "Mesin",
      jenis: mInfo?.jenis || mInfo?.Jenis || "",
      tanggal: formattedDate,
      waktu: status === "B" ? "B" : "M",
      kondisi_mesin: "Baik",
      hasil_pemeriksaan: "",
      keterangan: ""
    });
  }, [month, year, remote.data, machineMaster.data, notify]);

  const handleSelectActual = useCallback((actualItem, name, day, status, actual) => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    setActivePopover(null);
    if (actualItem) {
      setSelectedRecord(actualItem);
    } else {
      openForm(name, day, status || actual);
    }
  }, [openForm]);

  const downloadMonthlyInspection = async () => {
    const monthKey = `${year}-${String(month + 1).padStart(2, "0")}`;
    const monthLabel = `${SCHEDULE_MONTHS[month]} ${year}`;
    setIoBusy("download");
    try {
      const { createDirectBackupWorkbook, downloadWorkbook } = await loadDataWorkbook();
      const payload = await apiGet(
        ENDPOINTS.backup,
        { action: "direct-export", documentType: "maintenance", month: monthKey },
        { cache: false, timeout: 120000 }
      );
      const filteredRows = Array.isArray(payload?.rows)
        ? payload.rows.filter(row => {
            const rowDate = String(row.inspected_on || "").trim();
            return rowDate.startsWith(monthKey);
          })
        : [];
      const file = await createDirectBackupWorkbook("maintenance", { ...payload, rows: filteredRows });
      downloadWorkbook(file.buffer, "Rekap Perawatan.xlsx");
      notify(`Data Inspeksi Perawatan ${monthLabel} (${filteredRows.length} baris) berhasil diunduh.`);
    } catch (error) {
      notify(error?.message || "Gagal mengunduh data inspeksi.");
    } finally {
      setIoBusy("");
    }
  };

  const onChooseExcelFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setIoBusy("validate");
    try {
      const { parseDirectWorkbook } = await loadDirectWorkbook();
      const parsed = await parseDirectWorkbook(file);
      if (parsed.datasets?.[0]?.documentType !== "maintenance") {
        throw new Error("File yang dipilih bukan Rekap Perawatan. Pastikan memilih file Rekap Perawatan.xlsx.");
      }
      const rows = parsed.datasets[0].rows || [];
      if (!rows.length) {
        throw new Error("File Rekap Perawatan tidak memiliki baris data.");
      }
      const monthsInFile = Array.from(new Set(rows.map(r => r.inspected_on?.slice(0, 7)))).filter(Boolean).sort();
      setUploadModal({
        file,
        parsed,
        rows,
        monthsInFile,
      });
    } catch (error) {
      notify(error?.message || "File Excel tidak dapat dibaca.");
    } finally {
      setIoBusy("");
    }
  };

  const handleConfirmUpload = async () => {
    if (!uploadModal) return;
    setIoBusy("import");
    try {
      const result = await apiPost(
        ENDPOINTS.backup,
        {
          action: "direct-import",
          documentType: "maintenance",
          rows: uploadModal.rows,
          months: uploadModal.monthsInFile,
        },
        { timeout: 120000 }
      );
      if (result.status !== "success") {
        throw new Error(result.message || "Gagal mengunggah data.");
      }
      const deletedMsg = result.deleted ? `${result.deleted.toLocaleString("id-ID")} data lama dihapus. ` : "";
      const insertedMsg = `${Number(result.inserted || 0).toLocaleString("id-ID")} data baru berhasil diperbarui.`;
      notify(`${deletedMsg}${insertedMsg}`);
      setUploadModal(null);
      remote.reload();
    } catch (error) {
      notify(error?.message || "Gagal mengunggah data revisi.");
    } finally {
      setIoBusy("");
    }
  };

  const formatMonthKey = (key) => {
    if (!key) return "";
    const [y, m] = key.split("-").map(Number);
    if (!y || !m) return key;
    return `${SCHEDULE_MONTHS[m - 1] || m} ${y}`;
  };

  return <>
    <div className="schedule-search">
      <div className="schedule-search-top">
        <span className="eyebrow">Pencarian data metric</span>
      </div>
      <div>
        <label><span>Bulan</span><select value={month} onChange={e => setMonth(Number(e.target.value))}>{SCHEDULE_MONTHS.map((name, i) => <option value={i} key={name}>{name}</option>)}</select></label>
        <label className="year-field"><span>Tahun</span><select value={year} onChange={e => setYear(Number(e.target.value))}>{years.map(value => <option key={value}>{value}</option>)}</select></label>
      </div>
    </div>
    <div className="schedule-kpi-card">
      <div className="schedule-kpi-header">
        <div className="schedule-kpi-title-group">
          <div className="schedule-kpi-icon">
            <TrendingUp size={18} />
          </div>
          <div>
            <div className="schedule-kpi-label">Pencapaian Perawatan Bulan Ini</div>
            <div className="schedule-kpi-sublabel">{SCHEDULE_MONTHS[month]} {year}</div>
          </div>
        </div>
        <div className={`schedule-kpi-badge ${monthlyStats.percentage >= 80 ? "good" : monthlyStats.percentage >= 50 ? "warning" : "danger"}`}>
          {monthlyStats.percentage >= 80 ? "Memenuhi Target" : monthlyStats.percentage >= 50 ? "Sedang Berjalan" : "Di Bawah Target"}
        </div>
      </div>
      <div className="schedule-kpi-body">
        <div className="schedule-kpi-main-stat">
          <span className="schedule-kpi-value">{monthlyStats.percentage}%</span>
          <div className="schedule-kpi-details">
            <span className="schedule-kpi-count">
              Realisasi: <b>{monthlyStats.actualCount}</b> / <b>{monthlyStats.plannedCount}</b> Rencana Perawatan
            </span>
            <small className="schedule-kpi-hint">
              ({monthlyStats.plannedCompletedCount} plan terlaksana)
            </small>
          </div>
        </div>
        <div className="schedule-kpi-progress-track">
          <div
            className={`schedule-kpi-progress-bar ${monthlyStats.percentage >= 80 ? "good" : monthlyStats.percentage >= 50 ? "warning" : "danger"}`}
            style={{ width: `${Math.min(100, Math.max(0, monthlyStats.percentage))}%` }}
          />
        </div>
      </div>
    </div>
    <div className="schedule-legend"><span><i className="plan-m" />Plan (M)</span><span><i className="plan-b" />Plan (B)</span><span className="actual-key">✓ Actual</span></div>
    <div className="schedule-header-bar">
      <div className="schedule-caption-wrapper">
        <div className="schedule-caption">Data jadwal perawatan</div>
        <div className="schedule-achievement-pill">
          <Gauge size={13} />
          <span>Pencapaian: <b>{monthlyStats.percentage}%</b></span>
        </div>
      </div>
      <div className="schedule-bar-right-actions">
        {isAdmin && (
          <>
            <button
              type="button"
              className="schedule-action-btn"
              onClick={downloadMonthlyInspection}
              disabled={!!ioBusy}
              title={`Download data inspeksi perawatan ${SCHEDULE_MONTHS[month]} ${year} (Excel)`}
            >
              <Download size={14} />
              <span>{ioBusy === "download" ? "Mengunduh..." : "Download Excel"}</span>
            </button>
            <button
              type="button"
              className="schedule-action-btn primary"
              onClick={() => uploadInputRef.current?.click()}
              disabled={!!ioBusy}
              title="Upload file Excel Rekap Perawatan yang sudah direvisi"
            >
              <Upload size={14} />
              <span>Upload Revisi</span>
            </button>
            <input
              ref={uploadInputRef}
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              style={{ display: "none" }}
              onChange={onChooseExcelFile}
            />
          </>
        )}
        <button
          type="button"
          className="matrix-fullscreen-btn"
          onClick={toggleFullscreen}
          title={isFullscreen ? "Keluar layar penuh" : "Tampilkan tabel jadwal layar penuh"}
        >
          {isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          <span>{isFullscreen ? "Perkecil" : "Layar penuh"}</span>
        </button>
      </div>
    </div>
    <section className={`maintenance-matrix-panel ${isFullscreen ? "is-fullscreen" : ""}`} ref={panelRef}>
      {isFullscreen && (
        <div className="maintenance-matrix-fullscreen-bar">
          <div className="fullscreen-bar-title">
            <CalendarDays size={18} />
            <b>Jadwal Perawatan</b>
            <span className="fullscreen-bar-date">{SCHEDULE_MONTHS[month]} {year}</span>
          </div>
          <div className="fullscreen-bar-controls">
            <label>
              <span>Bulan</span>
              <select value={month} onChange={e => setMonth(Number(e.target.value))}>
                {SCHEDULE_MONTHS.map((name, i) => <option value={i} key={name}>{name}</option>)}
              </select>
            </label>
            <label className="year-field">
              <span>Tahun</span>
              <select value={year} onChange={e => setYear(Number(e.target.value))}>
                {years.map(value => <option key={value}>{value}</option>)}
              </select>
            </label>
          </div>
          <div className="schedule-legend in-bar">
            <div className="fullscreen-achievement-tag">
              <TrendingUp size={13} />
              <span>Pencapaian: <b>{monthlyStats.percentage}%</b> ({monthlyStats.actualCount}/{monthlyStats.plannedCount})</span>
            </div>
            <span><i className="plan-m" />Plan (M)</span>
            <span><i className="plan-b" />Plan (B)</span>
            <span className="actual-key">✓ Actual</span>
          </div>
          <button
            type="button"
            className="matrix-fullscreen-btn exit-fs"
            onClick={toggleFullscreen}
            title="Keluar layar penuh (Esc)"
          >
            <Minimize2 size={14} />
            <span>Keluar Layar Penuh</span>
          </button>
        </div>
      )}
      <RemoteState loading={remote.loading} error={remote.error} empty={!remote.loading && !remote.data.length} onRetry={remote.reload} />
      {!remote.loading && !remote.error && <div className="maintenance-matrix-scroll" ref={matrixScrollRef}>
        <table className="maintenance-matrix">
          <thead>
            <tr><th className="machine-column" rowSpan="2">Mesin / Tanggal</th>{monthDaysMeta.map(({ day, weekday, isHoliday, isSaturday, isToday }) => {
              return <th className={`date-column ${isHoliday ? "holiday" : isSaturday ? "saturday" : ""} ${isToday ? "today" : ""}`} colSpan="2" key={day}><small>{["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"][weekday]}</small><b>{day}</b></th>;
            })}</tr>
            <tr>{monthDaysMeta.map(({ day }) => <React.Fragment key={day}><th className="channel plan">P</th><th className="channel actual">A</th></React.Fragment>)}</tr>
          </thead>
          <tbody>{SCHEDULE_MACHINES.map(name => (
            <MaintenanceRow
              key={name}
              name={name}
              monthDaysMeta={monthDaysMeta}
              planMatrix={planMatrix}
              actualIndex={actualIndex}
              isQuotaReached={Boolean(machineQuotas.get(name)?.isQuotaReached)}
              onOpenForm={openForm}
              onSelectActual={handleSelectActual}
              onMouseEnterCell={handleCellMouseEnter}
              onMouseLeaveCell={handleCellMouseLeave}
            />
          ))}</tbody>
        </table>
      </div>}
    </section>
    {activePopover && (
      <MaintenancePopover
        item={activePopover.item}
        anchorEl={activePopover.anchorEl}
        onClose={() => setActivePopover(null)}
        onMouseEnter={handlePopoverMouseEnter}
        onMouseLeave={handlePopoverMouseLeave}
        onOpenDetail={() => {
          const itemToOpen = activePopover.item;
          setActivePopover(null);
          setSelectedRecord(itemToOpen);
        }}
      />
    )}
    {selectedRecord && (
      <MaintenanceRecordModal
        item={selectedRecord}
        session={session}
        notify={notify}
        onUpdated={() => remote.reload()}
        onDeleted={() => remote.reload()}
        onClose={() => setSelectedRecord(null)}
      />
    )}
    {uploadModal && (
      <div className="modal-overlay" onMouseDown={e => e.target === e.currentTarget && ioBusy !== "import" && setUploadModal(null)}>
        <article className="modal-card schedule-upload-modal">
          <div className="modal-head">
            <div>
              <p className="eyebrow">Khusus Administrator</p>
              <h3>Upload Revisi Rekap Perawatan</h3>
              <small>Sinkronisasi data hasil revisi Excel</small>
            </div>
            <button type="button" disabled={ioBusy === "import"} onClick={() => setUploadModal(null)} aria-label="Tutup modal">
              <X size={18} />
            </button>
          </div>
          <div className="schedule-upload-summary">
            <div className="schedule-upload-card">
              <small>File Excel</small>
              <b>{uploadModal.file.name}</b>
            </div>
            <div className="schedule-upload-card">
              <small>Jumlah Baris Data</small>
              <b>{uploadModal.rows.length.toLocaleString("id-ID")} baris</b>
            </div>
            <div className="schedule-upload-card" style={{ gridColumn: "1 / -1" }}>
              <small>Periode Bulan Terdeteksi</small>
              <b>{uploadModal.monthsInFile.map(formatMonthKey).join(", ") || "-"}</b>
            </div>
          </div>
          <div className="schedule-upload-alert">
            <AlertTriangle size={18} />
            <div>
              <strong>Pembersihan Data Lama Otomatis</strong>
              <p style={{ margin: "4px 0 0" }}>
                Seluruh data inspeksi perawatan lama pada bulan <b>{uploadModal.monthsInFile.map(formatMonthKey).join(", ")}</b> akan <b>dihapus terlebih dahulu</b> dari database, kemudian <b>{uploadModal.rows.length.toLocaleString("id-ID")} data baru</b> akan dimasukkan.
              </p>
              <small style={{ display: "block", marginTop: "4px", opacity: 0.9 }}>
                Hal ini menjamin tidak terjadi data ganda (duplikat).
              </small>
            </div>
          </div>
          <div className="modal-actions">
            <button type="button" className="secondary" disabled={ioBusy === "import"} onClick={() => setUploadModal(null)}>
              Batal
            </button>
            <button type="button" className="primary" disabled={ioBusy === "import"} onClick={handleConfirmUpload}>
              {ioBusy === "import" ? (
                <>
                  <span className="spinner" />
                  <span>Memproses upload...</span>
                </>
              ) : (
                <>
                  <Upload size={16} />
                  <span>Hapus Data Lama & Upload Baru</span>
                </>
              )}
            </button>
          </div>
        </article>
      </div>
    )}
  </>;
}

function MaintenanceForm({ notify, selectedOrder, go }) {
  const master = useRemoteData(loadMachineMaster);
  const maintenanceList = useRemoteData(async () => asArray(await apiGet(ENDPOINTS.maintenance, { action: "getPerawatan" }, { timeout: 30000 })));
  const scheduled = selectedOrder?.schedule;

  const [selectedMachine, setSelectedMachine] = useState(scheduled?.name || "");
  const [selectedKategori, setSelectedKategori] = useState("");
  const [selectedJenis, setSelectedJenis] = useState("");
  const [tanggal, setTanggal] = useState(scheduled?.date || new Date().toISOString().slice(0, 10));
  const [waktu, setWaktu] = useState(scheduled?.status === "B" ? "Bulanan" : "Mingguan");
  const [checks, setChecks] = useState([]);
  const [kondisiMesin, setKondisiMesin] = useState("Baik");
  const [keterangan, setKeterangan] = useState("");
  const [customItemName, setCustomItemName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const quotaInfo = useMemo(() => {
    if (!selectedMachine || !maintenanceList.data.length || !tanggal) {
      return { countM: 0, countB: 0, total: 0, isQuotaReached: false };
    }
    let m = new Date().getMonth();
    let y = new Date().getFullYear();
    const str = String(tanggal).trim();
    if (str.includes("-")) {
      const parts = str.split("-").map(Number);
      y = parts[0];
      m = parts[1] - 1;
    } else if (str.includes("/")) {
      const parts = str.split("/").map(Number);
      m = parts[1] - 1;
      y = parts[2];
    }
    return getMachineMonthlyMaintenanceCounts(maintenanceList.data, selectedMachine, m, y);
  }, [selectedMachine, tanggal, maintenanceList.data]);

  // Sync scheduled machine if passed
  useEffect(() => {
    if (master.data.length > 0 && !selectedMachine && scheduled?.name) {
      setSelectedMachine(scheduled.name);
    }
  }, [master.data, scheduled]);

  // When selectedMachine changes, update kategori & jenis if found in master
  useEffect(() => {
    if (!selectedMachine) return;
    const found = master.data.find(x =>
      (x.Nama || x.nama_mesin || x.nama) === selectedMachine
    );
    if (found) {
      if (found.Kategori || found.kategori) setSelectedKategori(found.Kategori || found.kategori);
      if (found.Jenis || found.jenis) setSelectedJenis(found.Jenis || found.jenis);
    }
  }, [selectedMachine, master.data]);

  // Dropdown lists
  const kategoriList = useMemo(() => {
    return [...new Set(master.data.map(x => x.Kategori || x.kategori).filter(Boolean))];
  }, [master.data]);

  const jenisList = useMemo(() => {
    const pool = selectedKategori ? master.data.filter(x => (x.Kategori || x.kategori) === selectedKategori) : master.data;
    return [...new Set(pool.map(x => x.Jenis || x.jenis).filter(Boolean))];
  }, [master.data, selectedKategori]);

  const machineList = useMemo(() => {
    let pool = master.data;
    if (selectedKategori) pool = pool.filter(x => (x.Kategori || x.kategori) === selectedKategori);
    if (selectedJenis) pool = pool.filter(x => (x.Jenis || x.jenis) === selectedJenis);
    return [...new Set(pool.map(x => x.Nama || x.nama_mesin || x.nama).filter(Boolean))];
  }, [master.data, selectedKategori, selectedJenis]);

  // When selectedMachine or waktu changes, load checklist items!
  useEffect(() => {
    if (!selectedMachine) {
      setChecks([]);
      return;
    }
    const scheduleCode = waktu === "Bulanan" ? "B" : "M";
    const templateItems = getChecklistItems(selectedMachine, selectedJenis, selectedKategori, scheduleCode);
    setChecks(templateItems.map((name, index) => ({
      id: index + 1,
      name,
      sort_order: index + 1,
      status: "Bagus",
      notes: ""
    })));
  }, [selectedMachine, selectedJenis, selectedKategori, waktu]);

  // Auto-calculate condition when items change
  const handleStatusChange = (index, newStatus) => {
    setChecks(prev => {
      const next = prev.map((item, i) => i === index ? { ...item, status: newStatus } : item);
      const hasRepair = next.some(item => item.status === "Perbaikan");
      if (hasRepair && kondisiMesin === "Baik") {
        setKondisiMesin("Perlu perhatian");
      } else if (!hasRepair && kondisiMesin === "Perlu perhatian") {
        setKondisiMesin("Baik");
      }
      return next;
    });
  };

  const handleNotesChange = (index, notes) => {
    setChecks(prev => prev.map((item, i) => i === index ? { ...item, notes } : item));
  };

  const handleSetAllBagus = () => {
    setChecks(prev => prev.map(item => ({ ...item, status: "Bagus" })));
    if (kondisiMesin === "Perlu perhatian") setKondisiMesin("Baik");
  };

  const handleAddCustomItem = (e) => {
    if (e) e.preventDefault();
    const trimmed = customItemName.trim();
    if (!trimmed) return;
    setChecks(prev => [
      ...prev,
      {
        id: prev.length + 1,
        name: trimmed,
        sort_order: prev.length + 1,
        status: "Bagus",
        notes: ""
      }
    ]);
    setCustomItemName("");
  };

  const handleRemoveCheck = (index) => {
    setChecks(prev => prev.filter((_, i) => i !== index));
  };

  const counts = useMemo(() => {
    const total = checks.length;
    const good = checks.filter(c => c.status === "Bagus").length;
    const repair = checks.filter(c => c.status === "Perbaikan").length;
    const na = checks.filter(c => c.status === "T.A").length;
    return { total, good, repair, na };
  }, [checks]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!selectedMachine) {
      setError("Pilih nama mesin terlebih dahulu.");
      return;
    }
    if (checks.length === 0) {
      setError("Daftar item pemeriksaan belum terisi.");
      return;
    }

    if (quotaInfo.isQuotaReached) {
      setError(`Mesin ${selectedMachine} sudah menyelesaikan 4 kali perawatan bulan ini (3x Mingguan dan 1x Bulanan). Perawatan tidak dapat ditambah lagi.`);
      return;
    }

    setSaving(true);
    setError("");

    try {
      const repairItems = checks.filter(c => c.status === "Perbaikan");
      const hasilPemeriksaanSummary = repairItems.length > 0
        ? `Perbaikan: ${repairItems.map(c => `${c.name}${c.notes ? ` (${c.notes})` : ""}`).join("; ")}`
        : "";

      const finalKeterangan = keterangan
        ? (hasilPemeriksaanSummary && !keterangan.includes(hasilPemeriksaanSummary)
            ? `${hasilPemeriksaanSummary} — ${keterangan}`
            : keterangan)
        : hasilPemeriksaanSummary;

      const payload = {
        kategori: selectedKategori || "Mesin",
        jenis: selectedJenis || "",
        nama_mesin: selectedMachine,
        tanggal: toIdDate(tanggal),
        waktu: waktu === "Bulanan" ? "B" : "M",
        kondisi: kondisiMesin,
        kondisi_mesin: kondisiMesin,
        hasil_pemeriksaan: finalKeterangan,
        keterangan: finalKeterangan,
        checks: checks.map(c => ({
          name: c.name,
          sort_order: c.sort_order,
          status: c.status === "Bagus" ? "good" : c.status === "Perbaikan" ? "repair_needed" : "not_applicable",
          raw_status: c.status + (c.notes ? ` - ${c.notes}` : "")
        }))
      };

      const result = await apiPost(ENDPOINTS.maintenance, payload);
      if (!isSuccess(result)) throw new Error(result.message || "Data perawatan gagal disimpan.");
      notify(`Data perawatan ${selectedMachine} (${checks.length} item) berhasil disimpan!`);
      if (typeof go === "function") {
        go("maintenance");
      }
    } catch (err) {
      setError(err?.message || "Data perawatan gagal disimpan.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="panel form-panel maintenance-form-panel" onSubmit={handleSubmit}>
      <div className="panel-head">
        <div>
          <p className="eyebrow">Preventive Maintenance Checklist</p>
          <h3>Aktual Perawatan &amp; Pengecekan Mesin</h3>
        </div>
        {counts.total > 0 && (
          <div className="maintenance-summary-badges">
            <span className="badge-pill good"><Check size={14} /> {counts.good} Bagus</span>
            {counts.repair > 0 && <span className="badge-pill repair"><AlertTriangle size={14} /> {counts.repair} Perbaikan</span>}
            {counts.na > 0 && <span className="badge-pill na"><MoreHorizontal size={14} /> {counts.na} T.A</span>}
          </div>
        )}
      </div>

      {quotaInfo.isQuotaReached && (
        <div className="maintenance-quota-alert">
          <AlertTriangle size={18} />
          <div>
            <strong>Batas Perawatan Bulan Ini Sudah Tercapai</strong>
            <p>
              Mesin <b>{selectedMachine}</b> sudah menyelesaikan 4 kali perawatan pada bulan ini (3x Mingguan dan 1x Bulanan).
              Anda tidak dapat menambahkan perawatan lagi untuk bulan yang sedang berjalan.
            </p>
          </div>
        </div>
      )}

      {/* Main Machine Selection Form */}
      <div className="form-grid">
        <Field label="Kategori">
          <select value={selectedKategori} onChange={e => { setSelectedKategori(e.target.value); setSelectedMachine(""); }}>
            <option value="">Semua Kategori</option>
            {kategoriList.map(x => <option key={x} value={x}>{x}</option>)}
          </select>
        </Field>

        <Field label="Jenis Mesin">
          <select value={selectedJenis} onChange={e => { setSelectedJenis(e.target.value); setSelectedMachine(""); }}>
            <option value="">Semua Jenis</option>
            {jenisList.map(x => <option key={x} value={x}>{x}</option>)}
          </select>
        </Field>

        <Field label="Nama Mesin">
          <select
            value={selectedMachine}
            onChange={e => setSelectedMachine(e.target.value)}
            required
          >
            <option value="">-- Pilih Mesin --</option>
            {machineList.map(x => <option key={x} value={x}>{x}</option>)}
          </select>
        </Field>

        <Field label="Tanggal Pelaksanaan">
          <DateInput
            name="tanggal"
            value={tanggal}
            onChange={e => setTanggal(e.target.value)}
            required
          />
        </Field>

        <Field label="Jenis Perawatan">
          <div className="segmented-toggle">
            <button
              type="button"
              className={waktu === "Mingguan" ? "active" : ""}
              onClick={() => setWaktu("Mingguan")}
            >
              Mingguan (M)
            </button>
            <button
              type="button"
              className={waktu === "Bulanan" ? "active" : ""}
              onClick={() => setWaktu("Bulanan")}
            >
              Bulanan (B)
            </button>
          </div>
        </Field>

        <Field label="Kondisi Mesin">
          <select value={kondisiMesin} onChange={e => setKondisiMesin(e.target.value)}>
            <option value="Baik">Baik</option>
            <option value="Perlu perhatian">Perlu perhatian</option>
            <option value="Rusak">Rusak</option>
          </select>
        </Field>
      </div>

      {/* Dynamic Checklist Section */}
      <div className="maintenance-checklist-section">
        <div className="checklist-section-header">
          <div>
            <h4>
              <ClipboardCheck size={18} /> Point Pemeriksaan {selectedMachine ? `— ${selectedMachine}` : ""} ({waktu})
            </h4>
            <p className="checklist-hint">
              {checks.length > 0
                ? `${checks.length} item checklist teridentifikasi untuk mesin ini. Tentukan kondisi per item:`
                : "Pilih nama mesin di atas untuk memuat daftar point pengecekan."}
            </p>
          </div>
          {checks.length > 0 && (
            <button
              type="button"
              className="set-all-good-btn"
              onClick={handleSetAllBagus}
              title="Set seluruh item menjadi Bagus"
            >
              <Check size={15} /> Set Semua Bagus
            </button>
          )}
        </div>

        {checks.length > 0 ? (
          <div className="checklist-items-table">
            <div className="checklist-table-header">
              <span className="col-num">No</span>
              <span className="col-name">Item Pemeriksaan</span>
              <span className="col-status">Status Pengecekan</span>
            </div>
            {checks.map((item, idx) => (
              <div key={item.id || idx} className={`checklist-item-row ${item.status.toLowerCase()}`}>
                <div className="checklist-item-main">
                  <span className="item-num">{idx + 1}</span>
                  <span className="item-title">{item.name}</span>
                  <div className="item-status-buttons">
                    <button
                      type="button"
                      className={`status-btn good ${item.status === "Bagus" ? "active" : ""}`}
                      onClick={() => handleStatusChange(idx, "Bagus")}
                    >
                      Bagus
                    </button>
                    <button
                      type="button"
                      className={`status-btn repair ${item.status === "Perbaikan" ? "active" : ""}`}
                      onClick={() => handleStatusChange(idx, "Perbaikan")}
                    >
                      Perbaikan
                    </button>
                    <button
                      type="button"
                      className={`status-btn na ${item.status === "T.A" ? "active" : ""}`}
                      onClick={() => handleStatusChange(idx, "T.A")}
                    >
                      T.A
                    </button>
                    {idx >= (checks.length - (checks.length - (getChecklistItems(selectedMachine, selectedJenis, selectedKategori, waktu === "Bulanan" ? "B" : "M").length))) && (
                      <button
                        type="button"
                        className="icon-action-btn delete"
                        onClick={() => handleRemoveCheck(idx)}
                        title="Hapus point kustom ini"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                </div>
                {item.status === "Perbaikan" && (
                  <div className="checklist-repair-note">
                    <AlertTriangle size={15} />
                    <input
                      type="text"
                      placeholder="Tuliskan temuan / kerusakan untuk item ini (misal: baut kendor, oli bocor, dll)..."
                      value={item.notes || ""}
                      onChange={e => handleNotesChange(idx, e.target.value)}
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="checklist-empty-state">
            <Wrench size={32} />
            <p>Silakan pilih <b>Nama Mesin</b> di atas untuk menampilkan rincian checklist.</p>
          </div>
        )}

        {/* Add custom item */}
        {selectedMachine && (
          <div className="add-checklist-custom-row">
            <input
              type="text"
              placeholder="Tambah point pemeriksaan lain jika ada (misal: Cek kebocoran pipa)..."
              value={customItemName}
              onChange={e => setCustomItemName(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); handleAddCustomItem(e); } }}
            />
            <button type="button" className="secondary small" onClick={handleAddCustomItem}>
              <Plus size={15} /> Tambah Point
            </button>
          </div>
        )}
      </div>

      {/* Catatan Tambahan */}
      <div className="form-grid">
        <Field label="Catatan Tambahan / Keterangan Teknisi (Opsional)" wide>
          <textarea
            value={keterangan}
            onChange={e => setKeterangan(e.target.value)}
            placeholder="Tuliskan catatan teknisi, rekomendasi tindakan, atau komponen yang diganti jika ada..."
            rows={2}
          />
        </Field>
      </div>

      {error && (
        <div className="remote-error">
          <AlertTriangle size={17} />
          <span>{error}</span>
        </div>
      )}

      <div className="form-footer">
        <p>
          <ShieldCheck size={16} /> Data &amp; rincian {checks.length} item checklist akan disimpan ke sistem SiTeki.
        </p>
        <button className="primary" type="submit" disabled={saving || !selectedMachine || quotaInfo.isQuotaReached}>
          {saving ? (
            <><span className="spinner" />Menyimpan…</>
          ) : (
            <><Check size={17} /> Simpan Perawatan ({checks.length} Item)</>
          )}
        </button>
      </div>
    </form>
  );
}

function KPI({ go }) {
  const achievement = useRemoteData(async () => asArray(await apiGet(ENDPOINTS.kpi)));
  const combined = useRemoteData(async () => {
    const result = await apiGet(ENDPOINTS.kpiCombined);
    return asArray(result, ["rekap"]);
  });
  const maintenanceSeries = achievement.data.map(x => ({
    label: monthName(x.bulan),
    value: Math.round(Number(x.pencapaian || 0) * 100)
  }));
  const downtimeSeries = combined.data.map(x => ({ label: monthName(x.bulan), value: Number(x.jam || 0) }));
  const orderSeries = combined.data.map(x => ({ label: monthName(x.bulan), value: Number(x.order || 0) }));
  const latestIndex = Math.max(0, combined.data.findLastIndex(x =>
    Number(x.jam || 0) > 0 || Number(x.order || 0) > 0 ||
    Number(x.bagus || 0) > 0 || Number(x.cukup || 0) > 0 || Number(x.tidakBagus || 0) > 0
  ));
  const latestCombined = combined.data[latestIndex] || {};
  const latestAchievement = maintenanceSeries[latestIndex]?.value || 0;
  const maintenanceTarget = Math.round(Number(achievement.data[latestIndex]?.target || .8) * 100);
  const downtimeTarget = Number(latestCombined.target || 500);
  const loading = achievement.loading || combined.loading;
  const error = achievement.error || combined.error;
  const reload = () => { achievement.reload(); combined.reload(); };
  return <>
    <div className="kpi-toolbar">
      <div><span className="eyebrow">Maintenance performance</span><b>Data KPI tahun berjalan</b></div>
      <button className="secondary small" onClick={reload}><Activity size={16} /> Muat ulang</button>
    </div>
    <RemoteState loading={loading} error={error} empty={!loading && !error && !maintenanceSeries.length} onRetry={reload} />
    {!loading && !error && <>
      <div className="stats-grid"><Stat icon={Gauge} label="KPI perawatan" value={`${latestAchievement}%`} detail={`Target ${maintenanceTarget}%`} tone="mint" /><Stat icon={Wrench} label="Jumlah order" value={Math.round(latestCombined.order || 0)} detail={monthName(latestCombined.bulan)} tone="blue" /><Stat icon={TimerReset} label="Downtime" value={`${Number(latestCombined.jam || 0).toFixed(1)}h`} detail={monthName(latestCombined.bulan)} tone="amber" /><Stat icon={CheckCircle2} label="Pelayanan bagus" value={Math.round(latestCombined.bagus || 0)} detail="Penilaian aktual" tone="violet" /></div>
      <KpiChartPanel title="Perawatan (%)" data={maintenanceSeries} target={maintenanceTarget} maxValue={100} color="#069b70" unit="%" onDetail={() => go("kpiMaintenance")} />
      <KpiChartPanel title="Downtime (jam)" data={downtimeSeries} target={downtimeTarget} maxValue={1000} color="#d97706" unit=" jam" targetLabel="Target maksimum" onDetail={() => go("kpiDowntime")} />
      <KpiChartPanel title="Jumlah order (unit)" data={orderSeries} maxValue={350} color="#7557d9" unit=" order" />
      <QualityTable data={combined.data} />
      <div className="split-actions"><button className="choice-card" onClick={() => go("kpiMaintenance")}><span className="icon-box mint"><Wrench /></span><div><b>Detail perawatan</b><small>Pencapaian per jenis dan mesin</small></div><ArrowRight /></button><button className="choice-card" onClick={() => go("kpiDowntime")}><span className="icon-box amber"><TimerReset /></span><div><b>Detail downtime</b><small>Durasi, mesin, bagian, dan komponen</small></div><ArrowRight /></button></div>
    </>}
  </>;
}

function MaintenanceKpiPage() {
  const ordersRemote = useRemoteData(async () =>
    asArray(await apiGet(
      ENDPOINTS.orders,
      { action: "getAllOrders", includeClosed: "1" },
      { timeout: 90000 }
    )).map(normalizeOrder)
  );
  const maintenanceRemote = useRemoteData(async () =>
    asArray(await apiGet(
      ENDPOINTS.maintenance,
      { action: "getPerawatan" },
      { timeout: 90000 }
    ))
  );
  const repairsRemote = useRemoteData(async () => {
    const rows = asArray(await apiGet(
      ENDPOINTS.jobs,
      { action: "getDataLapKerja", bulan: "", tglAwal: "", tglAkhir: "" },
      { timeout: 90000 }
    ));
    const primary = rows.filter(report => String(report.sheetName || "").trim().toLowerCase() === "lap_kerja");
    return primary.length ? primary : rows;
  });
  const loading = ordersRemote.loading || maintenanceRemote.loading || repairsRemote.loading;
  const error = ordersRemote.error || maintenanceRemote.error || repairsRemote.error;
  const reload = () => {
    ordersRemote.reload();
    maintenanceRemote.reload();
    repairsRemote.reload();
  };

  return <>
    <div className="kpi-toolbar">
      <div><span className="eyebrow">RBKIC maintenance metrics</span><b>Analisis work order dan preventive maintenance</b></div>
      <button className="secondary small" onClick={reload}><Activity size={16} /> Muat ulang</button>
    </div>
    <RemoteState
      loading={loading}
      error={error}
      empty={!loading && !error && !ordersRemote.data.length && !maintenanceRemote.data.length && !repairsRemote.data.length}
      onRetry={reload}
    />
    {!loading && !error &&
      <MaintenanceKpiPanel orders={ordersRemote.data} maintenance={maintenanceRemote.data} repairRecords={repairsRemote.data} />
    }
  </>;
}

function KPIDetail({ kind }) {
  return kind === "Perawatan" ? <MaintenanceKpiDetail /> : <DowntimeKpiDetail />;
}

const KPI_MONTHS = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
const KPI_TYPES = ["Semua Jenis", "Verloop", "Trailler", "Bevel", "Slitting", "Genset", "Forklift", "Kop", "Lakop", "Alat Uji", "Kompressor", "Pipa ERW", "Potong Bahan", "Perakitan", "Dump", "Mobile Crane", "Umum"];
const MONTH_ALIASES = {
  Januari: ["Jan"], Februari: ["Feb"], Maret: ["Mar"], April: ["Apr"], Mei: ["Mei", "May"],
  Juni: ["Jun"], Juli: ["Jul"], Agustus: ["Agu", "Aug"], September: ["Sep"],
  Oktober: ["Okt", "Oct"], November: ["Nov"], Desember: ["Des", "Dec"]
};

function monthName(value) {
  const numeric = Number(value);
  if (Number.isInteger(numeric) && numeric >= 1 && numeric <= 12) return SCHEDULE_MONTHS[numeric - 1];
  const found = Object.entries(MONTH_ALIASES).find(([, aliases]) => aliases.includes(String(value)));
  return found?.[0] || value || "-";
}

function trimChartSeries(data) {
  const series = Array.isArray(data) ? data : [];
  const lastIndex = series.findLastIndex(item => {
    const value = item?.value;
    return value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value)) && Number(value) !== 0;
  });
  return lastIndex < 0 ? [] : series.slice(0, lastIndex + 1);
}

function KpiChartPanel({ title, data, target = 0, maxValue, color, unit, targetLabel = "Target", onDetail }) {
  return <Panel title={title} className="kpi-chart-panel" action={onDetail && <button onClick={onDetail}>Detail <ArrowRight size={14} /></button>}>
    <LineChart data={data} target={target} maxValue={maxValue} color={color} unit={unit} targetLabel={targetLabel} />
  </Panel>;
}

function LineChart({ data, target = 0, maxValue = 100, color = "#069b70", unit = "", targetLabel = "Target" }) {
  const [selected, setSelected] = useState(null);
  const visibleData = trimChartSeries(data);
  const width = 960, height = 250, left = 48, right = 24, top = 28, bottom = 42;
  const chartWidth = width - left - right, chartHeight = height - top - bottom;
  const safeMax = Math.max(1, maxValue, target, ...visibleData.map(x => Number(x.value || 0)));
  const x = i => left + (visibleData.length > 1 ? i * chartWidth / (visibleData.length - 1) : chartWidth / 2);
  const y = value => top + chartHeight - Math.min(Math.max(Number(value || 0), 0), safeMax) / safeMax * chartHeight;
  const points = visibleData.map((item, i) => `${x(i)},${y(item.value)}`).join(" ");
  const fill = visibleData.length ? `${left},${top + chartHeight} ${points} ${x(visibleData.length - 1)},${top + chartHeight}` : "";
  const targetY = y(target);
  const latest = visibleData.at(-1);
  const previous = visibleData.at(-2);
  const delta = previous ? Number(latest.value || 0) - Number(previous.value || 0) : null;
  const maximumTarget = String(targetLabel).toLowerCase().includes("maksimum");
  const targetMet = target > 0 && (maximumTarget ? Number(latest?.value || 0) <= target : Number(latest?.value || 0) >= target);
  const selectedItem = selected === null ? null : visibleData[selected];
  if (!visibleData.length) return <div className="chart-empty"><Database size={20} /> Belum ada data grafik.</div>;
  return <div className="line-chart" onMouseLeave={() => setSelected(null)}>
    <div className="line-chart-summary">
      <span><strong>{Number(latest.value || 0).toLocaleString("id-ID", { maximumFractionDigits: 1 })}{unit}</strong><small>Data terakhir · {latest.label}</small></span>
      <div>
        {delta !== null && <em className="chart-delta">{delta > 0 ? "+" : ""}{delta.toLocaleString("id-ID", { maximumFractionDigits: 1 })}{unit} dari bulan lalu</em>}
        {target > 0 && <em className={`chart-target-status ${targetMet ? "met" : "missed"}`}>{targetMet ? "Target tercapai" : "Di luar target"}</em>}
      </div>
    </div>
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Grafik ${visibleData.length} bulan`}>
      {[0, .25, .5, .75, 1].map(p => {
        const gy = top + chartHeight - chartHeight * p;
        return <g key={p}><line x1={left} x2={width - right} y1={gy} y2={gy} className="chart-grid" /><text x={left - 8} y={gy + 4} textAnchor="end">{Math.round(safeMax * p)}</text></g>;
      })}
      {target > 0 && <g><line x1={left} x2={width - right} y1={targetY} y2={targetY} className="target-line" /><text x={width - right} y={targetY - 8} textAnchor="end" className="target-text">{targetLabel} {target}{unit}</text></g>}
      <polygon points={fill} fill={color} opacity=".045" />
      <polyline points={points} fill="none" stroke={color} strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" />
      {visibleData.map((item, i) => <g key={`${item.label}-${i}`} className="chart-point" onMouseEnter={() => setSelected(i)} onClick={() => setSelected(i)}>
        <circle cx={x(i)} cy={y(item.value)} r="12" fill="transparent" />
        <circle cx={x(i)} cy={y(item.value)} r="3.5" className="chart-point-core" fill="white" stroke={color} strokeWidth="2" />
        <text className="chart-value" x={x(i)} y={Math.max(top + 10, y(item.value) - 10)} textAnchor="middle">{Number(item.value || 0).toLocaleString("id-ID", { maximumFractionDigits: 1 })}{unit === "%" ? "%" : ""}</text>
        <text x={x(i)} y={height - 18} textAnchor="middle">{String(item.label).slice(0, 3)}</text>
      </g>)}
      {selectedItem && <line x1={x(selected)} x2={x(selected)} y1={top} y2={top + chartHeight} className="hover-line" />}
    </svg>
    {selectedItem && <div className="chart-tooltip" style={{ left: `${Math.min(88, Math.max(3, x(selected) / width * 100))}%` }}>
      <b>{selectedItem.label}</b><span><i style={{ background: color }} />{Number(selectedItem.value).toLocaleString("id-ID", { maximumFractionDigits: 1 })}{unit}</span>
    </div>}
  </div>;
}

function QualityTable({ data }) {
  const maxGood = Math.max(1, ...data.map(x => Number(x.bagus || 0)));
  return <Panel title="Kualitas pelayanan" className="quality-panel">
    <div className="quality-table">
      <div className="quality-row quality-head"><b>Bulan</b><b>Bagus</b><b>Cukup</b><b>Tidak bagus</b></div>
      {data.map((item, i) => <div className="quality-row" key={`${item.bulan}-${i}`}>
        <strong>{String(i + 1).padStart(2, "0")}. {monthName(item.bulan)}</strong>
        <span className="quality-good"><b>{Math.round(item.bagus || 0)}</b><i><em style={{ width: `${Number(item.bagus || 0) / maxGood * 100}%` }} /></i></span>
        <span>{Math.round(item.cukup || 0)}</span><span>{Math.round(item.tidakBagus || 0)}</span>
      </div>)}
    </div>
  </Panel>;
}

function MaintenanceKpiDetail() {
  const [month, setMonth] = useState("Januari");
  const [type, setType] = useState("Semua Jenis");
  const remote = useRemoteData(async () => {
    const [annual, detail] = await Promise.all([
      apiGet(ENDPOINTS.kpi),
      apiGet(ENDPOINTS.maintenanceDetail, { bulan: month, jenis: type })
    ]);
    const kinds = asArray(detail, ["data_per_jenis"])
      .filter(x => x.jenis !== "Pengecatan")
      .map(x => [x.jenis, Number(x.pencapaian || 0)]);
    let machines = asArray(detail, ["data_per_mesin"])
      .filter(x => x.nama_mesin !== "Perlengkapan Cat")
      .map(x => [x.nama_mesin, Number(x.pencapaian || 0)]);
    if (type === "Semua Jenis") machines = machines.sort((a, b) => a[1] - b[1]).slice(0, 10);
    return {
      annual: asArray(annual).map(x => ({ label: monthName(x.bulan), value: Number(x.pencapaian || 0) * 100 })),
      target: Number(asArray(annual)[0]?.target || .8) * 100,
      kinds, machines,
      totalKinds: Number(detail.total_jenis || 0), totalMachines: Number(detail.total_mesin || 0)
    };
  }, [month, type]);
  const data = remote.data || {};
  return <>
    <KpiFilters month={month} setMonth={setMonth} type={type} setType={setType} types={KPI_TYPES} />
    <RemoteState loading={remote.loading} error={remote.error} empty={!remote.loading && !data.annual?.length} onRetry={remote.reload} />
    {!remote.loading && !remote.error && <>
      <div className="stats-grid two"><Stat icon={Boxes} label="Jumlah armada" value={data.totalKinds || 0} detail={month} tone="blue" /><Stat icon={Settings} label="Jumlah mesin" value={data.totalMachines || 0} detail={type} tone="mint" /></div>
      <KpiChartPanel title="Pencapaian perawatan (%)" data={data.annual || []} target={data.target || 80} maxValue={100} color="#069b70" unit="%" />
      <div className="kpi-detail-grid">
        <RankChart title="Pencapaian menurut jenis" data={data.kinds || []} unit="%" maxValue={100} color="#3279e6" />
        <RankChart title={type === "Semua Jenis" ? "10 nama mesin terendah" : "Pencapaian nama mesin"} data={data.machines || []} unit="%" maxValue={100} color="#069b70" />
      </div>
    </>}
  </>;
}

function DowntimeKpiDetail() {
  const [month, setMonth] = useState("Semua Bulan");
  const [type, setType] = useState("Semua Jenis");
  const remote = useRemoteData(async () => apiGet(ENDPOINTS.downtime));
  const root = remote.data || {};
  const monthly = asArray(root, ["rekap"]).map(x => ({ label: monthName(x.bulan), value: Number(x.jam || 0) }));
  const raw = asArray(root, ["laporan_mentah"]);
  const types = ["Semua Jenis", ...new Set(raw.map(x => x.jenis).filter(Boolean))].sort((a, b) => a === "Semua Jenis" ? -1 : a.localeCompare(b));
  const monthCodes = month === "Semua Bulan" ? null : MONTH_ALIASES[month] || [month];
  const monthRows = raw.filter(x => !monthCodes || monthCodes.includes(x.bulan));
  const filtered = monthRows.filter(x => type === "Semua Jenis" || x.jenis === type);
  const sumGroups = (rows, key, limit = 10) => Object.entries(rows.reduce((acc, x) => {
    const name = x[key] || "Lainnya"; acc[name] = (acc[name] || 0) + Number(x.total_jam || 0); return acc;
  }, {})).sort((a, b) => b[1] - a[1]).slice(0, limit);
  const machines = sumGroups(monthRows, "mesin", 10), components = sumGroups(filtered, "komponen", 5), sections = sumGroups(filtered, "bagian", 5);
  const total = monthly.reduce((sum, x) => sum + x.value, 0);
  return <>
    <KpiFilters month={month} setMonth={setMonth} type={type} setType={setType} months={["Semua Bulan", ...KPI_MONTHS]} types={types} />
    <RemoteState loading={remote.loading} error={remote.error} empty={!remote.loading && !monthly.length} onRetry={remote.reload} />
    {!remote.loading && !remote.error && <>
      <div className="stats-grid two"><Stat icon={TimerReset} label="Downtime sampai sekarang" value={`${(total / 1000).toFixed(1)} rb jam`} detail="Akumulasi tahunan" tone="amber" /><Stat icon={Gauge} label="Target per tahun" value="6.000 jam" detail="Batas maksimum" tone="violet" /></div>
      <KpiChartPanel title="Total downtime (jam)" data={monthly} target={500} maxValue={1000} color="#d97706" unit=" jam" targetLabel="Target maksimum" />
      <div className="kpi-detail-grid">
        <RankChart title="Komponen" data={components} unit="h" color="#3279e6" />
        <Treemap title="Per bagian" data={sections} />
      </div>
      <RankChart title="Top 10 downtime terbanyak" data={machines} unit="h" color="#d34d79" />
    </>}
  </>;
}

function KpiFilters({ month, setMonth, type, setType, months = KPI_MONTHS, types }) {
  return <div className="kpi-filters">
    <label><span>Bulan</span><select value={month} onChange={e => setMonth(e.target.value)}>{months.map(x => <option key={x}>{x}</option>)}</select></label>
    <label><span>Jenis</span><select value={type} onChange={e => setType(e.target.value)}>{types.map(x => <option key={x}>{x}</option>)}</select></label>
  </div>;
}

function RankChart({ title, data, unit, maxValue, color = "#069b70" }) {
  const max = Math.max(1, maxValue || 0, ...data.map(x => Number(x[1] || 0)));
  return <Panel title={title} className="rank-panel"><div className="rank-list">{!data.length && <div className="chart-empty">Tidak ada data untuk filter ini.</div>}{data.map(([name, value], i) => <div key={`${name}-${i}`}><b>{String(i + 1).padStart(2, "0")}</b><span><strong>{name}</strong><i><em style={{ width: `${Math.min(Number(value || 0) / max * 100, 100)}%`, background: color }} /></i></span><strong>{Number(value || 0).toFixed(1)}{unit}</strong></div>)}</div></Panel>;
}

function Treemap({ title, data }) {
  const colors = ["#069b70", "#3279e6", "#d97706", "#7557d9", "#79a839"];
  const total = Math.max(1, data.reduce((sum, x) => sum + Number(x[1] || 0), 0));
  return <Panel title={title} className="treemap-panel"><div className="kpi-treemap">{!data.length && <div className="chart-empty">Tidak ada data untuk filter ini.</div>}{data.map(([name, value], i) => <div key={name} style={{ background: colors[i % colors.length], flexGrow: Math.max(1, Number(value) / total * 10) }}><b>{name}</b><span>{Number(value).toFixed(1)}h</span></div>)}</div></Panel>;
}

function Electricity({ notify, go, selectedOrder, session }) {
  const live = useRemoteData(() => apiGet(ENDPOINTS.electricity));
  const prev = live.data?.prevData || {};
  const remotePanels = new Map(asArray(live.data?.panels).map(panel => [String(panel.code || "").trim().toLowerCase(), panel]));
  const panelDefinitions = ELECTRICITY_PANELS.map(panel => ({ ...remotePanels.get(panel.code), ...panel }));
  const requestedMode = selectedOrder && Object.prototype.hasOwnProperty.call(selectedOrder, "electricityMode")
    ? selectedOrder.electricityMode
    : electricityQrRequest().mode;
  const mode = ELECTRICITY_QR_MODES.includes(requestedMode) ? requestedMode : "";
  const selectedPanel = panelDefinitions.find(panel => panel.code === mode);
  const jakartaNow = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const jakartaTime = () => new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Jakarta", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date());
  const emptyForm = () => ({ tanggal: jakartaNow(), jam: jakartaTime(), huhe_h: "", huhe_hh: "", huar_hh: "", huar_heh: "", grid_pln: "", pv_plts: "", to_grid: "", cos_phi: "", petugas: session?.name || "" });
  const [form, setForm] = useState(emptyForm);
  const [cosPhiCameraOpen, setCosPhiCameraOpen] = useState(false);
  const [cosPhiReading, setCosPhiReading] = useState(null);
  const update = event => {
    if (event.target.name === "cos_phi") setCosPhiReading(null);
    setForm(current => ({ ...current, [event.target.name]: event.target.value }));
  };
  const isAdmin = String(session?.role || "").toLocaleLowerCase("id-ID") === "admin";
  const officerNames = [...new Set([session?.name, ...asArray(live.data?.petugas)].map(name => String(name || "").trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right, "id-ID"));
  const officerControl = () => isAdmin
    ? <select name="petugas" value={form.petugas} onChange={update} required><option value="" disabled>Pilih nama petugas</option>{officerNames.map(name => <option key={name} value={name}>{name}</option>)}</select>
    : <input name="petugas" value={session?.name || form.petugas} readOnly required />;
  let assessment = null;
  try {
    if ([form.huhe_h, form.huhe_hh, form.huar_heh, form.huar_hh].every(value => value !== "")) assessment = calculateElectricityAssessment(form);
  } catch { assessment = null; }
  const submitEnergy = async (data) => {
    const calculated = calculateElectricityAssessment(data);
    if (!window.confirm(`Simpan pemeriksaan dengan hasil ${calculated.conclusion}?`)) return;
    const result = await apiPost(ENDPOINTS.electricity, { action: "insert", ...data, tanggal: toIdDate(data.tanggal) });
    if (!isSuccess(result)) throw new Error(result.message || "Data listrik gagal disimpan.");
    notify("Data pengecekan listrik disimpan dan tersinkron.");
    setForm(emptyForm());
    live.reload();
  };
  const submitPanel = async (data) => {
    const result = await apiPost(ENDPOINTS.electricity, { action: "insertPanelCosPhi", ...data, panel: mode, tanggal: toIdDate(data.tanggal) });
    if (!isSuccess(result)) throw new Error(result.message || "Data cos phi gagal disimpan.");
    notify(`Data cos phi ${selectedPanel?.name || "panel"} berhasil disimpan.`);
    setForm(emptyForm());
    setCosPhiReading(null);
    live.reload();
  };
  if (!mode) return <>
    <div className="electricity-location-intro"><p className="eyebrow">Pilih lokasi pemeriksaan</p><h2>Cek listrik berdasarkan QR lokasi</h2><p>Stand meter PLN menyimpan data energi dan perhitungan kVArh. Panel 1–4 hanya menyimpan pembacaan cos φ.</p></div>
    <div className="electricity-location-grid">
      <button type="button" onClick={() => go("electricity", { electricityMode: "pln" })}><span className="icon-box amber"><Zap size={21} /></span><span><b>Stand meter PLN</b><small>Input kWh dan kVArh</small></span><ArrowRight size={17} /></button>
      {panelDefinitions.map(panel => <button type="button" key={panel.code} onClick={() => go("electricity", { electricityMode: panel.code })}><span className="icon-box violet"><Activity size={21} /></span><span><b>{panel.name}</b><small>Input data cos φ</small></span><ArrowRight size={17} /></button>)}
    </div>
  </>;
  if (selectedPanel) return <>
    <div className="stats-grid two"><Stat icon={Activity} label={`${selectedPanel.name} terakhir`} value={Number.isFinite(Number(selectedPanel.latestPowerFactor)) ? Number(selectedPanel.latestPowerFactor).toFixed(2) : "-"} detail="Data cos φ terakhir" tone="violet" /><Stat icon={Database} label="Jenis pencatatan" value="Data saja" detail="Tidak masuk hitungan kVArh" tone="blue" /></div>
    <FormPanel title={`Input cos φ ${selectedPanel.name}`} onSubmit={submitPanel} submit="Simpan cos φ" extra={<div className="button-row"><button type="button" className="secondary" onClick={() => go("electricity", { electricityMode: "" })}>Ganti lokasi</button><button type="button" className="secondary" onClick={() => go("electricityData")}><Database size={17} /> Lihat data</button></div>}>
      <Field label="Tanggal"><input name="tanggal" type="date" lang="id-ID" value={form.tanggal} onChange={update} required /></Field>
      <Field label="Jam"><input name="jam" type="time" value={form.jam} onChange={update} required /></Field>
      <div className="cosphi-meter-field wide">
        <label htmlFor="panel-cos-phi">Cos φ {selectedPanel.name}</label>
        <div><input id="panel-cos-phi" name="cos_phi" type="text" inputMode="decimal" pattern="[0-9]+([.,][0-9]+)?" placeholder="Contoh: 0,85 atau 0.85" value={form.cos_phi} onChange={update} required /><button type="button" className="secondary" onClick={() => setCosPhiCameraOpen(true)}><Camera size={17} /> Baca Meter</button></div>
        {cosPhiReading && <small className={`cosphi-meter-source ${cosPhiReading.level}`}><CheckCircle2 size={15} /> Dibaca dari meter · {cosPhiReading.state} · Confidence {cosPhiReading.confidence}%</small>}
      </div>
      <Field label={isAdmin ? "Petugas (dapat dipilih Admin)" : "Petugas (otomatis dari akun login)"} wide>{officerControl()}</Field>
      <div className="cosphi-data-note wide"><Database size={17} /><span><b>Hanya pencatatan data</b><small>Nilai ini tidak mengubah perhitungan atau kesimpulan kVArh stand meter PLN.</small></span></div>
    </FormPanel>
    <CosPhiCamera open={cosPhiCameraOpen} onClose={() => setCosPhiCameraOpen(false)} onUse={reading => { setForm(current => ({ ...current, cos_phi: reading.value.toFixed(2) })); setCosPhiReading(reading); }} />
  </>;
  return <><div className="stats-grid three"><Stat icon={Zap} label="HUHE HH terakhir" value={prev.huhe_hh || "…"} detail="Data Neon" tone="mint" /><Stat icon={Gauge} label="PV PLTS terakhir" value={prev.pv_plts || "…"} detail="Data Neon" tone="blue" /><Stat icon={AlertTriangle} label="Kesimpulan" value={prev.kesimpulan || "-"} detail={prev.tanggal || "Belum ada data"} tone="amber" /></div>
    <FormPanel title="Input pengecekan energi listrik" onSubmit={submitEnergy} submit="Simpan pemeriksaan" extra={<div className="button-row"><button type="button" className="secondary" onClick={() => go("electricity", { electricityMode: "" })}>Ganti lokasi</button><button type="button" className="secondary" onClick={() => go("electricityData")}><Database size={17} /> Lihat data</button></div>}>
      <Field label="Tanggal"><input name="tanggal" type="date" lang="id-ID" value={form.tanggal} onChange={update} required /></Field><Field label="Jam"><input name="jam" type="time" value={form.jam} onChange={update} required /></Field>
      <Field label={`HUHE H (saat ini) · sebelumnya ${prev.huhe_h ?? "-"}`}><input name="huhe_h" type="text" inputMode="decimal" pattern="[0-9]+([.,][0-9]+)?" placeholder="Koma atau titik" value={form.huhe_h} onChange={update} required /></Field><Field label={`HUHE HH (sebelumnya) · data lalu ${prev.huhe_hh ?? "-"}`}><input name="huhe_hh" type="text" inputMode="decimal" pattern="[0-9]+([.,][0-9]+)?" placeholder="Koma atau titik" value={form.huhe_hh} onChange={update} required /></Field>
      <Field label={`HUAR HEH (saat ini) · sebelumnya ${prev.huar_heh ?? "-"}`}><input name="huar_heh" type="text" inputMode="decimal" pattern="[0-9]+([.,][0-9]+)?" placeholder="Koma atau titik" value={form.huar_heh} onChange={update} required /></Field><Field label={`HUAR HH (sebelumnya) · data lalu ${prev.huar_hh ?? "-"}`}><input name="huar_hh" type="text" inputMode="decimal" pattern="[0-9]+([.,][0-9]+)?" placeholder="Koma atau titik" value={form.huar_hh} onChange={update} required /></Field>
      <Field label="Grid PLN (MWh)"><input name="grid_pln" type="text" inputMode="decimal" pattern="[0-9]+([.,][0-9]+)?" placeholder="Koma atau titik" value={form.grid_pln} onChange={update} /></Field><Field label="PV PLTS (MWh)"><input name="pv_plts" type="text" inputMode="decimal" pattern="[0-9]+([.,][0-9]+)?" placeholder="Koma atau titik" value={form.pv_plts} onChange={update} /></Field>
      <Field label="To Grid (MWh)"><input name="to_grid" type="text" inputMode="decimal" pattern="[0-9]+([.,][0-9]+)?" placeholder="Koma atau titik" value={form.to_grid} onChange={update} /></Field><Field label={isAdmin ? "Petugas (dapat dipilih Admin)" : "Petugas (otomatis dari akun login)"}>{officerControl()}</Field>
      {assessment && <div className={`electricity-assessment wide ${assessment.conclusion === "AMAN" ? "safe" : "warning"}`}><div><small>Pemakaian aktif</small><b>{assessment.activeKwh.toFixed(2)} kWh</b></div><div><small>Batas reaktif PLN (62%)</small><b>{assessment.reactiveLimitKvarh.toFixed(2)} kVArh</b></div><div><small>Pemakaian reaktif</small><b>{assessment.reactiveKvarh.toFixed(2)} kVArh</b></div><div><small>Faktor daya estimasi</small><b>{assessment.powerFactor.toFixed(2)}</b></div><span><AlertTriangle size={17} /><strong>{assessment.conclusion}</strong><small>{assessment.conclusion === "AMAN" ? `Margin ${assessment.marginKvarh.toFixed(2)} kVArh` : `Kelebihan ${assessment.excessReactiveKvarh.toFixed(2)} kVArh`}</small></span><p>Indikasi interval untuk pemantauan dini. Pengenaan biaya resmi PLN mengikuti akumulasi bulanan dan golongan tarif pelanggan.</p></div>}
    </FormPanel></>;
}

function OilMonitoring({ session, notify }) {
  const [formKey, setFormKey] = useState(0);
  const remote = useRemoteData(() => getOilMonitoring(session.token), [session.token]);
  const data = remote.data?.summary ? remote.data : {};
  const summary = data.summary || {};
  const reservoirs = asArray(data.reservoirs);
  const history = asArray(data.history);
  const displayDate = value => value
    ? new Intl.DateTimeFormat("id-ID", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(`${String(value).slice(0, 10)}T12:00:00`))
    : "Belum dicek";
  const submit = async form => {
    await saveOilCheck(session.token, {
      reservoirId: form.reservoirId,
      checkedOn: form.checkedOn,
      levelPercent: Number(form.levelPercent),
      refillLiters: form.refillLiters === "" ? null : Number(form.refillLiters),
      oilCondition: form.oilCondition,
      notes: form.notes
    });
    notify("Pemeriksaan oli berhasil disimpan ke Neon.");
    setFormKey(value => value + 1);
    await remote.reload();
  };
  return <>
    <div className="stats-grid">
      <Stat icon={Droplets} label="Titik oli" value={remote.loading ? "…" : summary.reservoir_count ?? 0} detail="Reservoir aktif" tone="blue" />
      <Stat icon={AlertTriangle} label="Level kritis" value={remote.loading ? "…" : summary.critical_count ?? 0} detail="Di bawah batas minimum" tone="amber" />
      <Stat icon={Gauge} label="Perlu perhatian" value={remote.loading ? "…" : summary.attention_count ?? 0} detail="Mendekati batas minimum" tone="violet" />
      <Stat icon={CalendarDays} label="Terlambat dicek" value={remote.loading ? "…" : summary.overdue_count ?? 0} detail="Melewati interval" tone="mint" />
    </div>
    <RemoteState loading={remote.loading} error={remote.error} empty={!remote.loading && !reservoirs.length} onRetry={remote.reload} />
    {!remote.loading && !remote.error && reservoirs.length > 0 && <>
      <div className="oil-layout">
        <FormPanel key={formKey} title="Input pemeriksaan oli" onSubmit={submit} submit="Simpan ke Neon">
          <Field label="Titik / reservoir oli" wide><select name="reservoirId" required defaultValue=""><option value="" disabled>Pilih titik oli</option>{reservoirs.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
          <Field label="Tanggal"><input name="checkedOn" type="date" lang="id-ID" defaultValue={new Date().toISOString().slice(0, 10)} required /></Field>
          <Field label="Level oli (%)"><input name="levelPercent" type="number" min="0" max="100" step="0.1" required /></Field>
          <Field label="Penambahan oli (liter)"><input name="refillLiters" type="number" min="0" step="0.1" /></Field>
          <Field label="Kondisi oli"><select name="oilCondition" defaultValue="Normal"><option>Normal</option><option>Keruh</option><option>Kotor</option><option>Bercampur air</option><option>Perlu diganti</option></select></Field>
          <Field label="Keterangan" wide><textarea name="notes" placeholder="Catatan kebocoran, pengisian, atau tindak lanjut" /></Field>
        </FormPanel>
        <Panel title="Status level terbaru">
          <div className="oil-status-list">{reservoirs.map(item => <div key={item.id}>
            <span className={`oil-drop ${String(item.level_status || "").toLowerCase()}`}><Droplets size={18} /></span>
            <span><b>{item.name}</b><small>{displayDate(item.checked_on)}{item.is_overdue ? " / terlambat" : ""}</small></span>
            <span className="oil-meter"><i><em style={{ width: `${Math.max(0, Math.min(100, Number(item.level_percent || 0)))}%` }} /></i><small>{item.level_percent ?? "-"}%{item.estimated_oil_liters !== null && item.estimated_oil_liters !== undefined ? ` / ${Number(item.estimated_oil_liters).toLocaleString("id-ID", { maximumFractionDigits: 1 })} L` : ""}</small></span>
            <Badge text={item.level_status || "BELUM CEK"} />
          </div>)}</div>
        </Panel>
      </div>
      <Panel title="Riwayat pemeriksaan terbaru">
        <SimpleTable headers={["Tanggal", "Titik oli", "Level", "Estimasi volume", "Kondisi", "Petugas", "Status"]} rows={history.slice(0, 30).map(item => [
          displayDate(item.checked_on), item.reservoir_name, `${Number(item.level_percent).toLocaleString("id-ID")}%`,
          item.estimated_oil_liters === null ? "-" : `${Number(item.estimated_oil_liters).toLocaleString("id-ID", { maximumFractionDigits: 1 })} L`,
          item.oil_condition || "-", item.checked_by || "Data lama", item.level_status
        ])} />
      </Panel>
    </>}
  </>;
}

function Jobs({ go, session, notify }) {
  const now = new Date();
  const currentYear = String(now.getFullYear());
  const currentMonth = String(now.getMonth() + 1).padStart(2, "0");
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState({
    year: currentYear, month: currentMonth, category: "", type: "", machine: "", section: ""
  });
  const requestedPeriod = new Intl.DateTimeFormat("id-ID", { month: "long", year: "numeric" })
    .format(new Date(Number(filters.year), Number(filters.month) - 1, 1));
  // Ambil satu bulan dari server. Perubahan tahun/bulan akan meminta periode
  // tersebut saja sehingga browser tidak perlu mengunduh seluruh arsip.
  const remote = useRemoteData(async () => {
    const rows = asArray(await apiGet(ENDPOINTS.jobs, {
      action: "getDataLapKerja", bulan: requestedPeriod
    }, { timeout: 45000 }));
    // Spreadsheet memiliki tab salinan/arsip dengan header serupa. Gunakan
    // `lap_kerja` sebagai sumber utama yang sama dengan aplikasi Android agar
    // laporan tidak terduplikasi dari "Copy of lap_kerja"/"Laporan Kerja".
    const primary = rows.filter(report => String(report.sheetName || "").trim().toLowerCase() === "lap_kerja");
    return primary.length ? primary : rows;
  }, [filters.year, filters.month]);
  const isAdmin = String(session?.role || "").trim().toLowerCase() === "admin";
  const capabilities = useRemoteData(async () => isAdmin
    ? apiGet(ENDPOINTS.jobs, { action: "getCapabilities" })
    : { status: "success", capabilities: [] }, [isAdmin]);
  const canManage = isAdmin && Array.isArray(capabilities.data?.capabilities)
    && capabilities.data.capabilities.includes("updateReport")
    && capabilities.data.capabilities.includes("deleteReport");
  const [editing, setEditing] = useState(null);
  const [selectedReport, setSelectedReport] = useState(null);
  const [busyRow, setBusyRow] = useState(null);
  const [sort, setSort] = useState({ key: "date", direction: "desc" });
  const [page, setPage] = useState(1);
  const pageSize = 50;

  const reportDate = value => {
    const match = String(value || "").match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})(?:\s|$)/);
    if (match) return new Date(Number(match[3]), Number(match[2]) - 1, Number(match[1])).getTime();
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? 0 : parsed;
  };
  const reportStartValue = report =>
    report.tanggalMulai || report.tglMulai || report.jamMulai || report.awal || report.tanggal || "";
  const reportStartLabel = report => {
    const timestamp = reportDate(reportStartValue(report));
    return timestamp
      ? new Intl.DateTimeFormat("id-ID", {
        day: "2-digit", month: "2-digit", year: "numeric"
      }).format(new Date(timestamp))
      : report.tanggal || "-";
  };
  const reportMonth = value => {
    const timestamp = reportDate(value);
    if (!timestamp) return "";
    const date = new Date(timestamp);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  };
  const normalized = value => String(value ?? "").trim();
  const uniqueOptions = key => [...new Set(remote.data.map(report => normalized(key(report))).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, "id", { numeric: true, sensitivity: "base" }));
  const filterOptions = useMemo(() => ({
    years: Array.from({ length: 10 }, (_, index) => String(now.getFullYear() - index)),
    months: Array.from({ length: 12 }, (_, index) => ({
      value: String(index + 1).padStart(2, "0"),
      label: new Intl.DateTimeFormat("id-ID", { month: "long" }).format(new Date(2020, index, 1))
    })),
    categories: uniqueOptions(report => report.kategoriMesin),
    types: uniqueOptions(report => report.jenis),
    machines: uniqueOptions(report => report.mesin || report.namaMesin),
    sections: uniqueOptions(report => report.bagian)
  }), [remote.data, currentYear]);
  const visibleReports = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("id");
    const filtered = remote.data.filter(report => {
      const startValue = reportStartValue(report);
      const date = reportDate(startValue);
      const year = date ? String(new Date(date).getFullYear()) : "";
      const searchable = [
        startValue, report.tanggal, report.mesin, report.namaMesin, report.bagian, report.laporan,
        report.jenisPekerjaan, report.kategoriMesin, report.jenis
      ].join(" ").toLocaleLowerCase("id");
      return (!needle || searchable.includes(needle))
        && year === filters.year
        && reportMonth(startValue) === `${filters.year}-${filters.month}`
        && (!filters.category || normalized(report.kategoriMesin) === filters.category)
        && (!filters.type || normalized(report.jenis) === filters.type)
        && (!filters.machine || normalized(report.mesin || report.namaMesin) === filters.machine)
        && (!filters.section || normalized(report.bagian) === filters.section);
    });
    const getters = {
      date: report => reportDate(reportStartValue(report)),
      machine: report => normalized(report.mesin || report.namaMesin),
      section: report => normalized(report.bagian),
      report: report => normalized(report.laporan),
      duration: report => Number(String(report.durasi || report.totalJam || 0).replace(",", "."))
    };
    const getter = getters[sort.key] || getters.date;
    return [...filtered].sort((a, b) => {
      const left = getter(a), right = getter(b);
      const comparison = typeof left === "number"
        ? left - right
        : left.localeCompare(right, "id", { numeric: true, sensitivity: "base" });
      return sort.direction === "asc" ? comparison : -comparison;
    });
  }, [remote.data, query, filters, sort]);
  const setFilter = (key, value) => setFilters(current => ({ ...current, [key]: value }));
  const toggleSort = key => setSort(current => ({
    key, direction: current.key === key && current.direction === "asc" ? "desc" : "asc"
  }));
  const sortLabel = key => sort.key === key ? (sort.direction === "asc" ? "↑" : "↓") : "↕";
  const resetFilters = () => {
    setQuery("");
    setFilters({ year: currentYear, month: currentMonth, category: "", type: "", machine: "", section: "" });
  };
  const pageCount = Math.max(1, Math.ceil(visibleReports.length / pageSize));
  const pagedReports = visibleReports.slice((page - 1) * pageSize, page * pageSize);
  useEffect(() => setPage(1), [query, filters, sort]);
  useEffect(() => setPage(current => Math.min(current, pageCount)), [pageCount]);

  const removeReport = async report => {
    if (!canManage) return notify("Backend Admin laporan belum diperbarui.");
    if (!report.rowIndex) return notify("Identitas baris laporan tidak tersedia.");
    if (!window.confirm(`Hapus laporan ${report.mesin || report.namaMesin || ""} tanggal mulai ${reportStartLabel(report)}?`)) return;
    setBusyRow(report.rowIndex);
    try {
      const result = await apiPost(ENDPOINTS.jobs, {
        action: "deleteReport", token: session.token, rowIndex: report.rowIndex,
        sheetId: report.sheetId, sheetName: report.sheetName
      });
      if (!isSuccess(result)) throw new Error(result.message || "Laporan gagal dihapus.");
      notify("Laporan kerja berhasil dihapus.");
      await remote.reload();
    } catch (error) {
      notify(error?.message || "Laporan gagal dihapus.");
    } finally { setBusyRow(null); }
  };

  const saveReport = async data => {
    if (!editing?.rowIndex) throw new Error("Identitas baris laporan tidak tersedia.");
    const result = await apiPost(ENDPOINTS.jobs, {
      action: "updateReport", token: session.token, rowIndex: editing.rowIndex,
      sheetId: editing.sheetId, sheetName: editing.sheetName, ...data,
      tanggal: toIdDate(data.tanggal)
    });
    if (!isSuccess(result)) throw new Error(result.message || "Laporan gagal diperbarui.");
    setEditing(null);
    notify("Perubahan laporan kerja berhasil disimpan.");
    await remote.reload();
  };

  return <>
    <Panel title="Riwayat laporan" action={<button className="primary small" onClick={() => go("jobForm")}><Plus size={16} /> Isi laporan</button>}>
      <div className="report-filter-panel">
        <label className="search report-search"><Search size={17} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Cari laporan, mesin, atau pekerjaan..." /></label>
        <div className="report-filter-grid">
          <label><span>Tahun</span><select value={filters.year} onChange={event => setFilter("year", event.target.value)}>{filterOptions.years.map(year => <option key={year}>{year}</option>)}</select></label>
          <label><span>Bulan</span><select value={filters.month} onChange={event => setFilter("month", event.target.value)}>{filterOptions.months.map(month => <option key={month.value} value={month.value}>{month.label}</option>)}</select></label>
          <label><span>Kategori mesin</span><select value={filters.category} onChange={event => setFilter("category", event.target.value)}><option value="">Semua kategori</option>{filterOptions.categories.map(value => <option key={value}>{value}</option>)}</select></label>
          <label><span>Jenis</span><select value={filters.type} onChange={event => setFilter("type", event.target.value)}><option value="">Semua jenis</option>{filterOptions.types.map(value => <option key={value}>{value}</option>)}</select></label>
          <label><span>Nama mesin</span><select value={filters.machine} onChange={event => setFilter("machine", event.target.value)}><option value="">Semua mesin</option>{filterOptions.machines.map(value => <option key={value}>{value}</option>)}</select></label>
          <label><span>Bagian</span><select value={filters.section} onChange={event => setFilter("section", event.target.value)}><option value="">Semua bagian</option>{filterOptions.sections.map(value => <option key={value}>{value}</option>)}</select></label>
          <div className="report-filter-summary"><b>{visibleReports.length}</b><span>laporan {requestedPeriod}</span><button type="button" onClick={resetFilters}>Bulan ini</button></div>
        </div>
      </div>
      {isAdmin && !capabilities.loading && !canManage && <div className="admin-backend-note"><ShieldCheck size={16} /><span><b>Mode Admin laporan menunggu backend baru</b><small>Pasang script LaporanKerja.secure.gs agar Edit dan Hapus aktif dengan verifikasi token.</small></span></div>}
      <RemoteState loading={remote.loading} error={remote.error} empty={!remote.data.length} onRetry={remote.reload} />
      {!remote.loading && !remote.error && remote.data.length > 0 && visibleReports.length === 0 && <div className="remote-state"><Search size={18} /> Tidak ada laporan yang cocok dengan filter.</div>}
      {!remote.loading && !remote.error && visibleReports.length > 0 && <div className="table-wrap"><table>
        <thead><tr>
          <th><button className="sort-head" onClick={() => toggleSort("date")}>Tanggal mulai <span>{sortLabel("date")}</span></button></th>
          <th><button className="sort-head" onClick={() => toggleSort("machine")}>Mesin <span>{sortLabel("machine")}</span></button></th>
          <th><button className="sort-head" onClick={() => toggleSort("section")}>Bagian <span>{sortLabel("section")}</span></button></th>
          <th><button className="sort-head" onClick={() => toggleSort("report")}>Laporan pekerjaan <span>{sortLabel("report")}</span></button></th>
          <th><button className="sort-head" onClick={() => toggleSort("duration")}>Durasi <span>{sortLabel("duration")}</span></button></th>
          {isAdmin && <th>Aksi Admin</th>}
        </tr></thead>
        <tbody>{pagedReports.map((report, index) => <tr
          className="clickable-report-row"
          key={`${report.sheetId || report.sheetName || "report"}-${report.rowIndex || `${report.tanggal}-${index}`}`}
          tabIndex="0"
          onClick={() => setSelectedReport(report)}
          onKeyDown={event => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              setSelectedReport(report);
            }
          }}
        >
          <td>{reportStartLabel(report)}</td><td><b>{report.mesin || report.namaMesin || "-"}</b><small>{report.jenisPekerjaan || ""}</small></td>
          <td>{report.bagian || "-"}</td><td>{report.laporan || "-"}</td><td>{report.durasi || report.totalJam || "-"}</td>
          {isAdmin && <td><div className="admin-row-actions">
            <button type="button" title="Edit laporan" disabled={!canManage || busyRow === report.rowIndex} onClick={event => { event.stopPropagation(); setEditing(report); }}><Edit3 size={15} /></button>
            <button type="button" className="danger" title="Hapus laporan" disabled={!canManage || busyRow === report.rowIndex} onClick={event => { event.stopPropagation(); removeReport(report); }}>{busyRow === report.rowIndex ? <span className="spinner dark" /> : <Trash2 size={15} />}</button>
          </div></td>}
        </tr>)}</tbody>
      </table>
        {pageCount > 1 && <div className="table-pagination">
          <span>Menampilkan {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, visibleReports.length)} dari {visibleReports.length}</span>
          <div>
            <button type="button" disabled={page === 1} onClick={() => setPage(value => Math.max(1, value - 1))}>Sebelumnya</button>
            <b>{page} / {pageCount}</b>
            <button type="button" disabled={page === pageCount} onClick={() => setPage(value => Math.min(pageCount, value + 1))}>Berikutnya</button>
          </div>
        </div>}
      </div>}
    </Panel>
    {selectedReport && <ReportDetailModal report={selectedReport} onClose={() => setSelectedReport(null)} />}
    {editing && <ReportAdminEditor report={editing} onClose={() => setEditing(null)} onSave={saveReport} />}
  </>;
}

function ReportDetailModal({ report, onClose }) {
  const value = (...keys) => {
    for (const key of keys) {
      const current = String(report?.[key] ?? "").trim();
      if (current) return current;
    }
    return "-";
  };
  const start = value("tanggalMulai", "tglMulai", "jamMulai", "awal", "tanggal");
  const finish = value("tanggalSelesai", "tglSelesai", "jamSelesai", "akhir");
  const identity = [
    ["Bagian", value("bagian")],
    ["Kategori mesin", value("kategoriMesin")],
    ["Jenis mesin/armada", value("jenis")],
    ["Nama mesin/armada", value("mesin", "namaMesin")],
    ["Jenis pekerjaan", value("jenisPekerjaan")],
    ["Jenis komponen", value("jenisKomponen")]
  ];
  const timing = [
    ["Tanggal laporan", value("tanggal")],
    ["Mulai pekerjaan", start],
    ["Selesai pekerjaan", finish],
    ["Total durasi", `${value("durasi", "totalJam")}${value("durasi", "totalJam") === "-" ? "" : " jam"}`]
  ];
  const material = [
    ["Kategori part", value("partKategori")],
    ["Spare part dipakai", value("sparepart", "partNama")],
    ["Ukuran/kode part", value("ukuranPart", "partUkuran")],
    ["Order spare part", value("order")]
  ];
  const result = [
    ["Status pekerjaan", value("statusOrder")],
    ["Nilai perbaikan", value("nilaiPerbaikan")],
    ["Definisi pekerjaan", value("definisi")]
  ];
  const DetailGrid = ({ items }) => <div className="report-detail-grid">{items.map(([label, content]) =>
    <div key={label}><small>{label}</small><b>{content}</b></div>
  )}</div>;
  return <div className="modal-overlay" onMouseDown={event => event.target === event.currentTarget && onClose()}>
    <article className="modal-card report-detail-modal">
      <div className="modal-head">
        <div><p className="eyebrow">Detail laporan kerja</p><h3>{value("mesin", "namaMesin")}</h3><small>{start} · {value("bagian")}</small></div>
        <button type="button" onClick={onClose} aria-label="Tutup detail"><X size={18} /></button>
      </div>
      <section className="report-detail-highlight">
        <span className="icon-box mint"><FileBarChart size={20} /></span>
        <div><small>Laporan pekerjaan</small><p>{value("laporan")}</p></div>
      </section>
      <section className="report-detail-section"><h4>Identitas pekerjaan</h4><DetailGrid items={identity} /></section>
      <section className="report-detail-section"><h4>Waktu dan durasi</h4><DetailGrid items={timing} /></section>
      <section className="report-detail-columns">
        <div className="report-detail-section"><h4>Spare part</h4><DetailGrid items={material} /></div>
        <div className="report-detail-section"><h4>Hasil pekerjaan</h4><DetailGrid items={result} /></div>
      </section>
      <section className="report-detail-note"><small>Keterangan</small><p>{value("keterangan")}</p></section>
      <div className="modal-actions"><button type="button" className="primary" onClick={onClose}>Tutup</button></div>
    </article>
  </div>;
}

function ReportAdminEditor({ report, onClose, onSave }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const dateValue = useMemo(() => {
    const match = String(report.tanggal || "").match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    return match ? `${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}` : "";
  }, [report.tanggal]);
  const submit = async event => {
    event.preventDefault(); setSaving(true); setError("");
    try { await onSave(Object.fromEntries(new FormData(event.currentTarget).entries())); }
    catch (err) { setError(err?.message || "Perubahan gagal disimpan."); }
    finally { setSaving(false); }
  };
  return <div className="modal-overlay" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <form className="modal-card report-admin-editor" onSubmit={submit}>
      <div className="modal-head"><div><p className="eyebrow">Admin report editor</p><h3>Edit laporan kerja</h3></div><button type="button" onClick={onClose}><X size={18} /></button></div>
      <div className="form-grid">
        <Field label="Tanggal"><input name="tanggal" type="date" lang="id-ID" defaultValue={dateValue} required /></Field>
        <Field label="Bagian"><input name="bagian" defaultValue={report.bagian || ""} required /></Field>
        <Field label="Nama mesin"><input name="namaMesin" defaultValue={report.mesin || report.namaMesin || ""} required /></Field>
        <Field label="Durasi (jam)"><input name="totalJam" defaultValue={report.durasi || report.totalJam || ""} /></Field>
        <Field label="Laporan pekerjaan" wide><textarea name="laporan" defaultValue={report.laporan || ""} required /></Field>
        <Field label="Waktu mulai"><input name="jamMulai" defaultValue={report.awal || report.jamMulai || ""} /></Field>
        <Field label="Waktu selesai"><input name="jamSelesai" defaultValue={report.akhir || report.jamSelesai || ""} /></Field>
        <Field label="Spare part"><input name="sparepart" defaultValue={report.sparepart || ""} /></Field>
        <Field label="Order"><select name="order" defaultValue={report.order || "Tanpa Order"}><option>Order</option><option>Tanpa Order</option></select></Field>
        <Field label="Status"><select name="statusOrder" defaultValue={report.statusOrder || "Close"}><option>Open</option><option>Close</option></select></Field>
        <Field label="Nilai perbaikan"><select name="nilaiPerbaikan" defaultValue={report.nilaiPerbaikan || "Bagus"}><option>Bagus</option><option>Cukup</option><option>Tidak Bagus</option></select></Field>
        <Field label="Keterangan" wide><textarea name="keterangan" defaultValue={report.keterangan || ""} /></Field>
      </div>
      {error && <div className="remote-error"><AlertTriangle size={16} /><span>{error}</span></div>}
      <div className="modal-actions"><button type="button" className="secondary" onClick={onClose}>Batal</button><button className="primary" disabled={saving}>{saving ? <><span className="spinner" />Menyimpan…</> : <><Check size={16} />Simpan perubahan</>}</button></div>
    </form>
  </div>;
}

function ChoiceField({ label, children, wide = false }) {
  return <div className={`choice-field ${wide ? "wide" : ""}`}><span>{label}</span>{children}</div>;
}

function ChoiceCards({ name, options, value, onChange, defaultValue = "", required = false, columns }) {
  return <div className="choice-radio-grid" style={columns ? { "--choice-columns": columns } : undefined}>
    {options.map(option => {
      const item = typeof option === "string" ? { value: option, label: option } : option;
      const controlled = value !== undefined;
      return <label className="choice-radio" key={`${name}-${item.value}`}>
        <input
          type="radio"
          name={name}
          value={item.value}
          checked={controlled ? value === item.value : undefined}
          defaultChecked={!controlled && defaultValue === item.value}
          onChange={event => onChange?.(event.target.value)}
          required={required}
        />
        <i /><span><b>{item.label}</b>{item.help && <small>{item.help}</small>}</span>
      </label>;
    })}
  </div>;
}

function JobForm({ notify, go, session }) {
  const machines = useRemoteData(loadMachineMaster);
  const partsRemote = useRemoteData(async () => asArray(await apiGet(ENDPOINTS.partMaster, { action: "getPart" }), ["stok", "parts"]));
  const today = useMemo(() => {
    const date = new Date();
    const offset = date.getTimezoneOffset() * 60000;
    return new Date(date.getTime() - offset).toISOString().slice(0, 10);
  }, []);
  const [section, setSection] = useState("");
  const [machineType, setMachineType] = useState("");
  const [machineName, setMachineName] = useState("");
  const [startDate, setStartDate] = useState(today);
  const [startTime, setStartTime] = useState("08:00");
  const [endDate, setEndDate] = useState(today);
  const [endTime, setEndTime] = useState("09:00");
  const [selectedPartCategory, setSelectedPartCategory] = useState("Tidak Pakai");
  const [selectedPart, setSelectedPart] = useState("Tidak Pakai");
  const [partSize, setPartSize] = useState("");
  const [partSearch, setPartSearch] = useState("");
  const [partSearchOpen, setPartSearchOpen] = useState(false);
  const [workComponent, setWorkComponent] = useState("");
  const [showAddPart, setShowAddPart] = useState(false);
  const isAdmin = String(session?.role || "").toLowerCase() === "admin";

  const readValue = (item, keys) => {
    for (const key of keys) {
      const value = item?.[key];
      if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
    }
    return "";
  };
  const machineRows = useMemo(() => machines.data.map(item => ({
    id: item.id,
    category: readValue(item, ["Kategori", "kategori", "kategoriMesin", "kategori_mesin", "category"]) || "Mesin",
    type: readValue(item, ["Jenis", "jenis", "jenisMesin", "jenis_mesin", "type"]),
    name: readValue(item, ["Nama", "nama", "namaMesin", "nama_mesin", "mesin"])
  })).filter(item => item.type && item.name), [machines.data]);
  const machineCategory = section === "Bengkel" ? "Armada" : "Mesin";
  const categoryMachines = useMemo(
    () => machineRows.filter(item => item.category.localeCompare(machineCategory, "id-ID", { sensitivity: "accent" }) === 0),
    [machineRows, machineCategory]
  );
  const machineTypes = useMemo(
    () => [...new Set(categoryMachines.map(item => item.type))].sort((a, b) => a.localeCompare(b, "id-ID")),
    [categoryMachines]
  );
  const machineNames = useMemo(
    () => categoryMachines.filter(item => item.type === machineType).map(item => item.name)
      .filter((value, index, array) => array.indexOf(value) === index)
      .sort((a, b) => a.localeCompare(b, "id-ID")),
    [categoryMachines, machineType]
  );

  const partRows = useMemo(() => partsRemote.data.map((item, index) => ({
    id: item.id || `part-${index}`,
    category: Array.isArray(item) ? String(item[0] || "").trim() : readValue(item, ["Kategori", "kategori"]),
    name: Array.isArray(item) ? String(item[1] || "").trim() : readValue(item, ["Nama", "nama"]),
    size: Array.isArray(item) ? String(item[2] || "").trim() : readValue(item, ["Ukuran", "ukuran"]),
    componentType: Array.isArray(item) ? String(item[3] || "").trim() : readValue(item, ["Jenis Komponen", "jenisKomponen", "jenis_komponen"])
  })).filter(item => item.name && !(
    item.category.toLocaleLowerCase("id-ID") === "kategori" &&
    item.name.toLocaleLowerCase("id-ID") === "nama"
  )), [partsRemote.data]);
  const normalizePartSearch = value => String(value || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("id-ID").replace(/[^a-z0-9]+/g, " ").trim();
  const partMatches = useMemo(() => {
    const query = normalizePartSearch(partSearch);
    if (query.length < 2) return [];
    return partRows
      .filter(item => normalizePartSearch(
        `${item.name} ${item.size} ${item.category} ${item.componentType}`
      ).includes(query))
      .sort((left, right) => {
        const leftStarts = normalizePartSearch(left.name).startsWith(query) ? 0 : 1;
        const rightStarts = normalizePartSearch(right.name).startsWith(query) ? 0 : 1;
        return leftStarts - rightStarts ||
          left.name.localeCompare(right.name, "id-ID") ||
          left.size.localeCompare(right.size, "id-ID");
      })
      .slice(0, 10);
  }, [partRows, partSearch]);
  const partCategories = useMemo(
    () => [...new Set(partRows.map(item => item.category).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, "id-ID")),
    [partRows]
  );
  const partNames = useMemo(
    () => [...new Set(partRows
      .filter(item => item.category === selectedPartCategory)
      .map(item => item.name))]
      .sort((a, b) => a.localeCompare(b, "id-ID")),
    [partRows, selectedPartCategory]
  );
  const partSizes = useMemo(
    () => [...new Set(partRows
      .filter(item => item.category === selectedPartCategory && item.name === selectedPart)
      .map(item => item.size).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, "id-ID")),
    [partRows, selectedPartCategory, selectedPart]
  );
  const selectPartResult = item => {
    setSelectedPartCategory(item.category);
    setSelectedPart(item.name);
    setPartSize(item.size || "");
    if (item.componentType) setWorkComponent(item.componentType);
    setPartSearch(`${item.name}${item.size ? ` · ${item.size}` : ""}`);
    setPartSearchOpen(false);
  };

  const totalHours = useMemo(() => {
    if (!startDate || !startTime || !endDate || !endTime) return "0,00";
    const start = new Date(`${startDate}T${startTime}:00`);
    const end = new Date(`${endDate}T${endTime}:00`);
    const hours = (end.getTime() - start.getTime()) / 3600000;
    return Number.isFinite(hours) && hours >= 0
      ? hours.toLocaleString("id-ID", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : "0,00";
  }, [startDate, startTime, endDate, endTime]);

  const addMasterPart = async data => {
    if (!isAdmin) throw new Error("Hanya Admin yang dapat menambahkan master part.");
    const kategori = String(data.kategori || "").trim();
    const nama = String(data.nama || "").trim();
    const ukuran = String(data.ukuran || "").trim();
    const jenisKomponen = String(data.jenisKomponen || "").trim();
    const satuan = String(data.satuan || "Pcs").trim() || "Pcs";
    const stokAwal = Number(String(data.stokAwal ?? "0").replace(",", "."));
    if (!kategori || !nama || !ukuran) throw new Error("Kategori, nama, dan ukuran part wajib diisi.");
    if (!Number.isFinite(stokAwal) || stokAwal < 0) throw new Error("Stok awal harus berupa angka nol atau lebih.");
    const stockResult = await apiPost(ENDPOINTS.jobs, {
      action: "addMasterPart", token: session.token, kategori, nama, ukuran,
      jenisKomponen, satuan, stokAwal, lokasi: String(data.lokasi || "").trim(),
      photo: data.photo
    }, { timeout: 90000 });
    if (!isSuccess(stockResult)) {
      const unsupported = String(stockResult?.message || "").toLowerCase().includes("tanggal");
      throw new Error(unsupported
        ? "Backend laporan belum mendukung tambah master part. Terapkan LaporanKerja.secure.gs versi terbaru."
        : stockResult?.message || "Part gagal ditambahkan ke database stok.");
    }
    if (stockResult?.stockSynced !== true) {
      throw new Error(
        "Backend belum menambahkan part ke tab Stok. Terapkan LaporanKerja.secure.gs versi 2.8 sebagai deployment baru."
      );
    }
    await partsRemote.reload();
    setSelectedPartCategory(kategori);
    setSelectedPart(nama);
    setPartSize(ukuran);
    if (jenisKomponen) setWorkComponent(jenisKomponen);
    setPartSearch(`${nama} · ${ukuran}`);
    setShowAddPart(false);
    notify(stockResult?.message || "Master part berhasil disimpan ke Neon.");
  };

  const submit = async (data) => {
    const mappedSection = data.bagian === "Teknik A"
      ? "Tek. Shift A"
      : data.bagian === "Teknik B"
        ? "Tek. Shift B"
        : data.bagian;
    const payload = {
      token: session?.token || "",
      tanggal: toIdDate(data.tanggal), bagian: mappedSection, kategoriMesin: data.kategoriMesin,
      jenis: data.jenis, namaMesin: data.namaMesin, jenisPekerjaan: data.jenisPekerjaan,
      laporan: data.laporan, jenisKomponen: data.jenisKomponen,
      jamMulai: `${toIdDate(data.tglMulai)} ${data.jamMulai}`, jamSelesai: `${toIdDate(data.tglSelesai)} ${data.jamSelesai}`,
      totalJam: data.totalJam, definisi: data.definisi || "", sparepart: data.sparepart,
      ukuranPart: data.ukuranPart || "", order: data.order || "Tanpa Order", statusOrder: data.statusOrder || "",
      nilaiPerbaikan: data.nilaiPerbaikan, keterangan: data.keterangan,
      isNewMachine: false, isNewPart: false, partKategori: data.partKategori || "",
      partNama: data.sparepart, partUkuran: data.ukuranPart || ""
    };
    const result = await apiPost(ENDPOINTS.jobs, payload);
    if (!isSuccess(result)) throw new Error(result.message || "Laporan gagal disimpan.");
    notify("Laporan kerja berhasil disimpan dan tersinkron.");
    go("jobs");
  };
  return <><FormPanel title="Dokumentasi pekerjaan" onSubmit={submit} submit="Simpan laporan">
    <div className="form-section-title wide"><span>01</span><div><b>Identitas pekerjaan</b><small>Mesin dan aset mengikuti master data Android.</small></div></div>
    <Field label="Tanggal laporan"><input name="tanggal" type="date" lang="id-ID" defaultValue={today} required /></Field>
    <ChoiceField label="Bagian pekerjaan" wide>
      <ChoiceCards name="bagian" value={section} required columns={3}
        options={["Teknik", "Teknik A", "Teknik B", "Umum", "Bengkel", "Konstruksi"]}
        onChange={value => {
          setSection(value);
          setMachineType("");
          setMachineName("");
        }} />
    </ChoiceField>
    <Field label="Kategori perangkat">
      <input name="kategoriMesin" value={section ? machineCategory : ""} placeholder="Otomatis dari bagian" readOnly required />
    </Field>
    <Field label={`Jenis ${machineCategory.toLowerCase()}`}>
      <select name="jenis" value={machineType} onChange={event => {
        setMachineType(event.target.value);
        setMachineName("");
      }} disabled={!section || machines.loading} required>
        <option value="">{machines.loading ? "Memuat master mesin…" : `Pilih jenis ${machineCategory.toLowerCase()}`}</option>
        {machineTypes.map(value => <option key={value}>{value}</option>)}
      </select>
    </Field>
    <Field label={`Nama ${machineCategory.toLowerCase()}`}>
      <select name="namaMesin" value={machineName} onChange={event => setMachineName(event.target.value)} disabled={!machineType || machines.loading} required>
        <option value="">{machineType ? `Pilih nama ${machineCategory.toLowerCase()}` : "Pilih jenis terlebih dahulu"}</option>
        {machineNames.map(value => <option key={value}>{value}</option>)}
      </select>
      {machines.error && <small className="field-help error">Master mesin gagal dimuat: {machines.error}</small>}
    </Field>

    <div className="form-section-title wide"><span>02</span><div><b>Detail pekerjaan</b><small>Klasifikasi sama dengan formulir Android.</small></div></div>
    <ChoiceField label="Jenis pekerjaan" wide>
      <ChoiceCards name="jenisPekerjaan" required columns={3}
        options={["Perbaikan", "Pemeriksaan", "Pemasangan", "Pemindahan", "Pembuatan", "Setting"]} />
    </ChoiceField>
    <ChoiceField label="Jenis komponen" wide>
      <ChoiceCards name="jenisKomponen" value={workComponent} required columns={3}
        onChange={setWorkComponent}
        options={[...new Set([workComponent, "Mekanikal", "Elektrikal", "Konstruksi"].filter(Boolean))]} />
    </ChoiceField>
    <Field label="Laporan pekerjaan" wide><textarea name="laporan" placeholder="Uraikan pekerjaan yang dilakukan…" required /></Field>

    <div className="form-section-title wide"><span>03</span><div><b>Waktu dan durasi</b><small>Total jam dihitung otomatis.</small></div></div>
    <Field label="Tanggal mulai"><input name="tglMulai" type="date" lang="id-ID" value={startDate} onChange={event => setStartDate(event.target.value)} required /></Field>
    <Field label="Jam mulai"><input name="jamMulai" type="time" value={startTime} onChange={event => setStartTime(event.target.value)} required /></Field>
    <Field label="Tanggal selesai"><input name="tglSelesai" type="date" lang="id-ID" value={endDate} onChange={event => setEndDate(event.target.value)} required /></Field>
    <Field label="Jam selesai"><input name="jamSelesai" type="time" value={endTime} onChange={event => setEndTime(event.target.value)} required /></Field>
    <Field label="Total durasi">
      <div className="calculated-field"><Clock3 size={17} /><b>{totalHours} jam</b></div>
      <input name="totalJam" type="hidden" value={totalHours} />
    </Field>
    <ChoiceField label="Definisi pekerjaan" wide>
      <ChoiceCards name="definisi" defaultValue="" columns={4}
        options={[{ value: "", label: "Tidak ada" }, "Tunggu Part", "Overhaul", "Kirim Luar"]} />
    </ChoiceField>

    <div className="form-section-title wide"><span>04</span><div><b>Material dan hasil</b><small>Cari nama atau kode part terlebih dahulu agar tidak membuat master ganda.</small></div></div>
    <Field label="Cari nama / kode spare part" wide>
      <div className="part-lookup">
        <Search size={17} />
        <input
          type="search"
          value={partSearch}
          onFocus={() => setPartSearchOpen(true)}
          onBlur={() => setTimeout(() => setPartSearchOpen(false), 150)}
          onChange={event => {
            setPartSearch(event.target.value);
            setPartSearchOpen(true);
          }}
          placeholder="Ketik minimal 2 huruf, contoh: carbon brush atau 20 x 32"
          autoComplete="off"
        />
        {partSearch && <button type="button" className="part-lookup-clear" onClick={() => {
          setPartSearch("");
          setPartSearchOpen(false);
        }} aria-label="Hapus pencarian"><X size={15} /></button>}
        {partSearchOpen && normalizePartSearch(partSearch).length >= 2 &&
          <div className="part-lookup-results">
            {partsRemote.loading
              ? <div className="part-lookup-state"><span className="spinner dark" />Mencari master part…</div>
              : partMatches.length
                ? <>
                  <small>{partMatches.length} hasil terdekat</small>
                  {partMatches.map((item, index) => <button
                    type="button"
                    key={`${item.id || item.name}-${item.size}-${index}`}
                    onMouseDown={event => event.preventDefault()}
                    onClick={() => selectPartResult(item)}
                  >
                    <span><b>{item.name}</b><em>{item.size || "Tanpa ukuran"}</em></span>
                    <span><i>{item.category || "Tanpa kategori"}</i><i>{item.componentType || "Jenis belum diisi"}</i></span>
                    <Check size={15} />
                  </button>)}
                </>
                : <div className="part-lookup-empty">
                  <b>Part tidak ditemukan</b>
                  <span>Periksa ejaan atau cari menggunakan ukuran/kode.</span>
                  {isAdmin
                    ? <button type="button" onMouseDown={event => event.preventDefault()} onClick={() => {
                      setPartSearchOpen(false);
                      setShowAddPart(true);
                    }}><Plus size={14} /> Buat master part baru</button>
                    : <small>Hubungi Admin jika part memang belum terdaftar.</small>}
                </div>
            }
          </div>}
      </div>
      <small className="field-help">Memilih hasil pencarian akan mengisi kategori, nama, ukuran, dan jenis komponen secara otomatis.</small>
    </Field>
    <Field label="Kategori part">
      <select value={selectedPartCategory} onChange={event => {
        const value = event.target.value;
        setSelectedPartCategory(value);
        setSelectedPart(value === "Tidak Pakai" ? "Tidak Pakai" : "");
        setPartSize("");
        setPartSearch("");
      }} disabled={partsRemote.loading} required>
        <option>Tidak Pakai</option>
        {partCategories.map(value => <option key={value}>{value}</option>)}
      </select>
      <input name="partKategori" type="hidden" value={selectedPartCategory === "Tidak Pakai" ? "" : selectedPartCategory} />
      {partsRemote.error && <small className="field-help error">Master part gagal dimuat: {partsRemote.error}</small>}
      {isAdmin && <button type="button" className="field-add-button" onClick={() => setShowAddPart(true)}><Search size={14} /> Cari ulang atau tambahkan master</button>}
    </Field>
    <Field label="Spare part dipakai">
      <select name="sparepart" value={selectedPart} onChange={event => {
        const value = event.target.value;
        setSelectedPart(value);
        setPartSize("");
        setPartSearch("");
        const matched = partRows.find(item =>
          item.category === selectedPartCategory && item.name === value
        );
        if (matched?.componentType) setWorkComponent(matched.componentType);
      }} disabled={partsRemote.loading} required>
        <option value="">{selectedPartCategory === "Tidak Pakai" ? "Tidak menggunakan part" : "Pilih spare part"}</option>
        {selectedPartCategory === "Tidak Pakai" && <option value="Tidak Pakai">Tidak Pakai</option>}
        {partNames.map(value => <option key={value}>{value}</option>)}
      </select>
    </Field>
    <Field label="Kode / jenis / ukuran part">
      <select name="ukuranPart" value={partSize} onChange={event => {
        const value = event.target.value;
        setPartSize(value);
        const matched = partRows.find(item =>
          item.category === selectedPartCategory && item.name === selectedPart && item.size === value
        );
        if (matched?.componentType) setWorkComponent(matched.componentType);
      }} disabled={selectedPartCategory === "Tidak Pakai" || !selectedPart} required={selectedPartCategory !== "Tidak Pakai" && partSizes.length > 0}>
        <option value="">{selectedPartCategory === "Tidak Pakai" ? "Tidak menggunakan part" : !selectedPart ? "Pilih spare part terlebih dahulu" : partSizes.length ? "Pilih ukuran part" : "Tidak ada ukuran pada master"}</option>
        {partSizes.map(value => <option key={value}>{value}</option>)}
      </select>
    </Field>
    <ChoiceField label="Nilai perbaikan">
      <ChoiceCards name="nilaiPerbaikan" required columns={3}
        options={["Bagus", "Cukup", "Tidak Bagus"]} />
    </ChoiceField>

    <div className="form-section-title wide"><span>05</span><div><b>Status dan order</b><small>Status akhir laporan serta kebutuhan pemesanan.</small></div></div>
    <ChoiceField label="Order spare part">
      <ChoiceCards name="order" defaultValue="Tanpa Order" columns={2}
        options={[{ value: "Tanpa Order", label: "Tanpa Order" }, { value: "Order", label: "Pakai Order" }]} />
    </ChoiceField>
    <ChoiceField label="Status pekerjaan">
      <ChoiceCards name="statusOrder" required columns={2}
        options={[{ value: "Open", label: "Masih open" }, { value: "Close", label: "Selesai / close" }]} />
    </ChoiceField>
    <Field label="Keterangan" wide><textarea name="keterangan" placeholder="Catatan tambahan…" /></Field>
  </FormPanel>
    {showAddPart && <AddMasterPartModal
      existingCategories={partCategories}
      existingParts={partRows}
      initialQuery={partSearch}
      onClose={() => setShowAddPart(false)}
      onSelectExisting={item => {
        selectPartResult(item);
        setShowAddPart(false);
      }}
      onSave={addMasterPart}
    />}</>;
}

function AddMasterPartModal({
  existingCategories, existingParts, initialQuery, onClose, onSelectExisting, onSave
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [lookup, setLookup] = useState(initialQuery || "");
  const [creating, setCreating] = useState(false);
  const [syncExisting, setSyncExisting] = useState(false);
  const [categoryChoice, setCategoryChoice] = useState("");
  const [newCategory, setNewCategory] = useState("");
  const [partName, setPartName] = useState("");
  const [partSize, setPartSize] = useState("");
  const [componentType, setComponentType] = useState("");
  const [photo, setPhoto] = useState(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState("");
  const photoInputRef = useRef(null);
  const photoCameraRef = useRef(null);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === "Escape" && !saving) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, saving]);

  const resolvedCategory = categoryChoice === "__new__" ? newCategory.trim() : categoryChoice;
  const normalize = value => String(value || "").normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("id-ID")
    .replace(/[^a-z0-9]+/g, " ").trim();
  const matches = useMemo(() => {
    const query = normalize(lookup);
    if (query.length < 2) return [];
    return existingParts.filter(item => normalize(
      `${item.name} ${item.size} ${item.category} ${item.componentType}`
    ).includes(query)).sort((left, right) => {
      const leftStarts = normalize(left.name).startsWith(query) ? 0 : 1;
      const rightStarts = normalize(right.name).startsWith(query) ? 0 : 1;
      return leftStarts - rightStarts ||
        left.name.localeCompare(right.name, "id-ID") ||
        left.size.localeCompare(right.size, "id-ID");
    }).slice(0, 8);
  }, [existingParts, lookup]);
  const beginNew = (seed, asSync = false) => {
    setCreating(true);
    setSyncExisting(asSync);
    setError("");
    setCategoryChoice(seed?.category || "");
    setNewCategory("");
    setPartName(seed?.name || lookup.trim());
    setPartSize(asSync ? (seed?.size || "") : "");
    setComponentType(seed?.componentType || "");
  };
  const submit = async event => {
    event.preventDefault();
    if (!creating) {
      setError("Cari master part terlebih dahulu. Form data baru hanya dibuka jika part atau variannya belum tersedia.");
      return;
    }
    if (photoBusy) { setError("Tunggu kompresi foto selesai."); return; }
    setSaving(true); setError("");
    try { await onSave({ ...Object.fromEntries(new FormData(event.currentTarget).entries()), photo }); }
    catch (err) { setError(err?.message || "Master part gagal disimpan."); }
    finally { setSaving(false); }
  };
  const processPhoto = async file => {
    if (!file) return;
    setPhotoBusy(true); setPhotoError("");
    try { setPhoto(await prepareBonImage(file, { scanMode: false, targetBytes: 260 * 1024, maxDimension: 1200, aspectRatio: 3 / 4 })); }
    catch (error) { setPhoto(null); setPhotoError(error?.message || "Foto referensi gagal diproses."); }
    finally { setPhotoBusy(false); }
  };
  return <div className="modal-overlay add-part-overlay" onMouseDown={event => { if (event.target === event.currentTarget && !saving) onClose(); }}>
    <form className="modal-card add-part-modal" onSubmit={submit}>
      <div className="modal-head"><div><p className="eyebrow">Admin master data</p><h3>Cari atau tambah spare part</h3><small>Pastikan part belum tersedia sebelum membuat data baru.</small></div><button type="button" disabled={saving} onClick={onClose} title="Kembali ke Stok Part"><X size={18} /></button></div>
      <div className="master-part-search">
        <Search size={17} />
        <input type="search" value={lookup} onChange={event => {
          setLookup(event.target.value);
          setCreating(false);
          setSyncExisting(false);
          setError("");
        }} placeholder="Cari nama, ukuran, kode, atau kategori…" autoFocus />
      </div>
      {normalize(lookup).length < 2
        ? <div className="master-part-guidance"><Search size={22} /><div><b>Cari master part dahulu</b><span>Ketik minimal 2 huruf untuk memeriksa data yang sudah tersedia.</span></div></div>
        : matches.length
          ? <div className="master-part-matches">
            <div><b>Part serupa ditemukan</b><span>Pilih data yang sesuai, tambah varian ukuran, atau buat part baru jika hasil tersebut berbeda.</span></div>
            {matches.map((item, index) => <button type="button" key={`${item.id || item.name}-${item.size}-${index}`} onClick={() => onSelectExisting(item)}>
              {item.photoUrl ? <img src={item.photoUrl} alt="" className="master-part-match-thumb" /> : <span className="master-part-match-placeholder"><Package size={14} /></span>}
              <span><b>{item.name}</b><small>{item.size || "Tanpa ukuran"}</small></span>
              <span><em>{item.category || "Tanpa kategori"}</em><em>{item.componentType || "Jenis belum diisi"}</em></span>
              <CheckCircle2 size={17} />
            </button>)}
            {!creating && <>
              <button type="button" className="master-part-variant" onClick={() => beginNew(matches[0], false)}><Plus size={15} /> Nama sudah ada, tetapi ukuran/kode berbeda</button>
              <button type="button" className="master-part-variant" onClick={() => beginNew(null, false)}><Plus size={15} /> Hasil tidak sesuai — buat spare part baru</button>
              <button type="button" className="master-part-variant master-part-sync" onClick={() => beginNew(matches[0], true)}><Database size={15} /> Sinkronkan hasil teratas ke tab Stok</button>
            </>}
          </div>
          : <div className="master-part-not-found">
            <AlertTriangle size={18} /><div><b>Tidak ditemukan pada master</b><span>Pastikan ejaan sudah benar sebelum membuat data baru.</span></div>
            {!creating && <button type="button" onClick={() => beginNew(null, false)}><Plus size={15} /> Buat data baru</button>}
          </div>
      }
      {creating && <div className="master-part-new-form">
        <div className="master-part-new-title"><span>{syncExisting ? "Sinkronisasi" : "Data baru"}</span><b>{syncExisting ? "Pastikan stok awal dan satuan sudah benar" : "Lengkapi identitas sparepart"}</b></div>
        <div className="form-grid">
          <input name="syncExisting" type="hidden" value={syncExisting ? "true" : ""} />
          <Field label="Kategori part">
            <select value={categoryChoice} onChange={event => { setCategoryChoice(event.target.value); setNewCategory(""); }} required>
              <option value="">Pilih kategori</option>
              {existingCategories.map(value => <option value={value} key={value}>{value}</option>)}
              <option value="__new__">+ Tambah kategori baru</option>
            </select>
            <input name="kategori" type="hidden" value={resolvedCategory} />
            {categoryChoice === "__new__" && <input className="nested-new-input" value={newCategory} onChange={event => setNewCategory(event.target.value)} placeholder="Nama kategori baru" required />}
          </Field>
          <Field label="Nama spare part"><input name="nama" value={partName} onChange={event => setPartName(event.target.value)} placeholder="Nama spare part" required /></Field>
          <Field label="Ukuran / kode"><input name="ukuran" value={partSize} onChange={event => setPartSize(event.target.value)} placeholder="Ukuran, tipe, atau kode" required /></Field>
          <Field label="Jenis komponen"><select name="jenisKomponen" value={componentType} onChange={event => setComponentType(event.target.value)}><option value="">Tidak ditentukan</option>{componentType && !["Mekanikal", "Elektrikal", "Konstruksi"].includes(componentType) && <option>{componentType}</option>}<option>Mekanikal</option><option>Elektrikal</option><option>Konstruksi</option></select></Field>
          <Field label="Stok awal"><input name="stokAwal" type="number" min="0" step="any" defaultValue="0" required /></Field>
          <Field label="Lokasi penyimpanan"><input name="lokasi" placeholder="Contoh: Gudang utama - Rak A-03" /></Field>
          <Field label="Satuan">
            <input name="satuan" list="master-part-units" defaultValue="Pcs" placeholder="Contoh: Pcs" required />
            <datalist id="master-part-units">
              {["Pcs", "Unit", "Set", "Meter", "Liter", "Kg", "Batang", "Roll", "Tabung"].map(value => <option value={value} key={value} />)}
            </datalist>
          </Field>
          <div className={`master-part-photo wide ${photo ? "has-photo" : ""}`}>
            {photo ? <><img src={photo.dataUrl} alt="Pratinjau foto referensi part" /><div><b>Foto referensi siap</b><small>{photo.width} × {photo.height} px (3:4) · {formatImageBytes(photo.bytes)} · hemat {Math.max(0, photo.compressionRatio)}%</small></div><div><button type="button" className="secondary small" onClick={() => photoInputRef.current?.click()}><Upload size={14} />Ganti</button><button type="button" className="secondary small" onClick={() => photoCameraRef.current?.click()}><Camera size={14} />Kamera</button><button type="button" className="secondary small danger-button" onClick={() => { setPhoto(null); setPhotoError(""); }}><Trash2 size={14} />Hapus</button></div></> : <><span><ImagePlus size={19} /></span><div><b>Foto referensi part (Rasio 3:4) <em>Opsional</em></b><small>Memudahkan pengguna mengenali bentuk barang di inventori.</small></div><div className="button-row"><button type="button" className="secondary small" disabled={photoBusy} onClick={() => photoInputRef.current?.click()}>{photoBusy ? <><span className="spinner dark" />Memproses</> : <><Upload size={14} />Upload foto</>}</button><button type="button" className="secondary small" disabled={photoBusy} onClick={() => photoCameraRef.current?.click()}>{photoBusy ? <><span className="spinner dark" />Memproses</> : <><Camera size={14} />Ambil foto</>}</button></div></>}
            <input ref={photoInputRef} className="cosphi-file-input" type="file" accept="image/*" onChange={async event => { const input = event.currentTarget; await processPhoto(input.files?.[0]); input.value = ""; }} />
            <input ref={photoCameraRef} className="cosphi-file-input" type="file" accept="image/*" capture="environment" onChange={async event => { const input = event.currentTarget; await processPhoto(input.files?.[0]); input.value = ""; }} />
          </div>
        </div>
      </div>}
      {photoError && <div className="remote-error"><AlertTriangle size={16} /><span>{photoError}</span></div>}
      {error && <div className="remote-error"><AlertTriangle size={16} /><span>{error}</span></div>}
      <p className="sensitive-data-note"><ShieldCheck size={15} /> Aksi ini hanya diproses setelah token sesi Admin diverifikasi backend.</p>
      <div className="modal-actions">
        <button type="button" className="secondary" disabled={saving} onClick={onClose}><ArrowLeft size={16} /> Kembali ke Stok Part</button>
        {creating && <>
          <button type="button" className="secondary" disabled={saving} onClick={() => { setCreating(false); setError(""); }}><Search size={16} /> Cari Part Lain</button>
          <button className="primary" disabled={saving}>{saving ? <><span className="spinner" />Menyimpan…</> : syncExisting ? <><Database size={16} />Sinkronkan part</> : <><Plus size={16} />Tambahkan part</>}</button>
        </>}
      </div>
    </form>
  </div>;
}

function StockPartDetailModal({ part, isAdmin, categories, onClose, onSave, onSavePhoto, onRemovePhoto }) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState("");
  const [cameraOpen, setCameraOpen] = useState(false);
  const photoInputRef = useRef(null);
  const [form, setForm] = useState({ kategori: part.kategori || "", nama: part.nama || "", ukuran: part.ukuran || "", jenisKomponen: part.jenisKomponen || "", satuan: part.satuan || "Pcs", lokasi: part.lokasi || "", stok: part.stok ?? 0 });
  useEffect(() => { setEditing(false); setError(""); setForm({ kategori: part.kategori || "", nama: part.nama || "", ukuran: part.ukuran || "", jenisKomponen: part.jenisKomponen || "", satuan: part.satuan || "Pcs", lokasi: part.lokasi || "", stok: part.stok ?? 0 }); }, [part.partId, part.id, part.stok]);
  const update = event => setForm(current => ({ ...current, [event.target.name]: event.target.value }));
  const submit = async event => {
    event.preventDefault(); setSaving(true); setError("");
    const stokVal = Number(String(form.stok ?? "0").replace(",", "."));
    if (!Number.isFinite(stokVal) || stokVal < 0) {
      setError("Jumlah stok harus berupa angka 0 atau lebih.");
      setSaving(false);
      return;
    }
    try { await onSave({ ...form, stok: stokVal, stokAwal: stokVal, partId: part.partId || part.id }); }
    catch (err) { setError(err?.message || "Detail part gagal diperbarui."); setSaving(false); }
  };
  const quantity = value => Number(value || 0).toLocaleString("id-ID", { maximumFractionDigits: 3 });
  const low = Number(part.stok || 0) < 10;
  const uploadPhoto = async fileOrDataUrl => {
    if (!fileOrDataUrl || photoBusy) return;
    setPhotoBusy(true); setPhotoError("");
    try {
      const photo = await prepareBonImage(fileOrDataUrl, { scanMode: false, targetBytes: 260 * 1024, maxDimension: 1200, aspectRatio: 3 / 4 });
      await onSavePhoto(part.partId || part.id, photo);
    }
    catch (err) { setPhotoError(err?.message || "Foto referensi part gagal disimpan."); }
    finally { setPhotoBusy(false); }
  };
  const removePhoto = async () => {
    if (photoBusy) return;
    setPhotoBusy(true); setPhotoError("");
    try { await onRemovePhoto(part.partId || part.id); }
    catch (err) { setPhotoError(err?.message || "Foto referensi part gagal dihapus."); }
    finally { setPhotoBusy(false); }
  };
  return <div className="modal-overlay stock-part-detail-overlay" onMouseDown={event => { if (event.target === event.currentTarget && !saving) onClose(); }}>
    <form className="modal-card stock-part-detail-modal" onSubmit={submit}>
      <div className="modal-head"><div><p className="eyebrow">Detail inventori</p><h3>{part.nama || "Spare part"}</h3><small>{[part.kategori, part.ukuran].filter(Boolean).join(" · ") || "Tanpa rincian"}</small></div><button type="button" disabled={saving} onClick={onClose} aria-label="Tutup detail part"><X size={18} /></button></div>
      <div className={`stock-part-detail-hero ${low ? "warning" : "safe"}`}><span><Package size={24} /></span><div><small>Stok tersedia</small><strong>{quantity(part.stok)} <em>{part.satuan || ""}</em></strong><p>{low ? "Stok di bawah batas perhatian 10" : "Saldo inventori dalam batas"}</p></div><Badge text={low ? "Perlu perhatian" : "Tersedia"} /></div>
      <section className={`stock-part-photo ${part.photoUrl ? "has-photo" : ""}`}>
        {part.photoUrl ? (
          <a href={part.photoUrl} target="_blank" rel="noreferrer" className="stock-part-photo-link" title="Buka foto referensi ukuran penuh">
            <img src={part.photoUrl} alt={`Foto referensi ${part.nama}`} />
            <span className="stock-part-photo-label"><ImagePlus size={14} />Buka foto referensi</span>
          </a>
        ) : (
          <div className="stock-part-photo-empty">
            <span className="stock-part-photo-empty-icon"><ImagePlus size={20} /></span>
            <div><b>Belum ada foto referensi</b><small>Tambahkan foto agar pengguna mudah mengenali bentuk barang.</small></div>
          </div>
        )}
        {isAdmin && (
          <aside className="stock-part-photo-actions">
            <button type="button" className="secondary small" disabled={photoBusy} onClick={() => photoInputRef.current?.click()} title="Pilih foto dari galeri">
              {photoBusy ? <><span className="spinner dark" />Memproses</> : <><Upload size={14} />{part.photoUrl ? "Ganti foto" : "Upload foto"}</>}
            </button>
            <button type="button" className="secondary small" disabled={photoBusy} onClick={() => setCameraOpen(true)} title="Ambil foto dari kamera">
              {photoBusy ? <><span className="spinner dark" />Memproses</> : <><Camera size={14} />Ambil foto</>}
            </button>
            {part.photoUrl && <button type="button" className="secondary small danger-button" disabled={photoBusy} onClick={removePhoto} title="Hapus foto referensi"><Trash2 size={14} />Hapus</button>}
          </aside>
        )}
        <input ref={photoInputRef} className="cosphi-file-input" type="file" accept="image/*" onChange={async event => { const input = event.currentTarget; await uploadPhoto(input.files?.[0]); input.value = ""; }} />
      </section>
      {cameraOpen && <StockPhotoCameraModal open={cameraOpen} onClose={() => setCameraOpen(false)} onCapture={uploadPhoto} />}
      {!editing ? <div className="stock-part-detail-grid">
        <div><small>Kategori</small><b>{part.kategori || "-"}</b></div><div><small>Nama part</small><b>{part.nama || "-"}</b></div><div><small>Ukuran / jenis</small><b>{part.ukuran || "-"}</b></div><div><small>Lokasi</small><b>{part.lokasi || "Belum diisi"}</b></div><div><small>Jenis komponen</small><b>{part.jenisKomponen || "Belum ditentukan"}</b></div><div><small>Total masuk</small><b>{quantity(part.masuk)} {part.satuan || ""}</b></div><div><small>Total keluar</small><b>{quantity(part.keluar)} {part.satuan || ""}</b></div>
      </div> : <div className="stock-part-edit-form">
        <label><span>Kategori</span><input name="kategori" value={form.kategori} onChange={update} list="stock-detail-categories" required /><datalist id="stock-detail-categories">{categories.map(value => <option value={value} key={value} />)}</datalist></label>
        <label><span>Nama part</span><input name="nama" value={form.nama} onChange={update} required /></label>
        <label><span>Ukuran / jenis</span><input name="ukuran" value={form.ukuran} onChange={update} required /></label>
        <label><span>Jenis komponen</span><select name="jenisKomponen" value={form.jenisKomponen} onChange={update}><option value="">Belum ditentukan</option>{form.jenisKomponen && !['Mekanikal', 'Elektrikal', 'Konstruksi'].includes(form.jenisKomponen) && <option>{form.jenisKomponen}</option>}<option>Mekanikal</option><option>Elektrikal</option><option>Konstruksi</option></select></label>
        <label><span>Satuan</span><input name="satuan" value={form.satuan} onChange={update} list="stock-detail-units" required /><datalist id="stock-detail-units">{["Pcs", "Unit", "Set", "Meter", "Liter", "Kg", "Batang", "Roll", "Tabung"].map(value => <option value={value} key={value} />)}</datalist></label>
        <label><span>Lokasi penyimpanan</span><input name="lokasi" value={form.lokasi} onChange={update} placeholder="Contoh: Gudang utama - Rak A-03" /></label>
        <label><span>Stok barang (saldo)</span><input name="stok" type="number" min="0" step="any" value={form.stok} onChange={update} required /><small>Admin dapat menyesuaikan jumlah stok barang secara langsung.</small></label>
      </div>}
      {error && <div className="remote-error"><AlertTriangle size={16} /><span>{error}</span></div>}
      {photoError && <div className="remote-error"><AlertTriangle size={16} /><span>{photoError}</span></div>}
      <div className="stock-part-detail-note"><ShieldCheck size={16} /><span><b>{isAdmin ? "Perubahan master tersinkron" : "Akses lihat detail"}</b><small>{isAdmin ? "Kategori, nama, ukuran, jenis komponen, stok, dan satuan diperbarui pada master serta saldo aktif." : "Hanya Admin yang dapat mengubah identitas spare part."}</small></span></div>
      <div className="modal-actions"><button type="button" className="secondary" disabled={saving} onClick={editing ? () => { setEditing(false); setError(""); } : onClose}>{editing ? "Batal edit" : "Tutup"}</button>{isAdmin && !editing && <button type="button" className="primary" disabled={!part.partId && !part.id} onClick={() => setEditing(true)}><Edit3 size={16} />Edit part</button>}{isAdmin && editing && <button type="submit" className="primary" disabled={saving}>{saving ? <><span className="spinner" />Menyimpan…</> : <><Check size={16} />Simpan perubahan</>}</button>}</div>
    </form>
  </div>;
}

const partPhotoFeatureCache = new Map();

function rgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  const s = max === 0 ? 0 : d / max;
  const v = max;
  if (max !== min) {
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }
  return [h, s, v];
}

function extractCanvasFeatures(canvas) {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;

  // 1. Dual-direction dHash (17x16 for X and 16x17 for Y = 512 structural bits)
  const hashCanvas = document.createElement("canvas");
  hashCanvas.width = 17;
  hashCanvas.height = 17;
  const hCtx = hashCanvas.getContext("2d", { willReadFrequently: true });
  hCtx.drawImage(canvas, 0, 0, 17, 17);
  const hData = hCtx.getImageData(0, 0, 17, 17).data;

  const grays = new Float32Array(17 * 17);
  for (let i = 0, p = 0; i < grays.length; i++, p += 4) {
    grays[i] = 0.299 * hData[p] + 0.587 * hData[p + 1] + 0.114 * hData[p + 2];
  }

  let hashX = "";
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      hashX += grays[y * 17 + x] < grays[y * 17 + x + 1] ? "1" : "0";
    }
  }

  let hashY = "";
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      hashY += grays[y * 17 + x] < grays[(y + 1) * 17 + x] ? "1" : "0";
    }
  }

  // 2. HSV Color Histogram (32x32 sample with center-weighting)
  const colorCanvas = document.createElement("canvas");
  colorCanvas.width = 32;
  colorCanvas.height = 32;
  const cCtx = colorCanvas.getContext("2d", { willReadFrequently: true });
  cCtx.drawImage(canvas, 0, 0, 32, 32);
  const cData = cCtx.getImageData(0, 0, 32, 32).data;

  // 12 Hue bins + 4 Neutral/Gray bins
  const colorHist = new Float32Array(16);
  let totalWeight = 0;
  let centerR = 0, centerG = 0, centerB = 0, centerCount = 0;

  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      const idx = (y * 32 + x) * 4;
      const r = cData[idx], g = cData[idx + 1], b = cData[idx + 2];
      const [h, s, v] = rgbToHsv(r, g, b);

      const isCenter = x >= 6 && x <= 25 && y >= 6 && y <= 25;
      const weight = isCenter ? 2.2 : 1.0;
      totalWeight += weight;

      if (isCenter) {
        centerR += r; centerG += g; centerB += b;
        centerCount++;
      }

      if (s < 0.16 || v < 0.14) {
        const grayBin = Math.min(3, Math.floor(v * 4));
        colorHist[12 + grayBin] += weight;
      } else {
        const hueBin = Math.min(11, Math.floor(h * 12));
        colorHist[hueBin] += weight;
      }
    }
  }

  if (totalWeight > 0) {
    for (let i = 0; i < 16; i++) colorHist[i] /= totalWeight;
  }

  const avgCenter = centerCount > 0
    ? [centerR / centerCount, centerG / centerCount, centerB / centerCount]
    : [128, 128, 128];

  return { hashX, hashY, colorHist, avgCenter };
}

function getImageFeatures(url) {
  if (!url) return Promise.resolve(null);
  if (partPhotoFeatureCache.has(url)) return Promise.resolve(partPhotoFeatureCache.get(url));

  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const baseCanvas = document.createElement("canvas");
        baseCanvas.width = 120;
        baseCanvas.height = 160;
        const bCtx = baseCanvas.getContext("2d", { willReadFrequently: true });
        if (!bCtx) return resolve(null);
        bCtx.drawImage(img, 0, 0, 120, 160);

        const fullFeat = extractCanvasFeatures(baseCanvas);

        // Center crop (inner 70% isolating the part)
        const centerCanvas = document.createElement("canvas");
        centerCanvas.width = 120;
        centerCanvas.height = 160;
        const cCtx = centerCanvas.getContext("2d", { willReadFrequently: true });
        cCtx.drawImage(
          baseCanvas,
          Math.round(120 * 0.15), Math.round(160 * 0.15),
          Math.round(120 * 0.70), Math.round(160 * 0.70),
          0, 0, 120, 160
        );
        const centerFeat = extractCanvasFeatures(centerCanvas);

        const feat = { full: fullFeat, center: centerFeat };
        partPhotoFeatureCache.set(url, feat);
        resolve(feat);
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

function matchSingleFeature(f1, f2) {
  if (!f1 || !f2) return 0;

  // 1. Dual dHash similarity (X & Y)
  let diff = 0;
  for (let i = 0; i < 256; i++) {
    if (f1.hashX[i] !== f2.hashX[i]) diff++;
    if (f1.hashY[i] !== f2.hashY[i]) diff++;
  }
  const structSim = Math.max(0, (512 - diff) / 512);

  // 2. Color Histogram intersection
  let histSim = 0;
  for (let i = 0; i < 16; i++) {
    histSim += Math.min(f1.colorHist[i], f2.colorHist[i]);
  }

  // 3. Center RGB Euclidean distance
  const c1 = f1.avgCenter, c2 = f2.avgCenter;
  const dr = c1[0] - c2[0], dg = c1[1] - c2[1], db = c1[2] - c2[2];
  const rgbDist = Math.sqrt(dr * dr + dg * dg + db * db) / 441.67;
  const rgbSim = Math.max(0, 1 - rgbDist);

  return structSim * 0.55 + histSim * 0.35 + rgbSim * 0.10;
}

function compareImageFeatures(feat1, feat2) {
  if (!feat1 || !feat2 || !feat1.full || !feat2.full) return 0;

  const sFull = matchSingleFeature(feat1.full, feat2.full);
  const sCenter = matchSingleFeature(feat1.center, feat2.center);
  const sCross1 = matchSingleFeature(feat1.center, feat2.full);
  const sCross2 = matchSingleFeature(feat1.full, feat2.center);

  // Multi-scale composite score
  const rawScore = Math.max(
    sFull * 0.55 + sCenter * 0.45,
    sCenter * 0.70 + sFull * 0.30,
    sCross1 * 0.88,
    sCross2 * 0.88
  );

  // Calibrate score with high-contrast sigmoid curve so definitive matches stand out
  let calibrated = 0;
  if (rawScore <= 0.44) {
    calibrated = Math.max(0, rawScore * 0.25);
  } else if (rawScore >= 0.78) {
    calibrated = 0.82 + (rawScore - 0.78) * 0.82;
  } else {
    calibrated = 0.11 + ((rawScore - 0.44) / (0.78 - 0.44)) * 0.71;
  }

  return Math.round(Math.min(100, Math.max(0, calibrated * 100)));
}

function StockPhotoCameraModal({ open, onClose, onCapture }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const fileFallbackRef = useRef(null);

  const stopStream = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) videoRef.current.srcObject = null;
  };

  const close = () => {
    stopStream();
    setError("");
    setReady(false);
    onClose();
  };

  useEffect(() => {
    if (!open) {
      stopStream();
      return;
    }
    let cancelled = false;
    const startCam = async () => {
      setError("");
      setReady(false);
      if (!navigator.mediaDevices?.getUserMedia) {
        setError("Browser ini belum mendukung kamera langsung. Silakan gunakan tombol file / galeri di bawah.");
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 960 } },
          audio: false
        });
        if (cancelled) {
          stream.getTracks().forEach(t => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
          setReady(true);
        }
      } catch {
        if (cancelled) return;
        setError("Izin akses kamera belum diberikan. Anda dapat memilih foto dari galeri atau kamera bawaan HP.");
      }
    };
    startCam();
    return () => {
      cancelled = true;
      stopStream();
    };
  }, [open]);

  const snap = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth || !video.videoHeight) return;

    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const targetAspect = 3 / 4;
    let cropW, cropH, startX, startY;

    if (vw / vh > targetAspect) {
      cropH = vh;
      cropW = Math.round(vh * targetAspect);
      startX = Math.round((vw - cropW) / 2);
      startY = 0;
    } else {
      cropW = vw;
      cropH = Math.round(vw / targetAspect);
      startX = 0;
      startY = Math.round((vh - cropH) / 2);
    }

    const outW = Math.min(cropW, 720);
    const outH = Math.round(outW * (4 / 3));

    const canvas = document.createElement("canvas");
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(video, startX, startY, cropW, cropH, 0, 0, outW, outH);

    const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
    close();
    onCapture(dataUrl);
  };

  const handleFallback = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const prepared = await prepareBonImage(file, { scanMode: false, targetBytes: 260 * 1024, maxDimension: 900, aspectRatio: 3 / 4 });
      close();
      onCapture(prepared?.dataUrl);
    } catch {
      setError("Gagal memproses foto dari file.");
    }
    e.target.value = "";
  };

  if (!open) return null;

  return (
    <div className="cosphi-camera-overlay" role="dialog" aria-modal="true" aria-labelledby="stock-camera-title">
      <section className="cosphi-camera-modal" style={{ maxWidth: "480px" }}>
        <header>
          <div>
            <small>Pencarian Visual Part</small>
            <h3 id="stock-camera-title">Arahkan Kamera ke Spare Part</h3>
          </div>
          <button type="button" onClick={close} aria-label="Tutup kamera"><X size={21} /></button>
        </header>
        <div className="cosphi-camera-view visible" style={{ aspectRatio: "3/4" }}>
          <video ref={videoRef} playsInline muted className="visible" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          <div className="cosphi-camera-guide">
            <span style={{ width: "84%", aspectRatio: "3/4", borderRadius: "16px" }} />
            <p>Posisikan spare part tepat di dalam bingkai</p>
          </div>
        </div>
        {error && (
          <div className="cosphi-camera-message">
            <AlertTriangle size={18} />
            <span>{error}</span>
          </div>
        )}
        <footer>
          <button type="button" className="secondary" onClick={() => fileFallbackRef.current?.click()}>
            <Upload size={16} /> File / Galeri
          </button>
          <button type="button" className="primary cosphi-capture" onClick={snap} disabled={!ready}>
            <Camera size={18} /> Ambil Foto
          </button>
          <input ref={fileFallbackRef} type="file" accept="image/*" onChange={handleFallback} style={{ display: "none" }} />
        </footer>
      </section>
    </div>
  );
}

function Stock({ go, session, notify }) {
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("Semua kategori");
  const [resetting, setResetting] = useState(false);
  const [selectedPart, setSelectedPart] = useState(null);
  const [showAddPart, setShowAddPart] = useState(false);
  const [searchPhoto, setSearchPhoto] = useState(null);
  const [photoSearching, setPhotoSearching] = useState(false);
  const [photoScores, setPhotoScores] = useState(new Map());
  const [cameraModalOpen, setCameraModalOpen] = useState(false);
  const photoSearchFileRef = useRef(null);

  const remote = useRemoteData(async () => {
    const [stockResult, masterResult] = await Promise.allSettled([
      apiGet(ENDPOINTS.stock, { action: "getStokPart", bulan: currentIndonesianMonth() }, { cache: false, timeout: 90000 }),
      apiGet(ENDPOINTS.partMaster, { action: "getPart" })
    ]);
    if (stockResult.status === "rejected") throw stockResult.reason;
    const master = masterResult.status === "fulfilled" ? masterResult.value : [];
    const clean = value => String(value || "").trim().toLocaleLowerCase("id-ID").replace(/\s+/g, " ");
    const exact = new Map(), byName = new Map();
    master.forEach(part => {
      const nama = Array.isArray(part) ? part[1] : part.Nama ?? part.nama;
      const ukuran = Array.isArray(part) ? part[2] : part.Ukuran ?? part.ukuran;
      const kategori = Array.isArray(part) ? part[0] : part.Kategori ?? part.kategori;
      if (!nama || !kategori) return;
      exact.set(`${clean(nama)}|${clean(ukuran)}`, String(kategori).trim());
      if (!byName.has(clean(nama))) byName.set(clean(nama), String(kategori).trim());
    });
    return asArray(stockResult.value).map(part => ({
      ...part,
      kategori: part.kategori || part.Kategori || exact.get(`${clean(part.nama)}|${clean(part.ukuran)}`) || byName.get(clean(part.nama)) || "Tanpa kategori"
    }));
  });
  const usageRemote = useRemoteData(async () => asArray(await apiGet(ENDPOINTS.stock, { action: "getUsage" }, { cache: false, timeout: 45000 }))
    .filter(item => item?.nama && Number(item.jumlah) > 0 && item.tanggal)
    .sort((a, b) => {
      const key = value => { const match = String(value || "").match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2}))?/); return match ? `${match[3]}${match[2]}${match[1]}${match[4] || "00"}${match[5] || "00"}` : ""; };
      return key(b.dibuatPada || b.tanggal).localeCompare(key(a.dibuatPada || a.tanggal));
    }));
  const canUseStock = ["admin", "teknik", "gudang"].includes(String(session?.role || "").toLowerCase());
  const isAdmin = String(session?.role || "").toLowerCase() === "admin";
  const categories = useMemo(() => [...new Set(remote.data.map(p => p.kategori).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, "id-ID")), [remote.data]);

  const executePhotoSearch = async (dataUrl) => {
    if (!dataUrl) return;
    setSearchPhoto(dataUrl);
    setPhotoSearching(true);
    try {
      const queryFeat = await getImageFeatures(dataUrl);
      const scores = new Map();
      if (queryFeat && remote.data) {
        const parts = remote.data;
        const BATCH_SIZE = 5;
        for (let i = 0; i < parts.length; i += BATCH_SIZE) {
          const batch = parts.slice(i, i + BATCH_SIZE);
          await Promise.all(
            batch.map(async (part) => {
              const partId = String(part.id || part.partId);
              if (part.photoUrl) {
                try {
                  const partFeat = await getImageFeatures(part.photoUrl);
                  const score = compareImageFeatures(queryFeat, partFeat);
                  scores.set(partId, score);
                } catch {
                  scores.set(partId, 0);
                }
              } else {
                scores.set(partId, 0);
              }
            })
          );
          await new Promise(r => setTimeout(r, 10));
        }
      }
      setPhotoScores(scores);
    } catch (err) {
      console.error("Photo search error:", err);
    } finally {
      setPhotoSearching(false);
    }
  };

  const handlePhotoSearchUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const prepared = await prepareBonImage(file, { scanMode: false, targetBytes: 260 * 1024, maxDimension: 900, aspectRatio: 3 / 4 });
      if (prepared?.dataUrl) {
        await executePhotoSearch(prepared.dataUrl);
      }
    } catch (err) {
      console.error("Photo upload error:", err);
    }
    e.target.value = "";
  };

  const clearPhotoSearch = () => {
    setSearchPhoto(null);
    setPhotoScores(new Map());
  };

  const filtered = useMemo(() => {
    let list = remote.data
      .filter(p => category === "Semua kategori" || p.kategori === category)
      .filter(p => `${p.kategori} ${p.nama} ${p.ukuran}`.toLowerCase().includes(q.toLowerCase()));

    if (searchPhoto) {
      list = [...list].sort((a, b) => {
        const idA = String(a.id || a.partId);
        const idB = String(b.id || b.partId);
        const scoreA = photoScores.get(idA) || 0;
        const scoreB = photoScores.get(idB) || 0;
        if (scoreB !== scoreA) return scoreB - scoreA;
        return a.kategori.localeCompare(b.kategori, "id-ID");
      });
    } else {
      list = [...list].sort((a, b) => a.kategori.localeCompare(b.kategori, "id-ID") || String(a.nama).localeCompare(String(b.nama), "id-ID") || String(a.ukuran).localeCompare(String(b.ukuran), "id-ID"));
    }
    return list;
  }, [remote.data, category, q, searchPhoto, photoScores]);

  const totalStock = remote.data.reduce((n, p) => n + Number(p.stok || 0), 0);
  const low = remote.data.filter(p => Number(p.stok || 0) < 10).length;
  const resetTestTransactions = async () => {
    if (resetting) return;
    const confirmation = window.prompt("Tindakan ini menghapus SEMUA transaksi Bon Pesan, riwayat stok, pemakaian, serta mengubah seluruh saldo stok menjadi 0.\n\nKetik HAPUS DATA UJI COBA untuk melanjutkan:");
    if (confirmation !== "HAPUS DATA UJI COBA") return;
    if (!window.confirm("Konfirmasi terakhir: data transaksi dan jumlah stok tidak dapat dipulihkan. Lanjutkan?")) return;
    setResetting(true);
    try {
      const result = await apiPost(ENDPOINTS.stock, { action: "resetTestTransactions", token: session.token, confirmation }, { timeout: 120000 });
      if (!isSuccess(result) || !result?.data?.balancesReset) throw new Error(result.message || "Data uji coba gagal dihapus.");
      await Promise.all([remote.reload(), usageRemote.reload()]);
      notify(result.message || "Seluruh data uji coba berhasil dihapus.");
    } catch (error) {
      notify(error?.message || "Data uji coba gagal dihapus.");
    } finally { setResetting(false); }
  };
  const updatePart = async data => {
    const result = await apiPost(ENDPOINTS.jobs, { action: "updateMasterPart", token: session.token, ...data }, { timeout: 90000 });
    if (!isSuccess(result)) throw new Error(result?.message || "Detail master part gagal diperbarui.");
    setSelectedPart(null);
    await remote.reload();
    notify(result.message || "Detail master part berhasil diperbarui.");
  };
  const savePartPhoto = async (partId, photo) => {
    const result = await apiPost(ENDPOINTS.jobs, { action: "updateMasterPartPhoto", token: session.token, partId, photo }, { timeout: 90000 });
    if (!isSuccess(result)) throw new Error(result?.message || "Foto referensi part gagal disimpan.");
    setSelectedPart(null); await remote.reload(); notify(result.message || "Foto referensi part berhasil disimpan.");
  };
  const removePartPhoto = async partId => {
    const result = await apiPost(ENDPOINTS.jobs, { action: "removeMasterPartPhoto", token: session.token, partId }, { timeout: 90000 });
    if (!isSuccess(result)) throw new Error(result?.message || "Foto referensi part gagal dihapus.");
    setSelectedPart(null); await remote.reload(); notify(result.message || "Foto referensi part dihapus.");
  };
  const addInventoryPart = async data => {
    const kategori = String(data.kategori || "").trim(), nama = String(data.nama || "").trim();
    const ukuran = String(data.ukuran || "").trim(), satuan = String(data.satuan || "Pcs").trim() || "Pcs";
    const stokAwal = Number(String(data.stokAwal ?? "0").replace(",", "."));
    if (!kategori || !nama || !ukuran) throw new Error("Kategori, nama, dan ukuran part wajib diisi.");
    if (!Number.isFinite(stokAwal) || stokAwal < 0) throw new Error("Stok awal harus nol atau lebih.");
    const result = await apiPost(ENDPOINTS.jobs, { action: "addMasterPart", token: session.token, kategori, nama, ukuran, satuan, stokAwal, lokasi: String(data.lokasi || "").trim(), jenisKomponen: String(data.jenisKomponen || "").trim(), photo: data.photo }, { timeout: 90000 });
    if (!isSuccess(result)) throw new Error(result?.message || "Part gagal ditambahkan ke inventori.");
    setShowAddPart(false);
    await remote.reload();
    notify(result.message || "Part berhasil ditambahkan ke inventori.");
  };

  const tableHeaders = searchPhoto
    ? ["Kategori", "Nama part", "Kecocokan Foto", "Ukuran / jenis", "Lokasi", "Stok", "Satuan"]
    : ["Kategori", "Nama part", "Ukuran / jenis", "Lokasi", "Stok", "Satuan"];

  const tableRows = filtered.map(p => {
    const partId = String(p.id || p.partId);
    const score = photoScores.get(partId);
    const nameCell = <span className="stock-detail-trigger">{p.photoUrl ? <img src={p.photoUrl} alt="" /> : <span className="stock-part-placeholder"><Package size={14} /></span>}<span><b>{p.nama}</b><small>Klik untuk detail</small></span></span>;
    const scoreTag = p.photoUrl && score !== undefined ? (
      <span className={`photo-match-tag ${score >= 70 ? "high" : score >= 40 ? "mid" : "low"}`}>
        <Sparkles size={12} /> <b>{score}%</b> match
      </span>
    ) : (
      <span className="photo-match-tag none">Tanpa foto ref</span>
    );

    return searchPhoto ? [
      p.kategori,
      nameCell,
      scoreTag,
      p.ukuran,
      p.lokasi || "-",
      <b className={Number(p.stok) < 10 ? "low-stock" : ""}>{p.stok}</b>,
      <span>{p.satuan}</span>
    ] : [
      p.kategori,
      nameCell,
      p.ukuran,
      p.lokasi || "-",
      <b className={Number(p.stok) < 10 ? "low-stock" : ""}>{p.stok}</b>,
      <span>{p.satuan}</span>
    ];
  });

  return <><div className="stats-grid three"><Stat icon={Boxes} label="Total jenis part" value={remote.loading ? "…" : remote.data.length} detail="Data Neon" tone="blue" /><Stat icon={Package} label="Stok tersedia" value={remote.loading ? "…" : totalStock} detail="Seluruh gudang" tone="mint" /><Stat icon={AlertTriangle} label="Di bawah 10" value={remote.loading ? "…" : low} detail="Perlu perhatian" tone="amber" /></div>
    <Panel title="Inventori spare part" action={<div className="button-row"><button className="secondary small" onClick={() => go("partRequests")}><History size={16} /> Daftar bon</button>{canUseStock && <button className="secondary small stock-use-button" onClick={() => go("stockUsage")}><Warehouse size={16} />Pakai stok</button>}{isAdmin && <button className="secondary small" onClick={() => setShowAddPart(true)}><Plus size={16} />Tambah part</button>}<button className="primary small" onClick={() => go("partOrder")}><Plus size={16} /> Buat bon</button></div>}>
      <Toolbar query={q} setQuery={setQ}>
        <select value={category} onChange={e => setCategory(e.target.value)} aria-label="Sortir kategori">
          <option>Semua kategori</option>
          {categories.map(item => <option key={item}>{item}</option>)}
        </select>
        <button type="button" className={`stock-photo-search-btn ${searchPhoto ? "active" : ""}`} onClick={() => photoSearchFileRef.current?.click()} title="Upload foto dari galeri">
          <Upload size={16} />
          <span>{searchPhoto ? "Ganti foto" : "Upload foto"}</span>
        </button>
        <button type="button" className={`stock-photo-search-btn ${searchPhoto ? "active" : ""}`} onClick={() => setCameraModalOpen(true)} title="Ambil foto langsung dari kamera">
          <Camera size={16} />
          <span>Ambil foto</span>
        </button>
        <input ref={photoSearchFileRef} type="file" accept="image/*" onChange={handlePhotoSearchUpload} style={{ display: "none" }} />
      </Toolbar>
      {searchPhoto && (
        <div className="photo-search-banner">
          <div className="photo-search-preview">
            <img src={searchPhoto} alt="Foto pencarian" />
            <div>
              <b>Pencarian Foto Aktif</b>
              <small>{photoSearching ? "Memproses kecocokan visual..." : "Menampilkan barang berdasarkan persentase kecocokan foto"}</small>
            </div>
          </div>
          <button type="button" className="secondary small" onClick={clearPhotoSearch}>
            <X size={14} /> Hapus filter foto
          </button>
        </div>
      )}
      <RemoteState loading={remote.loading} error={remote.error} empty={!filtered.length} onRetry={remote.reload} />
      {!remote.loading && !remote.error && filtered.length > 0 && <div className="stock-table-scroll"><SimpleTable headers={tableHeaders} rows={tableRows} rowKeys={filtered.map(p => p.id || p.partId)} onRowClick={index => setSelectedPart(filtered[index])} /></div>}
    </Panel>
    <Panel title="Riwayat pemakaian terbaru"><RemoteState loading={usageRemote.loading} error={usageRemote.error} empty={!usageRemote.data.length} onRetry={usageRemote.reload} />{!usageRemote.loading && !usageRemote.error && usageRemote.data.length > 0 && <SimpleTable headers={["Tanggal", "Nama part", "Jumlah", "Pemakai", "Mesin / kebutuhan", "Kegunaan"]} rows={usageRemote.data.slice(0, 10).map(item => [item.tanggal || "-", <span className="stock-usage-part"><b>{item.nama || "-"}</b><small>{[item.kategori, item.ukuran].filter(Boolean).join(" · ")}</small></span>, `${Number(item.jumlah || 0).toLocaleString("id-ID")} ${item.satuan || ""}`, <span className="stock-usage-part"><b>{item.pemakai || "-"}</b><small>{item.bagian || ""}</small></span>, item.mesin || "-", item.kegunaan || "-"])} />}</Panel>
    {cameraModalOpen && <StockPhotoCameraModal open={cameraModalOpen} onClose={() => setCameraModalOpen(false)} onCapture={executePhotoSearch} />}
    {selectedPart && <StockPartDetailModal part={selectedPart} isAdmin={isAdmin} categories={categories} onClose={() => setSelectedPart(null)} onSave={updatePart} onSavePhoto={savePartPhoto} onRemovePhoto={removePartPhoto} />}
    {showAddPart && <AddMasterPartModal existingCategories={categories} existingParts={remote.data.map(part => ({ id: part.partId || part.id, name: part.nama, size: part.ukuran, category: part.kategori, componentType: part.jenisKomponen }))} initialQuery="" onClose={() => setShowAddPart(false)} onSelectExisting={item => { const match = remote.data.find(part => String(part.partId || part.id) === String(item.id)); setShowAddPart(false); if (match) setSelectedPart(match); }} onSave={addInventoryPart} />}</>;
}

function StockUsage({ go, session, notify }) {
  const [partId, setPartId] = useState(""), [requesterId, setRequesterId] = useState(""), [machine, setMachine] = useState("");
  const delegated = ["admin", "gudang"].includes(String(session?.role || "").toLowerCase());
  const remote = useRemoteData(async () => {
    const [stockResult, metadataResult] = await Promise.all([
      apiGet(ENDPOINTS.stock, { action: "getStokPart" }, { cache: false, timeout: 45000 }),
      apiGet(ENDPOINTS.partOrder, { action: "getMetadataOrder" }, { cache: false, timeout: 45000 }),
    ]);
    return { stock: asArray(stockResult), masterParts: asArray(metadataResult?.stok), requesters: asArray(metadataResult?.pemesanTeknik), machines: asArray(metadataResult?.mesinDetail) };
  });
  const stockItems = useMemo(() => {
    const clean = value => String(value || "").trim().toLocaleLowerCase("id-ID").replace(/\s+/g, " ");
    const masters = asArray(remote.data?.masterParts), masterByIdentity = new Map(), masterByNameSize = new Map(), mastersByName = new Map();
    masters.forEach(item => {
      const category = clean(item.kategori || item.Kategori), name = clean(item.nama || item.Nama), size = clean(item.ukuran || item.Ukuran);
      masterByIdentity.set(`${category}|${name}|${size}`, item.id);
      masterByNameSize.set(`${name}|${size}`, item.id);
      mastersByName.set(name, [...(mastersByName.get(name) || []), item.id]);
    });
    return asArray(remote.data?.stock).map(item => ({
      ...item,
      partId: item.partId || (() => { const category = clean(item.kategori || item.Kategori), name = clean(item.nama || item.Nama), size = clean(item.ukuran || item.Ukuran); return masterByIdentity.get(`${category}|${name}|${size}`) || masterByNameSize.get(`${name}|${size}`) || (mastersByName.get(name)?.length === 1 ? mastersByName.get(name)[0] : ""); })(),
    })).filter(item => item.partId && Number(item.stok || 0) > 0);
  }, [remote.data?.stock, remote.data?.masterParts]);
  const requesters = asArray(remote.data?.requesters);
  const selectedPart = stockItems.find(item => String(item.partId) === partId);
  const selectedRequester = delegated ? requesters.find(item => String(item.id) === requesterId) : requesters.find(item => String(item.nama || "").toLocaleLowerCase("id-ID") === String(session?.name || "").toLocaleLowerCase("id-ID"));
  const effectiveDepartment = selectedRequester?.bagian || "";
  const isWorkshop = effectiveDepartment.toLocaleLowerCase("id-ID").includes("bengkel");
  const machineChoices = useMemo(() => {
    const items = asArray(remote.data?.machines).map(item => ({
      category: String(item.kategori || item.Kategori || "").trim().toLocaleLowerCase("id-ID"),
      name: String(item.nama || item.Nama || "").trim(), type: String(item.jenis || item.Jenis || "").trim(),
    })).filter(item => item.name);
    return isWorkshop ? items.filter(item => item.category === "armada") : items.filter(item => item.category !== "armada");
  }, [remote.data?.machines, isWorkshop]);
  useEffect(() => setMachine(""), [requesterId, isWorkshop]);
  const localDate = () => { const date = new Date(), offset = date.getTimezoneOffset(); return new Date(date.getTime() - offset * 60000).toISOString().slice(0, 10); };
  const submit = async data => {
    if (!selectedPart) throw new Error("Pilih barang yang tersedia pada stok.");
    if (delegated && !selectedRequester) throw new Error("Pilih pemakai dari bagian Teknik.");
    const quantity = Number(String(data.jumlah || "").replace(",", "."));
    if (!Number.isFinite(quantity) || quantity <= 0) throw new Error("Jumlah pemakaian harus lebih dari 0.");
    if (quantity > Number(selectedPart.stok || 0)) throw new Error(`Stok tidak mencukupi. Tersedia ${selectedPart.stok} ${selectedPart.satuan || ""}.`);
    const result = await apiPost(ENDPOINTS.stock, { action: "useStock", token: session.token, partId, requesterId, tanggal: toIdDate(data.tanggal), jumlah: quantity, mesin: machine, kegunaan: data.kegunaan, keterangan: data.keterangan }, { timeout: 90000 });
    if (!isSuccess(result) || !result?.data?.id) throw new Error("Server pemakaian stok belum aktif. Muat ulang aplikasi setelah deployment selesai.");
    notify(result.message || "Pemakaian stok berhasil disimpan."); go("stock");
  };
  return <>
    <RemoteState loading={remote.loading} error={remote.error} empty={!remote.loading && !stockItems.length} onRetry={remote.reload} />
    {!remote.loading && !remote.error && stockItems.length > 0 && <FormPanel title="Catat pemakaian sparepart" onSubmit={submit} submit="Simpan pemakaian" extra={<span className="badge info"><Warehouse size={13} />Stok keluar</span>}>
      <Field label="Tanggal pemakaian"><input name="tanggal" type="date" lang="id-ID" defaultValue={localDate()} required /></Field>
      <Field label="Nama barang" wide asDiv><ProfessionalDropdown name="partId" value={partId} onChange={setPartId} options={stockItems.map(item => ({ value: item.partId, label: item.nama, photoUrl: item.photoUrl, meta: `${[item.kategori, item.ukuran].filter(Boolean).join(" · ")} · stok ${Number(item.stok || 0).toLocaleString("id-ID")} ${item.satuan || ""}` }))} placeholder="Cari barang pada stok" searchPlaceholder="Cari nama, kategori, atau ukuran..." required icon={Package} /></Field>
      {selectedPart && <div className="stock-use-summary wide"><div><small>Kategori</small><b>{selectedPart.kategori || "-"}</b></div><div><small>Ukuran / tipe</small><b>{selectedPart.ukuran || "-"}</b></div><div><small>Stok tersedia</small><b>{Number(selectedPart.stok || 0).toLocaleString("id-ID")} {selectedPart.satuan || ""}</b></div></div>}
      <Field label="Jumlah dipakai"><input name="jumlah" type="number" min="0.001" max={selectedPart?.stok || undefined} step="any" placeholder="0" required /></Field>
      {delegated ? <Field label="Pemakai" asDiv><ProfessionalDropdown name="requesterId" value={requesterId} onChange={value => { setRequesterId(value); setMachine(""); }} options={requesters.map(item => ({ value: item.id, label: item.nama, meta: item.bagian || "Teknik" }))} placeholder="Pilih pemakai bagian Teknik" searchPlaceholder="Cari nama karyawan..." required icon={UserRound} /></Field> : <Field label="Pemakai"><input value={session.name || ""} readOnly /></Field>}
      <Field label="Bagian"><input value={effectiveDepartment || (delegated ? "Terisi otomatis" : "Mengikuti profil akun")} readOnly /></Field>
      <Field label="Mesin / kebutuhan" wide asDiv><ProfessionalDropdown name="mesin" value={machine} onChange={setMachine} options={machineChoices.map(item => ({ value: item.name, label: item.name, meta: item.type || "Jenis belum tersedia" }))} placeholder={isWorkshop ? "Pilih nama Armada" : "Pilih atau tulis mesin / kebutuhan"} searchPlaceholder={isWorkshop ? "Cari nama Armada..." : "Cari mesin atau kebutuhan..."} allowCustom={!isWorkshop} required={isWorkshop} icon={Settings} /></Field>
      <Field label="Kegunaan" wide><textarea name="kegunaan" placeholder="Contoh: Penggantian bearing motor conveyor" required /></Field>
      <Field label="Keterangan" wide><textarea name="keterangan" placeholder="Catatan tambahan (opsional)" /></Field>
    </FormPanel>}
  </>;
}

const newPartRequestItem = () => ({
  id: `item-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  partId: "", partQuery: "", kategori: "", nama: "", ukuran: "", jmlPesan: "", satuan: "", kegunaan: "",
  samplePhoto: null, samplePhotoBusy: false, samplePhotoError: "",
});

function BonCropEditor({ draft, onCancel, onApply }) {
  const svgRef = useRef(null);
  const [dragging, setDragging] = useState(null);
  const toPixels = source => source.map(point => ({ x: point.x * draft.width, y: point.y * draft.height }));
  const [corners, setCorners] = useState(() => toPixels(draft.corners));
  useEffect(() => setCorners(toPixels(draft.corners)), [draft.previewUrl]);
  const polygonArea = Math.abs(corners.reduce((sum, point, index) => sum + point.x * corners[(index + 1) % 4].y - corners[(index + 1) % 4].x * point.y, 0)) / 2;
  const crosses = corners.map((point, index) => {
    const next = corners[(index + 1) % 4], after = corners[(index + 2) % 4];
    return (next.x - point.x) * (after.y - next.y) - (next.y - point.y) * (after.x - next.x);
  });
  const valid = polygonArea > draft.width * draft.height * .06 && (crosses.every(value => value > 0) || crosses.every(value => value < 0));
  const moveCorner = event => {
    if (dragging === null) return;
    const bounds = svgRef.current.getBoundingClientRect();
    const x = Math.min(draft.width, Math.max(0, (event.clientX - bounds.left) / Math.max(1, bounds.width) * draft.width));
    const y = Math.min(draft.height, Math.max(0, (event.clientY - bounds.top) / Math.max(1, bounds.height) * draft.height));
    setCorners(current => current.map((point, index) => index === dragging ? { x, y } : point));
  };
  const reset = () => setCorners(toPixels(draft.corners));
  const useFullImage = () => { const inset = Math.max(3, Math.min(draft.width, draft.height) * .012); setCorners([{ x: inset, y: inset }, { x: draft.width - inset, y: inset }, { x: draft.width - inset, y: draft.height - inset }, { x: inset, y: draft.height - inset }]); };
  const labels = ["Kiri atas", "Kanan atas", "Kanan bawah", "Kiri bawah"];
  return createPortal(<div className="bon-crop-overlay" role="dialog" aria-modal="true" aria-labelledby="bon-crop-title">
    <section className="bon-crop-editor">
      <header><div><p className="eyebrow">Scanner dokumen</p><h3 id="bon-crop-title">Atur batas bon</h3><small>Geser empat titik sampai seluruh kertas berada di dalam garis.</small></div><button type="button" onClick={onCancel} aria-label="Tutup editor crop"><X size={20} /></button></header>
      <div className="bon-crop-body">
        <div className={`bon-crop-status ${valid ? "ready" : "invalid"}`}><ScanLine size={16} /><span><b>{draft.detected ? "Batas awal terdeteksi otomatis" : "Gunakan seluruh foto sebagai batas awal"}</b><small>{valid ? "Sudut siap diterapkan dan diratakan." : "Susunan sudut berpotongan. Atur ulang titik crop."}</small></span></div>
        <div className="bon-crop-stage">
          <svg ref={svgRef} viewBox={`0 0 ${draft.width} ${draft.height}`} style={{ aspectRatio: `${draft.width}/${draft.height}` }} onPointerMove={moveCorner} onPointerUp={() => setDragging(null)} onPointerCancel={() => setDragging(null)}>
            <image href={draft.previewUrl} x="0" y="0" width={draft.width} height={draft.height} />
            <path d={`M0 0H${draft.width}V${draft.height}H0Z M${corners.map(point => `${point.x} ${point.y}`).join("L")}Z`} className="bon-crop-mask" fillRule="evenodd" />
            <polygon points={corners.map(point => `${point.x},${point.y}`).join(" ")} className="bon-crop-polygon" />
            {corners.map((point, index) => <g key={labels[index]} className="bon-crop-handle" transform={`translate(${point.x} ${point.y})`} onPointerDown={event => { event.preventDefault(); setDragging(index); svgRef.current?.setPointerCapture?.(event.pointerId); }} role="button" aria-label={`Geser sudut ${labels[index]}`}><circle r="30" className="touch" /><circle r="11" className="visible" /><path d="M-18 0H18M0-18V18" /></g>)}
          </svg>
        </div>
      </div>
      <footer><div><button type="button" className="secondary" onClick={reset}><RefreshCw size={16} />Deteksi awal</button><button type="button" className="secondary" onClick={useFullImage}><Maximize2 size={16} />Seluruh foto</button></div><div><button type="button" className="secondary" onClick={onCancel}>Batal</button><button type="button" className="primary" disabled={!valid} onClick={() => onApply(corners.map(point => ({ x: point.x / draft.width, y: point.y / draft.height })))}><Check size={17} />Terapkan crop</button></div></footer>
    </section>
  </div>, document.body);
}

function PartOrder({ notify, go, session }) {
  const [items, setItems] = useState(() => [newPartRequestItem()]);
  const [requesterId, setRequesterId] = useState("");
  const [department, setDepartment] = useState("");
  const [machine, setMachine] = useState("");
  const [showAddPart, setShowAddPart] = useState(false);
  const [addPartTarget, setAddPartTarget] = useState("");
  const [photo, setPhoto] = useState(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState("");
  const [scanMode, setScanMode] = useState(true);
  const [cropEditor, setCropEditor] = useState(null);
  const photoInputRef = useRef(null);
  const galleryInputRef = useRef(null);
  const photoSourceRef = useRef(null);
  const isAdmin = String(session?.role || "").toLocaleLowerCase("id-ID") === "admin";
  const metadata = useRemoteData(async () => {
    const [metadataResult, masterResult, userResult, machineResult] = await Promise.allSettled([
      apiGet(ENDPOINTS.partOrder, { action: "getMetadataOrder" }, { timeout: 45000 }),
      apiGet(ENDPOINTS.partMaster, { action: "getPart" }, { timeout: 45000 }),
      isAdmin
        ? apiPost(ENDPOINTS.users, { action: "getAllUsers", token: session?.token || "" }, { timeout: 90000 })
        : Promise.resolve({ status: "success", data: [] }),
      apiGet(ENDPOINTS.maintenanceMaster, { action: "getRawatMaster" }, { timeout: 45000 })
    ]);
    const metadataValue = metadataResult.status === "fulfilled" ? metadataResult.value : null;
    const metadataStock = isSuccess(metadataValue) ? asArray(metadataValue?.stok) : [];
    const serverRequesters = asArray(metadataValue?.pemesanTeknik);
    const fallbackRequesters = userResult.status === "fulfilled"
      ? asArray(userResult.value).filter(user => String(user.role || "").trim().toLocaleLowerCase("id-ID") === "teknik").map(user => ({
        id: user.id, nama: user.nama || user.name || "", bagian: user.bagian || user.department || "Teknik",
      })).filter(user => user.id && user.nama)
      : [];
    const pemesanTeknik = serverRequesters.length ? serverRequesters : fallbackRequesters;
    const serverMachines = asArray(metadataValue?.mesinDetail);
    const fallbackMachines = machineResult.status === "fulfilled" ? asArray(machineResult.value) : [];
    const mesinDetail = serverMachines.length ? serverMachines : fallbackMachines;
    if (metadataStock.length) return { ...metadataValue, stok: metadataStock, pemesanTeknik, mesinDetail, source: "order-part" };
    if (masterResult.status === "fulfilled") {
      const fallback = asArray(masterResult.value, ["stok", "parts"]);
      if (fallback.length) return { status: "success", stok: fallback, pemesanTeknik, mesinDetail, source: "master-part" };
    }
    throw new Error("Master part dan metadata Order Part tidak tersedia.");
  });
  const stok = asArray(metadata.data?.stok);
  const technicalRequesters = asArray(metadata.data?.pemesanTeknik);
  const selectedRequester = technicalRequesters.find(requester => String(requester.id) === requesterId);
  const effectiveDepartment = isAdmin ? (selectedRequester?.bagian || "") : department;
  const isWorkshop = effectiveDepartment.trim().toLocaleLowerCase("id-ID").includes("bengkel");
  const machineChoices = useMemo(() => {
    const detail = asArray(metadata.data?.mesinDetail).map(item => ({
      category: String(item.kategori || item.Kategori || "").trim().toLocaleLowerCase("id-ID"),
      name: String(item.nama || item.Nama || "").trim(),
      type: String(item.jenis || item.Jenis || item.type || "").trim(),
    })).filter(item => item.name);
    const armadaNames = new Set(detail.filter(item => item.category === "armada").map(item => item.name));
    const typeByName = new Map(detail.map(item => [item.name, item.type]));
    const workshop = [...armadaNames].sort((a, b) => a.localeCompare(b, "id-ID"));
    const regularSource = detail.length
      ? detail.filter(item => item.category !== "armada").map(item => item.name)
      : asArray(metadata.data?.mesin).map(value => String(value || "").trim()).filter(value => value && !armadaNames.has(value));
    return { workshop, regular: [...new Set(regularSource)].sort((a, b) => a.localeCompare(b, "id-ID")), typeByName };
  }, [metadata.data?.mesinDetail, metadata.data?.mesin]);
  const workshopMachineNames = machineChoices.workshop;
  const regularMachineNames = machineChoices.regular;
  useEffect(() => {
    setMachine(current => isWorkshop && workshopMachineNames.includes(current) ? current : "");
  }, [isWorkshop, workshopMachineNames.join("\u0000")]);
  const stockOptions = useMemo(() => stok.map((part, index) => ({
    id: part.id || index,
    kategori: String(Array.isArray(part) ? part[0] : part.kategori || part.Kategori || "").trim(),
    nama: String(Array.isArray(part) ? part[1] : part.nama || part.Nama || "").trim(),
    ukuran: String(Array.isArray(part) ? part[2] : part.ukuran || part.Ukuran || "").trim(),
    satuan: String(Array.isArray(part) ? part[4] || "" : part.satuan || part.Satuan || "").trim(),
    componentType: String(Array.isArray(part) ? part[3] || "" : part.jenisKomponen || part["Jenis Komponen"] || "").trim(),
    photoUrl: part.photoUrl || part.photo_url || "",
  })).filter(part => part.nama).map(part => ({
    ...part, searchLabel: [part.nama, part.ukuran, part.kategori].filter(Boolean).join(" — "),
  })), [stok]);

  const updateItem = (id, field, value) => setItems(current => current.map(item => {
    if (item.id !== id) return item;
    if (field !== "partQuery") return { ...item, [field]: value };
    const normalized = String(value).trim().toLocaleLowerCase("id-ID");
    const exactLabel = stockOptions.find(part => part.searchLabel.toLocaleLowerCase("id-ID") === normalized);
    const nameMatches = stockOptions.filter(part => part.nama.toLocaleLowerCase("id-ID") === normalized);
    const matched = exactLabel || (nameMatches.length === 1 ? nameMatches[0] : null);
    return matched
      ? { ...item, partId: matched.id, partQuery: matched.searchLabel, nama: matched.nama, kategori: matched.kategori, ukuran: matched.ukuran, satuan: matched.satuan }
      : { ...item, partId: "", partQuery: value, nama: "", kategori: "", ukuran: "", satuan: "" };
  }));
  const choosePart = (itemId, part) => setItems(current => current.map(item => item.id === itemId ? {
    ...item, partId: part.id, partQuery: part.searchLabel || [part.nama, part.ukuran, part.kategori].filter(Boolean).join(" — "),
    nama: part.nama, kategori: part.kategori, ukuran: part.ukuran || "", satuan: part.satuan || "",
  } : item));
  const addMasterPart = async data => {
    if (!isAdmin) throw new Error("Hanya Admin yang dapat menambahkan master spare part.");
    const kategori = String(data.kategori || "").trim(), nama = String(data.nama || "").trim();
    const ukuran = String(data.ukuran || "").trim(), satuan = String(data.satuan || "Pcs").trim() || "Pcs";
    const stokAwal = Number(String(data.stokAwal ?? "0").replace(",", "."));
    if (!kategori || !nama || !ukuran) throw new Error("Kategori, nama, dan ukuran part wajib diisi.");
    if (!Number.isFinite(stokAwal) || stokAwal < 0) throw new Error("Stok awal harus nol atau lebih.");
    const result = await apiPost(ENDPOINTS.jobs, {
      action: "addMasterPart", token: session.token, kategori, nama, ukuran, satuan, stokAwal, lokasi: String(data.lokasi || "").trim(),
      jenisKomponen: String(data.jenisKomponen || "").trim(), photo: data.photo,
    }, { timeout: 90000 });
    if (!isSuccess(result)) throw new Error(result?.message || "Master spare part gagal ditambahkan.");
    if (addPartTarget) choosePart(addPartTarget, {
      id: result.data?.id, kategori, nama, ukuran, satuan,
      componentType: String(data.jenisKomponen || "").trim(),
    });
    setShowAddPart(false); setAddPartTarget("");
    await metadata.reload();
    notify(result.message || "Master spare part berhasil ditambahkan.");
  };
  const processPhoto = async (file, enhance = scanMode, manualCorners = null) => {
    if (!file) return;
    setPhotoBusy(true); setPhotoError("");
    try {
      if (enhance && !manualCorners) {
        const inspection = await inspectBonImage(file);
        setCropEditor({ ...inspection, file });
        return;
      }
      const prepared = await prepareBonImage(file, { scanMode: enhance, manualCorners });
      setPhoto(prepared);
    } catch (error) {
      setPhoto(null);
      setPhotoError(error?.message || "Foto bon gagal diproses.");
    } finally { setPhotoBusy(false); }
  };
  const applyManualCrop = async corners => {
    const file = cropEditor?.file;
    setCropEditor(null);
    if (file) await processPhoto(file, true, corners);
  };
  const toggleScanMode = async () => {
    const next = !scanMode;
    setScanMode(next);
    if (photoSourceRef.current) await processPhoto(photoSourceRef.current, next);
  };
  const processItemSamplePhoto = async (itemId, file) => {
    if (!file) return;
    setItems(current => current.map(item => item.id === itemId ? { ...item, samplePhotoBusy: true, samplePhotoError: "" } : item));
    try {
      const prepared = await prepareBonImage(file, { scanMode: false, targetBytes: 320 * 1024, maxDimension: 1400 });
      setItems(current => current.map(item => item.id === itemId ? { ...item, samplePhoto: prepared, samplePhotoBusy: false } : item));
    } catch (error) {
      setItems(current => current.map(item => item.id === itemId ? { ...item, samplePhoto: null, samplePhotoBusy: false, samplePhotoError: error?.message || "Foto sampel barang gagal diproses." } : item));
    }
  };
  const submit = async (data) => {
    if (!items.length || items.length > 10) throw new Error("Satu bon harus berisi 1 sampai 10 barang.");
    if (photoBusy || items.some(item => item.samplePhotoBusy)) throw new Error("Tunggu proses kompresi foto selesai.");
    if (isAdmin && !selectedRequester) throw new Error("Pilih pemesan bagian Teknik terlebih dahulu.");
    if (isWorkshop && !String(data.mesin || "").trim()) throw new Error("Pilih nama Armada untuk pemesan bagian Bengkel.");
    if (!isWorkshop && workshopMachineNames.includes(String(data.mesin || "").trim())) throw new Error("Nama Armada hanya dapat dipilih untuk pemesan bagian Bengkel.");
    const unselectedIndex = items.findIndex(item => !item.partId || !item.nama);
    if (unselectedIndex >= 0) throw new Error(`Pilih nama barang item ${unselectedIndex + 1} dari daftar Stok Part.`);
    const payloadItems = items.map(({ id, partQuery, samplePhotoBusy, samplePhotoError, ...item }) => item);
    const result = await apiPost(ENDPOINTS.partOrder, {
      action: "submitOrder", ...data, tglPesan: toIdDate(data.tglPesan), items: payloadItems,
      photo: photo || null, status: "Open",
    }, { timeout: 90000 });
    if (!isSuccess(result)) throw new Error(result.message || "Bon pesan gagal disimpan oleh server.");
    notify(result.message || "Bon pesan berhasil dikirim.");
    go("partRequests");
  };
  return <><RemoteState loading={metadata.loading} error={metadata.error} onRetry={metadata.reload} /><FormPanel title="Bon pesan barang" onSubmit={submit} submit={`Kirim bon · ${items.length} item`} extra={<span className="bon-item-counter"><ClipboardList size={15} />{items.length}/10 item</span>}>
    <div className="form-section-title wide"><span>01</span><div><b>Informasi bon</b><small>Informasi ini berlaku untuk seluruh barang dalam transaksi.</small></div></div>
    <Field label="Tanggal pesan"><input name="tglPesan" type="date" lang="id-ID" defaultValue={new Date().toISOString().slice(0, 10)} required /></Field>
    <Field label="Pemesan" asDiv={isAdmin}>{isAdmin
      ? <><ProfessionalDropdown name="requesterId" value={requesterId} onChange={setRequesterId} options={technicalRequesters.map(requester => ({ value: requester.id, label: requester.nama, meta: requester.bagian || "Teknik" }))} placeholder="Pilih pemesan bagian Teknik" searchPlaceholder="Cari nama karyawan..." icon={UserRound} /><input type="hidden" name="pemesan" value={selectedRequester?.nama || ""} /></>
      : <input name="pemesan" value={session?.name || ""} readOnly required />}</Field>
    <Field label="Bagian">{isAdmin
      ? <input name="bagian" value={selectedRequester?.bagian || ""} placeholder="Terisi otomatis" readOnly />
      : <><input name="bagian" value={department} onChange={event => setDepartment(event.target.value)} list="department-options" /><datalist id="department-options">{asArray(metadata.data?.bagian).map(value => <option key={value} value={value} />)}</datalist></>}</Field>
    <Field label="Mesin / kebutuhan" asDiv><ProfessionalDropdown name="mesin" value={machine} onChange={setMachine} options={(isWorkshop ? workshopMachineNames : regularMachineNames).map(value => ({ value, label: value, meta: machineChoices.typeByName.get(value) || "Jenis belum tersedia" }))} placeholder={isWorkshop ? "Pilih nama Armada" : "Pilih atau tulis mesin / kebutuhan"} searchPlaceholder={isWorkshop ? "Cari nama Armada..." : "Cari mesin atau kebutuhan..."} allowCustom={!isWorkshop} icon={Settings} /></Field>
    <Field label="Catatan transaksi" wide><textarea name="keterangan" placeholder="Catatan tambahan untuk seluruh isi bon (opsional)" /></Field>

    <div className="form-section-title wide"><span>02</span><div><b>Daftar barang</b><small>Tambahkan maksimal 10 barang berbeda dalam satu nomor transaksi.</small></div></div>
    <div className="bon-items-editor wide">
      {items.map((item, index) => <article className="bon-item-row" key={item.id}>
        <header><span>{String(index + 1).padStart(2, "0")}</span><div><b>Item {index + 1}</b><small>Detail barang yang dipesan</small></div>{items.length > 1 && <button type="button" onClick={() => setItems(current => current.filter(value => value.id !== item.id))} aria-label={`Hapus item ${index + 1}`}><Trash2 size={16} /><span>Hapus</span></button>}</header>
        <div className="bon-item-fields">
          <div className="bon-item-name"><span>Nama barang</span><ProfessionalDropdown value={item.partQuery} onChange={value => updateItem(item.id, "partQuery", value)} options={stockOptions.map(part => ({ value: part.searchLabel, label: part.nama, photoUrl: part.photoUrl, meta: [part.ukuran, part.kategori, part.satuan].filter(Boolean).join(" · ") }))} placeholder="Pilih nama barang dari Stok Part" searchPlaceholder="Cari nama, ukuran, atau kategori..." allowCustom showCustomOption={false} icon={Package} /><small className={`bon-part-selection ${item.partId ? "selected" : ""}`}>{item.partId ? "Terhubung dengan master Stok Part" : "Ketik lalu pilih barang dari daftar yang muncul"}</small>{!item.partId && item.partQuery.trim().length >= 2 && (isAdmin ? <button type="button" className="bon-add-master" onClick={() => { setAddPartTarget(item.id); setShowAddPart(true); }}><Plus size={13} />Barang tidak ada? Tambahkan ke master</button> : <small className="bon-master-admin-note">Barang tidak ditemukan? Hubungi Admin untuk menambah master.</small>)}</div>
          <label className="bon-item-quantity"><span>Jumlah</span><input value={item.jmlPesan} onChange={event => updateItem(item.id, "jmlPesan", event.target.value)} type="number" min="0.001" step="any" placeholder="0" required /></label>
        </div>
        <div className={`bon-item-sample ${item.samplePhoto ? "has-photo" : ""}`}>
          {item.samplePhoto ? <><img src={item.samplePhoto.dataUrl} alt={`Foto sampel ${item.nama || `item ${index + 1}`}`} /><div><span className="badge success"><Check size={12} />Foto sampel siap</span><b>{item.samplePhoto.fileName}</b><small>{item.samplePhoto.width} × {item.samplePhoto.height} px · {formatImageBytes(item.samplePhoto.bytes)} · hemat {Math.max(0, item.samplePhoto.compressionRatio)}%</small></div><div className="bon-item-sample-actions"><button type="button" className="secondary small" onClick={() => document.getElementById(`sample-gallery-${item.id}`)?.click()}><Upload size={14} />Ganti</button><button type="button" className="secondary small danger-button" onClick={() => setItems(current => current.map(value => value.id === item.id ? { ...value, samplePhoto: null, samplePhotoError: "" } : value))}><Trash2 size={14} />Hapus</button></div></> : <><span className="bon-item-sample-icon"><ImagePlus size={20} /></span><div><b>Foto sampel barang <em>Opsional</em></b><small>Lampirkan contoh barang jika ukuran atau jenisnya belum pasti.</small></div><div className="bon-item-sample-actions"><button type="button" className="secondary small" disabled={item.samplePhotoBusy || !metadata.data?.cloudinaryEnabled} onClick={() => document.getElementById(`sample-camera-${item.id}`)?.click()}>{item.samplePhotoBusy ? <><span className="spinner dark" />Memproses</> : <><Camera size={14} />Ambil foto</>}</button><button type="button" className="secondary small" disabled={item.samplePhotoBusy || !metadata.data?.cloudinaryEnabled} onClick={() => document.getElementById(`sample-gallery-${item.id}`)?.click()}><Upload size={14} />Upload</button></div></>}
          <input id={`sample-camera-${item.id}`} className="cosphi-file-input" type="file" accept="image/*" capture="environment" onChange={async event => { const input = event.currentTarget; await processItemSamplePhoto(item.id, input.files?.[0]); input.value = ""; }} />
          <input id={`sample-gallery-${item.id}`} className="cosphi-file-input" type="file" accept="image/*" onChange={async event => { const input = event.currentTarget; await processItemSamplePhoto(item.id, input.files?.[0]); input.value = ""; }} />
        </div>
        {item.samplePhotoError && <p className="bon-item-sample-error"><AlertTriangle size={13} />{item.samplePhotoError}</p>}
        {item.partId && Number(item.jmlPesan) > 0 && <div className="bon-item-summary">
          <div><span>Kategori</span><b>{item.kategori || "-"}</b></div>
          <div className="bon-summary-name"><span>Nama barang</span><b>{item.nama || "-"}</b></div>
          <div><span>Ukuran / tipe</span><b>{item.ukuran || "-"}</b></div>
          <div><span>Jumlah</span><b>{item.jmlPesan}</b></div>
          <div><span>Satuan</span><b>{item.satuan || "-"}</b></div>
        </div>}
      </article>)}
      <button type="button" className="bon-add-item" disabled={items.length >= 10} onClick={() => setItems(current => [...current, newPartRequestItem()])}><Plus size={18} /><span><b>{items.length >= 10 ? "Batas 10 item tercapai" : "Tambahkan item lain"}</b><small>{items.length}/10 item dalam transaksi ini</small></span></button>
    </div>

    <div className="form-section-title wide"><span>03</span><div><b>Foto atau scan bon</b><small>Foto dikompres sebelum diunggah agar hemat penyimpanan dan data.</small></div></div>
    <div className="bon-photo-field wide">
      {!photo ? <div className="bon-photo-empty"><span><ImagePlus size={26} /></span><div><b>Lampirkan foto bon manual</b><small>Ambil foto baru atau pilih gambar yang sudah tersimpan di PC/HP. Maksimal foto asli 12 MB.</small></div><div className="bon-photo-source-actions"><button type="button" className="secondary" disabled={photoBusy || metadata.loading || !metadata.data?.cloudinaryEnabled} onClick={() => photoInputRef.current?.click()}>{photoBusy ? <><span className="spinner dark" />Memproses...</> : <><Camera size={17} />Ambil foto</>}</button><button type="button" className="secondary" disabled={photoBusy || metadata.loading || !metadata.data?.cloudinaryEnabled} onClick={() => galleryInputRef.current?.click()}><Upload size={17} />Pilih dari perangkat</button></div></div>
        : <div className="bon-photo-preview"><img src={photo.dataUrl} alt="Pratinjau hasil scan bon pesan" /><div><span className="badge success"><Check size={13} /> {photo.manualCrop ? "Crop manual diterapkan" : photo.documentDetected ? "Dokumen terdeteksi" : "Foto siap diunggah"}</span><b>{photo.fileName}</b><small>{photo.width} × {photo.height} px · {formatImageBytes(photo.bytes)} dari {formatImageBytes(photo.originalBytes)} · hemat {Math.max(0, photo.compressionRatio)}%</small>{scanMode && <small className="bon-scan-result">{photo.documentDetected ? `Perspektif dirapikan dan margin aman dipertahankan${photo.manualCrop ? " sesuai batas pilihan Anda" : ` · keyakinan ${photo.cropConfidence}%`}` : "Tepi tidak terdeteksi aman · foto penuh dipertahankan"}</small>}<div className="button-row">{scanMode && photoSourceRef.current && <button type="button" className="secondary small" onClick={() => processPhoto(photoSourceRef.current, true)}><ScanLine size={15} />Atur crop</button>}<button type="button" className="secondary small" onClick={() => photoInputRef.current?.click()}><Camera size={15} />Foto ulang</button><button type="button" className="secondary small" onClick={() => galleryInputRef.current?.click()}><Upload size={15} />Pilih file</button><button type="button" className="secondary small danger-button" onClick={() => { setPhoto(null); photoSourceRef.current = null; if (photoInputRef.current) photoInputRef.current.value = ""; if (galleryInputRef.current) galleryInputRef.current.value = ""; }}><Trash2 size={15} />Hapus</button></div></div></div>}
      <label className={`bon-scan-toggle ${scanMode ? "active" : ""}`}><input type="checkbox" checked={scanMode} onChange={toggleScanMode} /><ScanLine size={18} /><span><b>Mode scanner dokumen</b><small>Deteksi tepi, potong latar, koreksi perspektif, dan perjelas bon—tanpa OCR.</small></span><i>{scanMode ? "Aktif" : "Nonaktif"}</i></label>
      {!metadata.loading && !metadata.data?.cloudinaryEnabled && <p className="bon-photo-warning"><AlertTriangle size={16} />Cloudinary belum dikonfigurasi. Form tetap dapat dikirim tanpa foto.</p>}
      {photoError && <p className="bon-photo-warning"><AlertTriangle size={16} />{photoError}</p>}
      <input ref={photoInputRef} className="cosphi-file-input" type="file" accept="image/*" capture="environment" onChange={event => { const input = event.currentTarget, file = input.files?.[0]; photoSourceRef.current = file || null; processPhoto(file).finally(() => { input.value = ""; }); }} />
      <input ref={galleryInputRef} className="cosphi-file-input" type="file" accept="image/*" onChange={event => { const input = event.currentTarget, file = input.files?.[0]; photoSourceRef.current = file || null; processPhoto(file).finally(() => { input.value = ""; }); }} />
    </div>
  </FormPanel>
    {showAddPart && <AddMasterPartModal
      existingCategories={[...new Set(stockOptions.map(part => part.kategori).filter(Boolean))].sort((a, b) => a.localeCompare(b, "id-ID"))}
      existingParts={stockOptions}
      initialQuery={items.find(item => item.id === addPartTarget)?.partQuery || ""}
      onClose={() => { setShowAddPart(false); setAddPartTarget(""); }}
      onSelectExisting={part => { if (addPartTarget) choosePart(addPartTarget, part); setShowAddPart(false); setAddPartTarget(""); }}
      onSave={addMasterPart}
    />}
    {cropEditor && <BonCropEditor draft={cropEditor} onCancel={() => setCropEditor(null)} onApply={applyManualCrop} />}</>;
}

function BonRequestDetailModal({ transaction, isAdmin, onClose, onEdit, onDelete, onItemArrival, busy }) {
  const samplePhotoItems = [...transaction.items].sort((a, b) => a.itemPosition - b.itemPosition).filter(item => item.samplePhotoUrl);
  return <div className="modal-overlay" onMouseDown={event => event.target === event.currentTarget && onClose()}>
    <article className="modal-card bon-detail-modal">
      <div className="modal-head"><div><p className="eyebrow">Detail Bon Pesan</p><h3>{transaction.number}</h3><small>{transaction.date || "-"} · {transaction.requester || "Tanpa nama pemesan"}</small></div><button type="button" onClick={onClose} aria-label="Tutup detail"><X size={18} /></button></div>
      <div className="bon-detail-summary"><div><small>Pemesan</small><b>{transaction.requester || "-"}</b></div><div><small>Bagian</small><b>{transaction.department || "-"}</b></div><div><small>Mesin / kebutuhan</small><b>{transaction.machine || "-"}</b></div><div><small>Status</small><Badge text={transaction.status} /></div></div>
      <section className="bon-detail-items"><h4>Daftar barang · {transaction.items.length} item</h4>{[...transaction.items].sort((a, b) => a.itemPosition - b.itemPosition).map((item, index) => { const isClosed = String(item.status).toLowerCase() === "close"; return <div key={item.id} className={isClosed ? "arrived" : ""}><span>{String(index + 1).padStart(2, "0")}</span><p>{isAdmin && !isClosed ? <button type="button" className="bon-item-arrival-trigger" onClick={() => onItemArrival(item)}>{item.nama}</button> : <b>{item.nama}</b>}<small>{[item.kategori, item.ukuran].filter(Boolean).join(" · ") || "Tanpa rincian"}</small>{item.kegunaan && <em>{item.kegunaan}</em>}</p><div className="bon-item-arrival-state"><strong>{Number(item.jmlDatang || 0).toLocaleString("id-ID")} / {Number(item.jmlPesan || 0).toLocaleString("id-ID")} <small>{item.satuan}</small></strong><Badge text={item.status || "Open"} />{item.arrivedAtLabel && <small>Datang terakhir {item.arrivedAtLabel}</small>}</div></div> })}</section>
      {transaction.notes && <section className="report-detail-note"><small>Catatan transaksi</small><p>{transaction.notes}</p></section>}
      {transaction.photoUrl && <a className="bon-detail-photo" href={transaction.photoUrl} target="_blank" rel="noreferrer"><Eye size={16} />Buka foto atau scan bon</a>}
      {samplePhotoItems.length > 0 && <section className="bon-detail-sample-list"><div><ImagePlus size={15} /><span><b>Foto sampel barang</b><small>{samplePhotoItems.length} part memiliki foto sampel</small></span></div>{samplePhotoItems.map((item, index) => <a key={item.id} href={item.samplePhotoUrl} target="_blank" rel="noreferrer"><img src={item.samplePhotoUrl} alt={`Foto sampel ${item.nama}`} /><span><b>{String(index + 1).padStart(2, "0")} · {item.nama}</b><small>{[item.kategori, item.ukuran].filter(Boolean).join(" · ") || "Tanpa rincian"}</small></span><em><Eye size={13} />Buka foto sampel</em></a>)}</section>}
      <div className="modal-actions"><button type="button" className="secondary" onClick={onClose}>Tutup</button>{isAdmin && <><button type="button" className="danger-button" disabled={busy} onClick={onDelete}><Trash2 size={16} />Hapus</button><button type="button" className="primary" disabled={busy} onClick={onEdit}><Edit3 size={16} />Edit bon</button></>}</div>
    </article>
  </div>;
}

function BonItemArrivalModal({ item, onClose, onSave }) {
  const today = () => { const date = new Date(), pad = number => String(number).padStart(2, "0"); return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}`; };
  const requestedQuantity = Number(item.jmlPesan || 0), previouslyArrived = Number(item.jmlDatang || 0);
  const initialRemaining = Math.max(0, requestedQuantity - previouslyArrived);
  const [arrivalDate, setArrivalDate] = useState(today());
  const [quantity, setQuantity] = useState(initialRemaining || "");
  const [saving, setSaving] = useState(false), [error, setError] = useState("");
  const receivedNow = Number(quantity || 0), totalArrived = previouslyArrived + (Number.isFinite(receivedNow) ? receivedNow : 0);
  const remainingQuantity = Math.max(0, requestedQuantity - totalArrived), willClose = remainingQuantity <= 0;
  const submit = async event => { event.preventDefault(); const createRemainderBon = event.nativeEvent?.submitter?.value === "reorder"; setSaving(true); setError(""); try { await onSave({ itemId: item.id, tglDatang: arrivalDate, jmlDatang: quantity, createRemainderBon }); } catch (err) { setError(err?.message || "Kedatangan barang gagal disimpan."); } finally { setSaving(false); } };
  return <div className="modal-overlay bon-arrival-overlay" onMouseDown={event => event.target === event.currentTarget && !saving && onClose()}>
    <form className="modal-card bon-arrival-modal" onSubmit={submit}>
      <div className="modal-head"><div><p className="eyebrow">Penerimaan barang</p><h3>{item.nama}</h3><small>{[item.kategori, item.ukuran].filter(Boolean).join(" · ")}</small></div><button type="button" disabled={saving} onClick={onClose}><X size={18} /></button></div>
      <div className="bon-arrival-body">
        <div className="bon-arrival-progress"><span><small>Jumlah pesan</small><b>{requestedQuantity.toLocaleString("id-ID")} {item.satuan || ""}</b></span><span><small>Sudah datang</small><b>{previouslyArrived.toLocaleString("id-ID")} {item.satuan || ""}</b></span><span><small>Sisa sebelum input</small><b>{initialRemaining.toLocaleString("id-ID")} {item.satuan || ""}</b></span></div>
        <div className="form-grid"><Field label="Tanggal datang" wide><input type="text" inputMode="numeric" value={arrivalDate} onChange={event => setArrivalDate(event.target.value)} placeholder="dd/mm/yyyy" pattern="\d{2}/\d{2}/\d{4}" title="Gunakan format dd/mm/yyyy" required /></Field><Field label="Jumlah datang saat ini"><input type="number" min="0.001" max={initialRemaining} step="any" value={quantity} onChange={event => setQuantity(event.target.value)} required /></Field><Field label="Status setelah disimpan"><input value={willClose ? "Close" : "Open"} readOnly /></Field></div>
        <p className="sensitive-data-note"><CheckCircle2 size={15} />{willClose ? "Jumlah pesanan terpenuhi. Item akan Close setelah disimpan." : `Masih tersisa ${remainingQuantity.toLocaleString("id-ID")} ${item.satuan || ""}. Item tetap Open sampai jumlah pesanan terpenuhi.`}</p>
        {error && <div className="remote-error"><AlertTriangle size={16} /><span>{error}</span></div>}
      </div>
      <div className="modal-actions">{!willClose && remainingQuantity > 0 && <button type="submit" name="arrivalAction" value="reorder" className="secondary bon-reorder-button" disabled={saving}><FilePlus2 size={16} />Simpan & buat bon sisa</button>}<button type="button" className="secondary" disabled={saving} onClick={onClose}>Batal</button><button className="primary" name="arrivalAction" value="save" disabled={saving}>{saving ? <><span className="spinner" />Menyimpan…</> : <><Check size={16} />Simpan kedatangan</>}</button></div>
    </form>
  </div>;
}

function BonRequestEditor({ transaction, requesters, machines, onClose, onSave }) {
  const [saving, setSaving] = useState(false), [error, setError] = useState("");
  const [requester, setRequester] = useState(transaction.requester || "");
  const [machine, setMachine] = useState(transaction.machine || "");
  const [items, setItems] = useState(() => transaction.items.map(item => ({ id: item.id, nama: item.nama, ukuran: item.ukuran, satuan: item.satuan, jmlPesan: item.jmlPesan, kegunaan: item.kegunaan || "" })));
  const selectedRequester = requesters.find(user => String(user.nama).toLocaleLowerCase("id-ID") === requester.toLocaleLowerCase("id-ID"));
  const isWorkshop = String(selectedRequester?.bagian || transaction.department || "").toLocaleLowerCase("id-ID").includes("bengkel");
  const armadaMachineNames = [...new Set(machines.filter(item => String(item.kategori || item.Kategori || "").trim().toLocaleLowerCase("id-ID") === "armada").map(item => item.nama || item.Nama).filter(Boolean))];
  const machineTypeByName = new Map(machines.map(item => [item.nama || item.Nama, String(item.jenis || item.Jenis || item.type || "").trim()]));
  const machineNames = [...new Set(machines.filter(item => isWorkshop
    ? String(item.kategori || item.Kategori || "").trim().toLocaleLowerCase("id-ID") === "armada"
    : String(item.kategori || item.Kategori || "").trim().toLocaleLowerCase("id-ID") !== "armada").map(item => item.nama || item.Nama).filter(Boolean))].sort((a, b) => a.localeCompare(b, "id-ID"));
  const submit = async event => { event.preventDefault(); setSaving(true); setError(""); try { const data = Object.fromEntries(new FormData(event.currentTarget).entries()); if (!selectedRequester) throw new Error("Pilih pemesan bagian Teknik terlebih dahulu."); if (isWorkshop && !String(data.mesin || "").trim()) throw new Error("Pilih nama Armada untuk pemesan bagian Bengkel."); if (!isWorkshop && armadaMachineNames.includes(String(data.mesin || "").trim())) throw new Error("Nama Armada hanya dapat dipilih untuk pemesan bagian Bengkel."); await onSave({ ...data, items }); } catch (err) { setError(err?.message || "Bon Pesan gagal diperbarui."); } finally { setSaving(false); } };
  return <div className="modal-overlay" onMouseDown={event => event.target === event.currentTarget && !saving && onClose()}>
    <form className="modal-card bon-edit-modal" onSubmit={submit}>
      <div className="modal-head"><div><p className="eyebrow">Admin Bon Pesan</p><h3>Edit {transaction.number}</h3><small>Perubahan diterapkan pada seluruh item dalam transaksi.</small></div><button type="button" disabled={saving} onClick={onClose}><X size={18} /></button></div>
      <div className="form-grid">
        <Field label="Tanggal pesan"><input name="tglPesan" type="date" lang="id-ID" defaultValue={toDateInput(transaction.date)} required /></Field>
        <Field label="Pemesan" asDiv><ProfessionalDropdown name="pemesan" value={requester} onChange={value => { setRequester(value); setMachine(""); }} options={requesters.map(user => ({ value: user.nama, label: user.nama, meta: user.bagian || "Teknik" }))} placeholder="Pilih pemesan Teknik" searchPlaceholder="Cari nama karyawan..." icon={UserRound} /></Field>
        <Field label="Bagian"><input value={selectedRequester?.bagian || transaction.department || ""} readOnly /></Field>
        <Field label="Mesin / kebutuhan" asDiv><ProfessionalDropdown name="mesin" value={machine} onChange={setMachine} options={machineNames.map(value => ({ value, label: value, meta: machineTypeByName.get(value) || "Jenis belum tersedia" }))} placeholder={isWorkshop ? "Pilih nama Armada" : "Pilih atau tulis mesin / kebutuhan"} searchPlaceholder={isWorkshop ? "Cari nama Armada..." : "Cari mesin atau kebutuhan..."} allowCustom={!isWorkshop} icon={Settings} /></Field>
        <Field label="Catatan transaksi" wide><textarea name="keterangan" defaultValue={transaction.notes || ""} /></Field>
      </div>
      <section className="bon-edit-items"><h4>Barang dalam transaksi</h4>{items.map((item, index) => <div key={item.id}><span>{String(index + 1).padStart(2, "0")}</span><p><b>{item.nama}</b><small>{[item.ukuran, item.satuan].filter(Boolean).join(" · ")}</small></p><label><small>Jumlah</small><input type="number" min="0.001" step="any" value={item.jmlPesan} onChange={event => setItems(current => current.map(value => value.id === item.id ? { ...value, jmlPesan: event.target.value } : value))} required /></label><label><small>Kegunaan</small><input value={item.kegunaan} onChange={event => setItems(current => current.map(value => value.id === item.id ? { ...value, kegunaan: event.target.value } : value))} /></label></div>)}</section>
      {error && <div className="remote-error"><AlertTriangle size={16} /><span>{error}</span></div>}
      <div className="modal-actions"><button type="button" className="secondary" disabled={saving} onClick={onClose}>Batal</button><button className="primary" disabled={saving}>{saving ? <><span className="spinner" />Menyimpan…</> : <><Check size={16} />Simpan perubahan</>}</button></div>
    </form>
  </div>;
}

function PartRequests({ go, session, notify }) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(null), [editing, setEditing] = useState(null), [arrivalItem, setArrivalItem] = useState(null), [busy, setBusy] = useState("");
  const isAdmin = String(session?.role || "").toLocaleLowerCase("id-ID") === "admin";
  const remote = useRemoteData(async () => asArray(await apiGet(ENDPOINTS.partRequests, { action: "getDaftarBon" }, { cache: false, timeout: 45000 })));
  const adminMetadata = useRemoteData(async () => {
    if (!isAdmin) return { requesters: [], machines: [] };
    const [usersResult, machinesResult] = await Promise.all([apiPost(ENDPOINTS.users, { action: "getAllUsers", token: session.token }, { timeout: 90000 }), apiGet(ENDPOINTS.maintenanceMaster, { action: "getRawatMaster" }, { timeout: 45000 })]);
    return { requesters: asArray(usersResult).filter(user => String(user.role || "").trim().toLocaleLowerCase("id-ID") === "teknik"), machines: asArray(machinesResult) };
  }, [isAdmin, session?.token]);
  const transactions = useMemo(() => {
    const grouped = new Map();
    remote.data.forEach(row => { const key = row.transactionId; if (!key) return; if (!grouped.has(key)) grouped.set(key, { key, number: row.transactionNumber, date: row.tglPesan || row.tanggal, requester: row.pemesan, department: row.bagian, machine: row.mesin, status: row.transactionStatus || "Open", photoUrl: row.photoUrl, scanEnhanced: row.scanEnhanced, notes: row.transactionNotes, items: [] }); grouped.get(key).items.push(row); });
    return [...grouped.values()].map(transaction => ({ ...transaction, closedItems: transaction.items.filter(item => String(item.status).toLowerCase() === "close").length }));
  }, [remote.data]);
  const itemRows = useMemo(() => transactions.flatMap(transaction => [...transaction.items].sort((a, b) => a.itemPosition - b.itemPosition).map(item => ({ transaction, item }))), [transactions]);
  const filtered = itemRows.filter(({ transaction, item }) => `${transaction.number} ${transaction.date} ${transaction.requester} ${transaction.department} ${transaction.machine} ${item.nama} ${item.kategori} ${item.ukuran} ${item.satuan} ${item.status}`.toLowerCase().includes(query.toLowerCase()));
  const openItems = itemRows.filter(({ item }) => String(item.status).toLowerCase() !== "close").length;
  const closedItems = itemRows.length - openItems;
  const editTransaction = transaction => { setSelected(null); setEditing(transaction); };
  const saveTransaction = async data => { const result = await apiPost(ENDPOINTS.partOrder, { action: "updateOrder", transactionId: editing.key, token: session.token, ...data }, { timeout: 90000 }); if (!isSuccess(result)) throw new Error(result.message || "Bon Pesan gagal diperbarui."); setEditing(null); notify(result.message || "Bon Pesan berhasil diperbarui."); await remote.reload(); };
  const deleteTransaction = async transaction => { if (!isAdmin || busy) return; if (!window.confirm(`Hapus ${transaction.number} beserta ${transaction.items.length} item? Data ini tidak dapat dipulihkan.`)) return; setBusy(transaction.key); try { const result = await apiPost(ENDPOINTS.partOrder, { action: "deleteOrder", transactionId: transaction.key, token: session.token }, { timeout: 90000 }); if (!isSuccess(result)) throw new Error(result.message || "Bon Pesan gagal dihapus."); setSelected(null); setEditing(null); notify(result.message || "Bon Pesan berhasil dihapus."); await remote.reload(); } catch (error) { notify(error?.message || "Bon Pesan gagal dihapus."); } finally { setBusy(""); } };
  const saveArrival = async data => { const result = await apiPost(ENDPOINTS.partOrder, { action: "closeItem", token: session.token, ...data }, { timeout: 90000 }); if (!isSuccess(result)) throw new Error(result.message || "Kedatangan barang gagal disimpan."); setArrivalItem(null); setSelected(null); notify(result.message || "Kedatangan barang berhasil disimpan."); await remote.reload(); };
  const actionButtons = transaction => isAdmin ? <><button type="button" onClick={() => editTransaction(transaction)} aria-label={`Edit ${transaction.number}`}><Edit3 size={15} /></button><button type="button" className="danger" disabled={busy === transaction.key} onClick={() => deleteTransaction(transaction)} aria-label={`Hapus ${transaction.number}`}><Trash2 size={15} /></button>{transaction.photoUrl && <a href={transaction.photoUrl} target="_blank" rel="noreferrer" aria-label={`Foto ${transaction.number}`}><ImagePlus size={15} /></a>}</> : null;
  return <>
    <div className="stats-grid three"><Stat icon={ClipboardList} label="Barang terbuka" value={remote.loading ? "…" : openItems} detail="Belum datang" tone="mint" /><Stat icon={Package} label="Total barang" value={remote.loading ? "…" : itemRows.length} detail="Seluruh item Bon" tone="blue" /><Stat icon={CheckCircle2} label="Barang selesai" value={remote.loading ? "…" : closedItems} detail="Sudah datang" tone="violet" /></div>
    <Panel title="Daftar bon pesan" action={<button className="primary small" onClick={() => go("partOrder")}><Plus size={16} />Buat bon</button>}>
      <Toolbar query={query} setQuery={setQuery} /><RemoteState loading={remote.loading} error={remote.error} empty={!filtered.length} onRetry={remote.reload} />
      {!remote.loading && !remote.error && filtered.length > 0 && <SimpleTable
        headers={["Nomor bon", "Tanggal pesan", "Nama barang", "Kategori", "Ukuran / tipe", "Datang / pesan", "Pemesan", "Mesin / kebutuhan", "Tanggal datang", "Status", ...(isAdmin ? ["Aksi"] : [])]}
        rows={filtered.map(({ transaction, item }) => [
          <button type="button" className="bon-number-link" onClick={() => setSelected(transaction)}>{transaction.number}</button>, transaction.date || "-",
          <button type="button" className="bon-item-table-link" onClick={() => setSelected(transaction)}>{item.nama || "-"}</button>,
          item.kategori || "-", item.ukuran || "-", `${Number(item.jmlDatang || 0).toLocaleString("id-ID")} / ${Number(item.jmlPesan || 0).toLocaleString("id-ID")} ${item.satuan || ""}`, transaction.requester || "-", transaction.machine || "-", item.arrivedAtLabel || "-", <Badge text={item.status || "Open"} />,
          ...(isAdmin ? [<div className="bon-table-actions"><button type="button" onClick={() => setSelected(transaction)} aria-label={`Detail ${item.nama}`}><Eye size={15} /></button><button type="button" className={String(item.status).toLowerCase() === "close" ? "completed" : ""} disabled={String(item.status).toLowerCase() === "close"} onClick={() => setArrivalItem(item)} aria-label={`Catat kedatangan ${item.nama}`} title={String(item.status).toLowerCase() === "close" ? "Item sudah Close" : "Catat kedatangan barang"}><CheckCircle2 size={15} /></button>{actionButtons(transaction)}</div>] : [])
        ])}
        rowKeys={filtered.map(({ transaction, item }) => `${transaction.key}-${item.id}`)}
      />}
    </Panel>
    {selected && <BonRequestDetailModal transaction={selected} isAdmin={isAdmin} busy={busy === selected.key} onClose={() => setSelected(null)} onEdit={() => editTransaction(selected)} onDelete={() => deleteTransaction(selected)} onItemArrival={setArrivalItem} />}
    {editing && <BonRequestEditor transaction={editing} requesters={adminMetadata.data?.requesters || []} machines={adminMetadata.data?.machines || []} onClose={() => setEditing(null)} onSave={saveTransaction} />}
    {arrivalItem && <BonItemArrivalModal item={arrivalItem} onClose={() => setArrivalItem(null)} onSave={saveArrival} />}
  </>;
}

function More({ go, session, notify }) {
  const items = [
    ["users", "Teknisi", "Manajemen teknisi", Users, "mint", session.role === "Admin"],
    ["oil", "Cek Oli", "Level dan volume reservoir", Droplets, "blue", ["Admin", "Teknik"].includes(session.role)],
    ["transformer", "Trafo Las", "Monitoring trafo las", Zap, "amber", true],
    ["overtime", "Lemburan", "Pengajuan kerja lembur", Clock3, "violet", true],
    ["overtimeRecap", "Rekap Lembur", "Total jam dan upah karyawan", FileBarChart, "amber", session.role === "Admin"],
    ["catalog", "Katalog", "Referensi produk teknik", BookOpen, "blue", true],
    ["settings", "Pengaturan", "Preferensi sistem", Settings, "mint", true]
  ];
  return <div className="more-grid">{items.map(([id, title, sub, Icon, tone, allowed]) => <button key={id} className={`more-card ${!allowed ? "locked" : ""}`} onClick={() => allowed ? go(id) : notify("Hanya Admin yang memiliki akses.")}><span className={`icon-box ${tone}`}><Icon /></span><div><b>{title}</b><small>{sub}</small></div><ArrowRight /></button>)}</div>;
}

function TransformerMenu({ go }) {
  return <div className="split-actions"><button className="choice-card large-choice" onClick={() => go("transformerForm")}><span className="icon-box amber"><ClipboardCheck /></span><div><b>Isi inspeksi</b><small>Catat kondisi, status stang, kabel, masa, dan keterangan trafo las.</small></div><ArrowRight /></button><button className="choice-card large-choice" onClick={() => go("transformerData")}><span className="icon-box blue"><Database /></span><div><b>Data trafo las</b><small>Lihat master aset transformator las.</small></div><ArrowRight /></button></div>;
}

function TransformerForm({ notify }) {
  const travos = useRemoteData(async () => asArray(await apiGet(ENDPOINTS.transformer, { action: "getDataTravo" })));
  const refs = useRemoteData(() => apiGet(ENDPOINTS.transformer, { action: "getReferensi" }));
  const submit = async (data) => {
    const selected = travos.data.find(x => x.kode === data.kode);
    const result = await apiPost(ENDPOINTS.transformer, { action: "simpanInspeksi", ...data, nama: selected?.nama || data.nama });
    if (!isSuccess(result)) throw new Error(result.message || "Inspeksi trafo gagal disimpan.");
    notify("Data inspeksi trafo berhasil disimpan dan tersinkron.");
  };
  return <FormPanel title="Form inspeksi transformator" onSubmit={submit} submit="Simpan inspeksi">
    <Field label="Kode trafo"><select name="kode" required><option value="">Pilih kode</option>{travos.data.map(x => <option key={x.kode}>{x.kode}</option>)}</select></Field><Field label="Lokasi"><select name="lokasi">{asArray(refs.data?.lokasi).map(x => <option key={x}>{x}</option>)}</select></Field><Field label="Kondisi"><select name="kondisi"><option>Bagus</option><option>Rusak</option><option>N/A</option></select></Field><Field label="Status"><select name="status"><option>Digunakan</option><option>Standby</option><option>Rusak</option><option>Servis</option></select></Field><Field label="Stang las"><select name="stang"><option>Ada</option><option>Tidak</option><option>Rusak</option></select></Field><Field label="Kabel las"><select name="kabel"><option>Ada</option><option>Tidak</option><option>Rusak</option></select></Field><Field label="Masa las"><select name="masa"><option>Ada</option><option>Tidak</option><option>Rusak</option></select></Field><Field label="Keterangan" wide><textarea name="keterangan" /></Field>
  </FormPanel>;
}

function Catalog() {
  const items = [
    ["Bearing", "Komponen bantalan putar", Gauge, "https://drive.google.com/file/d/1tN3fUbcZZFIik2ne-qhtUgzoHXfVqR8y/view?usp=drive_link"],
    ["Baut", "Fastener industri", Settings, "https://drive.google.com/file/d/1CYVlwlHJ2vlEVinisZBqxXI1VgNC9Bqs/view?usp=drive_link"],
    ["Chain Coupling", "Rantai transmisi", SlidersHorizontal, "https://drive.google.com/file/d/1-djNvG4UZl_bS2l_4MuUnpv-Adj_EEgi/view?usp=drive_link"],
    ["Circlip", "Retaining ring", CircleIcon, "https://drive.google.com/file/d/1UH5kRt9hzUjjnrBVgFRODjToZpld6m_j/view?usp=drive_link"],
    ["Flange", "Sambungan perpipaan", Activity, "https://drive.google.com/file/d/1_NR0iIaRgz41jjMCnKc5P6zH2UKaLp7Q/view?usp=drive_link"],
    ["O-Ring", "Sistem penyekat", Boxes, "https://drive.google.com/file/d/1zqcM5-r60p7U0byWZaHW3I4xYIXG2eG2/view?usp=share_link"]
  ];
  return <div className="catalog-grid">{items.map(([name, sub, Icon, url]) => <article key={name}><div className="catalog-art"><Icon size={42} /></div><b>{name}</b><small>{sub}</small><button onClick={() => window.open(url, "_blank", "noopener,noreferrer")}>Lihat katalog <ArrowRight size={15} /></button></article>)}</div>;
}
function CircleIcon(props) { return <Activity {...props} />; }

function Stang({ notify }) {
  const remote = useRemoteData(() => apiGet(ENDPOINTS.stang, { action: "getDatabaseStang" }));
  const summary = remote.data?.rangkuman || {};
  const submit = async (data) => {
    const params = data.action === "pinjam"
      ? { action: "pinjam", kode: "", keluar: toIdDate(data.tanggal), namaKeluar: data.group, digunakan: data.lokasi, kembali: "", namaKembali: "", dari: "", merk: data.merk, durasi: "0", keterangan: data.keterangan }
      : { action: "kembali", kode: data.kode, keluar: "", namaKeluar: "", digunakan: "", kembali: toIdDate(data.tanggal), namaKembali: data.group, dari: data.lokasi, merk: data.merk, durasi: data.durasi || "0", keterangan: data.keterangan };
    const result = await apiPost(ENDPOINTS.stang, params);
    if (!isSuccess(result)) throw new Error(result.message || "Transaksi stang gagal.");
    notify("Transaksi stang berhasil disimpan dan tersinkron.");
    remote.reload();
  };
  return <><div className="stats-grid three"><Stat icon={SlidersHorizontal} label="Total dikeluarkan" value={summary.totalDikeluarkan || "…"} detail="Data Spreadsheet" tone="blue" /><Stat icon={Warehouse} label="Sudah kembali" value={summary.totalSudahKembali || "…"} detail="Data Spreadsheet" tone="mint" /><Stat icon={History} label="Belum kembali" value={summary.totalBelumKembali || "…"} detail="Perlu ditelusuri" tone="amber" /></div><FormPanel title="Sirkulasi stang" onSubmit={submit} submit="Simpan transaksi"><Field label="Jenis transaksi"><select name="action"><option value="pinjam">Keluar / pinjam</option><option value="kembali">Kembali</option></select></Field><Field label="Kode stang"><input name="kode" placeholder={remote.data?.nextKode || "Otomatis untuk peminjaman"} /></Field><Field label="Tanggal"><input name="tanggal" type="date" lang="id-ID" defaultValue={new Date().toISOString().slice(0, 10)} /></Field><Field label="Merk"><select name="merk">{asArray(remote.data?.merk).map(x => <option key={x}>{x}</option>)}</select></Field><Field label="Group"><select name="group">{asArray(remote.data?.group).map(x => <option key={x}>{x}</option>)}</select></Field><Field label="Lokasi"><select name="lokasi">{asArray(remote.data?.lokasi).map(x => <option key={x}>{x}</option>)}</select></Field><Field label="Durasi (hari, untuk kembali)"><input name="durasi" type="number" /></Field><Field label="Keterangan" wide><textarea name="keterangan" /></Field></FormPanel>
    <Panel title="Stang belum kembali"><RemoteState loading={remote.loading} error={remote.error} empty={!asArray(remote.data?.belumKembali).length} onRetry={remote.reload} />{asArray(remote.data?.belumKembali).length > 0 && <SimpleTable headers={["Kode", "Tanggal keluar", "Group", "Digunakan"]} rows={remote.data.belumKembali.map(x => [x.kode, x.keluar, x.namaKeluar, x.digunakan])} />}</Panel></>;
}

function machineNameFromScan(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  try {
    const url = new URL(text);
    return String(url.searchParams.get("namaMesin") || url.searchParams.get("mesin") || url.searchParams.get("nama") || "").trim();
  } catch {
    return text;
  }
}

function Scanner({ go, notify }) {
  const [code, setCode] = useState("");
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState("");
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const frameRef = useRef(0);
  const stopScanner = () => {
    if (frameRef.current) cancelAnimationFrame(frameRef.current);
    frameRef.current = 0;
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setScanning(false);
  };
  useEffect(() => () => stopScanner(), []);
  const openCode = raw => {
    const electricityMode = electricityQrRequest(raw).mode;
    if (electricityMode) {
      stopScanner();
      notify(electricityMode === "pln" ? "Stand meter PLN ditemukan." : `${electricityMode.replace("_", " ")} ditemukan.`);
      go("electricity", { electricityMode });
      return;
    }
    const name = machineNameFromScan(raw);
    if (!name) {
      setScanError("Kode tidak memuat parameter namaMesin atau mesin.");
      return;
    }
    stopScanner();
    notify(`Mesin ${name} ditemukan. Lengkapi order kerja.`);
    go("createOrder", { fromScanner: true, namaMesin: name });
  };
  const startScanner = async () => {
    setScanError("");
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("Browser tidak menyediakan akses kamera.");
      if (!("BarcodeDetector" in window)) throw new Error("Pemindai kamera belum didukung browser ini. Gunakan Chrome/Brave terbaru atau masukkan kode secara manual.");
      const supported = await window.BarcodeDetector.getSupportedFormats();
      const requested = ["qr_code", "code_128", "code_39", "ean_13", "ean_8"].filter(format => supported.includes(format));
      if (!requested.length) throw new Error("Format QR/barcode tidak didukung browser ini.");
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
      streamRef.current = stream;
      setScanning(true);
      const video = videoRef.current;
      video.srcObject = stream;
      await video.play();
      const detector = new window.BarcodeDetector({ formats: requested });
      const detect = async () => {
        if (!streamRef.current) return;
        try {
          const results = await detector.detect(video);
          if (results.length) return openCode(results[0].rawValue);
        } catch { }
        frameRef.current = requestAnimationFrame(detect);
      };
      frameRef.current = requestAnimationFrame(detect);
    } catch (error) {
      stopScanner();
      setScanError(error?.message || "Kamera tidak dapat dibuka. Pastikan izin kamera diberikan.");
    }
  };
  return <div className="scanner-card">
    <div className={`scan-frame ${scanning ? "active" : ""}`}><span /><span /><span /><span /><video ref={videoRef} playsInline muted />{!scanning && <QrCode size={108} />}</div>
    <h2>Pindai QR aset</h2>
    <p>QR mesin membuka order kerja. QR stand meter PLN atau panel listrik membuka formulir pemeriksaan yang sesuai.</p>
    {scanError && <div className="remote-error"><AlertTriangle size={17} /><span>{scanError}</span></div>}
    <button className={scanning ? "secondary wide" : "primary wide"} type="button" onClick={scanning ? stopScanner : startScanner}>{scanning ? "Hentikan kamera" : "Aktifkan kamera dan pindai"}</button>
    <div className="manual-code"><input value={code} onChange={(e) => setCode(e.target.value)} onKeyDown={event => event.key === "Enter" && openCode(code)} placeholder="Masukkan nama mesin atau tautan QR" /><button className="primary" onClick={() => code ? openCode(code) : notify("Masukkan kode terlebih dahulu.")}>Buka data</button></div>
  </div>;
}

function SettingsPage({ notify, themeMode, onThemeChange, session }) {
  const isAdmin = String(session?.role || "").trim().toLowerCase() === "admin";
  useEffect(() => {
    if (isAdmin) preloadWorkbookModules();
  }, [isAdmin]);
  const [backupBusy, setBackupBusy] = useState("");
  const [backupProgress, setBackupProgress] = useState("");
  const [backupManifest, setBackupManifest] = useState(null);
  const [showDownloadPicker, setShowDownloadPicker] = useState(false);
  const [downloadSelection, setDownloadSelection] = useState(() => new Set());
  const [importPreview, setImportPreview] = useState(null);
  const [importSelection, setImportSelection] = useState(() => new Set());
  const [candidateSelection, setCandidateSelection] = useState(() => new Set());
  const inputRef = useRef(null);
  const getManifest = () => apiGet(ENDPOINTS.backup, { action: "manifest" }, { cache: false, timeout: 120000 });
  const toggleSelection = (setter, key) => setter(previous => {
    const next = new Set(previous);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });
  const openDownloadPicker = async () => {
    if (backupManifest) { setShowDownloadPicker(value => !value); return; }
    setBackupBusy("manifest"); setBackupProgress("Mengambil daftar data...");
    try {
      const manifest = await getManifest();
      setBackupManifest(manifest); setShowDownloadPicker(true);
    } catch (error) { notify(error?.message || "Daftar data gagal dimuat."); }
    finally { setBackupBusy(""); setBackupProgress(""); }
  };
  const downloadSelected = async () => {
    if (!backupManifest || !downloadSelection.size) { notify("Centang minimal satu data yang akan diunduh."); return; }
    setBackupBusy("download"); setBackupProgress("Menyiapkan data pilihan...");
    try {
      const selected = backupManifest.datasets.filter(dataset => downloadSelection.has(dataset.key));
      const operational = selected.filter(dataset => dataset.operationalFormat);
      const generic = selected.filter(dataset => !dataset.operationalFormat);
      const { createBackupWorkbook, createDirectBackupWorkbook, downloadWorkbook } = await loadDataWorkbook();
      let downloaded = 0;
      for (let index = 0; index < operational.length; index += 1) {
        const definition = operational[index];
        setBackupProgress(`Membuat ${definition.label} dalam format master (${index + 1}/${operational.length})...`);
        const payload = await apiGet(ENDPOINTS.backup, { action: "direct-export", documentType: definition.operationalFormat }, { cache: false, timeout: 120000 });
        const file = await createDirectBackupWorkbook(definition.operationalFormat, payload);
        downloadWorkbook(file.buffer, file.filename); downloaded += 1;
      }
      if (generic.length) {
        const manifest = { ...backupManifest, datasets: generic };
        const buffer = await createBackupWorkbook(manifest, async key => apiGet(ENDPOINTS.backup, { action: "export", dataset: key }, { cache: false, timeout: 120000 }), progress => setBackupProgress(`Mengambil ${progress.label} (${progress.current}/${progress.total})...`));
        downloadWorkbook(buffer, `siteki-backup-${new Date().toISOString().slice(0, 10)}.xlsx`); downloaded += 1;
      }
      notify(`${selected.length} kelompok data berhasil dibuat dalam ${downloaded} file.`);
    } catch (error) { notify(error?.message || "Backup data gagal dibuat."); }
    finally { setBackupBusy(""); setBackupProgress(""); }
  };
  const sendImportChunk = (dataset, rows, validateOnly = false) => apiPost(ENDPOINTS.backup,
    dataset.importMode === "direct"
      ? { action: "direct-import", documentType: dataset.documentType, rows, validateOnly }
      : { action: "import", dataset: dataset.key, rows, validateOnly },
    { timeout: 120000 });
  const validateChunks = async datasets => {
    const totals = { checked: 0, inserted: 0, skipped: 0, unmatchedMachines: 0, unmatchedParts: 0, timeAnomalies: 0, durationAnomalies: 0, candidateRows: [] };
    for (const dataset of datasets) {
      const chunkSize = dataset.importMode === "direct" ? 2000 : 250;
      for (let start = 0; start < dataset.rows.length; start += chunkSize) {
        setBackupProgress(`Memvalidasi ${dataset.label} (${Math.min(start + chunkSize, dataset.rows.length)}/${dataset.rows.length})...`);
        const result = await sendImportChunk(dataset, dataset.rows.slice(start, start + chunkSize), true);
        totals.inserted += Number(result.inserted || 0); totals.skipped += Number(result.skipped || 0);
        totals.unmatchedMachines += Number(result.warnings?.unmatchedMachines || 0);
        totals.unmatchedParts += Number(result.warnings?.unmatchedParts || 0);
        totals.timeAnomalies += Number(result.warnings?.timeAnomalies || 0);
        totals.durationAnomalies += Number(result.warnings?.durationAnomalies || 0);
        if (Array.isArray(result.candidateRows)) totals.candidateRows.push(...result.candidateRows);
      }
      totals.checked += dataset.rows.length;
    }
    return totals;
  };
  const chooseWorkbook = async event => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setBackupBusy("validate"); setImportPreview(null); setBackupProgress("Membaca workbook...");
    try {
      const isDirect = /rekap\s*perawatan|laporan\s*kerja/i.test(file.name || "");
      let parsed;
      if (isDirect) {
        const { parseDirectWorkbook } = await loadDirectWorkbook();
        parsed = await parseDirectWorkbook(file);
      } else {
        const manifest = await getManifest();
        setBackupManifest(manifest);
        try {
          const { parseBackupWorkbook } = await loadDataWorkbook();
          parsed = await parseBackupWorkbook(file, manifest);
        } catch (error) {
          if (!/bukan workbook backup SiTeki/i.test(error?.message || "")) throw error;
          const { parseDirectWorkbook } = await loadDirectWorkbook();
          parsed = await parseDirectWorkbook(file);
        }
      }
      let oldRows, candidates, warnings = null;
      if (parsed.kind === "direct") {
        const validation = await validateChunks(parsed.datasets);
        oldRows = validation.skipped; candidates = validation.inserted;
        warnings = {
          ...parsed.warnings, unmatchedMachines: validation.unmatchedMachines,
          unmatchedParts: validation.unmatchedParts, timeAnomalies: validation.timeAnomalies,
          durationAnomalies: validation.durationAnomalies
        };
        parsed.candidateRows = validation.candidateRows;
      } else {
        oldRows = parsed.datasets.reduce((total, dataset) => total + dataset.rows.filter(row => dataset.keyColumns.length === 1 && dataset.keyColumns[0] === "id" && row.id !== null && row.id !== "").length, 0);
        candidates = parsed.totalRows - oldRows;
      }
      setImportSelection(new Set(parsed.datasets.map(dataset => dataset.key)));
      setCandidateSelection(new Set((parsed.candidateRows || []).map(row => String(row.source_row))));
      setImportPreview({ ...parsed, oldRows, candidates, warnings });
      notify(parsed.kind === "direct" ? `${parsed.datasets[0].label} dikenali otomatis. Periksa pratinjau sebelum mengunggah.` : "Workbook berhasil dibaca. Pilih sheet yang akan diunggah.");
    } catch (error) { notify(error?.message || "Workbook tidak dapat dibaca."); }
    finally { setBackupBusy(""); setBackupProgress(""); }
  };
  const applyWorkbook = async () => {
    if (!importPreview) return;
    const datasets = importPreview.datasets.filter(dataset => importSelection.has(dataset.key)).map(dataset =>
      dataset.importMode === "direct"
        ? { ...dataset, rows: dataset.rows.filter(row => candidateSelection.has(String(row.source_row))) }
        : dataset
    );
    if (!datasets.length) { notify("Centang minimal satu sheet yang akan diunggah."); return; }
    if (datasets.some(dataset => !dataset.rows.length)) { notify("Centang minimal satu kandidat data baru yang akan dimasukkan."); return; }
    const selectedRows = datasets.reduce((total, dataset) => total + dataset.rows.length, 0);
    if (!window.confirm(importPreview.kind === "direct" ? `Upload ${selectedRows} data terpilih? Data baru akan dimasukkan dan data lama yang cocok akan diperbarui dengan data terbaru.` : `Upload data dari ${datasets.length} sheet terpilih?`)) return;
    setBackupBusy("import");
    let inserted = 0, skipped = 0;
    try {
      await validateChunks(datasets);
      for (const dataset of datasets) {
        const chunkSize = dataset.importMode === "direct" ? 2000 : 250;
        for (let start = 0; start < dataset.rows.length; start += chunkSize) {
          setBackupProgress(`Menyimpan ${dataset.label} (${Math.min(start + chunkSize, dataset.rows.length)}/${dataset.rows.length})...`);
          const result = await sendImportChunk(dataset, dataset.rows.slice(start, start + chunkSize));
          inserted += Number(result.inserted || 0); skipped += Number(result.skipped || 0);
        }
      }
      setImportPreview(null);
      setImportSelection(new Set());
      setCandidateSelection(new Set());
      notify(`${inserted.toLocaleString("id-ID")} data berhasil diunggah/diperbarui.`);
    } catch (error) { notify(`${error?.message || "Impor gagal."} ${inserted ? `${inserted.toLocaleString("id-ID")} data sebelumnya sudah diproses.` : ""}`); }
    finally { setBackupBusy(""); setBackupProgress(""); }
  };
  return <Panel title="Preferensi">
    <div className="theme-setting">
      <div><p className="eyebrow">Tema antarmuka</p><h3>Pilih tampilan SiTeki</h3><small>Preferensi tersimpan otomatis pada perangkat ini.</small></div>
      <div className="theme-options">
        <button type="button" className={themeMode === "light" ? "active" : ""} onClick={() => onThemeChange("light")}><Sun size={19} /><span><b>Terang</b><small>Tampilan cerah</small></span>{themeMode === "light" && <Check size={16} />}</button>
        <button type="button" className={themeMode === "dark" ? "active" : ""} onClick={() => onThemeChange("dark")}><Moon size={19} /><span><b>Gelap</b><small>Nyaman di malam hari</small></span>{themeMode === "dark" && <Check size={16} />}</button>
      </div>
    </div>
    <NotificationSettings session={session} notify={notify} />
    <section className="backup-settings">
      <div className="backup-heading"><span className="icon-box mint"><Database size={20} /></span><div><p className="eyebrow">Khusus administrator</p><h3>Download & impor data pilihan</h3><small>Pilih kelompok data agar proses download dan upload lebih cepat.</small></div></div>
      <div className="backup-rules"><ShieldCheck size={17} /><span>Impor data akan memasukkan data baru dan memperbarui data lama jika memiliki ID atau data yang terdeteksi sama (mengambil data upload terbaru).</span></div>
      {isAdmin ? <><div className="backup-actions">
        <button type="button" className="secondary" onClick={openDownloadPicker} disabled={!!backupBusy}><Download size={17} />{backupBusy === "manifest" ? "Memuat..." : showDownloadPicker ? "Tutup pilihan download" : "Pilih data untuk download"}</button>
        <button type="button" className="primary" onClick={() => inputRef.current?.click()} disabled={!!backupBusy}><FilePlus2 size={17} />{backupBusy === "validate" ? "Membaca..." : "Pilih file untuk upload"}</button>
        <input ref={inputRef} className="backup-file-input" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={chooseWorkbook} />
      </div>
        {showDownloadPicker && backupManifest && (() => {
          const visibleDatasets = backupManifest.datasets.filter(d => d.key !== "maintenance_inspections");
          return (
            <div className="backup-picker">
              <div className="backup-picker-head"><div><b>Pilih data yang akan di-download</b><small>{downloadSelection.size} dari {visibleDatasets.length} dipilih</small></div><div><button type="button" onClick={() => setDownloadSelection(new Set(visibleDatasets.map(dataset => dataset.key)))}>Pilih semua</button><button type="button" onClick={() => setDownloadSelection(new Set())}>Kosongkan</button></div></div>
              <div className="backup-dataset-grid">{visibleDatasets.map(dataset => <label key={dataset.key} className={downloadSelection.has(dataset.key) ? "selected" : ""}><input type="checkbox" checked={downloadSelection.has(dataset.key)} onChange={() => toggleSelection(setDownloadSelection, dataset.key)} /><span><b>{dataset.label}</b><small>{Number(dataset.count || 0).toLocaleString("id-ID")} baris{dataset.operationalFormat ? " · format master siap upload" : ""}</small></span></label>)}</div>
              <button type="button" className="primary backup-confirm" onClick={downloadSelected} disabled={!downloadSelection.size || !!backupBusy}><Download size={16} />Download {downloadSelection.size} data pilihan</button>
            </div>
          );
        })()}
        {backupProgress && <div className="backup-progress"><span className="spinner dark" />{backupProgress}</div>}
        {importPreview && <div className="backup-preview">
          <div className="backup-preview-title"><b>{importPreview.filename}</b><small>{importPreview.kind === "direct" ? `${importPreview.datasets[0]?.label || "Dokumen"} dikenali otomatis dari nama file, sheet, dan judul kolom.` : "Pilih sheet yang akan diproses."} Data yang cocok akan diperbarui dengan data baru dari file ini.</small>{importPreview.warnings?.duplicatesInFile > 0 && <small className="backup-warning">{importPreview.warnings.duplicatesInFile.toLocaleString("id-ID")} baris identik di dalam file dilewati otomatis agar laporan dan KPI tidak terhitung ganda.</small>}{importPreview.warnings?.unmatchedMachines > 0 && <small className="backup-warning">{importPreview.warnings.unmatchedMachines.toLocaleString("id-ID")} baris memakai nama mesin yang belum cocok dengan master; data tetap dapat disimpan tanpa relasi master.</small>}{importPreview.warnings?.unmatchedParts > 0 && <small className="backup-warning">{importPreview.warnings.unmatchedParts.toLocaleString("id-ID")} baris memakai part yang belum cocok dengan master; laporan tetap tersimpan tanpa relasi part.</small>}{importPreview.warnings?.timeAnomalies > 0 && <small className="backup-warning">{importPreview.warnings.timeAnomalies.toLocaleString("id-ID")} baris memiliki jam selesai sebelum jam mulai dan akan ditandai sebagai anomali sumber.</small>}{importPreview.warnings?.durationAnomalies > 0 && <small className="backup-warning">{importPreview.warnings.durationAnomalies.toLocaleString("id-ID")} baris memiliki Total Jam yang berbeda dari selisih waktu dan akan ditandai sebagai anomali sumber.</small>}</div>
          <div className="backup-counts"><span><b>{importPreview.oldRows.toLocaleString("id-ID")}</b><small>baris diperbarui</small></span><span><b>{importPreview.candidates.toLocaleString("id-ID")}</b><small>baris baru</small></span></div>
          <div className="backup-import-picker">{importPreview.datasets.map(dataset => <label key={dataset.key} className={importSelection.has(dataset.key) ? "selected" : ""}><input type="checkbox" checked={importSelection.has(dataset.key)} onChange={() => toggleSelection(setImportSelection, dataset.key)} /><span><b>{dataset.label}</b><small>{dataset.rows.length.toLocaleString("id-ID")} baris</small></span></label>)}</div>
          {importPreview.kind === "direct" && importPreview.candidateRows?.length > 0 && <div className="backup-candidate-list"><div><b>Data yang akan di-upload / diperbarui</b><small>{candidateSelection.size} dari {importPreview.candidateRows.length} dipilih</small></div>{importPreview.candidateRows.map((row, index) => <label key={`${row.inspected_on || row.report_date}-${row.machine_name}-${index}`} className={candidateSelection.has(String(row.source_row)) ? "selected" : ""}><input type="checkbox" checked={candidateSelection.has(String(row.source_row))} onChange={() => toggleSelection(setCandidateSelection, String(row.source_row))} /><strong>{row.inspected_on || row.report_date}</strong><em>{row.machine_name}</em><small>{row.schedule_code || row.work_description || ""}{row.source_row ? ` · baris ${row.source_row}` : ""}{row.is_update ? " · [Pembaruan]" : " · [Data baru]"}</small></label>)}</div>}
          <button type="button" className="primary" onClick={applyWorkbook} disabled={!importSelection.size || (importPreview.kind === "direct" && !candidateSelection.size) || !!backupBusy}>{backupBusy === "import" ? "Mengunggah..." : importPreview.kind === "direct" ? `Upload ${candidateSelection.size} data pilihan` : `Upload data dari ${importSelection.size} sheet`}</button>
          <button type="button" className="secondary" onClick={() => { setImportPreview(null); setCandidateSelection(new Set()); }} disabled={!!backupBusy}>Batal</button>
        </div>}</> : <div className="backup-locked"><ShieldCheck size={17} /><span>Masuk menggunakan akun dengan role Admin untuk menggunakan backup dan impor.</span></div>}
    </section>
  </Panel>;
}

const EMPTY_USER = {
  username: "", password: "", nama: "", role: "Teknik", fungsi: "", nik: "", jabatan: "", bagian: "", regu: "",
  tglMasuk: "", lamaKerja: "", kontrakTerakhir: "", pendidikan: "", jurusan: "", statusPegawai: "Kontrak",
  statusGaji: "Harian", tunjangan: "", tLahir: "", tglLahir: "", usia: "", alamat: "", noTelp: "",
  noTelpDarurat: "", gajiPokok: "0", gajiHarian: "0", keterangan: ""
};
const USER_FIELDS = [
  ["username", "Username", "text"], ["password", "Password baru", "password"], ["nama", "Nama lengkap", "text"],
  ["role", "Role sistem", "role"], ["fungsi", "Fungsi", "text"], ["nik", "NIK", "text"], ["jabatan", "Jabatan", "text"],
  ["bagian", "Bagian", "text"], ["regu", "Regu", "text"], ["tglMasuk", "Tanggal masuk", "date"],
  ["lamaKerja", "Lama kerja", "readonly"], ["kontrakTerakhir", "Kontrak terakhir", "date"],
  ["pendidikan", "Pendidikan", "text"], ["jurusan", "Jurusan", "text"], ["statusPegawai", "Status pegawai", "pegawai"],
  ["statusGaji", "Status gaji", "gaji"], ["tunjangan", "Tunjangan", "number"], ["tLahir", "Tempat lahir", "text"],
  ["tglLahir", "Tanggal lahir", "date"], ["usia", "Usia", "readonly"], ["alamat", "Alamat", "textarea"],
  ["noTelp", "Nomor telepon", "tel"], ["noTelpDarurat", "Nomor darurat", "tel"], ["gajiPokok", "Gaji pokok", "number"],
  ["gajiHarian", "Gaji harian", "number"], ["keterangan", "Keterangan", "textarea"]
];

function OvertimeEntry({ session, notify }) {
  const now = new Date();
  const initialCutoff = new Date(now);
  if (now.getDate() >= 22) {
    initialCutoff.setDate(1);
    initialCutoff.setMonth(initialCutoff.getMonth() + 1);
  }
  const [year, setYear] = useState(initialCutoff.getFullYear());
  const [month, setMonth] = useState(initialCutoff.getMonth() + 1);
  const [selected, setSelected] = useState("");
  const [hours, setHours] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const remote = useRemoteData(async () => {
    if (!session.token) throw new Error("Sesi aman tidak tersedia. Silakan logout dan login kembali.");
    const startMonth = month === 1 ? 12 : month - 1;
    const startYear = month === 1 ? year - 1 : year;
    const [startResult, endResult] = await Promise.all([
      apiPost(ENDPOINTS.users, { action: "getOvertimeCalendar", token: session.token, year: startYear, month: startMonth }, { timeout: 90000 }),
      apiPost(ENDPOINTS.users, { action: "getOvertimeCalendar", token: session.token, year, month }, { timeout: 90000 })
    ]);
    if (!isSuccess(startResult)) throw new Error(startResult.message || "Kalender awal periode lembur tidak dapat dibuka.");
    if (!isSuccess(endResult)) throw new Error(endResult.message || "Kalender akhir periode lembur tidak dapat dibuka.");
    const cutoff = startResult.cutoff || {};
    const inCutoff = item => !cutoff.tanggalAwal || !cutoff.tanggalAkhir ||
      (item?.tanggal >= cutoff.tanggalAwal && item?.tanggal <= cutoff.tanggalAkhir);
    const uniqueByDate = items => Array.from(new Map(items.filter(inCutoff).map(item => [item.tanggal, item])).values());
    return {
      ...startResult,
      data: uniqueByDate([...asArray(startResult), ...asArray(endResult)]),
      holidays: uniqueByDate([...asArray(startResult?.holidays), ...asArray(endResult?.holidays)]),
      cutoff
    };
  }, [session.token, year, month]);
  const entries = asArray(remote.data);
  const entryMap = useMemo(() => new Map(entries.map(item => [item.tanggal, item])), [entries]);
  const holidayMap = useMemo(() => new Map(asArray(remote.data?.holidays).map(item => [item.tanggal, item.nama])), [remote.data]);
  const cutoff = remote.data?.cutoff || {};
  const cutoffDates = useMemo(() => {
    const fallbackEnd = new Date(year, month - 1, 21, 12);
    const fallbackStart = new Date(year, month - 2, 22, 12);
    const parse = value => /^\d{4}-\d{2}-\d{2}$/.test(String(value || "")) ? new Date(`${value}T12:00:00`) : null;
    const start = parse(cutoff.tanggalAwal) || fallbackStart;
    const end = parse(cutoff.tanggalAkhir) || fallbackEnd;
    const dates = [];
    for (let current = new Date(start); current <= end; current.setDate(current.getDate() + 1)) dates.push(new Date(current));
    return dates;
  }, [year, month, cutoff.tanggalAwal, cutoff.tanggalAkhir]);
  const leading = cutoffDates.length ? (cutoffDates[0].getDay() + 6) % 7 : 0;
  const trailing = (7 - (leading + cutoffDates.length) % 7) % 7;
  const money = value => new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(Number(value || 0));
  const shortDate = value => value ? new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short", year: "numeric" }).format(new Date(`${value}T12:00:00`)) : "-";
  const cutoffLabel = cutoff.tanggalAwal && cutoff.tanggalAkhir ? `${shortDate(cutoff.tanggalAwal)} – ${shortDate(cutoff.tanggalAkhir)}` : `22 ${SCHEDULE_MONTHS[(month + 10) % 12]} – 21 ${SCHEDULE_MONTHS[month - 1]} ${year}`;
  const years = Array.from({ length: Math.max(1, now.getFullYear() - 2022) }, (_, index) => 2024 + index).reverse();
  const dateKey = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  const todayKey = dateKey(now);
  const openDay = key => {
    const existing = entryMap.get(key);
    setSelected(key); setHours(existing?.jam ?? ""); setNote(existing?.keterangan ?? ""); setFormError("");
  };
  const close = () => { setSelected(""); setHours(""); setNote(""); setFormError(""); };
  const save = async event => {
    event.preventDefault(); setSaving(true); setFormError("");
    try {
      const result = await apiPost(ENDPOINTS.users, { action: "saveOvertime", token: session.token, tanggal: selected, jam: Number(hours), keterangan: note }, { timeout: 90000 });
      if (!isSuccess(result)) throw new Error(result.message || "Data lembur gagal disimpan.");
      notify(result.message || "Data lembur berhasil disimpan."); close(); remote.reload();
    } catch (error) { setFormError(error?.message || "Data lembur gagal disimpan."); }
    finally { setSaving(false); }
  };
  const remove = async () => {
    setSaving(true); setFormError("");
    try {
      const result = await apiPost(ENDPOINTS.users, { action: "deleteOvertime", token: session.token, tanggal: selected }, { timeout: 90000 });
      if (!isSuccess(result)) throw new Error(result.message || "Data lembur gagal dihapus.");
      notify("Data lembur berhasil dihapus."); close(); remote.reload();
    } catch (error) { setFormError(error?.message || "Data lembur gagal dihapus."); }
    finally { setSaving(false); }
  };
  const selectedDate = selected ? new Date(`${selected}T12:00:00`) : null;
  const existing = selected ? entryMap.get(selected) : null;
  const selectedHoliday = selected ? holidayMap.get(selected) : "";
  return <>
    <div className="stats-grid three">
      <Stat icon={CalendarDays} label="Catatan cutoff" value={remote.loading ? "…" : String(cutoff.jumlahData || 0)} detail={cutoffLabel} tone="blue" />
      <Stat icon={Clock3} label="Total jam lembur" value={remote.loading ? "…" : `${Number(cutoff.totalJam || 0).toLocaleString("id-ID", { maximumFractionDigits: 2 })} jam`} detail={cutoffLabel} tone="mint" />
      <Stat icon={FileBarChart} label="Total upah" value={remote.loading ? "…" : money(cutoff.totalUpah)} detail={cutoffLabel} tone="amber" />
    </div>
    <Panel title="Kalender Lemburan" action={<div className="overtime-filters"><label><span>Periode bulan</span><select value={month} onChange={e => { setMonth(Number(e.target.value)); close(); }}>{SCHEDULE_MONTHS.map((name, index) => <option key={name} value={index + 1}>{name}</option>)}</select></label><label><span>Tahun</span><select value={year} onChange={e => { setYear(Number(e.target.value)); close(); }}>{years.map(value => <option key={value}>{value}</option>)}</select></label></div>}>
      <div className="overtime-calendar-note"><ShieldCheck size={15} /><span>Klik tanggal untuk mengisi lembur. Ringkasan mengikuti cutoff <b>{cutoffLabel}</b>. Hari Minggu dan libur nasional dihitung sebagai <b>Hari Besar</b>.</span></div>
      <RemoteState loading={remote.loading} error={remote.error} onRetry={remote.reload} />
      {!remote.loading && !remote.error && <div className="overtime-calendar">
        <div className="overtime-weekdays">{["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"].map(day => <b key={day}>{day}</b>)}</div>
        <div className="overtime-days">
          {Array.from({ length: leading }, (_, index) => <span className="empty-day" key={`empty-${index}`} />)}
          {cutoffDates.map(date => {
            const day = date.getDate(), key = dateKey(date), entry = entryMap.get(key), holiday = holidayMap.get(key);
            const today = key === todayKey;
            const entryNote = String(entry?.keterangan || "").trim();
            return <button key={key} className={`${holiday ? "holiday" : ""} ${entry ? "has-entry" : ""} ${today ? "today" : ""}`} onClick={() => openDay(key)} title={entryNote || undefined}>
              <div className="overtime-day-head"><span>{day}<i>{new Intl.DateTimeFormat("id-ID", { month: "short" }).format(date)}</i></span>{entryNote && <em>{entryNote}</em>}</div>
              {holiday && <small>{holiday}</small>}
              {entry && <div className="overtime-entry"><strong>{Number(entry.jam).toLocaleString("id-ID")} jam</strong></div>}
            </button>;
          })}
          {Array.from({ length: trailing }, (_, index) => <span className="empty-day" key={`trailing-${index}`} />)}
        </div>
      </div>}
      <div className="overtime-legend"><span><i className="holiday-dot" />Tanggal merah / hari besar</span><span><i className="entry-dot" />Lembur sudah diisi</span></div>
    </Panel>
    {selected && createPortal(<div className="overtime-modal-backdrop" onMouseDown={event => event.target === event.currentTarget && close()}>
      <form className="overtime-modal" onSubmit={save}>
        <div className="overtime-modal-head"><div><p className="eyebrow">{existing ? "Edit catatan" : "Catatan baru"}</p><h3>{new Intl.DateTimeFormat("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(selectedDate)}</h3></div><button type="button" onClick={close}><X size={18} /></button></div>
        <div className="overtime-modal-body">
          <div className={`overtime-day-status ${selectedHoliday ? "holiday" : ""}`}><CalendarDays size={17} /><span><b>{selectedHoliday ? "Lembur Hari Besar" : "Lembur Hari Kerja"}</b><small>{selectedHoliday || "Perhitungan normal"}</small></span></div>
          <label className="modal-field"><span>Jumlah jam lembur</span><input type="number" min=".5" max="24" step=".5" value={hours} onChange={e => setHours(e.target.value)} placeholder="Contoh: 2" required /></label>
          <label className="modal-field"><span>Keterangan pekerjaan</span><textarea value={note} onChange={e => setNote(e.target.value)} placeholder="Tuliskan pekerjaan yang dilakukan saat lembur…" required /></label>
          {existing && <div className="overtime-existing"><span>Upah tercatat</span><b>{money(existing.totalUpah)}</b></div>}
          {formError && <div className="remote-error"><AlertTriangle size={17} /><span>{formError}</span></div>}
        </div>
        <div className="overtime-modal-actions">{existing && <button type="button" className="danger-button" onClick={remove} disabled={saving}>Hapus</button>}<button type="submit" className="primary" disabled={saving}>{saving ? <><span className="spinner" />Menyimpan…</> : <><Check size={17} />Simpan lembur</>}</button></div>
      </form>
    </div>, document.body)}
  </>;
}

function OvertimeAdmin({ session }) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [query, setQuery] = useState("");
  const remote = useRemoteData(async () => {
    if (!session.token) throw new Error("Sesi aman tidak tersedia. Silakan logout dan login kembali.");
    const result = await apiPost(ENDPOINTS.users, { action: "getOvertimeAdmin", token: session.token, year, month }, { timeout: 90000 });
    if (!isSuccess(result)) throw new Error(result.message || "Rekap lembur tidak dapat diakses.");
    return result;
  }, [session.token, year, month]);
  const summary = remote.data?.summary || {};
  const cutoff = remote.data?.cutoff || {};
  const rows = asArray(remote.data);
  const entries = Array.isArray(remote.data?.entries) ? remote.data.entries : [];
  const filteredEntries = entries.filter(item => Object.values(item).join(" ").toLocaleLowerCase("id-ID").includes(query.toLocaleLowerCase("id-ID")));
  const money = value => new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(Number(value || 0));
  const shortDate = value => value ? new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short", year: "numeric" }).format(new Date(`${value}T12:00:00`)) : "-";
  const cutoffLabel = cutoff.tanggalAwal && cutoff.tanggalAkhir ? `${shortDate(cutoff.tanggalAwal)} – ${shortDate(cutoff.tanggalAkhir)}` : `22 ${SCHEDULE_MONTHS[month - 1]} – 21 bulan berikutnya`;
  const years = Array.from(new Set([2024, 2025, 2026, now.getFullYear()])).sort((a, b) => b - a);
  return <>
    <div className="stats-grid three">
      <Stat icon={Users} label="Karyawan lembur" value={remote.loading ? "…" : String(summary.jumlahKaryawan || 0)} detail={`${summary.jumlahData || 0} catatan • ${cutoffLabel}`} tone="blue" />
      <Stat icon={Clock3} label="Total jam lembur" value={remote.loading ? "…" : `${Number(summary.totalJam || 0).toLocaleString("id-ID", { maximumFractionDigits: 2 })} jam`} detail={cutoffLabel} tone="mint" />
      <Stat icon={FileBarChart} label="Total upah lembur" value={remote.loading ? "…" : money(summary.totalUpah)} detail={cutoffLabel} tone="amber" />
    </div>
    <Panel title="Ringkasan Upah Lemburan" action={<div className="overtime-filters">
      <select value={month} onChange={e => setMonth(Number(e.target.value))}>{SCHEDULE_MONTHS.map((name, index) => <option key={name} value={index + 1}>{name}</option>)}</select>
      <select value={year} onChange={e => setYear(Number(e.target.value))}>{years.map(value => <option key={value}>{value}</option>)}</select>
    </div>}>
      <p className="sensitive-data-note"><ShieldCheck size={15} /> Rekap periode cutoff <b>{cutoffLabel}</b>. Data upah hanya ditampilkan kepada Admin dengan token sesi yang diverifikasi server.</p>
      <RemoteState loading={remote.loading} error={remote.error} empty={!rows.length} onRetry={remote.reload} />
      {!remote.loading && !remote.error && rows.length > 0 && <SimpleTable
        headers={["Nama karyawan", "Role", "Jumlah lembur", "Total jam", "Total upah"]}
        rows={rows.map(item => [
          item.nama || "-", item.role || "-", `${item.jumlahData || 0} kali`,
          `${Number(item.totalJam || 0).toLocaleString("id-ID", { maximumFractionDigits: 2 })} jam`,
          <b className="money-value">{money(item.totalUpah)}</b>
        ])}
      />}
    </Panel>
    <Panel title="Daftar Lemburan Seluruh Karyawan" action={<button className="secondary small" onClick={() => exportCsv(
      ["Tanggal", "Nama karyawan", "Role", "Jenis lembur", "Jam", "Keterangan", "Upah"],
      filteredEntries.map(item => [item.tanggal, item.nama, item.role, item.jenis, item.jam, item.keterangan, item.totalUpah]),
      `rekap-lembur-${year}-${String(month).padStart(2, "0")}`
    )} disabled={!filteredEntries.length}><Download size={16} /> Ekspor</button>}>
      <Toolbar query={query} setQuery={setQuery} />
      <RemoteState loading={remote.loading} error={remote.error} empty={!filteredEntries.length} onRetry={remote.reload} />
      {!remote.loading && !remote.error && filteredEntries.length > 0 && <SimpleTable
        headers={["Tanggal", "Nama karyawan", "Role", "Jenis lembur", "Jam", "Keterangan", "Upah"]}
        rows={filteredEntries.map(item => [
          shortDate(item.tanggal), item.nama || "-", item.role || "-",
          item.jenis === "HariBesar" ? "Hari besar" : item.jenis === "Normal_Kecil" ? "Hari kerja < 2 jam" : "Hari kerja",
          `${Number(item.jam || 0).toLocaleString("id-ID", { maximumFractionDigits: 2 })} jam`, item.keterangan || "-",
          <b className="money-value">{money(item.totalUpah)}</b>
        ])}
      />}
    </Panel>
  </>;
}

function UserManagement({ session, notify }) {
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_USER);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const remote = useRemoteData(async () => {
    if (!session.token) throw new Error("Sesi aman belum tersedia. Keluar lalu login kembali setelah Apps Script baru diterapkan.");
    const result = await apiPost(ENDPOINTS.users, { action: "getAllUsers", token: session.token }, { timeout: 90000 });
    if (!isSuccess(result)) throw new Error(result.message || "Akses daftar teknisi ditolak.");
    return asArray(result);
  }, [session.token]);
  if (session.role !== "Admin") return <SecurityLocked title="Khusus administrator" />;
  const rows = remote.data.filter(user => `${user.nama} ${user.nik} ${user.username} ${user.bagian}`.toLowerCase().includes(query.toLowerCase()));
  const edit = user => {
    setEditing(user.nik || user.username);
    setForm({ ...EMPTY_USER, ...user, password: "", tglMasuk: toDateInput(user.tglMasuk), kontrakTerakhir: toDateInput(user.kontrakTerakhir), tglLahir: toDateInput(user.tglLahir), originalNik: user.nik, originalUsername: user.username });
  };
  const add = () => { setEditing("new"); setForm({ ...EMPTY_USER }); };
  const change = (key, value) => setForm(current => ({ ...current, [key]: value }));
  const save = async event => {
    event.preventDefault();
    setSaving(true); setSaveError("");
    try {
      const result = await apiPost(ENDPOINTS.users, { action: "updateOrCreateUser", token: session.token, ...form }, { timeout: 90000 });
      if (!isSuccess(result)) throw new Error(result.message || "Data teknisi gagal disimpan.");
      notify(editing === "new" ? "Teknisi baru berhasil ditambahkan." : "Data teknisi berhasil diperbarui.");
      setEditing(null); setForm(EMPTY_USER); remote.reload();
    } catch (error) {
      setSaveError(error?.message || "Data teknisi gagal disimpan.");
    } finally { setSaving(false); }
  };
  return <div className="user-management-layout">
    <Panel title="Database teknisi" action={<button className="primary small" onClick={add}><Plus size={16} /> Tambah teknisi</button>}>
      <Toolbar query={query} setQuery={setQuery} />
      <RemoteState loading={remote.loading} error={remote.error} empty={!rows.length} onRetry={remote.reload} />
      {!remote.loading && !remote.error && rows.length > 0 && <div className="technician-list">{rows.map(user => <button key={user.nik || user.username} onClick={() => edit(user)}>
        <span className="avatar">{String(user.nama || "?").split(" ").map(x => x[0]).slice(0, 2).join("")}</span>
        <span><b>{user.nama || "-"}</b><small>{user.nik || "-"} · {user.bagian || "Tanpa bagian"}</small></span>
        <Badge text={user.role || "Lainnya"} /><Edit3 size={16} />
      </button>)}</div>}
    </Panel>
    {editing ? <form className="panel form-panel technician-form" onSubmit={save}>
      <div className="panel-head"><div><p className="eyebrow">{editing === "new" ? "Data baru" : "Edit data"}</p><h3>{editing === "new" ? "Tambah teknisi" : "Ubah profil teknisi"}</h3></div><button type="button" className="secondary small" onClick={() => setEditing(null)}><X size={15} /> Tutup</button></div>
      <div className="form-grid">{USER_FIELDS.map(([key, label, type]) => <Field key={key} label={label} wide={type === "textarea"}>
        {type === "role" ? <select value={form[key]} onChange={e => change(key, e.target.value)}><option>Admin</option><option>Teknik</option><option>Operator</option><option>Gudang</option><option>Lainnya</option></select>
          : type === "pegawai" ? <select value={form[key]} onChange={e => change(key, e.target.value)}><option>Tetap</option><option>Kontrak</option><option>Harian</option><option>Magang</option></select>
            : type === "gaji" ? <select value={form[key]} onChange={e => change(key, e.target.value)}><option>Bulanan</option><option>Harian</option></select>
              : type === "textarea" ? <textarea value={form[key]} onChange={e => change(key, e.target.value)} />
                : <input type={type === "readonly" ? "text" : type} value={form[key]} readOnly={type === "readonly"} placeholder={key === "password" && editing !== "new" ? "Kosongkan jika tidak diubah" : ""} onChange={e => change(key, e.target.value)} required={["username", "nama", "nik"].includes(key)} />}
      </Field>)}</div>
      {saveError && <div className="remote-error"><AlertTriangle size={17} /><span>{saveError}</span></div>}
      <div className="form-footer"><p><ShieldCheck size={16} /> Hanya sesi Admin tervalidasi yang dapat menyimpan.</p><button className="primary" type="submit" disabled={saving}>{saving ? <><span className="spinner" />Menyimpan…</> : <><Check size={17} /> Simpan data teknisi</>}</button></div>
    </form> : <Panel title="Editor teknisi"><div className="user-editor-empty"><Users size={34} /><b>Pilih teknisi atau tambah data baru</b><p>Admin dapat mengelola seluruh kolom isian yang tersimpan di Neon.</p></div></Panel>}
  </div>;
}

function SecurityLocked({ title }) {
  return <Panel title={title}>
    <div className="security-locked">
      <span className="icon-box amber"><ShieldCheck /></span>
      <div>
        <h2>Akses dinonaktifkan sementara</h2>
        <p>Modul ini menangani data pribadi atau penggajian. Akses web dibuka kembali setelah backend menggunakan token sesi dan otorisasi role yang diverifikasi server.</p>
      </div>
    </div>
  </Panel>;
}

function ElectricityDataPage({ session, notify }) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(null);
  const [exporting, setExporting] = useState(false);
  const [exportPdfOpen, setExportPdfOpen] = useState(false);
  const remote = useRemoteData(async () => {
    const [energy, panel] = await Promise.all([
      apiGet(ENDPOINTS.electricity, { action: "getData", bulan: "", tglAwal: "", tglAkhir: "" }),
      apiGet(ENDPOINTS.electricity, { action: "getPanelData" }),
    ]);
    return { energy: asArray(energy), panel: asArray(panel) };
  });
  const matches = item => Object.values(item).join(" ").toLocaleLowerCase("id-ID").includes(query.toLocaleLowerCase("id-ID"));
  const twoDecimals = value => value === null || value === undefined || value === "" || !Number.isFinite(Number(value))
    ? "-"
    : Number(value).toLocaleString("id-ID", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const displayDateOnly = value => {
    const raw = String(value || "").trim();
    if (!raw) return "-";
    if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
      const [year, month, day] = raw.slice(0, 10).split("-");
      return `${day}/${month}/${year}`;
    }
    const match = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (match) {
      const day = match[1].padStart(2, "0");
      const month = match[2].padStart(2, "0");
      const year = match[3];
      return `${day}/${month}/${year}`;
    }
    return raw.split(" ")[0].split("\n")[0];
  };
  const energyHeaders = ["Tanggal", "Jam", "Pemakaian kWh", "Batas kVArh", "Pemakaian kVArh", "Faktor Daya", "Kesimpulan"];
  const energyItems = asArray(remote.data?.energy).filter(matches);
  const energyRows = energyItems.map(x => [displayDateOnly(x.tanggal_input || x.tanggal), x.jam, twoDecimals(x.pemakaian_kwh), twoDecimals(x.batas_kvarh ?? x.nilai_kwh ?? x.kwh), twoDecimals(x.nilai_kvar ?? x.kvar), twoDecimals(x.faktor_daya), x.kesimpulan]);
  const panelHeaders = ["Tanggal", "Jam", "Panel", "Cos φ", "Petugas"];
  const panelRows = asArray(remote.data?.panel).filter(matches).map(x => [x.tanggal, x.jam, x.panel, twoDecimals(x.cos_phi), x.petugas || "-"]);
  const exportHistoryPdf = async (items, exportType = "listrik") => {
    if (exporting || !items.length) return;
    setExporting(true);
    try {
      await downloadElectricityHistoryPdf(items, { exportType });
      setExportPdfOpen(false);
      const label = exportType === "listrik" ? "Pemakaian Listrik" : exportType === "plts" ? "Pemakaian PLTS" : "Pemakaian Semua";
      notify(`PDF ${label} berhasil dibuat (${items.length} catatan).`);
    } catch (error) {
      notify(error?.message || "PDF riwayat stand meter PLN gagal dibuat.");
    } finally { setExporting(false); }
  };
  const save = async data => {
    const result = await apiPost(ENDPOINTS.electricity, { action: "update", id: selected.id, ...data });
    if (!isSuccess(result)) throw new Error(result.message || "Data listrik gagal diperbarui.");
    setSelected(null);
    await remote.reload();
    notify("Data listrik berhasil diperbarui dan dihitung ulang.");
  };
  return <>
    <Toolbar query={query} setQuery={setQuery} />
    <RemoteState loading={remote.loading} error={remote.error} empty={!energyRows.length && !panelRows.length} onRetry={remote.reload} />
    {!remote.loading && !remote.error && <>
      <Panel title="Riwayat stand meter PLN" action={<button className="secondary small" onClick={() => setExportPdfOpen(true)} disabled={!energyItems.length || exporting}>{exporting ? <><span className="spinner dark" />Membuat PDF…</> : <><Download size={16} />Ekspor PDF</>}</button>}>
        {energyRows.length ? <SimpleTable headers={energyHeaders} rows={energyRows} rowKeys={energyItems.map(item => item.id)} onRowClick={index => setSelected(energyItems[index])} /> : <div className="remote-state"><Database size={18} /> Belum ada data stand meter.</div>}
      </Panel>
      <Panel title="Riwayat cos φ panel" action={<button className="secondary small" onClick={() => exportCsv(panelHeaders, panelRows, "cos-phi-panel")} disabled={!panelRows.length}><Download size={16} /> Ekspor</button>}>
        {panelRows.length ? <SimpleTable headers={panelHeaders} rows={panelRows} /> : <div className="remote-state"><Database size={18} /> Belum ada pembacaan cos φ panel.</div>}
      </Panel>
    </>}
    {selected && <ElectricityDetailModal item={selected} session={session} onClose={() => setSelected(null)} onSave={save} />}
    {exportPdfOpen && <ElectricityPdfExportModal items={energyItems} exporting={exporting} onClose={() => !exporting && setExportPdfOpen(false)} onExport={exportHistoryPdf} />}
  </>;
}

function electricityDateKey(item) {
  const value = String(item?.tanggal_input || item?.tanggal || "").trim();
  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const id = value.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  return id ? `${id[3]}-${id[2]}-${id[1]}` : "";
}

function ElectricityPdfExportModal({ items, exporting, onClose, onExport }) {
  const today = new Date();
  const localDate = new Date(today.getTime() - today.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const [exportType, setExportType] = useState("listrik");
  const [mode, setMode] = useState("month");
  const [month, setMonth] = useState(localDate.slice(0, 7));
  const [start, setStart] = useState(`${localDate.slice(0, 7)}-01`);
  const [end, setEnd] = useState(localDate);
  const [error, setError] = useState("");
  const submit = async event => {
    event.preventDefault(); setError("");
    if (mode === "range" && (!start || !end || start > end)) {
      setError("Rentang tanggal belum valid."); return;
    }
    const selected = items.filter(item => {
      const date = electricityDateKey(item);
      return mode === "month" ? Boolean(date && date.startsWith(month)) : Boolean(date && date >= start && date <= end);
    });
    if (!selected.length) {
      setError(mode === "month" ? "Tidak ada data stand meter pada bulan tersebut." : "Tidak ada data stand meter pada rentang tanggal tersebut."); return;
    }
    await onExport(selected, exportType);
  };
  return createPortal(<div className="modal-overlay" onMouseDown={event => event.target === event.currentTarget && !exporting && onClose()}>
    <form className="modal-card electricity-pdf-export-modal" onSubmit={submit}>
      <div className="modal-head"><div><p className="eyebrow">Ekspor dokumen</p><h3>PDF riwayat stand meter & PLTS</h3><small>Pilih jenis laporan dan periode data sebelum membuat dokumen.</small></div><button type="button" onClick={onClose} disabled={exporting} aria-label="Tutup ekspor PDF"><X size={18} /></button></div>

      <div className="form-group"><label className="field-label">Pilihan Jenis Laporan PDF</label>
        <div className="electricity-pdf-type-choice">
          <button type="button" className={exportType === "listrik" ? "active" : ""} onClick={() => setExportType("listrik")}>
            <Zap size={18} />
            <span><b>Pemakaian Listrik</b><small>Potrait · Stand meter PLN, Selisih, Kesimpulan</small></span>
          </button>
          <button type="button" className={exportType === "plts" ? "active" : ""} onClick={() => setExportType("plts")}>
            <Sun size={18} />
            <span><b>Pemakaian PLTS</b><small>Potrait · Grid PLN, PV PLTS, To Grid</small></span>
          </button>
          <button type="button" className={exportType === "semua" ? "active" : ""} onClick={() => setExportType("semua")}>
            <FileBarChart size={18} />
            <span><b>Pemakaian Semua</b><small>Landscape · Tabel Listrik kemudian Pemakaian PLTS</small></span>
          </button>
        </div>
      </div>

      <div className="form-group" style={{ marginTop: 14 }}><label className="field-label">Pilihan Periode Data</label>
        <div className="electricity-pdf-period-choice" style={{ marginTop: 6 }}>
          <button type="button" className={mode === "month" ? "active" : ""} onClick={() => setMode("month")}><CalendarDays size={18} /><span><b>Per bulan</b><small>Rekap satu bulan kalender</small></span></button>
          <button type="button" className={mode === "range" ? "active" : ""} onClick={() => setMode("range")}><CalendarDays size={18} /><span><b>Rentang tanggal</b><small>Pilih tanggal mulai dan akhir</small></span></button>
        </div>
      </div>

      {mode === "month" ? (
        <div className="form-group" style={{ marginTop: 14 }}>
          <label className="field-label">Bulan Data</label>
          <input type="month" value={month} onChange={event => setMonth(event.target.value)} required />
        </div>
      ) : (
        <div className="form-group" style={{ marginTop: 14 }}>
          <div className="form-grid">
            <Field label="Tanggal mulai"><input type="date" lang="id-ID" value={start} onChange={event => setStart(event.target.value)} required /></Field>
            <Field label="Tanggal akhir"><input type="date" lang="id-ID" value={end} onChange={event => setEnd(event.target.value)} required /></Field>
          </div>
        </div>
      )}
      <div className="stock-part-detail-note"><FileBarChart size={16} /><span><b>Format Hasil Ekspor</b><small>{exportType === "listrik" ? "Tabel tunggal pemakaian listrik (Potrait)." : exportType === "plts" ? "Tabel tunggal pemakaian PLTS (Potrait)." : "Tabel Listrik dilanjutkan Tabel PLTS secara urut (Landscape)."}</small></span></div>
      {error && <div className="remote-error"><AlertTriangle size={16} /><span>{error}</span></div>}
      <div className="modal-actions"><button type="button" className="secondary" onClick={onClose} disabled={exporting}>Batal</button><button className="primary" disabled={exporting}>{exporting ? <><span className="spinner" />Membuat PDF…</> : <><Download size={16} />Buat PDF</>}</button></div>
    </form>
  </div>, document.body);
}

function ElectricityDetailModal({ item, session, onClose, onSave }) {
  const isAdmin = String(session?.role || "").toLocaleLowerCase("id-ID") === "admin";
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState(() => ({
    tanggal: item.tanggal_input || "", jam: item.jam_input || String(item.jam || "").replace(".", ":"), petugas: item.petugas || session?.name || "",
    huhe_h: String(item.huhe_h ?? ""), huhe_hh: String(item.huhe_hh ?? ""), huar_heh: String(item.huar_heh ?? ""), huar_hh: String(item.huar_hh ?? ""),
    grid_pln: item.grid_pln ?? "", pv_plts: item.pv_plts ?? "", to_grid: item.to_grid ?? "",
  }));
  const update = event => setForm(current => ({ ...current, [event.target.name]: event.target.value }));
  let assessment = null;
  try { assessment = calculateElectricityAssessment(form); } catch { assessment = null; }
  const numberLabel = value => value === null || value === undefined || value === "" || !Number.isFinite(Number(value)) ? "-" : Number(value).toLocaleString("id-ID", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const detailItems = [
    ["Tanggal pemeriksaan", item.tanggal || "-"], ["Petugas", item.petugas || "-"],
    ["HUHE H (saat ini)", numberLabel(item.huhe_h)], ["HUHE HH (sebelumnya)", numberLabel(item.huhe_hh)],
    ["HUAR HEH (saat ini)", numberLabel(item.huar_heh)], ["HUAR HH (sebelumnya)", numberLabel(item.huar_hh)],
    ["Grid PLN", numberLabel(item.grid_pln)], ["PV PLTS", numberLabel(item.pv_plts)], ["To Grid", numberLabel(item.to_grid)],
    ["Pemakaian kWh", numberLabel(item.pemakaian_kwh)], ["Batas kVArh", numberLabel(item.batas_kvarh)],
    ["Pemakaian kVArh", numberLabel(item.nilai_kvar)], ["Faktor daya", numberLabel(item.faktor_daya)], ["Selisih", numberLabel(item.selisih)],
  ];
  const submit = async event => {
    event.preventDefault(); setSaving(true); setError("");
    try { await onSave(form); } catch (err) { setError(err?.message || "Perubahan data listrik gagal disimpan."); }
    finally { setSaving(false); }
  };
  const decimalInput = name => <input name={name} type="text" inputMode="decimal" pattern="[0-9]+([.,][0-9]+)?" value={form[name]} onChange={update} />;
  return <div className="modal-overlay" onMouseDown={event => event.target === event.currentTarget && !saving && onClose()}>
    <article className="modal-card electricity-detail-modal">
      <div className="modal-head"><div><p className="eyebrow">Detail pemeriksaan listrik</p><h3>Stand meter PLN</h3><small>{item.tanggal} · {item.petugas || "Petugas tidak tercatat"}</small></div><button type="button" disabled={saving} onClick={onClose} aria-label="Tutup detail"><X size={18} /></button></div>
      {!editing ? <>
        <div className="electricity-detail-status"><span><small>Kesimpulan</small><Badge text={item.kesimpulan || "-"} /></span><span><small>Selisih batas</small><b>{numberLabel(item.selisih)} kVArh</b></span></div>
        <div className="report-detail-grid electricity-detail-grid">{detailItems.map(([label, value]) => <div key={label}><small>{label}</small><b>{value}</b></div>)}</div>
        <div className="modal-actions"><button type="button" className="secondary" onClick={onClose}>Tutup</button>{isAdmin && <button type="button" className="primary" onClick={() => setEditing(true)}><Edit3 size={16} /> Edit data</button>}</div>
      </> : <form onSubmit={submit}>
        <div className="form-grid">
          <Field label="Tanggal"><input name="tanggal" type="date" lang="id-ID" value={form.tanggal} onChange={update} required /></Field>
          <Field label="Jam"><input name="jam" type="time" value={form.jam} onChange={update} required /></Field>
          <Field label="HUHE H (saat ini)">{decimalInput("huhe_h")}</Field><Field label="HUHE HH (sebelumnya)">{decimalInput("huhe_hh")}</Field>
          <Field label="HUAR HEH (saat ini)">{decimalInput("huar_heh")}</Field><Field label="HUAR HH (sebelumnya)">{decimalInput("huar_hh")}</Field>
          <Field label="Grid PLN (MWh)">{decimalInput("grid_pln")}</Field><Field label="PV PLTS (MWh)">{decimalInput("pv_plts")}</Field>
          <Field label="To Grid (MWh)">{decimalInput("to_grid")}</Field>
          <Field label="Petugas"><select name="petugas" value={form.petugas} onChange={update} required>{[...new Set([session?.name, item.petugas, ...ELECTRICITY_OFFICER_NAMES].filter(Boolean))].map(name => <option key={name}>{name}</option>)}</select></Field>
        </div>
        {assessment && <div className={`electricity-assessment ${assessment.conclusion === "AMAN" ? "safe" : "warning"}`}><div><small>Pemakaian aktif</small><b>{numberLabel(assessment.activeKwh)} kWh</b></div><div><small>Batas reaktif</small><b>{numberLabel(assessment.reactiveLimitKvarh)} kVArh</b></div><div><small>Pemakaian reaktif</small><b>{numberLabel(assessment.reactiveKvarh)} kVArh</b></div><div><small>Faktor daya</small><b>{numberLabel(assessment.powerFactor)}</b></div><span><AlertTriangle size={17} /><strong>{assessment.conclusion}</strong></span></div>}
        {error && <div className="remote-error"><AlertTriangle size={16} /><span>{error}</span></div>}
        <div className="modal-actions"><button type="button" className="secondary" disabled={saving} onClick={() => setEditing(false)}>Batal</button><button className="primary" disabled={saving || !assessment}>{saving ? <><span className="spinner" />Menyimpan…</> : <><Check size={16} /> Simpan perubahan</>}</button></div>
      </form>}
    </article>
  </div>;
}

function DataTablePage({ kind }) {
  const [query, setQuery] = useState("");
  const [period, setPeriod] = useState("Semua periode");
  const remote = useRemoteData(async () => {
    if (kind === "bon") return asArray(await apiGet(ENDPOINTS.partRequests, { action: "getDaftarBon" })).filter(x => String(x.status).toLowerCase() === "open");
    return asArray(await apiGet(ENDPOINTS.transformerData, { action: "getDataTravo" }));
  }, [kind]);
  const periodOf = value => {
    const match = String(value || "").match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})/);
    if (!match) return "";
    return new Intl.DateTimeFormat("id-ID", { month: "long", year: "numeric" })
      .format(new Date(Number(match[3]), Number(match[2]) - 1, 1));
  };
  const periods = useMemo(() => [...new Set(remote.data.map(item => periodOf(item.tanggal || item.tglPesan)).filter(Boolean))], [remote.data]);
  const filtered = remote.data.filter(item => {
    const matchesQuery = Object.values(item).join(" ").toLocaleLowerCase("id-ID").includes(query.toLocaleLowerCase("id-ID"));
    const matchesPeriod = period === "Semua periode" || periodOf(item.tanggal || item.tglPesan) === period;
    return matchesQuery && matchesPeriod;
  });
  const config = {
    bon: { headers: ["Tanggal", "Pemesan", "Part", "Jumlah", "Kegunaan", "Status"], map: x => [x.tglPesan || x.tanggal, x.pemesan, x.nama, `${x.jmlPesan || x.jumlah} ${x.satuan || ""}`, x.kegunaan, x.status] },
    travo: { headers: ["Kode", "Nama", "Merk", "Tipe", "Tegangan", "Pengadaan"], map: x => [x.kode, x.nama, x.merk, x.tipe, x.tegangan, x.pengadaan] }
  }[kind];
  const rows = filtered.map(config.map);
  return <Panel title="Data terbaru" action={<button className="secondary small" onClick={() => exportCsv(config.headers, rows, kind)} disabled={!rows.length}><Download size={16} /> Ekspor</button>}>
    <Toolbar query={query} setQuery={setQuery}>{periods.length > 0 && <select value={period} onChange={event => setPeriod(event.target.value)}><option>Semua periode</option>{periods.map(value => <option key={value}>{value}</option>)}</select>}</Toolbar>
    <RemoteState loading={remote.loading} error={remote.error} empty={!rows.length} onRetry={remote.reload} />
    {!remote.loading && !remote.error && rows.length > 0 && <SimpleTable headers={config.headers} rows={rows} />}
  </Panel>;
}

function Toolbar({ query = "", setQuery = () => { }, children }) {
  return <div className="toolbar"><label className="search"><Search size={17} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Cari data..." /></label>{children}</div>;
}

function SimpleTable({ headers, rows, onRowClick, rowKeys = [] }) {
  return <div className="table-wrap"><table><thead><tr>{headers.map(h => <th key={h}>{h}</th>)}</tr></thead><tbody>{rows.map((row, i) => <tr key={rowKeys[i] ?? i} className={onRowClick ? "clickable-table-row" : undefined} tabIndex={onRowClick ? 0 : undefined} onClick={onRowClick ? () => onRowClick(i) : undefined} onKeyDown={onRowClick ? event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onRowClick(i); } } : undefined}>{row.map((cell, j) => <td key={j}>{j === row.length - 1 && typeof cell === "string" ? <Badge text={cell} /> : cell}</td>)}</tr>)}</tbody></table></div>;
}

function Badge({ text }) {
  const value = String(text).toLowerCase();
  const tone = value.includes("tinggi") || value.includes("kritis") || value.includes("perhatian") || value.includes("denda") ? "danger" : value.includes("sedang") || value.includes("monitor") || value.includes("hari ini") ? "warning" : value.includes("open") || value.includes("proses") || value.includes("jadwal") ? "info" : "success";
  return <span className={`badge ${tone}`}>{text}</span>;
}

function FormPanel({ title, children, onSubmit, submit, extra }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true); setError("");
    try {
      await onSubmit(Object.fromEntries(new FormData(e.currentTarget).entries()));
    } catch (err) {
      setError(err?.message || "Data gagal disimpan.");
    } finally {
      setSaving(false);
    }
  };
  return <form className="panel form-panel" onSubmit={handleSubmit}><div className="panel-head"><div><p className="eyebrow">Data entry</p><h3>{title}</h3></div>{extra}</div><div className="form-grid">{children}</div>{error && <div className="remote-error"><AlertTriangle size={17} /><span>{error}</span></div>}<div className="form-footer"><p><ShieldCheck size={16} /> Data akan disimpan ke sistem SiTeki.</p><button className="primary" type="submit" disabled={saving}>{saving ? <><span className="spinner" />Menyimpan…</> : <><Check size={17} /> {submit}</>}</button></div></form>;
}

function ProfessionalDropdown({ name, value, onChange, options = [], placeholder = "Pilih data", searchPlaceholder = "Cari data...", required = false, disabled = false, allowCustom = false, showCustomOption = allowCustom, icon: Icon = Search }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [mobileMenuStyle, setMobileMenuStyle] = useState(null);
  const rootRef = useRef(null);
  const normalizedOptions = options.map(option => typeof option === "string" ? { value: option, label: option } : option).filter(option => option?.value !== undefined && option?.label);
  const selected = normalizedOptions.find(option => String(option.value) === String(value));
  const filtered = normalizedOptions.filter(option => `${option.label} ${option.meta || ""}`.toLocaleLowerCase("id-ID").includes(query.trim().toLocaleLowerCase("id-ID")));
  useEffect(() => {
    const close = event => { if (!rootRef.current?.contains(event.target)) { setOpen(false); setQuery(""); } };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);
  useEffect(() => setActiveIndex(0), [query, open]);
  useEffect(() => {
    if (!open || typeof window === "undefined" || !window.matchMedia("(max-width:600px)").matches) { setMobileMenuStyle(null); return; }
    const positionMenu = () => {
      const rect = rootRef.current?.getBoundingClientRect();
      if (!rect) return;
      const margin = 10, gap = 7, viewportHeight = window.innerHeight, viewportWidth = window.innerWidth;
      const width = Math.min(rect.width, viewportWidth - margin * 2);
      const left = Math.max(margin, Math.min(rect.left, viewportWidth - width - margin));
      const below = viewportHeight - rect.bottom - margin, above = rect.top - margin;
      const openAbove = below < 210 && above > below;
      const available = Math.max(150, Math.min(370, (openAbove ? above : below) - gap));
      setMobileMenuStyle({ left, width, maxHeight: available, top: openAbove ? Math.max(margin, rect.top - gap - available) : rect.bottom + gap, "--dropdown-options-height": `${Math.max(105, available - 42)}px` });
    };
    positionMenu();
    window.addEventListener("resize", positionMenu);
    window.addEventListener("scroll", positionMenu, true);
    return () => { window.removeEventListener("resize", positionMenu); window.removeEventListener("scroll", positionMenu, true); };
  }, [open]);
  const choose = option => { onChange(String(option.value)); setOpen(false); setQuery(""); };
  const onInputChange = event => {
    const next = event.target.value;
    setQuery(next); setOpen(true);
    if (allowCustom) onChange(next);
  };
  const onKeyDown = event => {
    if (event.key === "ArrowDown") { event.preventDefault(); setOpen(true); setActiveIndex(index => Math.min(index + 1, Math.max(0, filtered.length - 1))); }
    else if (event.key === "ArrowUp") { event.preventDefault(); setActiveIndex(index => Math.max(0, index - 1)); }
    else if (event.key === "Enter" && open && filtered[activeIndex]) { event.preventDefault(); choose(filtered[activeIndex]); }
    else if (event.key === "Escape") { setOpen(false); setQuery(""); }
  };
  const displayValue = open ? query : (selected?.label || String(value || ""));
  const mobileDropdown = typeof window !== "undefined" && window.matchMedia("(max-width:600px)").matches;
  const menu = open ? <div className="professional-dropdown-menu" style={mobileDropdown ? (mobileMenuStyle || { visibility: "hidden" }) : undefined} role="listbox" onPointerDown={event => event.stopPropagation()}>
    <div className="professional-dropdown-caption"><Search size={13} /><span>{filtered.length} pilihan ditemukan</span></div>
    <div className="professional-dropdown-options">{filtered.length ? filtered.map((option, index) => <button type="button" role="option" aria-selected={String(option.value) === String(value)} className={`${index === activeIndex ? "active" : ""} ${String(option.value) === String(value) ? "selected" : ""}`} key={`${option.value}-${index}`} onMouseEnter={() => setActiveIndex(index)} onMouseDown={event => event.preventDefault()} onClick={() => choose(option)}>{option.photoUrl ? <img src={option.photoUrl} alt="" className="professional-dropdown-option-img" /> : <span className="professional-dropdown-option-icon">{String(option.label).trim().slice(0, 1).toUpperCase()}</span>}<span><b>{option.label}</b>{option.meta && <small>{option.meta}</small>}</span>{String(option.value) === String(value) && <Check size={15} />}</button>) : <div className="professional-dropdown-empty"><Search size={18} /><b>Tidak ditemukan</b><small>Coba gunakan kata pencarian lain.</small></div>}</div>
    {showCustomOption && query.trim() && !normalizedOptions.some(option => String(option.label).toLocaleLowerCase("id-ID") === query.trim().toLocaleLowerCase("id-ID")) && <button type="button" className="professional-dropdown-custom" onMouseDown={event => event.preventDefault()} onClick={() => { onChange(query.trim()); setOpen(false); setQuery(""); }}><Plus size={14} />Gunakan “{query.trim()}”</button>}
  </div> : null;
  return <div ref={rootRef} className={`professional-dropdown ${open ? "open" : ""} ${value ? "has-value" : ""}`}>
    <input type="hidden" name={name} value={value || ""} />
    <div className="professional-dropdown-control">
      <Icon size={17} />
      <input value={displayValue} onChange={onInputChange} onFocus={() => { setOpen(true); setQuery(""); }} onKeyDown={onKeyDown} placeholder={open ? searchPlaceholder : placeholder} disabled={disabled} autoComplete="off" aria-expanded={open} aria-autocomplete="list" aria-required={required} />
      {value && <span className="professional-dropdown-check"><Check size={13} /></span>}
      <button type="button" onClick={() => { setOpen(current => !current); setQuery(""); }} disabled={disabled} aria-label={open ? "Tutup pilihan" : "Buka pilihan"}><ChevronDown size={17} /></button>
    </div>
    {mobileDropdown && open ? createPortal(menu, document.body) : menu}
  </div>;
}

function Field({ label, wide, children, asDiv = false }) {
  const Tag = asDiv ? "div" : "label";
  return <Tag className={`${wide ? "wide " : ""}${asDiv ? "form-field" : ""}`}><span>{label}</span>{children}</Tag>;
}

function RemoteState({ loading, error, empty, onRetry }) {
  if (loading) return <div className="remote-state"><span className="spinner dark" /> Mengambil data terbaru…</div>;
  if (error) return <div className="remote-error"><AlertTriangle size={17} /><span><b>Koneksi data gagal</b><small>{error}</small></span><button onClick={onRetry}>Coba lagi</button></div>;
  if (empty) return <div className="remote-state"><Database size={18} /> Belum ada data untuk ditampilkan.</div>;
  return null;
}

function exportCsv(headers, rows, filename) {
  const quote = (value) => `"${String(value?.props?.children ?? value ?? "").replaceAll('"', '""')}"`;
  const csv = [headers, ...rows].map(row => row.map(quote).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `siteki-${filename}-${new Date().toISOString().slice(0, 10)}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

createRoot(document.getElementById("root")).render(<React.StrictMode><App /></React.StrictMode>);
