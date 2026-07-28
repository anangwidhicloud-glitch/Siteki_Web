import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Activity, AlertTriangle, AppWindow, ArrowLeft, ArrowRight, BarChart3, Bell,
  BookOpen, Boxes, CalendarDays, Check, CheckCircle2, ChevronDown, ClipboardCheck,
  ClipboardList, Clock3, Database, Download, Edit3, Eye, FileBarChart,
  FilePlus2, Gauge, HardHat, History, Home, LogOut, Menu, MoreHorizontal, Package,
  Moon, Plus, QrCode, Search, Settings, ShieldCheck, SlidersHorizontal, Sparkles, Sun,
  TimerReset, Trash2, Users, Warehouse, Wrench, X, Zap
} from "lucide-react";
import "./styles.css";
import { apiGet, apiPost, asArray, ENDPOINTS, isSuccess } from "./lib/api";
import { getFirestoreCollection, invalidateFirestoreCollection } from "./lib/firebase";
import { useRemoteData } from "./hooks/useRemoteData";

const normalizeOrder = (o, index = 0) => ({
  ...o,
  rowIndex: Number(o.rowIndex ?? o.row ?? index + 2),
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

async function firestoreOrFallback(collectionName, fallbackLoader) {
  try {
    const firestoreRows = await Promise.race([
      getFirestoreCollection(collectionName),
      new Promise((_, reject) => setTimeout(() => reject(new Error("Firestore timeout")), 8000))
    ]);
    if (Array.isArray(firestoreRows) && firestoreRows.length) return firestoreRows;
  } catch {
    // Login SiTeki menggunakan token Apps Script, bukan Firebase Auth.
    // Karena itu master data publik dibaca dari API aplikasi bila rules Firestore menolak.
  }
  return fallbackLoader();
}

async function loadMachineMaster() {
  let sourceRows=[];
  let firestoreError;
  try {
    const timeout=new Promise((_,reject)=>setTimeout(()=>reject(new Error("Firestore timeout")),8000));
    const firestoreRows=await Promise.race([getFirestoreCollection("master_mesin"),timeout]);
    if (Array.isArray(firestoreRows)&&firestoreRows.length) sourceRows=firestoreRows;
  } catch(error) {
    firestoreError=error;
  }
  if (!sourceRows.length) {
    try {
      sourceRows=asArray(await apiGet(ENDPOINTS.maintenanceMaster,{action:"getRawatMaster"}));
    } catch(error) {
      throw error instanceof Error?error:firestoreError||new Error("Master mesin tidak tersedia.");
    }
  }
  const read=(item,keys)=>{
    for (const key of keys) {
      const value=item?.[key];
      if (value!==undefined&&value!==null&&String(value).trim()) return String(value).trim();
    }
    return "";
  };
  const normalized=sourceRows.map(item=>({
    ...item,
    Kategori:read(item,["Kategori","kategori","kategoriMesin","kategori_mesin","category"])||"Mesin",
    Jenis:read(item,["Jenis","jenis","jenisMesin","jenis_mesin","type"]),
    Nama:read(item,["Nama","nama","namaMesin","nama_mesin","mesin"])
  })).filter(item=>item.Jenis&&item.Nama);
  const unique=new Map();
  normalized.forEach(item=>{
    const key=`${item.Kategori}|${item.Jenis}|${item.Nama}`.toLocaleLowerCase("id-ID");
    unique.set(key,item);
  });
  if (!unique.size) {
    throw firestoreError instanceof Error?firestoreError:new Error("Master mesin tidak tersedia.");
  }
  return [...unique.values()];
}

const pageMeta = {
  dashboard: ["Dashboard", "Ringkasan operasional teknik hari ini"],
  orders: ["Order Kerja", "Daftar dan status pekerjaan perbaikan"],
  orderDetail: ["Detail Order", "Informasi lengkap permintaan perbaikan"],
  finishOrder: ["Penyelesaian Order", "Catat tindakan dan hasil perbaikan"],
  createOrder: ["Buat Order Kerja", "Buat permintaan pekerjaan baru"],
  maintenance: ["Perawatan", "Monitoring jadwal dan aktual perawatan"],
  schedule: ["Jadwal Perawatan", "Kalender preventive maintenance"],
  maintenanceForm: ["Isi Perawatan", "Rekam hasil aktivitas perawatan"],
  kpi: ["KPI Teknik", "Kinerja, pencapaian, dan downtime"],
  kpiMaintenance: ["Detail KPI Perawatan", "Analisis kepatuhan preventive maintenance"],
  kpiDowntime: ["Detail Downtime", "Analisis durasi dan sumber gangguan"],
  electricity: ["Pengecekan Listrik", "Input pemeriksaan energi dan panel"],
  electricityData: ["Data Listrik", "Riwayat hasil pemeriksaan kelistrikan"],
  jobs: ["Laporan Kerja", "Riwayat aktivitas tim teknik"],
  jobForm: ["Isi Laporan", "Dokumentasikan pekerjaan teknisi"],
  stock: ["Stok Part", "Ketersediaan komponen dan material"],
  partOrder: ["Order Part", "Ajukan kebutuhan spare part"],
  partRequests: ["Daftar Bon", "Riwayat permintaan dan pengambilan part"],
  stang: ["Logistik Stang", "Sirkulasi stang dan perlengkapan produksi"],
  more: ["Menu Lainnya", "Sub-sistem pendukung SiTeki"],
  catalog: ["Katalog", "Referensi komponen teknik"],
  transformer: ["Inspeksi Trafo", "Pemeriksaan dan database transformator"],
  transformerForm: ["Isi Inspeksi Trafo", "Rekam kondisi transformator"],
  transformerData: ["Data Trafo", "Master aset dan hasil inspeksi"],
  overtime: ["Lemburan", "Pengajuan serta riwayat kerja lembur"],
  overtimeRecap: ["Rekap Lembur", "Ringkasan upah lembur seluruh pengguna"],
  users: ["Manajemen Teknisi", "Sinkronisasi akses dan profil pengguna"],
  scanner: ["Pemindai QR", "Buka mesin dari kode identifikasi"],
  settings: ["Pengaturan", "Preferensi tampilan dan sistem"]
};

const navItems = [
  ["dashboard", "Beranda", Home],
  ["maintenance", "Perawatan", Wrench],
  ["orders", "Order Kerja", ClipboardList],
  ["jobs", "Laporan Kerja", FileBarChart],
  ["stock", "Stok Part", Boxes],
  ["kpi", "KPI", BarChart3],
  ["users", "Teknisi", Users, ["Admin"]],
  ["transformer", "Trafo", Zap],
  ["overtime", "Lemburan", Clock3],
  ["overtimeRecap", "Rekap Lembur", FileBarChart, ["Admin"]],
  ["catalog", "Katalog", BookOpen],
  ["settings", "Pengaturan", Settings]
];

const categoryAccess = {
  Admin: ["maintenance", "jobs", "kpi", "electricity", "stang", "orders", "stock", "more"],
  Teknik: ["maintenance", "jobs", "kpi", "electricity", "stang", "orders", "stock", "more"],
  Gudang: ["kpi", "stang", "stock", "more"],
  Operator: ["kpi", "orders", "more"]
};

function publicOrderRequest() {
  const params=new URLSearchParams(window.location.search);
  const active=params.has("buatorder")||params.has("mesin")||params.has("namaMesin")||window.location.pathname.toLowerCase().includes("buatorder");
  return {
    active,
    machine:String(params.get("mesin")||params.get("namaMesin")||"").trim()
  };
}

function App() {
  const [session, setSession] = useState(() => {
    try {
      return JSON.parse(sessionStorage.getItem("siteki-session") || "null");
    } catch {
      return null;
    }
  });
  const [page, setPage] = useState("dashboard");
  const [history, setHistory] = useState([]);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [toast, setToast] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [themeMode,setThemeMode]=useState(()=>{
    const saved=localStorage.getItem("siteki-theme");
    if (saved==="dark"||saved==="light") return saved;
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches?"dark":"light";
  });

  useEffect(()=>{
    document.documentElement.dataset.theme=themeMode;
    document.documentElement.style.colorScheme=themeMode;
    localStorage.setItem("siteki-theme",themeMode);
  },[themeMode]);
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(""), 3200);
      return () => clearTimeout(timer);
    }
  }, [toast]);
  const publicOrder=useMemo(publicOrderRequest,[]);

  const go = (target, data) => {
    setHistory((old) => [...old, page]);
    if (data) setSelectedOrder(data);
    else if (target === "createOrder") setSelectedOrder(null);
    setPage(target);
    setSidebarOpen(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const back = () => {
    setHistory((old) => {
      const copy = [...old];
      setPage(copy.pop() || "dashboard");
      return copy;
    });
  };
  const logout = () => {
    sessionStorage.removeItem("siteki-session");
    setSession(null);
    setPage("dashboard");
    setHistory([]);
  };

  if (publicOrder.active) return <PublicWorkOrder initialMachine={publicOrder.machine}/>;

  if (!session) return <Login onLogin={(user) => {
    sessionStorage.setItem("siteki-session", JSON.stringify(user));
    setSession(user);
  }} />;

  return (
    <div className="app-shell">
      <Sidebar page={page} role={session.role} open={sidebarOpen} onClose={() => setSidebarOpen(false)} go={go} logout={logout} />
      <main className="main">
        <Topbar session={session} page={page} onMenu={() => setSidebarOpen(true)} go={go} logout={logout} />
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
  const [message,setMessage]=useState("");
  const [completed,setCompleted]=useState(false);
  if (completed) return <div className="public-order-page">
    <div className="public-order-shell public-order-success">
      <span className="icon-box mint"><CheckCircle2/></span>
      <p className="eyebrow">Order berhasil dikirim</p>
      <h1>Terima kasih.</h1>
      <p>Permintaan perbaikan sudah masuk ke sistem SiTeki dan dapat langsung ditindaklanjuti tim Teknik.</p>
      <button className="primary" onClick={()=>{setCompleted(false);setMessage("");}}>Buat order lainnya</button>
    </div>
  </div>;
  return <div className="public-order-page">
    <header className="public-order-header"><div className="brand-mark"><span>ST</span></div><div><b>SiTeki</b><small>Form Order Kerja Publik</small></div><span className="public-access"><ShieldCheck size={15}/> Akses terbatas</span></header>
    <main className="public-order-shell">
      <div className="public-order-intro"><p className="eyebrow">PT. Pabrik Besi Beton Raja Besi</p><h1>Buat Order Kerja</h1><p>Laporkan kerusakan mesin tanpa akun. Halaman ini hanya dapat mengirim order dan tidak dapat membuka data internal SiTeki.</p></div>
      {message&&<div className="public-order-message"><CheckCircle2 size={17}/>{message}</div>}
      <WorkOrderForm initialMachine={initialMachine} notify={setMessage} onSuccess={()=>setCompleted(true)}/>
    </main>
  </div>;
}

function Login({ onLogin }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function submit(e) {
    e.preventDefault();
    if (!username || !password) return setError("Username dan password wajib diisi.");
    setLoading(true); setError("");
    try {
      const result = await apiPost(ENDPOINTS.users, { action:"login", username, password });
      if (String(result.status).toLowerCase() !== "success") throw new Error(result.message || "Kredensial tidak dikenali.");
      if (!result.token) throw new Error("Server login belum menggunakan sesi aman. Terapkan Apps Script versi baru.");
      const profile = result.profile || {};
      onLogin({ username: profile.username || username, name: profile.nama || "Karyawan Raja Besi", role: profile.role || "Operator", token:result.token || "" });
    } catch (err) {
      setError(err?.message || "Tidak dapat terhubung ke server login.");
    } finally { setLoading(false); }
  }

  return (
    <div className="login-page">
      <div className="login-art">
        <div className="brand-mark large"><span>ST</span></div>
        <div>
          <p className="eyebrow">Engineering intelligence system</p>
          <h1>Menjaga mesin<br />tetap <em>bergerak.</em></h1>
          <p className="login-copy">Satu ruang kerja terpadu untuk perawatan, order kerja, inventori part, inspeksi, dan performa teknik.</p>
        </div>
        <div className="plant-stats">
          <div><strong>24/7</strong><span>Operational visibility</span></div>
          <div><strong>1</strong><span>Integrated workspace</span></div>
        </div>
      </div>
      <form className="login-card" onSubmit={submit}>
        <div className="mobile-brand"><div className="brand-mark"><span>ST</span></div><b>SiTeki</b></div>
        <p className="eyebrow">Secure terminal access</p>
        <h2>Selamat datang</h2>
        <p className="muted">Masuk menggunakan akun SiTeki Anda.</p>
        <label>Username<input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Masukkan username" autoFocus /></label>
        <label>Password<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Masukkan password" /></label>
        {error && <p className="error"><AlertTriangle size={16} />{error}</p>}
        <button className="primary wide" disabled={loading}>{loading ? <><span className="spinner" />Memverifikasi akses</> : <>Masuk ke sistem <ArrowRight size={18} /></>}</button>
        <p className="login-note"><ShieldCheck size={16} /> Kredensial diverifikasi oleh database pengguna yang sama dengan aplikasi Android.</p>
      </form>
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
        {visibleNavItems.map(([id, label, Icon]) => <button key={id} className={page === id ? "active" : ""} onClick={() => go(id)}><Icon size={19} /><span>{label}</span>{id === "orders" && <i>3</i>}</button>)}
      </nav>
      <div className="sidebar-bottom">
        <div className="role-chip"><ShieldCheck size={16} /><span>Akses {role}</span></div>
        <button onClick={logout}><LogOut size={18} />Keluar sistem</button>
      </div>
    </aside>
  </>;
}

function Topbar({ session, page, onMenu, go, logout }) {
  return <header className="topbar">
    <button className="menu-toggle" onClick={onMenu}><Menu /></button>
    <div className="crumb"><span>SiTeki</span><b>/</b><strong>{pageMeta[page]?.[0] || "Workspace"}</strong></div>
    <div className="top-actions">
      <button className="icon-button" onClick={() => go("scanner")}><QrCode size={19} /></button>
      <button className="icon-button notification"><Bell size={19} /><i /></button>
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
    case "maintenanceForm": return <MaintenanceForm {...props} />;
    case "kpi": return <KPI {...props} />;
    case "kpiMaintenance": return <KPIDetail {...props} kind="Perawatan" />;
    case "kpiDowntime": return <KPIDetail {...props} kind="Downtime" />;
    case "electricity": return <Electricity {...props} />;
    case "electricityData": return <DataTablePage {...props} kind="listrik" />;
    case "jobs": return <Jobs {...props} />;
    case "jobForm": return <JobForm {...props} />;
    case "stock": return <Stock {...props} />;
    case "partOrder": return <PartOrder {...props} />;
    case "partRequests": return <DataTablePage {...props} kind="bon" />;
    case "more": return <More {...props} />;
    case "transformer": return <TransformerMenu {...props} />;
    case "transformerForm": return <TransformerForm {...props} />;
    case "transformerData": return <DataTablePage {...props} kind="travo" />;
    case "overtime": return <OvertimeEntry {...props}/>;
    case "overtimeRecap": return session.role==="Admin" ? <OvertimeAdmin {...props}/> : <SecurityLocked title="Rekap lembur dikunci" />;
    case "users": return <UserManagement {...props} />;
    case "catalog": return <Catalog />;
    case "stang": return <Stang {...props} />;
    case "scanner": return <Scanner {...props} />;
    case "settings": return <SettingsPage notify={notify} themeMode={themeMode} onThemeChange={setThemeMode} />;
    default: return <Dashboard {...props} />;
  }
}

function Dashboard({ go, session }) {
  const canViewOvertimeChart=["admin","teknik"].includes(String(session.role||"").toLowerCase());
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
  const overtimeSummaryRemote = useRemoteData(async () => {
    if (!canViewOvertimeChart) return [];
    const result=await apiPost(ENDPOINTS.users,{action:"getOvertimeChart",token:session.token,year:new Date().getFullYear()},{timeout:90000});
    if (!isSuccess(result)) throw new Error(result.message||"Grafik lembur tidak dapat diakses.");
    return asArray(result);
  },[session.token,canViewOvertimeChart]);
  const stockRemote = useRemoteData(async () => asArray(await apiGet(ENDPOINTS.stock, { action:"getStokPart", bulan:currentIndonesianMonth() })));
  const activeOrders = ordersRemote.data;
  const actualMaintenance = maintenanceRemote.data;
  const maintenanceAgenda = useMemo(
    () => buildMaintenanceAgenda(actualMaintenance, new Date()),
    [actualMaintenance]
  );
  const maintenanceKpi = kpiRemote.data.map(x=>({label:monthName(x.bulan),value:Math.round(Number(x.pencapaian||0)*100)}));
  const downtimeKpi = kpiCombinedRemote.data.map(x=>({label:monthName(x.bulan),value:Number(x.jam||0)}));
  const orderKpi = kpiCombinedRemote.data.map(x=>({label:monthName(x.bulan),value:Number(x.order||0)}));
  const overtimeKpi = overtimeSummaryRemote.data.map(x=>({label:monthName(x.bulan),value:Number(x.totalJam||0)}));
  const latestMaintenanceIndex = Math.max(0,maintenanceKpi.findLastIndex(x=>x.value>0));
  const latestCombinedIndex = Math.max(0,kpiCombinedRemote.data.findLastIndex(x=>Number(x.jam||0)>0||Number(x.order||0)>0));
  const health = maintenanceKpi[latestMaintenanceIndex]?.value||0;
  const maintenanceTarget = Math.round(Number(kpiRemote.data[latestMaintenanceIndex]?.target||.8)*100);
  const downtimeTarget = Number(kpiCombinedRemote.data[latestCombinedIndex]?.target||500);
  const today=new Date();
  const downtimeYearToDate=kpiCombinedRemote.data
    .slice(0,today.getMonth()+1)
    .reduce((total,item)=>total+Number(item.jam||0),0);
  const downtimeYearToDateLabel=new Intl.NumberFormat("id-ID",{
    minimumFractionDigits:1,maximumFractionDigits:1
  }).format(downtimeYearToDate);
  const downtimeDateRange=`1 Jan–${new Intl.DateTimeFormat("id-ID",{
    day:"numeric",month:"short",year:"numeric"
  }).format(today)}`;
  const lowStock = stockRemote.data.filter(x => Number(x.stok || 0) < 10).length;
  const access = categoryAccess[session.role] || categoryAccess.Operator;
  const categories = [
    ["maintenance", "Perawatan", Wrench, "Jadwal & aktual", "mint"],
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
      <div><p className="eyebrow">{new Intl.DateTimeFormat("id-ID", { weekday:"long", day:"numeric", month:"long", year:"numeric" }).format(new Date())}</p><h2>Selamat bekerja, {session.name.split(" ")[0]}.</h2><p>Data langsung dari sistem. Ada <b>{activeOrders.length} order terbuka</b> dan <b>{actualMaintenance.length} catatan perawatan</b> pada basis data.</p>
        <div className="hero-actions"><button className="primary" onClick={() => go("createOrder")}><Plus size={18} /> Buat order</button><button className="secondary" onClick={() => go("schedule")}><CalendarDays size={18} /> Lihat jadwal</button></div>
      </div>
      <div className="health-orbit"><div><Activity size={28} /><strong>{kpiRemote.loading ? "…" : `${health}%`}</strong><span>KPI perawatan</span></div></div>
    </section>
    <div className="stats-grid">
      <Stat icon={ClipboardList} label="Order terbuka" value={ordersRemote.loading ? "…" : String(activeOrders.length).padStart(2,"0")} detail="Data Spreadsheet" tone="mint" />
      <Stat icon={TimerReset} label="Downtime tahun ini" value={kpiCombinedRemote.loading ? "…" : `${downtimeYearToDateLabel} jam`} detail={downtimeDateRange} tone="blue" />
      <Stat icon={Gauge} label="KPI perawatan" value={kpiRemote.loading ? "…" : `${health}%`} detail="Data KPI terbaru" tone="amber" />
      <Stat icon={Package} label="Stok di bawah 10" value={stockRemote.loading ? "…" : String(lowStock).padStart(2,"0")} detail="Perlu perhatian" tone="violet" />
    </div>
    <div className="section-title dashboard-kpi-title"><div><p className="eyebrow">Live performance</p><h2>Ringkasan KPI Teknik</h2></div><button className="secondary small" onClick={()=>go("kpi")}>Lihat KPI lengkap <ArrowRight size={15}/></button></div>
    <div className="dashboard-kpi-grid">
      <DashboardKpiChart title="Downtime" subtitle="Akumulasi gangguan mesin" icon={TimerReset} data={downtimeKpi} target={downtimeTarget} maxValue={1000} unit=" jam" color="#d97706" decimals={1} loading={kpiCombinedRemote.loading} error={kpiCombinedRemote.error} onClick={()=>go("kpiDowntime")}/>
      <DashboardKpiChart title="Perawatan" subtitle="Pencapaian preventive maintenance" icon={Wrench} data={maintenanceKpi} target={maintenanceTarget} maxValue={100} unit="%" color="#079b70" loading={kpiRemote.loading} error={kpiRemote.error} onClick={()=>go("kpiMaintenance")}/>
      <DashboardKpiChart title="Total Order Kerja" subtitle="Permintaan pekerjaan bulanan" icon={ClipboardList} data={orderKpi} maxValue={350} unit="" color="#7557d9" loading={kpiCombinedRemote.loading} error={kpiCombinedRemote.error} onClick={()=>go("kpi")}/>
      {canViewOvertimeChart&&<DashboardKpiChart title="Total Jam Lembur" subtitle={`Akumulasi Admin & Teknik · ${new Date().getFullYear()}`} icon={Clock3} data={overtimeKpi} unit=" jam" color="#0f8ea8" decimals={1} loading={overtimeSummaryRemote.loading} error={overtimeSummaryRemote.error}/>}
    </div>
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
            <CalendarDays size={16}/>
            <span>
              <b>{maintenanceAgenda.title}</b>
              <small>{maintenanceAgenda.description}</small>
            </span>
          </div>
          {maintenanceAgenda.items.length > 0
            ? <div className="agenda">{maintenanceAgenda.items.map((item) =>
              <button
                key={`${item.name}-${item.date}`}
                onClick={() => go("maintenanceForm", { schedule: { name:item.name, date:item.isoDate, status:item.status } })}
              >
                <span className={`date-box ${maintenanceAgenda.source === "today" ? "today" : "overdue"}`}>
                  <b>{String(item.day).padStart(2,"0")}</b>
                  <small>{String(item.month).padStart(2,"0")}</small>
                </span>
                <span>
                  <b>{item.name}</b>
                  <small><em className={`agenda-type ${item.status === "B" ? "monthly" : "weekly"}`}>{item.type}</em> · {item.note}</small>
                </span>
                <ArrowRight size={16} />
              </button>)}</div>
            : <div className="agenda-empty"><CheckCircle2 size={22}/><b>Tidak ada perawatan tertunda</b><small>Jadwal hari ini dan minggu sebelumnya sudah selesai atau memang kosong.</small></div>}
        </>}
      </Panel>
    </div>
  </>;
}

function Stat({ icon: Icon, label, value, detail, tone }) {
  return <article className="stat"><span className={`icon-box ${tone}`}><Icon size={21} /></span><div><small>{label}</small><strong>{value}</strong><p><span>↗</span> {detail}</p></div></article>;
}

function DashboardKpiChart({ title,subtitle,icon:Icon,data,target=0,maxValue,color,unit,decimals=0,loading,error,onClick }) {
  const chartRef=useRef(null);
  const [chartSize,setChartSize]=useState({width:600,height:125});
  useEffect(()=>{
    const chart=chartRef.current;
    if (!chart) return;
    const update=()=>setChartSize({
      width:Math.max(280,Math.round(chart.clientWidth)),
      height:Math.max(110,Math.round(chart.clientHeight))
    });
    update();
    const observer=new ResizeObserver(update);
    observer.observe(chart);
    return ()=>observer.disconnect();
  },[]);
  const visible=trimChartSeries(data);
  const latest=visible.at(-1)||{};
  const previous=visible.at(-2);
  const delta=previous ? Number(latest.value||0)-Number(previous.value||0) : null;
  const detail=[
    latest.label||"-",
    target>0?`Target ${target}${unit}`:"",
    delta===null?"":`${delta>0?"+":""}${delta.toLocaleString("id-ID",{maximumFractionDigits:decimals})}${unit}`
  ].filter(Boolean).join(" · ");
  const {width,height}=chartSize,padX=18,padTop=15,padBottom=22;
  const chartHeight=height-padTop-padBottom,safeMax=Math.max(1,maxValue||0,target,...visible.map(x=>Number(x.value||0)));
  const pointX=i=>padX+(visible.length>1?i*(width-padX*2)/(visible.length-1):(width-padX*2)/2);
  const pointY=value=>padTop+chartHeight-Math.min(Math.max(Number(value||0),0),safeMax)/safeMax*chartHeight;
  const points=visible.map((item,i)=>`${pointX(i)},${pointY(item.value)}`).join(" ");
  const area=visible.length?`${padX},${padTop+chartHeight} ${points} ${pointX(visible.length-1)},${padTop+chartHeight}`:"";
  return <button className="dashboard-kpi-card" onClick={onClick}>
    <div className="dashboard-kpi-head"><span className="dashboard-kpi-icon" style={{color,background:`${color}16`}}><Icon size={19}/></span><div><b>{title}</b><small>{subtitle}</small></div><ArrowRight size={16}/></div>
    {loading?<div className="dashboard-chart-state"><span className="spinner dark"/>Memuat data…</div>:error?<div className="dashboard-chart-state error-text">Data tidak tersedia</div>:<>
      <div className="dashboard-kpi-value"><strong>{Number(latest.value||0).toLocaleString("id-ID",{maximumFractionDigits:1})}{unit}</strong><span>{detail}</span></div>
      <svg ref={chartRef} className="dashboard-sparkline" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Grafik ${title}`}>
        {[.25,.5,.75].map(p=><line key={p} x1={padX} x2={width-padX} y1={padTop+chartHeight*p} y2={padTop+chartHeight*p} className="spark-grid"/>)}
        {target>0&&<line x1={padX} x2={width-padX} y1={pointY(target)} y2={pointY(target)} className="spark-target"/>}
        <polygon points={area} fill={color} opacity=".055"/>
        <polyline points={points} fill="none" stroke={color} strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round"/>
        {visible.map((item,i)=><g key={i}>
          <text className="spark-value" x={pointX(i)} y={Math.max(9,pointY(item.value)-9)} textAnchor="middle">{Number(item.value||0).toLocaleString("id-ID",{maximumFractionDigits:decimals})}{unit==="%"?"%":""}</text>
          <circle cx={pointX(i)} cy={pointY(item.value)} r={i===visible.length-1?3.5:2.25} fill={i===visible.length-1?"white":color} stroke={color} strokeWidth={i===visible.length-1?2:0}/>
        </g>)}
        {visible.length>0&&<><text x={padX} y={height-3}>{String(visible[0].label).slice(0,3)}</text><text x={width-padX} y={height-3} textAnchor="end">{String(latest.label).slice(0,3)}</text></>}
      </svg>
    </>}
  </button>;
}

function Panel({ title, action, children, className = "" }) {
  return <section className={`panel ${className}`}><div className="panel-head"><h3>{title}</h3>{action}</div>{children}</section>;
}

function Orders({ go }) {
  const [query, setQuery] = useState("");
  const [month, setMonth] = useState("Semua Bulan");
  const remote = useRemoteData(async () =>
    asArray(await apiGet(ENDPOINTS.orders, { action: "getAllOrders" })).map(normalizeOrder)
  );
  const months=["Semua Bulan","Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"];
  const monthAliases=[[],["jan"],["feb"],["mar"],["apr"],["mei","may"],["jun"],["jul"],["agu","aug"],["sep"],["okt","oct"],["nov"],["des","dec"]];
  const rows = remote.data.filter((o) => {
    const matchesQuery=`${o.namaMesin} ${o.kerusakan} ${o.bagianOrder}`.toLowerCase().includes(query.toLowerCase());
    const dateText=String(o.tanggal).toLowerCase();
    const matchesMonth=month==="Semua Bulan"||monthAliases[months.indexOf(month)].some(alias=>dateText.includes(alias));
    return matchesQuery&&matchesMonth;
  });
  return <Panel title="Daftar order" action={<button className="primary small" onClick={() => go("createOrder")}><Plus size={16} /> Buat order</button>}>
    <Toolbar query={query} setQuery={setQuery}><select value={month} onChange={(e) => setMonth(e.target.value)}>{months.map(value=><option key={value}>{value}</option>)}</select></Toolbar>
    <RemoteState loading={remote.loading} error={remote.error} empty={!rows.length} onRetry={remote.reload} />
    {!remote.loading && !remote.error && rows.length > 0 && <OrderTable orders={rows} onClick={(o) => go("orderDetail", o)} />}
  </Panel>;
}

function OrderTable({ orders, onClick }) {
  return <div className="table-wrap"><table><thead><tr><th>Tanggal</th><th>Mesin / Kerusakan</th><th>Pengorder</th><th>Urgensi</th><th>Status</th><th /></tr></thead><tbody>{orders.map((o) => <tr key={o.rowIndex} onClick={() => onClick(o)}><td>{o.tanggal}</td><td><b>{o.namaMesin}</b><small>{o.kerusakan}</small></td><td><b>{o.namaOrder}</b><small>{o.bagianOrder} → {o.bagianTujuan}</small></td><td><Badge text={o.urgensi} /></td><td><Badge text={o.status} /></td><td><ArrowRight size={17} /></td></tr>)}</tbody></table></div>;
}

function OrderDetail({ order, go }) {
  return <div className="detail-grid">
    <Panel title={`WO-${String(order.rowIndex).padStart(4, "0")}`} action={<Badge text={order.status} />}>
      <div className="detail-hero"><span className="icon-box amber"><Wrench /></span><div><p>MESIN / ASET</p><h2>{order.namaMesin}</h2><span>{order.kerusakan}</span></div></div>
      <div className="info-grid">{[["Tanggal order", order.tanggal],["Tingkat urgensi", order.urgensi],["Nama pengorder", order.namaOrder],["Bagian pengorder", order.bagianOrder],["Bagian tujuan", order.bagianTujuan],["Status pekerjaan", order.status]].map(([a,b]) => <div key={a}><small>{a}</small><b>{b}</b></div>)}</div>
    </Panel>
    <Panel title="Tindakan selanjutnya"><div className="action-stack"><button className="primary wide" onClick={() => go("finishOrder")}><ClipboardCheck size={18} /> Lakukan perbaikan</button><button className="secondary wide"><Download size={18} /> Unduh detail order</button></div><p className="hint"><ShieldCheck size={16} /> Pastikan kondisi mesin aman sebelum memulai pekerjaan.</p></Panel>
  </div>;
}

function WorkOrderForm({ notify, go, initialMachine="", onSuccess }) {
  const machines = useRemoteData(loadMachineMaster);
  const [category,setCategory]=useState("");
  const [destination,setDestination]=useState("");
  const [machineName,setMachineName]=useState(initialMachine);
  const [machineType,setMachineType]=useState("");
  const orderSections=["Bahan Baku","Finishgood","Gudang Part","HRD","Muat","Opt. Crane","Pengecatan","Perakitan","Pipa ERW","PPID","QC","Slitting","Tek. Shift A","Tek. Shift B","Bengkel","Umum","Konstruksi"];
  const destinationSections=["Tek. Shift A","Tek. Shift B","Bengkel","Umum","Konstruksi"];
  const workTypes=["Perbaikan","Pemeriksaan","Pemasangan","Pemindahan","Pembuatan","Setting","Kalibrasi"];
  const typeOptions=[...new Set(machines.data.filter(item=>!category||String(item.Kategori||item.kategori||"")===category).map(item=>item.Jenis||item.jenis).filter(Boolean))].sort();
  const machineOptions=machines.data.filter(item=>(!category||String(item.Kategori||item.kategori||"")===category)&&(!machineType||String(item.Jenis||item.jenis||"")===machineType));
  useEffect(()=>{
    if (!initialMachine || !machines.data.length) return;
    const target=machines.data.find(item=>String(item.Nama||item.nama||"").trim().toLowerCase()===String(initialMachine).trim().toLowerCase());
    if (!target) return;
    setMachineName(target.Nama||target.nama||initialMachine);
    setCategory(target.Kategori||target.kategori||"");
    setMachineType(target.Jenis||target.jenis||"");
    if (String(target.Kategori||target.kategori||"").toLowerCase()==="armada") setDestination("Bengkel");
  },[initialMachine,machines.data]);
  const changeDestination=value=>{
    setDestination(value);
    const nextCategory=value==="Bengkel"?"Armada":"Mesin";
    if (nextCategory!==category) {
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
    <Field label="Bagian order"><select name="bagianOrder" required defaultValue=""><option value="" disabled>Pilih bagian order</option>{orderSections.map(value=><option key={value}>{value}</option>)}</select></Field>
    <Field label="Nama pengorder"><input name="namaOrder" placeholder="Nama lengkap" required /></Field>
    <Field label="Bagian tujuan"><select name="bagianTujuan" value={destination} onChange={event=>changeDestination(event.target.value)} required><option value="">Pilih bagian tujuan</option>{destinationSections.map(value=><option key={value}>{value}</option>)}</select></Field>
    <Field label="Kategori perangkat"><input name="kategoriMesin" value={category} placeholder="Otomatis dari bagian tujuan" readOnly required /></Field>
    <Field label={category==="Armada"?"Jenis armada":"Jenis mesin"}><select name="jenis" value={machineType} onChange={event=>{setMachineType(event.target.value);setMachineName("");}} required><option value="">Pilih jenis</option>{typeOptions.map(value=><option key={value}>{value}</option>)}</select></Field>
    <Field label="Nama mesin / aset"><select name="namaMesin" value={machineName} onChange={event=>{
      const value=event.target.value;
      setMachineName(value);
      const target=machines.data.find(item=>(item.Nama||item.nama)===value);
      if (target) {
        setCategory(target.Kategori||target.kategori||"");
        setMachineType(target.Jenis||target.jenis||"");
      }
    }} required><option value="">Pilih nama</option>{machineName&&!machines.data.some(x=>(x.Nama||x.nama)===machineName)&&<option value={machineName}>{machineName}</option>}{machineOptions.map(x => <option key={x.id} value={x.Nama || x.nama}>{x.Nama || x.nama}</option>)}</select></Field>
    <Field label="Jenis pekerjaan"><select name="jenisPekerjaan" required defaultValue=""><option value="" disabled>Pilih jenis pekerjaan</option>{workTypes.map(value=><option key={value}>{value}</option>)}</select></Field>
    <Field label="Urgensi"><select name="urgensi" defaultValue="Biasa"><option>Biasa</option><option>Penting</option><option>Penting Sekali</option></select></Field>
    <Field label="Deskripsi kerusakan" wide><textarea name="kerusakan" placeholder="Jelaskan gejala atau kerusakan..." required /></Field>
  </FormPanel>;
}

function FinishOrder({ order, notify, go }) {
  const parts=useRemoteData(()=>getFirestoreCollection("master_part"));
  const [partMode,setPartMode]=useState("none");
  const [partCategory,setPartCategory]=useState("");
  const [partName,setPartName]=useState("Tidak Pakai");
  const [partSize,setPartSize]=useState("Tidak Pakai");
  const partCategories=[...new Set(parts.data.map(item=>item.Kategori||item.kategori).filter(Boolean))].sort();
  const partNames=[...new Set(parts.data.filter(item=>!partCategory||(item.Kategori||item.kategori)===partCategory).map(item=>item.Nama||item.nama).filter(Boolean))].sort();
  const partSizes=[...new Set(parts.data.filter(item=>(item.Kategori||item.kategori)===partCategory&&(item.Nama||item.nama)===partName).map(item=>item.Ukuran||item.ukuran).filter(Boolean))].sort();
  const localDate=()=>{const date=new Date(),offset=date.getTimezoneOffset();return new Date(date.getTime()-offset*60000).toISOString().slice(0,10);};
  const localTime=()=>new Date().toLocaleTimeString("id-ID",{hour:"2-digit",minute:"2-digit",hour12:false}).replace(".",":");
  const submit = async (data) => {
    if (partMode!=="none"&&(!partName||!partSize)) throw new Error("Nama dan ukuran spare part wajib dilengkapi.");
    const result = await apiPost(ENDPOINTS.completeOrder, {
      action:"complete",rowIndex:order.rowIndex,
      perbaikanDilakukan:data.perbaikanDilakukan,
      jamMulai:`${toIdDate(data.tglMulai)} ${data.waktuMulai}`,
      jamSelesai:`${toIdDate(data.tglSelesai)} ${data.waktuSelesai}`,
      statusMesin:data.statusMesin,nilaiPerbaikan:data.nilaiPerbaikan,
      sparePart:partName,ukuranSparePart:partSize,keterangan:data.keterangan
    });
    if (!isSuccess(result)) throw new Error(result.message || "Penyelesaian order gagal disimpan.");
    notify(result.message || "Order ditandai selesai dan tersinkron.");
    go("dashboard");
  };
  return <FormPanel title={`Penyelesaian · ${order.namaMesin}`} onSubmit={submit} submit="Selesaikan order">
    <Field label="Tindakan perbaikan" wide><textarea name="perbaikanDilakukan" placeholder="Uraikan tindakan yang dilakukan..." required /></Field>
    <Field label="Tanggal mulai"><input name="tglMulai" type="date" defaultValue={localDate()} required /></Field>
    <Field label="Waktu mulai"><input name="waktuMulai" type="time" defaultValue={localTime()} required /></Field>
    <Field label="Tanggal selesai"><input name="tglSelesai" type="date" defaultValue={localDate()} required /></Field>
    <Field label="Waktu selesai"><input name="waktuSelesai" type="time" defaultValue={localTime()} required /></Field>
    <Field label="Status mesin"><select name="statusMesin" required defaultValue=""><option value="" disabled>Pilih status</option>{["Repair","Breakdown","Tunggu Part","Overhoul Mesin","Yang Lain"].map(value=><option key={value}>{value}</option>)}</select></Field>
    <Field label="Nilai perbaikan"><select name="nilaiPerbaikan" defaultValue="Bagus"><option>Bagus</option><option>Cukup</option><option>Tidak Bagus</option></select></Field>
    <Field label="Pemakaian spare part"><select value={partMode} onChange={event=>{
      const mode=event.target.value;setPartMode(mode);setPartCategory("");
      if(mode==="none"){setPartName("Tidak Pakai");setPartSize("Tidak Pakai");}
      else {setPartName("");setPartSize("");}
    }}><option value="none">Tidak Pakai</option><option value="master">Pilih dari master part</option><option value="manual">Input manual</option></select></Field>
    {partMode==="master"&&<><Field label="Kategori part"><select value={partCategory} onChange={event=>{setPartCategory(event.target.value);setPartName("");setPartSize("");}}><option value="">Pilih kategori</option>{partCategories.map(value=><option key={value}>{value}</option>)}</select></Field><Field label="Nama spare part"><select value={partName} onChange={event=>{setPartName(event.target.value);setPartSize("");}}><option value="">Pilih part</option>{partNames.map(value=><option key={value}>{value}</option>)}</select></Field><Field label="Ukuran spare part"><select value={partSize} onChange={event=>setPartSize(event.target.value)}><option value="">Pilih ukuran</option>{partSizes.map(value=><option key={value}>{value}</option>)}</select></Field></>}
    {partMode==="manual"&&<><Field label="Nama spare part"><input value={partName} onChange={event=>setPartName(event.target.value)} placeholder="Nama part"/></Field><Field label="Ukuran spare part"><input value={partSize} onChange={event=>setPartSize(event.target.value)} placeholder="Ukuran"/></Field></>}
    <Field label="Keterangan" wide><textarea name="keterangan" /></Field>
  </FormPanel>;
}

function Maintenance({ go }) {
  const remote = useRemoteData(async () =>
    asArray(await apiGet(ENDPOINTS.maintenance, { action:"getPerawatan" }))
  );
  const recent = remote.data.slice(-10).reverse();
  return <>
    <div className="stats-grid three"><Stat icon={CalendarDays} label="Catatan perawatan" value={remote.loading ? "…" : remote.data.length} detail="Seluruh data" tone="blue" /><Stat icon={CheckCircle2} label="Terealisasi" value={remote.loading ? "…" : recent.length} detail="Data terbaru" tone="mint" /><Stat icon={AlertTriangle} label="Sumber data" value="Live" detail="Google Spreadsheet" tone="amber" /></div>
    <div className="split-actions"><button className="choice-card" onClick={() => go("schedule")}><span className="icon-box blue"><CalendarDays /></span><div><b>Lihat jadwal</b><small>Kalender perawatan seluruh aset</small></div><ArrowRight /></button><button className="choice-card" onClick={() => go("maintenanceForm")}><span className="icon-box mint"><ClipboardCheck /></span><div><b>Isi perawatan</b><small>Rekam aktivitas yang dikerjakan</small></div><ArrowRight /></button></div>
    <Panel title="Aktual perawatan terbaru"><RemoteState loading={remote.loading} error={remote.error} empty={!recent.length} onRetry={remote.reload} /><div className="maintenance-list">{recent.map((m,i) => <div key={`${m.nama_mesin}-${m.tanggal}-${i}`}><span className="machine-icon"><Wrench /></span><div><b>{m.nama_mesin || m.nama || "-"}</b><small>{m.jenis_perawatan || m.waktu || "-"}</small></div><span>{m.tanggal}</span><Badge text="Selesai" /><button onClick={() => go("maintenanceForm")}>Isi lagi</button></div>)}</div></Panel>
  </>;
}

const SCHEDULE_MONTHS = ["Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"];
const SCHEDULE_MACHINES = [
  "Mobile Crane B","Truck Dump DT39","Truck Trailler H1983HG","Mobile Crane C",
  "Forklift A FD35","Truck Dump DT52","Truck Trailler H8318QO","Mobile Crane D",
  "Truck Dump DT55","Panther H8629JA","Truck Trailler H8696OA","Mobile Crane E",
  "Truck Dump DT98","Truck Trailler H8697OA","Panther H1669SQ","Mobile Crane A",
  "Truck Dump DT139","Truck Trailler H1358KS","Forklift B FD250","Suzuki APV",
  "Kop C","Kop D","Kop E","Kop F","Perlengkapan Cat","Line 13","Line 14","Line 15",
  "Lakop D","Slitting","Line 16","Line 17","Line 18","Tes Bending TELKOM",
  "Tes Jatuh Telkom","Bevel","Tes Bending PLN","Verloop D","Verloop H","Verloop E",
  "Verloop F","Kompressor 01","Line 01","Line 02","Line 03","Verloop A","Lakop A",
  "Kop A","Kop B","Kompressor 02","Line 04","Line 05","Line 06","Verloop B",
  "Verloop C","Lakop B","Lakop C","Line 07","Line 08","Line 09","Pipa ERW",
  "Verloop G","Potong Bahan A","Potong Spiral","Genset 01","Line 10","Line 11","Line 12"
];
const SCHEDULE_RULES = Object.fromEntries([
  ["Mobile Crane B",1,[3]],["Truck Dump DT39",1,[2]],["Truck Trailler H1983HG",1,[1]],["Mobile Crane C",1,[4]],
  ["Kop C",1,[3]],["Kop D",1,[2]],["Kop E",1,[1]],["Kop F",1,[4]],["Line 13",1,[2]],["Line 14",1,[1]],["Line 15",1,[4]],["Lakop D",1,[3]],
  ["Forklift A FD35",2,[3]],["Truck Dump DT52",2,[2]],["Truck Trailler H8318QO",2,[1]],["Mobile Crane D",2,[4]],
  ["Slitting",2,[2]],["Line 16",2,[1]],["Line 17",2,[4]],["Line 18",2,[3]],["Tes Bending TELKOM",2,[2]],["Tes Jatuh Telkom",2,[1]],["Bevel",2,[4]],["Tes Bending PLN",2,[3]],["Verloop D",2,[2]],
  ["Truck Dump DT55",3,[3]],["Panther H8629JA",3,[2]],["Truck Trailler H8696OA",3,[1]],["Mobile Crane E",3,[4]],
  ["Verloop H",3,[1]],["Verloop E",3,[4]],["Verloop F",3,[3]],["Kompressor 01",3,[2]],["Line 01",3,[1]],["Line 02",3,[4]],["Line 03",3,[3]],["Verloop A",3,[2]],["Lakop A",3,[1]],
  ["Truck Dump DT98",4,[3]],["Truck Trailler H8697OA",4,[2]],["Panther H1669SQ",4,[1]],["Kop A",4,[4]],["Kop B",4,[3]],["Kompressor 02",4,[2]],["Line 04",4,[1]],["Line 05",4,[4]],["Line 06",4,[3]],["Verloop B",4,[2]],["Verloop C",4,[1]],["Lakop B",4,[3]],
  ["Lakop C",5,[3]],["Mobile Crane A",5,[3]],["Truck Dump DT139",5,[2]],["Truck Trailler H1358KS",5,[1]],
  ["Line 07",5,[2]],["Line 08",5,[1]],["Line 09",5,[4]],["Pipa ERW",5,[3]],["Verloop G",5,[2]],["Potong Bahan A",5,[1]],
  ["Forklift B FD250",6,[1]],["Suzuki APV",6,[3]],["Potong Spiral",6,[4]],["Genset 01",6,[3]],["Line 10",6,[2]],["Line 11",6,[1]],["Line 12",6,[3]]
].map(([name,weekday,weeks]) => [name,{weekday,weeks}]));
const SCHEDULE_HOLIDAYS = {
  2024:{1:[1],2:[8,10],3:[11,29,31],4:[10,11],5:[1,9,23],6:[1,17],7:[7],8:[17],9:[16],12:[25]},
  2025:{1:[1,27,29],2:[10],3:[28,29,31],4:[1,18],5:[1,12,29],6:[1,7,27],8:[17],9:[5],12:[25]},
  2026:{1:[1,19],2:[17],3:[20,21,28],4:[3,5],5:[1,14,31],6:[1,22],8:[17],9:[5],12:[25]}
};

function scheduleStatus(name,day,month,year) {
  const date = new Date(year,month,day,12);
  if (date.getDay() === 0 || SCHEDULE_HOLIDAYS[year]?.[month+1]?.includes(day)) return "";
  const rule = SCHEDULE_RULES[name];
  if (!rule || date.getDay() !== rule.weekday) return "";
  let occurrence=0;
  for (let d=1;d<=day;d++) if (new Date(year,month,d,12).getDay() === rule.weekday) occurrence++;
  if (occurrence > 4) return "";
  return rule.weeks.includes(occurrence) ? "B" : "M";
}

function scheduleDate(day,month,year) {
  return `${String(day).padStart(2,"0")}/${String(month+1).padStart(2,"0")}/${year}`;
}

function normalizeMaintenanceDate(value) {
  const raw = String(value || "").trim();
  let match = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (match) return `${String(match[1]).padStart(2,"0")}/${String(match[2]).padStart(2,"0")}/${match[3]}`;
  match = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (match) return `${String(match[3]).padStart(2,"0")}/${String(match[2]).padStart(2,"0")}/${match[1]}`;
  const timestamp = Date.parse(raw);
  if (Number.isNaN(timestamp)) return raw;
  const date = new Date(timestamp);
  return scheduleDate(date.getDate(), date.getMonth(), date.getFullYear());
}

function maintenanceAgendaKey(name,date) {
  return `${String(name || "").trim().toLocaleLowerCase("id-ID")}|${normalizeMaintenanceDate(date)}`;
}

function maintenanceTasksForDate(date,completed) {
  const day=date.getDate(),month=date.getMonth(),year=date.getFullYear();
  return SCHEDULE_MACHINES.flatMap(name=>{
    const status=scheduleStatus(name,day,month,year);
    const idDate=scheduleDate(day,month,year);
    if (!status || completed.has(maintenanceAgendaKey(name,idDate))) return [];
    return [{
      name,status,date:idDate,day,month:month+1,
      isoDate:`${year}-${String(month+1).padStart(2,"0")}-${String(day).padStart(2,"0")}`,
      type:status==="B"?"Bulanan":"Mingguan"
    }];
  });
}

function buildMaintenanceAgenda(actualRows,today) {
  const completed=new Set(
    actualRows
      .map(item=>maintenanceAgendaKey(item.nama_mesin || item.nama,item.tanggal))
      .filter(key=>!key.startsWith("|") && !key.endsWith("|"))
  );
  const localToday=new Date(today.getFullYear(),today.getMonth(),today.getDate(),12);
  const todaysItems=maintenanceTasksForDate(localToday,completed).map(item=>({
    ...item,note:"Jadwal hari ini"
  }));
  if (todaysItems.length) return {
    source:"today",
    title:"Perawatan hari ini",
    description:`${todaysItems.length} mesin menunggu pemeriksaan`,
    items:todaysItems
  };

  const currentMonday=new Date(localToday);
  currentMonday.setDate(localToday.getDate()-((localToday.getDay()+6)%7));
  const previousMonday=new Date(currentMonday);
  previousMonday.setDate(currentMonday.getDate()-7);
  const overdue=[];
  for (let offset=0;offset<7;offset++) {
    const date=new Date(previousMonday);
    date.setDate(previousMonday.getDate()+offset);
    overdue.push(...maintenanceTasksForDate(date,completed).map(item=>({
      ...item,note:`Tertunda dari ${item.date}`
    })));
  }
  return {
    source:overdue.length?"previous-week":"empty",
    title:overdue.length?"Tertunda minggu sebelumnya":"Agenda perawatan bersih",
    description:overdue.length
      ? `${overdue.length} jadwal belum memiliki catatan aktual`
      : "Tidak ada pekerjaan yang perlu ditindaklanjuti",
    items:overdue
  };
}

function Schedule({ go }) {
  const now = new Date();
  const [month,setMonth] = useState(now.getMonth());
  const [year,setYear] = useState(now.getFullYear());
  const days = Array.from({length:new Date(year,month+1,0).getDate()},(_,i)=>i+1);
  const remote = useRemoteData(async () => asArray(await apiGet(ENDPOINTS.maintenance,{action:"getPerawatan"},{timeout:90000})));
  const actualIndex = useMemo(() => {
    const map=new Map();
    remote.data.forEach(item => {
      const [d,m,y]=String(item.tanggal||"").trim().split("/").map(Number);
      if (!d || !m || !y) return;
      map.set(`${item.nama_mesin||item.nama}|${scheduleDate(d,m-1,y)}`,item.jenis_perawatan||item.waktu||"M");
    });
    return map;
  },[remote.data]);
  const years=Array.from(new Set([2024,2025,2026,now.getFullYear(),now.getFullYear()+1])).sort();
  const openForm=(name,day,status) => go("maintenanceForm",{schedule:{name,date:`${year}-${String(month+1).padStart(2,"0")}-${String(day).padStart(2,"0")}`,status:status||"M"}});
  return <>
    <div className="schedule-search">
      <span className="eyebrow">Pencarian data metric</span>
      <div>
        <label><span>Bulan</span><select value={month} onChange={e=>setMonth(Number(e.target.value))}>{SCHEDULE_MONTHS.map((name,i)=><option value={i} key={name}>{name}</option>)}</select></label>
        <label className="year-field"><span>Tahun</span><select value={year} onChange={e=>setYear(Number(e.target.value))}>{years.map(value=><option key={value}>{value}</option>)}</select></label>
      </div>
    </div>
    <div className="schedule-legend"><span><i className="plan-m"/>Plan (M)</span><span><i className="plan-b"/>Plan (B)</span><span className="actual-key">✓ Actual</span></div>
    <div className="schedule-caption">Data jadwal perawatan</div>
    <section className="maintenance-matrix-panel">
      <RemoteState loading={remote.loading} error={remote.error} empty={!remote.loading&&!remote.data.length} onRetry={remote.reload}/>
      {!remote.loading&&!remote.error&&<div className="maintenance-matrix-scroll">
        <table className="maintenance-matrix">
          <thead>
            <tr><th className="machine-column" rowSpan="2">Mesin / Tanggal</th>{days.map(day=>{
              const date=new Date(year,month,day,12),holiday=SCHEDULE_HOLIDAYS[year]?.[month+1]?.includes(day),today=date.toDateString()===now.toDateString();
              return <th className={`date-column ${date.getDay()===0||holiday?"holiday":date.getDay()===6?"saturday":""} ${today?"today":""}`} colSpan="2" key={day}><small>{["Min","Sen","Sel","Rab","Kam","Jum","Sab"][date.getDay()]}</small><b>{day}</b></th>;
            })}</tr>
            <tr>{days.map(day=><React.Fragment key={day}><th className="channel plan">P</th><th className="channel actual">A</th></React.Fragment>)}</tr>
          </thead>
          <tbody>{SCHEDULE_MACHINES.map(name=><tr key={name}>
            <th className="machine-column" title={name}>{name}</th>
            {days.map(day=>{
              const status=scheduleStatus(name,day,month,year),dateKey=scheduleDate(day,month,year),actual=actualIndex.get(`${name}|${dateKey}`),actualMark=actual?(actual==="B"?"✓✓":"✓"):"";
              return <React.Fragment key={day}>
                <td><button className={`matrix-cell plan-cell ${status==="M"?"weekly":status==="B"?"monthly":""}`} onClick={()=>openForm(name,day,status)} aria-label={`${name}, rencana ${dateKey}`}>{status}</button></td>
                <td><button className={`matrix-cell actual-cell ${actual==="B"?"monthly-done":actual?"weekly-done":""}`} onClick={()=>openForm(name,day,status||actual)} aria-label={`${name}, aktual ${dateKey}`}>{actualMark}</button></td>
              </React.Fragment>;
            })}
          </tr>)}</tbody>
        </table>
      </div>}
    </section>
  </>;
}

function MaintenanceForm({ notify, selectedOrder }) {
  const master = useRemoteData(loadMachineMaster);
  const scheduled = selectedOrder?.schedule;
  const submit = async (data) => {
    const payload = { ...data, tanggal: toIdDate(data.tanggal), waktu: data.waktu === "Mingguan" ? "M" : "B", kondisi_mesin: data.kondisi };
    const result = await apiPost(ENDPOINTS.maintenance, payload);
    if (!isSuccess(result)) throw new Error(result.message || "Data perawatan gagal disimpan.");
    notify("Data perawatan berhasil disimpan dan tersinkron.");
  };
  return <FormPanel title="Aktual preventive maintenance" onSubmit={submit} submit="Simpan perawatan">
    <Field label="Kategori"><select name="kategori">{[...new Set(master.data.map(x => x.Kategori || x.kategori).filter(Boolean))].map(x => <option key={x}>{x}</option>)}</select></Field>
    <Field label="Jenis"><select name="jenis">{[...new Set(master.data.map(x => x.Jenis || x.jenis).filter(Boolean))].map(x => <option key={x}>{x}</option>)}</select></Field>
    <Field label="Nama mesin"><select key={`${scheduled?.name||"manual"}-${master.loading}`} name="nama_mesin" defaultValue={scheduled?.name||""} required><option value="">Pilih mesin</option>{[...new Set(master.data.map(x => x.Nama || x.nama_mesin || x.nama).filter(Boolean))].map(x => <option key={x}>{x}</option>)}</select></Field>
    <Field label="Tanggal"><input name="tanggal" type="date" defaultValue={scheduled?.date||new Date().toISOString().slice(0,10)} required /></Field>
    <Field label="Jenis perawatan"><select name="waktu" defaultValue={scheduled?.status==="B"?"Bulanan":"Mingguan"}><option>Mingguan</option><option>Bulanan</option></select></Field>
    <Field label="Kondisi mesin"><select name="kondisi"><option>Baik</option><option>Perlu perhatian</option><option>Rusak</option></select></Field>
    <Field label="Aktivitas / hasil pemeriksaan" wide><textarea name="hasil_pemeriksaan" placeholder="Tuliskan aktivitas dan hasil..." /></Field><Field label="Catatan lanjutan" wide><textarea name="keterangan" placeholder="Opsional" /></Field>
  </FormPanel>;
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
  const downtimeSeries = combined.data.map(x => ({ label:monthName(x.bulan), value:Number(x.jam || 0) }));
  const orderSeries = combined.data.map(x => ({ label:monthName(x.bulan), value:Number(x.order || 0) }));
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
      <button className="secondary small" onClick={reload}><Activity size={16}/> Muat ulang</button>
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

function KPIDetail({ kind }) {
  return kind === "Perawatan" ? <MaintenanceKpiDetail /> : <DowntimeKpiDetail />;
}

const KPI_MONTHS = ["Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"];
const KPI_TYPES = ["Semua Jenis","Verloop","Trailler","Bevel","Slitting","Genset","Forklift","Kop","Lakop","Alat Uji","Kompressor","Pipa ERW","Potong Bahan","Perakitan","Dump","Mobile Crane","Umum"];
const MONTH_ALIASES = {
  Januari:["Jan"], Februari:["Feb"], Maret:["Mar"], April:["Apr"], Mei:["Mei","May"],
  Juni:["Jun"], Juli:["Jul"], Agustus:["Agu","Aug"], September:["Sep"],
  Oktober:["Okt","Oct"], November:["Nov"], Desember:["Des","Dec"]
};

function monthName(value) {
  const found = Object.entries(MONTH_ALIASES).find(([, aliases]) => aliases.includes(String(value)));
  return found?.[0] || value || "-";
}

function trimChartSeries(data) {
  const series=Array.isArray(data)?data:[];
  const lastIndex=series.findLastIndex(item=>{
    const value=item?.value;
    return value!==null && value!==undefined && value!=="" && Number.isFinite(Number(value)) && Number(value)!==0;
  });
  return lastIndex<0?[]:series.slice(0,lastIndex+1);
}

function KpiChartPanel({ title, data, target = 0, maxValue, color, unit, targetLabel = "Target", onDetail }) {
  return <Panel title={title} className="kpi-chart-panel" action={onDetail && <button onClick={onDetail}>Detail <ArrowRight size={14}/></button>}>
    <LineChart data={data} target={target} maxValue={maxValue} color={color} unit={unit} targetLabel={targetLabel} />
  </Panel>;
}

function LineChart({ data, target = 0, maxValue = 100, color = "#069b70", unit = "", targetLabel = "Target" }) {
  const [selected, setSelected] = useState(null);
  const visibleData=trimChartSeries(data);
  const width = 960, height = 250, left = 48, right = 24, top = 28, bottom = 42;
  const chartWidth = width-left-right, chartHeight = height-top-bottom;
  const safeMax = Math.max(1, maxValue, target, ...visibleData.map(x => Number(x.value || 0)));
  const x = i => left + (visibleData.length > 1 ? i * chartWidth/(visibleData.length-1) : chartWidth/2);
  const y = value => top + chartHeight - Math.min(Math.max(Number(value || 0),0),safeMax)/safeMax*chartHeight;
  const points = visibleData.map((item,i) => `${x(i)},${y(item.value)}`).join(" ");
  const fill = visibleData.length ? `${left},${top+chartHeight} ${points} ${x(visibleData.length-1)},${top+chartHeight}` : "";
  const targetY = y(target);
  const latest=visibleData.at(-1);
  const previous=visibleData.at(-2);
  const delta=previous?Number(latest.value||0)-Number(previous.value||0):null;
  const maximumTarget=String(targetLabel).toLowerCase().includes("maksimum");
  const targetMet=target>0 && (maximumTarget?Number(latest?.value||0)<=target:Number(latest?.value||0)>=target);
  const selectedItem=selected===null?null:visibleData[selected];
  if (!visibleData.length) return <div className="chart-empty"><Database size={20}/> Belum ada data grafik.</div>;
  return <div className="line-chart" onMouseLeave={() => setSelected(null)}>
    <div className="line-chart-summary">
      <span><strong>{Number(latest.value||0).toLocaleString("id-ID",{maximumFractionDigits:1})}{unit}</strong><small>Data terakhir · {latest.label}</small></span>
      <div>
        {delta!==null&&<em className="chart-delta">{delta>0?"+":""}{delta.toLocaleString("id-ID",{maximumFractionDigits:1})}{unit} dari bulan lalu</em>}
        {target>0&&<em className={`chart-target-status ${targetMet?"met":"missed"}`}>{targetMet?"Target tercapai":"Di luar target"}</em>}
      </div>
    </div>
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Grafik ${visibleData.length} bulan`}>
      {[0,.25,.5,.75,1].map(p => {
        const gy=top+chartHeight-chartHeight*p;
        return <g key={p}><line x1={left} x2={width-right} y1={gy} y2={gy} className="chart-grid"/><text x={left-8} y={gy+4} textAnchor="end">{Math.round(safeMax*p)}</text></g>;
      })}
      {target > 0 && <g><line x1={left} x2={width-right} y1={targetY} y2={targetY} className="target-line"/><text x={width-right} y={targetY-8} textAnchor="end" className="target-text">{targetLabel} {target}{unit}</text></g>}
      <polygon points={fill} fill={color} opacity=".045"/>
      <polyline points={points} fill="none" stroke={color} strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round"/>
      {visibleData.map((item,i) => <g key={`${item.label}-${i}`} className="chart-point" onMouseEnter={() => setSelected(i)} onClick={() => setSelected(i)}>
        <circle cx={x(i)} cy={y(item.value)} r="12" fill="transparent"/>
        <circle cx={x(i)} cy={y(item.value)} r="3.5" className="chart-point-core" fill="white" stroke={color} strokeWidth="2"/>
        <text className="chart-value" x={x(i)} y={Math.max(top+10,y(item.value)-10)} textAnchor="middle">{Number(item.value||0).toLocaleString("id-ID",{maximumFractionDigits:1})}{unit==="%"?"%":""}</text>
        <text x={x(i)} y={height-18} textAnchor="middle">{String(item.label).slice(0,3)}</text>
      </g>)}
      {selectedItem && <line x1={x(selected)} x2={x(selected)} y1={top} y2={top+chartHeight} className="hover-line"/>}
    </svg>
    {selectedItem && <div className="chart-tooltip" style={{left:`${Math.min(88,Math.max(3,x(selected)/width*100))}%`}}>
      <b>{selectedItem.label}</b><span><i style={{background:color}} />{Number(selectedItem.value).toLocaleString("id-ID",{maximumFractionDigits:1})}{unit}</span>
    </div>}
  </div>;
}

function QualityTable({ data }) {
  const maxGood = Math.max(1, ...data.map(x => Number(x.bagus || 0)));
  return <Panel title="Kualitas pelayanan" className="quality-panel">
    <div className="quality-table">
      <div className="quality-row quality-head"><b>Bulan</b><b>Bagus</b><b>Cukup</b><b>Tidak bagus</b></div>
      {data.map((item,i) => <div className="quality-row" key={`${item.bulan}-${i}`}>
        <strong>{String(i+1).padStart(2,"0")}. {monthName(item.bulan)}</strong>
        <span className="quality-good"><b>{Math.round(item.bagus || 0)}</b><i><em style={{width:`${Number(item.bagus || 0)/maxGood*100}%`}} /></i></span>
        <span>{Math.round(item.cukup || 0)}</span><span>{Math.round(item.tidakBagus || 0)}</span>
      </div>)}
    </div>
  </Panel>;
}

function MaintenanceKpiDetail() {
  const [month,setMonth] = useState("Januari");
  const [type,setType] = useState("Semua Jenis");
  const remote = useRemoteData(async () => {
    const [annual, detail] = await Promise.all([
      apiGet(ENDPOINTS.kpi),
      apiGet(ENDPOINTS.maintenanceDetail, { bulan:month, jenis:type })
    ]);
    const kinds = asArray(detail, ["data_per_jenis"])
      .filter(x => x.jenis !== "Pengecatan")
      .map(x => [x.jenis, Number(x.pencapaian || 0)]);
    let machines = asArray(detail, ["data_per_mesin"])
      .filter(x => x.nama_mesin !== "Perlengkapan Cat")
      .map(x => [x.nama_mesin, Number(x.pencapaian || 0)]);
    if (type === "Semua Jenis") machines = machines.sort((a,b) => a[1]-b[1]).slice(0,10);
    return {
      annual:asArray(annual).map(x => ({label:monthName(x.bulan),value:Number(x.pencapaian || 0)*100})),
      target:Number(asArray(annual)[0]?.target || .8)*100,
      kinds, machines,
      totalKinds:Number(detail.total_jenis || 0), totalMachines:Number(detail.total_mesin || 0)
    };
  }, [month,type]);
  const data = remote.data || {};
  return <>
    <KpiFilters month={month} setMonth={setMonth} type={type} setType={setType} types={KPI_TYPES}/>
    <RemoteState loading={remote.loading} error={remote.error} empty={!remote.loading && !data.annual?.length} onRetry={remote.reload}/>
    {!remote.loading && !remote.error && <>
      <div className="stats-grid two"><Stat icon={Boxes} label="Jumlah armada" value={data.totalKinds || 0} detail={month} tone="blue"/><Stat icon={Settings} label="Jumlah mesin" value={data.totalMachines || 0} detail={type} tone="mint"/></div>
      <KpiChartPanel title="Pencapaian perawatan (%)" data={data.annual || []} target={data.target || 80} maxValue={100} color="#069b70" unit="%"/>
      <div className="kpi-detail-grid">
        <RankChart title="Pencapaian menurut jenis" data={data.kinds || []} unit="%" maxValue={100} color="#3279e6"/>
        <RankChart title={type === "Semua Jenis" ? "10 nama mesin terendah" : "Pencapaian nama mesin"} data={data.machines || []} unit="%" maxValue={100} color="#069b70"/>
      </div>
    </>}
  </>;
}

function DowntimeKpiDetail() {
  const [month,setMonth] = useState("Semua Bulan");
  const [type,setType] = useState("Semua Jenis");
  const remote = useRemoteData(async () => apiGet(ENDPOINTS.downtime));
  const root = remote.data || {};
  const monthly = asArray(root, ["rekap"]).map(x => ({label:monthName(x.bulan),value:Number(x.jam || 0)}));
  const raw = asArray(root, ["laporan_mentah"]);
  const types = ["Semua Jenis", ...new Set(raw.map(x => x.jenis).filter(Boolean))].sort((a,b) => a === "Semua Jenis" ? -1 : a.localeCompare(b));
  const monthCodes = month === "Semua Bulan" ? null : MONTH_ALIASES[month] || [month];
  const monthRows = raw.filter(x => !monthCodes || monthCodes.includes(x.bulan));
  const filtered = monthRows.filter(x => type === "Semua Jenis" || x.jenis === type);
  const sumGroups = (rows,key,limit=10) => Object.entries(rows.reduce((acc,x) => {
    const name=x[key] || "Lainnya"; acc[name]=(acc[name]||0)+Number(x.total_jam||0); return acc;
  },{})).sort((a,b)=>b[1]-a[1]).slice(0,limit);
  const machines=sumGroups(monthRows,"mesin",10), components=sumGroups(filtered,"komponen",5), sections=sumGroups(filtered,"bagian",5);
  const total=monthly.reduce((sum,x)=>sum+x.value,0);
  return <>
    <KpiFilters month={month} setMonth={setMonth} type={type} setType={setType} months={["Semua Bulan",...KPI_MONTHS]} types={types}/>
    <RemoteState loading={remote.loading} error={remote.error} empty={!remote.loading && !monthly.length} onRetry={remote.reload}/>
    {!remote.loading && !remote.error && <>
      <div className="stats-grid two"><Stat icon={TimerReset} label="Downtime sampai sekarang" value={`${(total/1000).toFixed(1)} rb jam`} detail="Akumulasi tahunan" tone="amber"/><Stat icon={Gauge} label="Target per tahun" value="6.000 jam" detail="Batas maksimum" tone="violet"/></div>
      <KpiChartPanel title="Total downtime (jam)" data={monthly} target={500} maxValue={1000} color="#d97706" unit=" jam" targetLabel="Target maksimum"/>
      <div className="kpi-detail-grid">
        <RankChart title="Komponen" data={components} unit="h" color="#3279e6"/>
        <Treemap title="Per bagian" data={sections}/>
      </div>
      <RankChart title="Top 10 downtime terbanyak" data={machines} unit="h" color="#d34d79"/>
    </>}
  </>;
}

function KpiFilters({ month,setMonth,type,setType,months=KPI_MONTHS,types }) {
  return <div className="kpi-filters">
    <label><span>Bulan</span><select value={month} onChange={e=>setMonth(e.target.value)}>{months.map(x=><option key={x}>{x}</option>)}</select></label>
    <label><span>Jenis</span><select value={type} onChange={e=>setType(e.target.value)}>{types.map(x=><option key={x}>{x}</option>)}</select></label>
  </div>;
}

function RankChart({ title,data,unit,maxValue,color="#069b70" }) {
  const max=Math.max(1,maxValue || 0,...data.map(x=>Number(x[1]||0)));
  return <Panel title={title} className="rank-panel"><div className="rank-list">{!data.length && <div className="chart-empty">Tidak ada data untuk filter ini.</div>}{data.map(([name,value],i)=><div key={`${name}-${i}`}><b>{String(i+1).padStart(2,"0")}</b><span><strong>{name}</strong><i><em style={{width:`${Math.min(Number(value||0)/max*100,100)}%`,background:color}} /></i></span><strong>{Number(value||0).toFixed(1)}{unit}</strong></div>)}</div></Panel>;
}

function Treemap({ title,data }) {
  const colors=["#069b70","#3279e6","#d97706","#7557d9","#79a839"];
  const total=Math.max(1,data.reduce((sum,x)=>sum+Number(x[1]||0),0));
  return <Panel title={title} className="treemap-panel"><div className="kpi-treemap">{!data.length && <div className="chart-empty">Tidak ada data untuk filter ini.</div>}{data.map(([name,value],i)=><div key={name} style={{background:colors[i%colors.length],flexGrow:Math.max(1,Number(value)/total*10)}}><b>{name}</b><span>{Number(value).toFixed(1)}h</span></div>)}</div></Panel>;
}

function Electricity({ notify, go }) {
  const live = useRemoteData(() => apiGet(ENDPOINTS.electricity));
  const prev = live.data?.prevData || {};
  const submit = async (data) => {
    const hH=Number(data.huhe_h), hHH=Number(data.huhe_hh), aHEH=Number(data.huar_heh), aHH=Number(data.huar_hh);
    const kwh=(hHH-hH)*.62, kvar=aHEH-aHH, selisih=kwh-kvar;
    const result = await apiGet(ENDPOINTS.electricity, { action:"insert", ...data, tanggal:toIdDate(data.tanggal), nilai_kwh:kwh, nilai_kvar:kvar, selisih, kesimpulan:kwh>kvar ? "AMAN":"POTENSI DENDA" });
    if (!isSuccess(result)) throw new Error(result.message || "Data listrik gagal disimpan.");
    notify("Data pengecekan listrik disimpan dan tersinkron.");
    live.reload();
  };
  return <><div className="stats-grid three"><Stat icon={Zap} label="HUHE HH terakhir" value={prev.huhe_hh || "…"} detail="Data Spreadsheet" tone="mint" /><Stat icon={Gauge} label="PV PLTS terakhir" value={prev.pv_plts || "…"} detail="Data Spreadsheet" tone="blue" /><Stat icon={AlertTriangle} label="Kesimpulan" value={prev.kesimpulan || "-"} detail={prev.tanggal || "Belum ada data"} tone="amber" /></div>
    <FormPanel title="Input pengecekan energi listrik" onSubmit={submit} submit="Simpan pemeriksaan" extra={<button type="button" className="secondary" onClick={() => go("electricityData")}><Database size={17} /> Lihat data</button>}>
      <Field label="Tanggal"><input name="tanggal" type="date" defaultValue={new Date().toISOString().slice(0,10)} required /></Field><Field label="Jam"><input name="jam" type="time" required /></Field>
      <Field label="HUHE H (KWH)"><input name="huhe_h" type="number" step="any" required /></Field><Field label="HUHE HH (KWH)"><input name="huhe_hh" type="number" step="any" required /></Field>
      <Field label="HUAR HEH (KVAR)"><input name="huar_heh" type="number" step="any" required /></Field><Field label="HUAR HH (KVAR)"><input name="huar_hh" type="number" step="any" required /></Field>
      <Field label="Grid PLN"><input name="grid_pln" type="number" step="any" /></Field><Field label="PV PLTS"><input name="pv_plts" type="number" step="any" /></Field>
      <Field label="To Grid"><input name="to_grid" type="number" step="any" /></Field><Field label="Petugas"><input name="petugas" required /></Field>
    </FormPanel></>;
}

function Jobs({ go, session, notify }) {
  const now=new Date();
  const currentYear=String(now.getFullYear());
  const currentMonth=String(now.getMonth()+1).padStart(2,"0");
  const [query,setQuery]=useState("");
  const [filters,setFilters]=useState({
    year:currentYear,month:currentMonth,category:"",type:"",machine:"",section:""
  });
  const requestedPeriod=new Intl.DateTimeFormat("id-ID",{month:"long",year:"numeric"})
    .format(new Date(Number(filters.year),Number(filters.month)-1,1));
  // Ambil satu bulan dari server. Perubahan tahun/bulan akan meminta periode
  // tersebut saja sehingga browser tidak perlu mengunduh seluruh arsip.
  const remote = useRemoteData(async () => {
    const rows=asArray(await apiGet(ENDPOINTS.jobs,{
      action:"getDataLapKerja",bulan:requestedPeriod
    },{timeout:45000}));
    // Spreadsheet memiliki tab salinan/arsip dengan header serupa. Gunakan
    // `lap_kerja` sebagai sumber utama yang sama dengan aplikasi Android agar
    // laporan tidak terduplikasi dari "Copy of lap_kerja"/"Laporan Kerja".
    const primary=rows.filter(report=>String(report.sheetName||"").trim().toLowerCase()==="lap_kerja");
    return primary.length?primary:rows;
  },[filters.year,filters.month]);
  const isAdmin=String(session?.role||"").toLowerCase()==="admin";
  const capabilities=useRemoteData(async()=>isAdmin
    ? apiGet(ENDPOINTS.jobs,{action:"getCapabilities"})
    : {status:"success",capabilities:[]},[isAdmin]);
  const canManage=isAdmin && Array.isArray(capabilities.data?.capabilities)
    && capabilities.data.capabilities.includes("updateReport")
    && capabilities.data.capabilities.includes("deleteReport");
  const [editing,setEditing]=useState(null);
  const [selectedReport,setSelectedReport]=useState(null);
  const [busyRow,setBusyRow]=useState(null);
  const [sort,setSort]=useState({key:"date",direction:"desc"});
  const [page,setPage]=useState(1);
  const pageSize=50;

  const reportDate=value=>{
    const match=String(value||"").match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})(?:\s|$)/);
    if (match) return new Date(Number(match[3]),Number(match[2])-1,Number(match[1])).getTime();
    const parsed=Date.parse(value);
    return Number.isNaN(parsed)?0:parsed;
  };
  const reportStartValue=report=>
    report.tanggalMulai||report.tglMulai||report.jamMulai||report.awal||report.tanggal||"";
  const reportStartLabel=report=>{
    const timestamp=reportDate(reportStartValue(report));
    return timestamp
      ? new Intl.DateTimeFormat("id-ID",{
          day:"2-digit",month:"2-digit",year:"numeric"
        }).format(new Date(timestamp))
      : report.tanggal||"-";
  };
  const reportMonth=value=>{
    const timestamp=reportDate(value);
    if (!timestamp) return "";
    const date=new Date(timestamp);
    return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}`;
  };
  const normalized=value=>String(value??"").trim();
  const uniqueOptions=key=>[...new Set(remote.data.map(report=>normalized(key(report))).filter(Boolean))]
    .sort((a,b)=>a.localeCompare(b,"id",{numeric:true,sensitivity:"base"}));
  const filterOptions=useMemo(()=>({
    years:Array.from({length:10},(_,index)=>String(now.getFullYear()-index)),
    months:Array.from({length:12},(_,index)=>({
      value:String(index+1).padStart(2,"0"),
      label:new Intl.DateTimeFormat("id-ID",{month:"long"}).format(new Date(2020,index,1))
    })),
    categories:uniqueOptions(report=>report.kategoriMesin),
    types:uniqueOptions(report=>report.jenis),
    machines:uniqueOptions(report=>report.mesin||report.namaMesin),
    sections:uniqueOptions(report=>report.bagian)
  }),[remote.data,currentYear]);
  const visibleReports=useMemo(()=>{
    const needle=query.trim().toLocaleLowerCase("id");
    const filtered=remote.data.filter(report=>{
      const startValue=reportStartValue(report);
      const date=reportDate(startValue);
      const year=date?String(new Date(date).getFullYear()):"";
      const searchable=[
        startValue,report.tanggal,report.mesin,report.namaMesin,report.bagian,report.laporan,
        report.jenisPekerjaan,report.kategoriMesin,report.jenis
      ].join(" ").toLocaleLowerCase("id");
      return (!needle||searchable.includes(needle))
        && year===filters.year
        && reportMonth(startValue)===`${filters.year}-${filters.month}`
        && (!filters.category||normalized(report.kategoriMesin)===filters.category)
        && (!filters.type||normalized(report.jenis)===filters.type)
        && (!filters.machine||normalized(report.mesin||report.namaMesin)===filters.machine)
        && (!filters.section||normalized(report.bagian)===filters.section);
    });
    const getters={
      date:report=>reportDate(reportStartValue(report)),
      machine:report=>normalized(report.mesin||report.namaMesin),
      section:report=>normalized(report.bagian),
      report:report=>normalized(report.laporan),
      duration:report=>Number(String(report.durasi||report.totalJam||0).replace(",","."))
    };
    const getter=getters[sort.key]||getters.date;
    return [...filtered].sort((a,b)=>{
      const left=getter(a),right=getter(b);
      const comparison=typeof left==="number"
        ? left-right
        : left.localeCompare(right,"id",{numeric:true,sensitivity:"base"});
      return sort.direction==="asc"?comparison:-comparison;
    });
  },[remote.data,query,filters,sort]);
  const setFilter=(key,value)=>setFilters(current=>({...current,[key]:value}));
  const toggleSort=key=>setSort(current=>({
    key,direction:current.key===key&&current.direction==="asc"?"desc":"asc"
  }));
  const sortLabel=key=>sort.key===key?(sort.direction==="asc"?"↑":"↓"):"↕";
  const resetFilters=()=>{
    setQuery("");
    setFilters({year:currentYear,month:currentMonth,category:"",type:"",machine:"",section:""});
  };
  const pageCount=Math.max(1,Math.ceil(visibleReports.length/pageSize));
  const pagedReports=visibleReports.slice((page-1)*pageSize,page*pageSize);
  useEffect(()=>setPage(1),[query,filters,sort]);
  useEffect(()=>setPage(current=>Math.min(current,pageCount)),[pageCount]);

  const removeReport=async report=>{
    if (!canManage) return notify("Backend Admin laporan belum diperbarui.");
    if (!report.rowIndex) return notify("Identitas baris laporan tidak tersedia.");
    if (!window.confirm(`Hapus laporan ${report.mesin||report.namaMesin||""} tanggal mulai ${reportStartLabel(report)}?`)) return;
    setBusyRow(report.rowIndex);
    try {
      const result=await apiPost(ENDPOINTS.jobs,{
        action:"deleteReport",token:session.token,rowIndex:report.rowIndex,
        sheetId:report.sheetId,sheetName:report.sheetName
      });
      if (!isSuccess(result)) throw new Error(result.message||"Laporan gagal dihapus.");
      notify("Laporan kerja berhasil dihapus.");
      await remote.reload();
    } catch(error) {
      notify(error?.message||"Laporan gagal dihapus.");
    } finally { setBusyRow(null); }
  };

  const saveReport=async data=>{
    if (!editing?.rowIndex) throw new Error("Identitas baris laporan tidak tersedia.");
    const result=await apiPost(ENDPOINTS.jobs,{
      action:"updateReport",token:session.token,rowIndex:editing.rowIndex,
      sheetId:editing.sheetId,sheetName:editing.sheetName,...data,
      tanggal:toIdDate(data.tanggal)
    });
    if (!isSuccess(result)) throw new Error(result.message||"Laporan gagal diperbarui.");
    setEditing(null);
    notify("Perubahan laporan kerja berhasil disimpan.");
    await remote.reload();
  };

  return <>
    <Panel title="Riwayat laporan" action={<button className="primary small" onClick={() => go("jobForm")}><Plus size={16} /> Isi laporan</button>}>
      <div className="report-filter-panel">
        <label className="search report-search"><Search size={17}/><input value={query} onChange={event=>setQuery(event.target.value)} placeholder="Cari laporan, mesin, atau pekerjaan..."/></label>
        <div className="report-filter-grid">
          <label><span>Tahun</span><select value={filters.year} onChange={event=>setFilter("year",event.target.value)}>{filterOptions.years.map(year=><option key={year}>{year}</option>)}</select></label>
          <label><span>Bulan</span><select value={filters.month} onChange={event=>setFilter("month",event.target.value)}>{filterOptions.months.map(month=><option key={month.value} value={month.value}>{month.label}</option>)}</select></label>
          <label><span>Kategori mesin</span><select value={filters.category} onChange={event=>setFilter("category",event.target.value)}><option value="">Semua kategori</option>{filterOptions.categories.map(value=><option key={value}>{value}</option>)}</select></label>
          <label><span>Jenis</span><select value={filters.type} onChange={event=>setFilter("type",event.target.value)}><option value="">Semua jenis</option>{filterOptions.types.map(value=><option key={value}>{value}</option>)}</select></label>
          <label><span>Nama mesin</span><select value={filters.machine} onChange={event=>setFilter("machine",event.target.value)}><option value="">Semua mesin</option>{filterOptions.machines.map(value=><option key={value}>{value}</option>)}</select></label>
          <label><span>Bagian</span><select value={filters.section} onChange={event=>setFilter("section",event.target.value)}><option value="">Semua bagian</option>{filterOptions.sections.map(value=><option key={value}>{value}</option>)}</select></label>
          <div className="report-filter-summary"><b>{visibleReports.length}</b><span>laporan {requestedPeriod}</span><button type="button" onClick={resetFilters}>Bulan ini</button></div>
        </div>
      </div>
      {isAdmin && !capabilities.loading && !canManage && <div className="admin-backend-note"><ShieldCheck size={16}/><span><b>Mode Admin laporan menunggu backend baru</b><small>Pasang script LaporanKerja.secure.gs agar Edit dan Hapus aktif dengan verifikasi token.</small></span></div>}
      <RemoteState loading={remote.loading} error={remote.error} empty={!remote.data.length} onRetry={remote.reload} />
      {!remote.loading&&!remote.error&&remote.data.length>0&&visibleReports.length===0&&<div className="remote-state"><Search size={18}/> Tidak ada laporan yang cocok dengan filter.</div>}
      {!remote.loading && !remote.error && visibleReports.length > 0 && <div className="table-wrap"><table>
        <thead><tr>
          <th><button className="sort-head" onClick={()=>toggleSort("date")}>Tanggal mulai <span>{sortLabel("date")}</span></button></th>
          <th><button className="sort-head" onClick={()=>toggleSort("machine")}>Mesin <span>{sortLabel("machine")}</span></button></th>
          <th><button className="sort-head" onClick={()=>toggleSort("section")}>Bagian <span>{sortLabel("section")}</span></button></th>
          <th><button className="sort-head" onClick={()=>toggleSort("report")}>Laporan pekerjaan <span>{sortLabel("report")}</span></button></th>
          <th><button className="sort-head" onClick={()=>toggleSort("duration")}>Durasi <span>{sortLabel("duration")}</span></button></th>
          {isAdmin&&<th>Aksi Admin</th>}
        </tr></thead>
        <tbody>{pagedReports.map((report,index)=><tr
          className="clickable-report-row"
          key={`${report.sheetId||report.sheetName||"report"}-${report.rowIndex||`${report.tanggal}-${index}`}`}
          tabIndex="0"
          onClick={()=>setSelectedReport(report)}
          onKeyDown={event=>{
            if(event.key==="Enter"||event.key===" "){
              event.preventDefault();
              setSelectedReport(report);
            }
          }}
        >
          <td>{reportStartLabel(report)}</td><td><b>{report.mesin||report.namaMesin||"-"}</b><small>{report.jenisPekerjaan||""}</small></td>
          <td>{report.bagian||"-"}</td><td>{report.laporan||"-"}</td><td>{report.durasi||report.totalJam||"-"}</td>
          {isAdmin&&<td><div className="admin-row-actions">
            <button type="button" title="Edit laporan" disabled={!canManage||busyRow===report.rowIndex} onClick={event=>{event.stopPropagation();setEditing(report);}}><Edit3 size={15}/></button>
            <button type="button" className="danger" title="Hapus laporan" disabled={!canManage||busyRow===report.rowIndex} onClick={event=>{event.stopPropagation();removeReport(report);}}>{busyRow===report.rowIndex?<span className="spinner dark"/>:<Trash2 size={15}/>}</button>
          </div></td>}
        </tr>)}</tbody>
      </table>
      {pageCount>1&&<div className="table-pagination">
        <span>Menampilkan {(page-1)*pageSize+1}–{Math.min(page*pageSize,visibleReports.length)} dari {visibleReports.length}</span>
        <div>
          <button type="button" disabled={page===1} onClick={()=>setPage(value=>Math.max(1,value-1))}>Sebelumnya</button>
          <b>{page} / {pageCount}</b>
          <button type="button" disabled={page===pageCount} onClick={()=>setPage(value=>Math.min(pageCount,value+1))}>Berikutnya</button>
        </div>
      </div>}
      </div>}
    </Panel>
    {selectedReport&&<ReportDetailModal report={selectedReport} onClose={()=>setSelectedReport(null)}/>}
    {editing&&<ReportAdminEditor report={editing} onClose={()=>setEditing(null)} onSave={saveReport}/>}
  </>;
}

function ReportDetailModal({report,onClose}) {
  const value=(...keys)=>{
    for(const key of keys){
      const current=String(report?.[key]??"").trim();
      if(current) return current;
    }
    return "-";
  };
  const start=value("tanggalMulai","tglMulai","jamMulai","awal","tanggal");
  const finish=value("tanggalSelesai","tglSelesai","jamSelesai","akhir");
  const identity=[
    ["Bagian",value("bagian")],
    ["Kategori mesin",value("kategoriMesin")],
    ["Jenis mesin/armada",value("jenis")],
    ["Nama mesin/armada",value("mesin","namaMesin")],
    ["Jenis pekerjaan",value("jenisPekerjaan")],
    ["Jenis komponen",value("jenisKomponen")]
  ];
  const timing=[
    ["Tanggal laporan",value("tanggal")],
    ["Mulai pekerjaan",start],
    ["Selesai pekerjaan",finish],
    ["Total durasi",`${value("durasi","totalJam")}${value("durasi","totalJam")==="-"?"":" jam"}`]
  ];
  const material=[
    ["Kategori part",value("partKategori")],
    ["Spare part dipakai",value("sparepart","partNama")],
    ["Ukuran/kode part",value("ukuranPart","partUkuran")],
    ["Order spare part",value("order")]
  ];
  const result=[
    ["Status pekerjaan",value("statusOrder")],
    ["Nilai perbaikan",value("nilaiPerbaikan")],
    ["Definisi pekerjaan",value("definisi")]
  ];
  const DetailGrid=({items})=><div className="report-detail-grid">{items.map(([label,content])=>
    <div key={label}><small>{label}</small><b>{content}</b></div>
  )}</div>;
  return <div className="modal-overlay" onMouseDown={event=>event.target===event.currentTarget&&onClose()}>
    <article className="modal-card report-detail-modal">
      <div className="modal-head">
        <div><p className="eyebrow">Detail laporan kerja</p><h3>{value("mesin","namaMesin")}</h3><small>{start} · {value("bagian")}</small></div>
        <button type="button" onClick={onClose} aria-label="Tutup detail"><X size={18}/></button>
      </div>
      <section className="report-detail-highlight">
        <span className="icon-box mint"><FileBarChart size={20}/></span>
        <div><small>Laporan pekerjaan</small><p>{value("laporan")}</p></div>
      </section>
      <section className="report-detail-section"><h4>Identitas pekerjaan</h4><DetailGrid items={identity}/></section>
      <section className="report-detail-section"><h4>Waktu dan durasi</h4><DetailGrid items={timing}/></section>
      <section className="report-detail-columns">
        <div className="report-detail-section"><h4>Spare part</h4><DetailGrid items={material}/></div>
        <div className="report-detail-section"><h4>Hasil pekerjaan</h4><DetailGrid items={result}/></div>
      </section>
      <section className="report-detail-note"><small>Keterangan</small><p>{value("keterangan")}</p></section>
      <div className="modal-actions"><button type="button" className="primary" onClick={onClose}>Tutup</button></div>
    </article>
  </div>;
}

function ReportAdminEditor({report,onClose,onSave}) {
  const [saving,setSaving]=useState(false);
  const [error,setError]=useState("");
  const dateValue=useMemo(()=>{
    const match=String(report.tanggal||"").match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    return match?`${match[3]}-${match[2].padStart(2,"0")}-${match[1].padStart(2,"0")}`:"";
  },[report.tanggal]);
  const submit=async event=>{
    event.preventDefault();setSaving(true);setError("");
    try { await onSave(Object.fromEntries(new FormData(event.currentTarget).entries())); }
    catch(err){ setError(err?.message||"Perubahan gagal disimpan."); }
    finally { setSaving(false); }
  };
  return <div className="modal-overlay" onMouseDown={event=>{if(event.target===event.currentTarget)onClose();}}>
    <form className="modal-card report-admin-editor" onSubmit={submit}>
      <div className="modal-head"><div><p className="eyebrow">Admin report editor</p><h3>Edit laporan kerja</h3></div><button type="button" onClick={onClose}><X size={18}/></button></div>
      <div className="form-grid">
        <Field label="Tanggal"><input name="tanggal" type="date" defaultValue={dateValue} required/></Field>
        <Field label="Bagian"><input name="bagian" defaultValue={report.bagian||""} required/></Field>
        <Field label="Nama mesin"><input name="namaMesin" defaultValue={report.mesin||report.namaMesin||""} required/></Field>
        <Field label="Durasi (jam)"><input name="totalJam" defaultValue={report.durasi||report.totalJam||""}/></Field>
        <Field label="Laporan pekerjaan" wide><textarea name="laporan" defaultValue={report.laporan||""} required/></Field>
        <Field label="Waktu mulai"><input name="jamMulai" defaultValue={report.awal||report.jamMulai||""}/></Field>
        <Field label="Waktu selesai"><input name="jamSelesai" defaultValue={report.akhir||report.jamSelesai||""}/></Field>
        <Field label="Spare part"><input name="sparepart" defaultValue={report.sparepart||""}/></Field>
        <Field label="Order"><select name="order" defaultValue={report.order||"Tanpa Order"}><option>Order</option><option>Tanpa Order</option></select></Field>
        <Field label="Status"><select name="statusOrder" defaultValue={report.statusOrder||"Close"}><option>Open</option><option>Close</option></select></Field>
        <Field label="Nilai perbaikan"><select name="nilaiPerbaikan" defaultValue={report.nilaiPerbaikan||"Bagus"}><option>Bagus</option><option>Cukup</option><option>Tidak Bagus</option></select></Field>
        <Field label="Keterangan" wide><textarea name="keterangan" defaultValue={report.keterangan||""}/></Field>
      </div>
      {error&&<div className="remote-error"><AlertTriangle size={16}/><span>{error}</span></div>}
      <div className="modal-actions"><button type="button" className="secondary" onClick={onClose}>Batal</button><button className="primary" disabled={saving}>{saving?<><span className="spinner"/>Menyimpan…</>:<><Check size={16}/>Simpan perubahan</>}</button></div>
    </form>
  </div>;
}

function ChoiceField({label,children,wide=false}) {
  return <div className={`choice-field ${wide?"wide":""}`}><span>{label}</span>{children}</div>;
}

function ChoiceCards({name,options,value,onChange,defaultValue="",required=false,columns}) {
  return <div className="choice-radio-grid" style={columns?{"--choice-columns":columns}:undefined}>
    {options.map(option=>{
      const item=typeof option==="string"?{value:option,label:option}:option;
      const controlled=value!==undefined;
      return <label className="choice-radio" key={`${name}-${item.value}`}>
        <input
          type="radio"
          name={name}
          value={item.value}
          checked={controlled?value===item.value:undefined}
          defaultChecked={!controlled&&defaultValue===item.value}
          onChange={event=>onChange?.(event.target.value)}
          required={required}
        />
        <i/><span><b>{item.label}</b>{item.help&&<small>{item.help}</small>}</span>
      </label>;
    })}
  </div>;
}

function JobForm({ notify, go, session }) {
  const machines = useRemoteData(loadMachineMaster);
  const partsRemote = useRemoteData(() => firestoreOrFallback(
    "master_part",
    async () => asArray(await apiGet(ENDPOINTS.partMaster, { action:"getPart" }), ["stok","parts"])
  ));
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
  const isAdmin=String(session?.role||"").toLowerCase()==="admin";

  const readValue = (item, keys) => {
    for (const key of keys) {
      const value = item?.[key];
      if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
    }
    return "";
  };
  const machineRows = useMemo(() => machines.data.map(item => ({
    id:item.id,
    category:readValue(item, ["Kategori","kategori","kategoriMesin","kategori_mesin","category"]) || "Mesin",
    type:readValue(item, ["Jenis","jenis","jenisMesin","jenis_mesin","type"]),
    name:readValue(item, ["Nama","nama","namaMesin","nama_mesin","mesin"])
  })).filter(item => item.type && item.name), [machines.data]);
  const machineCategory = section === "Bengkel" ? "Armada" : "Mesin";
  const categoryMachines = useMemo(
    () => machineRows.filter(item => item.category.localeCompare(machineCategory, "id-ID", { sensitivity:"accent" }) === 0),
    [machineRows, machineCategory]
  );
  const machineTypes = useMemo(
    () => [...new Set(categoryMachines.map(item => item.type))].sort((a,b) => a.localeCompare(b,"id-ID")),
    [categoryMachines]
  );
  const machineNames = useMemo(
    () => categoryMachines.filter(item => item.type === machineType).map(item => item.name)
      .filter((value,index,array) => array.indexOf(value) === index)
      .sort((a,b) => a.localeCompare(b,"id-ID")),
    [categoryMachines, machineType]
  );

  const partRows = useMemo(() => partsRemote.data.map((item,index) => ({
    id:item.id||`part-${index}`,
    category:Array.isArray(item)?String(item[0]||"").trim():readValue(item, ["Kategori","kategori"]),
    name:Array.isArray(item)?String(item[1]||"").trim():readValue(item, ["Nama","nama"]),
    size:Array.isArray(item)?String(item[2]||"").trim():readValue(item, ["Ukuran","ukuran"]),
    componentType:Array.isArray(item)?String(item[3]||"").trim():readValue(item, ["Jenis Komponen","jenisKomponen","jenis_komponen"])
  })).filter(item => item.name && !(
    item.category.toLocaleLowerCase("id-ID")==="kategori" &&
    item.name.toLocaleLowerCase("id-ID")==="nama"
  )), [partsRemote.data]);
  const normalizePartSearch=value=>String(value||"")
    .normalize("NFD").replace(/[\u0300-\u036f]/g,"")
    .toLocaleLowerCase("id-ID").replace(/[^a-z0-9]+/g," ").trim();
  const partMatches = useMemo(() => {
    const query=normalizePartSearch(partSearch);
    if (query.length<2) return [];
    return partRows
      .filter(item=>normalizePartSearch(
        `${item.name} ${item.size} ${item.category} ${item.componentType}`
      ).includes(query))
      .sort((left,right)=>{
        const leftStarts=normalizePartSearch(left.name).startsWith(query)?0:1;
        const rightStarts=normalizePartSearch(right.name).startsWith(query)?0:1;
        return leftStarts-rightStarts||
          left.name.localeCompare(right.name,"id-ID")||
          left.size.localeCompare(right.size,"id-ID");
      })
      .slice(0,10);
  }, [partRows,partSearch]);
  const partCategories = useMemo(
    () => [...new Set(partRows.map(item=>item.category).filter(Boolean))]
      .sort((a,b)=>a.localeCompare(b,"id-ID")),
    [partRows]
  );
  const partNames = useMemo(
    () => [...new Set(partRows
      .filter(item=>item.category===selectedPartCategory)
      .map(item => item.name))]
      .sort((a,b) => a.localeCompare(b,"id-ID")),
    [partRows,selectedPartCategory]
  );
  const partSizes = useMemo(
    () => [...new Set(partRows
      .filter(item => item.category===selectedPartCategory&&item.name===selectedPart)
      .map(item => item.size).filter(Boolean))]
      .sort((a,b) => a.localeCompare(b,"id-ID")),
    [partRows,selectedPartCategory,selectedPart]
  );
  const selectPartResult=item=>{
    setSelectedPartCategory(item.category);
    setSelectedPart(item.name);
    setPartSize(item.size||"");
    if (item.componentType) setWorkComponent(item.componentType);
    setPartSearch(`${item.name}${item.size?` · ${item.size}`:""}`);
    setPartSearchOpen(false);
  };

  const totalHours = useMemo(() => {
    if (!startDate || !startTime || !endDate || !endTime) return "0,00";
    const start = new Date(`${startDate}T${startTime}:00`);
    const end = new Date(`${endDate}T${endTime}:00`);
    const hours = (end.getTime() - start.getTime()) / 3600000;
    return Number.isFinite(hours) && hours >= 0
      ? hours.toLocaleString("id-ID", { minimumFractionDigits:2, maximumFractionDigits:2 })
      : "0,00";
  }, [startDate,startTime,endDate,endTime]);

  const addMasterPart=async data=>{
    if (!isAdmin) throw new Error("Hanya Admin yang dapat menambahkan master part.");
    const kategori=String(data.kategori||"").trim();
    const nama=String(data.nama||"").trim();
    const ukuran=String(data.ukuran||"").trim();
    const jenisKomponen=String(data.jenisKomponen||"").trim();
    const satuan=String(data.satuan||"Pcs").trim()||"Pcs";
    const stokAwal=Number(String(data.stokAwal??"0").replace(",","."));
    if (!kategori||!nama||!ukuran) throw new Error("Kategori, nama, dan ukuran part wajib diisi.");
    if (!Number.isFinite(stokAwal)||stokAwal<0) throw new Error("Stok awal harus berupa angka nol atau lebih.");
    const stockResult=await apiPost(ENDPOINTS.jobs,{
      action:"addMasterPart",token:session.token,kategori,nama,ukuran,
      jenisKomponen,satuan,stokAwal
    },{timeout:90000});
    if (!isSuccess(stockResult)) {
      const unsupported=String(stockResult?.message||"").toLowerCase().includes("tanggal");
      throw new Error(unsupported
        ?"Backend laporan belum mendukung tambah master part. Terapkan LaporanKerja.secure.gs versi terbaru."
        :stockResult?.message||"Part gagal ditambahkan ke database stok.");
    }
    if (stockResult?.firestoreSynced !== true) {
      throw new Error(
        "Backend belum menyinkronkan Firestore. Ganti Code.gs dengan LaporanKerja.secure.gs versi 2.8, tambahkan scope Firestore, lalu terapkan deployment kembali."
      );
    }
    if (stockResult?.stockSynced !== true) {
      throw new Error(
        "Backend belum menambahkan part ke tab Stok. Terapkan LaporanKerja.secure.gs versi 2.8 sebagai deployment baru."
      );
    }
    invalidateFirestoreCollection("master_part");
    await partsRemote.reload();
    setSelectedPartCategory(kategori);
    setSelectedPart(nama);
    setPartSize(ukuran);
    if (jenisKomponen) setWorkComponent(jenisKomponen);
    setPartSearch(`${nama} · ${ukuran}`);
    setShowAddPart(false);
    notify(stockResult?.message||(
      stockResult?.duplicate
        ?"Data part berhasil disinkronkan ke Firestore dan tab Stok."
        :"Master part berhasil ditambahkan ke Firestore, tab Part, dan tab Stok."
    ));
  };

  const submit = async (data) => {
    const mappedSection = data.bagian === "Teknik A"
      ? "Tek. Shift A"
      : data.bagian === "Teknik B"
        ? "Tek. Shift B"
        : data.bagian;
    const payload = {
      token:session?.token||"",
      tanggal:toIdDate(data.tanggal), bagian:mappedSection, kategoriMesin:data.kategoriMesin,
      jenis:data.jenis, namaMesin:data.namaMesin, jenisPekerjaan:data.jenisPekerjaan,
      laporan:data.laporan, jenisKomponen:data.jenisKomponen,
      jamMulai:`${toIdDate(data.tglMulai)} ${data.jamMulai}`, jamSelesai:`${toIdDate(data.tglSelesai)} ${data.jamSelesai}`,
      totalJam:data.totalJam, definisi:data.definisi || "", sparepart:data.sparepart,
      ukuranPart:data.ukuranPart || "", order:data.order || "Tanpa Order", statusOrder:data.statusOrder || "",
      nilaiPerbaikan:data.nilaiPerbaikan, keterangan:data.keterangan,
      isNewMachine:false, isNewPart:false, partKategori:data.partKategori || "",
      partNama:data.sparepart, partUkuran:data.ukuranPart || ""
    };
    const result = await apiPost(ENDPOINTS.jobs, payload);
    if (!isSuccess(result)) throw new Error(result.message || "Laporan gagal disimpan.");
    notify("Laporan kerja berhasil disimpan dan tersinkron.");
    go("jobs");
  };
  return <><FormPanel title="Dokumentasi pekerjaan" onSubmit={submit} submit="Simpan laporan">
    <div className="form-section-title wide"><span>01</span><div><b>Identitas pekerjaan</b><small>Mesin dan aset mengikuti master data Android.</small></div></div>
    <Field label="Tanggal laporan"><input name="tanggal" type="date" defaultValue={today} required /></Field>
    <ChoiceField label="Bagian pekerjaan" wide>
      <ChoiceCards name="bagian" value={section} required columns={3}
        options={["Teknik","Teknik A","Teknik B","Umum","Bengkel","Konstruksi"]}
        onChange={value=>{
        setSection(value);
        setMachineType("");
        setMachineName("");
      }}/>
    </ChoiceField>
    <Field label="Kategori perangkat">
      <input name="kategoriMesin" value={section ? machineCategory : ""} placeholder="Otomatis dari bagian" readOnly required />
    </Field>
    <Field label={`Jenis ${machineCategory.toLowerCase()}`}>
      <select name="jenis" value={machineType} onChange={event=>{
        setMachineType(event.target.value);
        setMachineName("");
      }} disabled={!section || machines.loading} required>
        <option value="">{machines.loading ? "Memuat master mesin…" : `Pilih jenis ${machineCategory.toLowerCase()}`}</option>
        {machineTypes.map(value=><option key={value}>{value}</option>)}
      </select>
    </Field>
    <Field label={`Nama ${machineCategory.toLowerCase()}`}>
      <select name="namaMesin" value={machineName} onChange={event=>setMachineName(event.target.value)} disabled={!machineType || machines.loading} required>
        <option value="">{machineType ? `Pilih nama ${machineCategory.toLowerCase()}` : "Pilih jenis terlebih dahulu"}</option>
        {machineNames.map(value=><option key={value}>{value}</option>)}
      </select>
      {machines.error && <small className="field-help error">Master mesin gagal dimuat: {machines.error}</small>}
    </Field>

    <div className="form-section-title wide"><span>02</span><div><b>Detail pekerjaan</b><small>Klasifikasi sama dengan formulir Android.</small></div></div>
    <ChoiceField label="Jenis pekerjaan" wide>
      <ChoiceCards name="jenisPekerjaan" required columns={3}
        options={["Perbaikan","Pemeriksaan","Pemasangan","Pemindahan","Pembuatan","Setting"]}/>
    </ChoiceField>
    <ChoiceField label="Jenis komponen" wide>
      <ChoiceCards name="jenisKomponen" value={workComponent} required columns={3}
        onChange={setWorkComponent}
        options={[...new Set([workComponent,"Mekanikal","Elektrikal","Konstruksi"].filter(Boolean))]}/>
    </ChoiceField>
    <Field label="Laporan pekerjaan" wide><textarea name="laporan" placeholder="Uraikan pekerjaan yang dilakukan…" required /></Field>

    <div className="form-section-title wide"><span>03</span><div><b>Waktu dan durasi</b><small>Total jam dihitung otomatis.</small></div></div>
    <Field label="Tanggal mulai"><input name="tglMulai" type="date" value={startDate} onChange={event=>setStartDate(event.target.value)} required /></Field>
    <Field label="Jam mulai"><input name="jamMulai" type="time" value={startTime} onChange={event=>setStartTime(event.target.value)} required /></Field>
    <Field label="Tanggal selesai"><input name="tglSelesai" type="date" value={endDate} onChange={event=>setEndDate(event.target.value)} required /></Field>
    <Field label="Jam selesai"><input name="jamSelesai" type="time" value={endTime} onChange={event=>setEndTime(event.target.value)} required /></Field>
    <Field label="Total durasi">
      <div className="calculated-field"><Clock3 size={17}/><b>{totalHours} jam</b></div>
      <input name="totalJam" type="hidden" value={totalHours} />
    </Field>
    <ChoiceField label="Definisi pekerjaan" wide>
      <ChoiceCards name="definisi" defaultValue="" columns={4}
        options={[{value:"",label:"Tidak ada"},"Tunggu Part","Overhaul","Kirim Luar"]}/>
    </ChoiceField>

    <div className="form-section-title wide"><span>04</span><div><b>Material dan hasil</b><small>Cari nama atau kode part terlebih dahulu agar tidak membuat master ganda.</small></div></div>
    <Field label="Cari nama / kode spare part" wide>
      <div className="part-lookup">
        <Search size={17}/>
        <input
          type="search"
          value={partSearch}
          onFocus={()=>setPartSearchOpen(true)}
          onBlur={()=>setTimeout(()=>setPartSearchOpen(false),150)}
          onChange={event=>{
            setPartSearch(event.target.value);
            setPartSearchOpen(true);
          }}
          placeholder="Ketik minimal 2 huruf, contoh: carbon brush atau 20 x 32"
          autoComplete="off"
        />
        {partSearch&&<button type="button" className="part-lookup-clear" onClick={()=>{
          setPartSearch("");
          setPartSearchOpen(false);
        }} aria-label="Hapus pencarian"><X size={15}/></button>}
        {partSearchOpen&&normalizePartSearch(partSearch).length>=2&&
          <div className="part-lookup-results">
            {partsRemote.loading
              ? <div className="part-lookup-state"><span className="spinner dark"/>Mencari master part…</div>
              : partMatches.length
                ? <>
                    <small>{partMatches.length} hasil terdekat</small>
                    {partMatches.map((item,index)=><button
                      type="button"
                      key={`${item.id||item.name}-${item.size}-${index}`}
                      onMouseDown={event=>event.preventDefault()}
                      onClick={()=>selectPartResult(item)}
                    >
                      <span><b>{item.name}</b><em>{item.size||"Tanpa ukuran"}</em></span>
                      <span><i>{item.category||"Tanpa kategori"}</i><i>{item.componentType||"Jenis belum diisi"}</i></span>
                      <Check size={15}/>
                    </button>)}
                  </>
                : <div className="part-lookup-empty">
                    <b>Part tidak ditemukan</b>
                    <span>Periksa ejaan atau cari menggunakan ukuran/kode.</span>
                    {isAdmin
                      ? <button type="button" onMouseDown={event=>event.preventDefault()} onClick={()=>{
                          setPartSearchOpen(false);
                          setShowAddPart(true);
                        }}><Plus size={14}/> Buat master part baru</button>
                      : <small>Hubungi Admin jika part memang belum terdaftar.</small>}
                  </div>
            }
          </div>}
      </div>
      <small className="field-help">Memilih hasil pencarian akan mengisi kategori, nama, ukuran, dan jenis komponen secara otomatis.</small>
    </Field>
    <Field label="Kategori part">
      <select value={selectedPartCategory} onChange={event=>{
        const value=event.target.value;
        setSelectedPartCategory(value);
        setSelectedPart(value==="Tidak Pakai"?"Tidak Pakai":"");
        setPartSize("");
        setPartSearch("");
      }} disabled={partsRemote.loading} required>
        <option>Tidak Pakai</option>
        {partCategories.map(value=><option key={value}>{value}</option>)}
      </select>
      <input name="partKategori" type="hidden" value={selectedPartCategory==="Tidak Pakai"?"":selectedPartCategory}/>
      {partsRemote.error && <small className="field-help error">Master part gagal dimuat: {partsRemote.error}</small>}
      {isAdmin&&<button type="button" className="field-add-button" onClick={()=>setShowAddPart(true)}><Search size={14}/> Cari ulang atau tambahkan master</button>}
    </Field>
    <Field label="Spare part dipakai">
      <select name="sparepart" value={selectedPart} onChange={event=>{
        const value=event.target.value;
        setSelectedPart(value);
        setPartSize("");
        setPartSearch("");
        const matched=partRows.find(item=>
          item.category===selectedPartCategory&&item.name===value
        );
        if (matched?.componentType) setWorkComponent(matched.componentType);
      }} disabled={partsRemote.loading} required>
        <option value="">{selectedPartCategory==="Tidak Pakai"?"Tidak menggunakan part":"Pilih spare part"}</option>
        {selectedPartCategory==="Tidak Pakai"&&<option value="Tidak Pakai">Tidak Pakai</option>}
        {partNames.map(value=><option key={value}>{value}</option>)}
      </select>
    </Field>
    <Field label="Kode / jenis / ukuran part">
      <select name="ukuranPart" value={partSize} onChange={event=>{
        const value=event.target.value;
        setPartSize(value);
        const matched=partRows.find(item=>
          item.category===selectedPartCategory&&item.name===selectedPart&&item.size===value
        );
        if (matched?.componentType) setWorkComponent(matched.componentType);
      }} disabled={selectedPartCategory==="Tidak Pakai"||!selectedPart} required={selectedPartCategory!=="Tidak Pakai"&&partSizes.length>0}>
        <option value="">{selectedPartCategory==="Tidak Pakai"?"Tidak menggunakan part":!selectedPart?"Pilih spare part terlebih dahulu":partSizes.length?"Pilih ukuran part":"Tidak ada ukuran pada master"}</option>
        {partSizes.map(value=><option key={value}>{value}</option>)}
      </select>
    </Field>
    <ChoiceField label="Nilai perbaikan">
      <ChoiceCards name="nilaiPerbaikan" required columns={3}
        options={["Bagus","Cukup","Tidak Bagus"]}/>
    </ChoiceField>

    <div className="form-section-title wide"><span>05</span><div><b>Status dan order</b><small>Status akhir laporan serta kebutuhan pemesanan.</small></div></div>
    <ChoiceField label="Order spare part">
      <ChoiceCards name="order" defaultValue="Tanpa Order" columns={2}
        options={[{value:"Tanpa Order",label:"Tanpa Order"},{value:"Order",label:"Pakai Order"}]}/>
    </ChoiceField>
    <ChoiceField label="Status pekerjaan">
      <ChoiceCards name="statusOrder" required columns={2}
        options={[{value:"Open",label:"Masih open"},{value:"Close",label:"Selesai / close"}]}/>
    </ChoiceField>
    <Field label="Keterangan" wide><textarea name="keterangan" placeholder="Catatan tambahan…" /></Field>
  </FormPanel>
  {showAddPart&&<AddMasterPartModal
    existingCategories={partCategories}
    existingParts={partRows}
    initialQuery={partSearch}
    onClose={()=>setShowAddPart(false)}
    onSelectExisting={item=>{
      selectPartResult(item);
      setShowAddPart(false);
    }}
    onSave={addMasterPart}
  />}</>;
}

function AddMasterPartModal({
  existingCategories,existingParts,initialQuery,onClose,onSelectExisting,onSave
}) {
  const [saving,setSaving]=useState(false);
  const [error,setError]=useState("");
  const [lookup,setLookup]=useState(initialQuery||"");
  const [creating,setCreating]=useState(false);
  const [syncExisting,setSyncExisting]=useState(false);
  const [categoryChoice,setCategoryChoice]=useState("");
  const [newCategory,setNewCategory]=useState("");
  const [partName,setPartName]=useState("");
  const [partSize,setPartSize]=useState("");
  const [componentType,setComponentType]=useState("");
  const resolvedCategory=categoryChoice==="__new__"?newCategory.trim():categoryChoice;
  const normalize=value=>String(value||"").normalize("NFD")
    .replace(/[\u0300-\u036f]/g,"").toLocaleLowerCase("id-ID")
    .replace(/[^a-z0-9]+/g," ").trim();
  const matches=useMemo(()=>{
    const query=normalize(lookup);
    if (query.length<2) return [];
    return existingParts.filter(item=>normalize(
      `${item.name} ${item.size} ${item.category} ${item.componentType}`
    ).includes(query)).sort((left,right)=>{
      const leftStarts=normalize(left.name).startsWith(query)?0:1;
      const rightStarts=normalize(right.name).startsWith(query)?0:1;
      return leftStarts-rightStarts||
        left.name.localeCompare(right.name,"id-ID")||
        left.size.localeCompare(right.size,"id-ID");
    }).slice(0,8);
  },[existingParts,lookup]);
  const beginNew=(seed,asSync=false)=>{
    setCreating(true);
    setSyncExisting(asSync);
    setError("");
    setCategoryChoice(seed?.category||"");
    setNewCategory("");
    setPartName(seed?.name||lookup.trim());
    setPartSize(asSync?(seed?.size||""):"");
    setComponentType(seed?.componentType||"");
  };
  const submit=async event=>{
    event.preventDefault();
    if (!creating) {
      setError("Cari master part terlebih dahulu. Form data baru hanya dibuka jika part atau variannya belum tersedia.");
      return;
    }
    setSaving(true);setError("");
    try { await onSave(Object.fromEntries(new FormData(event.currentTarget).entries())); }
    catch(err) { setError(err?.message||"Master part gagal disimpan."); }
    finally { setSaving(false); }
  };
  return <div className="modal-overlay" onMouseDown={event=>{if(event.target===event.currentTarget&&!saving)onClose();}}>
    <form className="modal-card add-part-modal" onSubmit={submit}>
      <div className="modal-head"><div><p className="eyebrow">Admin master data</p><h3>Cari atau tambah spare part</h3><small>Pastikan part belum tersedia sebelum membuat data baru.</small></div><button type="button" disabled={saving} onClick={onClose}><X size={18}/></button></div>
      <div className="master-part-search">
        <Search size={17}/>
        <input type="search" value={lookup} onChange={event=>{
          setLookup(event.target.value);
          setCreating(false);
          setSyncExisting(false);
          setError("");
        }} placeholder="Cari nama, ukuran, kode, atau kategori…" autoFocus/>
      </div>
      {normalize(lookup).length<2
        ? <div className="master-part-guidance"><Search size={22}/><div><b>Cari master part dahulu</b><span>Ketik minimal 2 huruf untuk memeriksa data yang sudah tersedia.</span></div></div>
        : matches.length
          ? <div className="master-part-matches">
              <div><b>Part serupa ditemukan</b><span>Pilih data yang sesuai, tambah varian ukuran, atau buat part baru jika hasil tersebut berbeda.</span></div>
              {matches.map((item,index)=><button type="button" key={`${item.id||item.name}-${item.size}-${index}`} onClick={()=>onSelectExisting(item)}>
                <span><b>{item.name}</b><small>{item.size||"Tanpa ukuran"}</small></span>
                <span><em>{item.category||"Tanpa kategori"}</em><em>{item.componentType||"Jenis belum diisi"}</em></span>
                <CheckCircle2 size={17}/>
              </button>)}
              {!creating&&<>
                <button type="button" className="master-part-variant" onClick={()=>beginNew(matches[0],false)}><Plus size={15}/> Nama sudah ada, tetapi ukuran/kode berbeda</button>
                <button type="button" className="master-part-variant" onClick={()=>beginNew(null,false)}><Plus size={15}/> Hasil tidak sesuai — buat spare part baru</button>
                <button type="button" className="master-part-variant master-part-sync" onClick={()=>beginNew(matches[0],true)}><Database size={15}/> Sinkronkan hasil teratas ke tab Stok</button>
              </>}
            </div>
          : <div className="master-part-not-found">
              <AlertTriangle size={18}/><div><b>Tidak ditemukan pada master</b><span>Pastikan ejaan sudah benar sebelum membuat data baru.</span></div>
              {!creating&&<button type="button" onClick={()=>beginNew(null,false)}><Plus size={15}/> Buat data baru</button>}
            </div>
      }
      {creating&&<div className="master-part-new-form">
        <div className="master-part-new-title"><span>{syncExisting?"Sinkronisasi":"Data baru"}</span><b>{syncExisting?"Pastikan stok awal dan satuan sudah benar":"Lengkapi identitas sparepart"}</b></div>
        <div className="form-grid">
          <input name="syncExisting" type="hidden" value={syncExisting?"true":""}/>
          <Field label="Kategori part">
          <select value={categoryChoice} onChange={event=>{setCategoryChoice(event.target.value);setNewCategory("");}} required>
            <option value="">Pilih kategori</option>
            {existingCategories.map(value=><option value={value} key={value}>{value}</option>)}
            <option value="__new__">+ Tambah kategori baru</option>
          </select>
          <input name="kategori" type="hidden" value={resolvedCategory}/>
          {categoryChoice==="__new__"&&<input className="nested-new-input" value={newCategory} onChange={event=>setNewCategory(event.target.value)} placeholder="Nama kategori baru" required/>}
        </Field>
          <Field label="Nama spare part"><input name="nama" value={partName} onChange={event=>setPartName(event.target.value)} placeholder="Nama spare part" required/></Field>
          <Field label="Ukuran / kode"><input name="ukuran" value={partSize} onChange={event=>setPartSize(event.target.value)} placeholder="Ukuran, tipe, atau kode" required/></Field>
          <Field label="Jenis komponen"><select name="jenisKomponen" value={componentType} onChange={event=>setComponentType(event.target.value)}><option value="">Tidak ditentukan</option>{componentType&&!["Mekanikal","Elektrikal","Konstruksi"].includes(componentType)&&<option>{componentType}</option>}<option>Mekanikal</option><option>Elektrikal</option><option>Konstruksi</option></select></Field>
          <Field label="Stok awal"><input name="stokAwal" type="number" min="0" step="any" defaultValue="0" required/></Field>
          <Field label="Satuan">
            <input name="satuan" list="master-part-units" defaultValue="Pcs" placeholder="Contoh: Pcs" required/>
            <datalist id="master-part-units">
              {["Pcs","Unit","Set","Meter","Liter","Kg","Batang","Roll","Tabung"].map(value=><option value={value} key={value}/>)}
            </datalist>
          </Field>
        </div>
      </div>}
      {error&&<div className="remote-error"><AlertTriangle size={16}/><span>{error}</span></div>}
      <p className="sensitive-data-note"><ShieldCheck size={15}/> Aksi ini hanya diproses setelah token sesi Admin diverifikasi backend.</p>
      <div className="modal-actions">
        <button type="button" className="secondary" disabled={saving} onClick={onClose}>Batal</button>
        {creating&&<button className="primary" disabled={saving}>{saving?<><span className="spinner"/>Menyimpan…</>:syncExisting?<><Database size={16}/>Sinkronkan part</>:<><Plus size={16}/>Tambahkan part</>}</button>}
      </div>
    </form>
  </div>;
}

function Stock({ go }) {
  const [q,setQ] = useState("");
  const [category,setCategory] = useState("Semua kategori");
  const remote = useRemoteData(async () => {
    const [stockResult,masterResult] = await Promise.allSettled([
      apiGet(ENDPOINTS.stock, { action:"getStokPart", bulan:currentIndonesianMonth() }, { timeout:90000 }),
      Promise.race([
        getFirestoreCollection("master_part"),
        new Promise((_,reject) => setTimeout(() => reject(new Error("Master part timeout")),20000))
      ])
    ]);
    if (stockResult.status === "rejected") throw stockResult.reason;
    const master = masterResult.status === "fulfilled" ? masterResult.value : [];
    const clean = value => String(value||"").trim().toLocaleLowerCase("id-ID").replace(/\s+/g," ");
    const exact = new Map(),byName = new Map();
    master.forEach(part => {
      const nama=part.Nama??part.nama,ukuran=part.Ukuran??part.ukuran,kategori=part.Kategori??part.kategori;
      if (!nama || !kategori) return;
      exact.set(`${clean(nama)}|${clean(ukuran)}`,String(kategori).trim());
      if (!byName.has(clean(nama))) byName.set(clean(nama),String(kategori).trim());
    });
    return asArray(stockResult.value).map(part => ({
      ...part,
      kategori:part.kategori||part.Kategori||exact.get(`${clean(part.nama)}|${clean(part.ukuran)}`)||byName.get(clean(part.nama))||"Tanpa kategori"
    }));
  });
  const categories = useMemo(() => [...new Set(remote.data.map(p=>p.kategori).filter(Boolean))]
    .sort((a,b)=>a.localeCompare(b,"id-ID")), [remote.data]);
  const filtered = remote.data
    .filter(p => category === "Semua kategori" || p.kategori === category)
    .filter(p => `${p.kategori} ${p.nama} ${p.ukuran}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a,b) => a.kategori.localeCompare(b.kategori,"id-ID") || String(a.nama).localeCompare(String(b.nama),"id-ID") || String(a.ukuran).localeCompare(String(b.ukuran),"id-ID"));
  const totalStock = remote.data.reduce((n,p) => n + Number(p.stok || 0), 0);
  const low = remote.data.filter(p => Number(p.stok || 0) < 10).length;
  return <><div className="stats-grid three"><Stat icon={Boxes} label="Total jenis part" value={remote.loading ? "…" : remote.data.length} detail="Data Spreadsheet" tone="blue" /><Stat icon={Package} label="Stok tersedia" value={remote.loading ? "…" : totalStock} detail="Seluruh gudang" tone="mint" /><Stat icon={AlertTriangle} label="Di bawah 10" value={remote.loading ? "…" : low} detail="Perlu perhatian" tone="amber" /></div>
    <Panel title="Inventori spare part" action={<div className="button-row"><button className="secondary small" onClick={() => go("partRequests")}><History size={16} /> Daftar bon</button><button className="primary small" onClick={() => go("partOrder")}><Plus size={16} /> Order part</button></div>}><Toolbar query={q} setQuery={setQ}><select value={category} onChange={e=>setCategory(e.target.value)} aria-label="Sortir kategori"><option>Semua kategori</option>{categories.map(item=><option key={item}>{item}</option>)}</select></Toolbar><RemoteState loading={remote.loading} error={remote.error} empty={!filtered.length} onRetry={remote.reload} />{!remote.loading && !remote.error && filtered.length > 0 && <SimpleTable headers={["Kategori","Nama part","Ukuran / jenis","Stok","Satuan"]} rows={filtered.map(p => [p.kategori,p.nama,p.ukuran,<b className={Number(p.stok)<10 ? "low-stock" : ""}>{p.stok}</b>,p.satuan])} />}</Panel></>;
}

function PartOrder({ notify, go }) {
  const metadata = useRemoteData(() => apiGet(ENDPOINTS.partOrder, { action:"getMetadataOrder" }));
  const stok = asArray(metadata.data?.stok);
  const submit = async (data) => {
    const result = await apiPost(ENDPOINTS.partOrder, { action:"submitOrder", ...data, tglPesan:toIdDate(data.tglPesan), isNewData:!stok.some(x => (Array.isArray(x) ? x[2] : x.nama) === data.nama), status:"Open" });
    if (!isSuccess(result)) throw new Error(result.message || "Order part gagal disimpan.");
    notify("Order part berhasil dikirim dan tersinkron.");
    go("stock");
  };
  return <FormPanel title="Permintaan spare part" onSubmit={submit} submit="Kirim order part">
    <Field label="Tanggal pesan"><input name="tglPesan" type="date" defaultValue={new Date().toISOString().slice(0,10)} required /></Field><Field label="Kategori"><input name="kategori" required /></Field><Field label="Nama part"><input name="nama" list="part-options" required /><datalist id="part-options">{stok.map((x,i) => <option key={i} value={Array.isArray(x) ? x[2] : x.nama} />)}</datalist></Field><Field label="Ukuran"><input name="ukuran" /></Field><Field label="Jumlah pesan"><input name="jmlPesan" type="number" required /></Field><Field label="Satuan"><input name="satuan" /></Field><Field label="Kegunaan"><input name="kegunaan" /></Field><Field label="Mesin"><input name="mesin" /></Field><Field label="Bagian"><input name="bagian" /></Field><Field label="Pemesan"><input name="pemesan" required /></Field>
  </FormPanel>;
}

function More({ go, session, notify }) {
  const items = [
    ["users","Teknisi","Manajemen teknisi",Users,"mint", session.role === "Admin"],
    ["transformer","Trafo","Monitoring transformator",Zap,"amber",true],
    ["overtime","Lemburan","Pengajuan kerja lembur",Clock3,"violet",true],
    ["overtimeRecap","Rekap Lembur","Total jam dan upah karyawan",FileBarChart,"amber",session.role === "Admin"],
    ["catalog","Katalog","Referensi produk teknik",BookOpen,"blue",true],
    ["settings","Pengaturan","Preferensi sistem",Settings,"mint",true]
  ];
  return <div className="more-grid">{items.map(([id,title,sub,Icon,tone,allowed]) => <button key={id} className={`more-card ${!allowed ? "locked" : ""}`} onClick={() => allowed ? go(id) : notify("Hanya Admin yang memiliki akses.")}><span className={`icon-box ${tone}`}><Icon /></span><div><b>{title}</b><small>{sub}</small></div><ArrowRight /></button>)}</div>;
}

function TransformerMenu({ go }) {
  return <div className="split-actions"><button className="choice-card large-choice" onClick={() => go("transformerForm")}><span className="icon-box amber"><ClipboardCheck /></span><div><b>Isi inspeksi</b><small>Catat kondisi, status stang, kabel, masa, dan keterangan trafo.</small></div><ArrowRight /></button><button className="choice-card large-choice" onClick={() => go("transformerData")}><span className="icon-box blue"><Database /></span><div><b>Data trafo</b><small>Lihat master transformator dan seluruh riwayat pemeriksaan.</small></div><ArrowRight /></button></div>;
}

function TransformerForm({ notify }) {
  const travos = useRemoteData(async () => asArray(await apiGet(ENDPOINTS.transformer, { action:"getDataTravo" })));
  const refs = useRemoteData(() => apiGet(ENDPOINTS.transformer, { action:"getReferensi" }));
  const submit = async (data) => {
    const selected = travos.data.find(x => x.kode === data.kode);
    const result = await apiPost(ENDPOINTS.transformer, { action:"simpanInspeksi", ...data, nama:selected?.nama || data.nama });
    if (!isSuccess(result)) throw new Error(result.message || "Inspeksi trafo gagal disimpan.");
    notify("Data inspeksi trafo berhasil disimpan dan tersinkron.");
  };
  return <FormPanel title="Form inspeksi transformator" onSubmit={submit} submit="Simpan inspeksi">
    <Field label="Kode trafo"><select name="kode" required><option value="">Pilih kode</option>{travos.data.map(x => <option key={x.kode}>{x.kode}</option>)}</select></Field><Field label="Lokasi"><select name="lokasi">{asArray(refs.data?.lokasi).map(x => <option key={x}>{x}</option>)}</select></Field><Field label="Kondisi"><select name="kondisi"><option>Bagus</option><option>Rusak</option><option>N/A</option></select></Field><Field label="Status"><select name="status"><option>Digunakan</option><option>Standby</option><option>Rusak</option><option>Servis</option></select></Field><Field label="Stang las"><select name="stang"><option>Ada</option><option>Tidak</option><option>Rusak</option></select></Field><Field label="Kabel las"><select name="kabel"><option>Ada</option><option>Tidak</option><option>Rusak</option></select></Field><Field label="Masa las"><select name="masa"><option>Ada</option><option>Tidak</option><option>Rusak</option></select></Field><Field label="Keterangan" wide><textarea name="keterangan" /></Field>
  </FormPanel>;
}

function Catalog() {
  const items = [
    ["Bearing","Komponen bantalan putar",Gauge,"https://drive.google.com/file/d/1tN3fUbcZZFIik2ne-qhtUgzoHXfVqR8y/view?usp=drive_link"],
    ["Baut","Fastener industri",Settings,"https://drive.google.com/file/d/1CYVlwlHJ2vlEVinisZBqxXI1VgNC9Bqs/view?usp=drive_link"],
    ["Chain Coupling","Rantai transmisi",SlidersHorizontal,"https://drive.google.com/file/d/1-djNvG4UZl_bS2l_4MuUnpv-Adj_EEgi/view?usp=drive_link"],
    ["Circlip","Retaining ring",CircleIcon,"https://drive.google.com/file/d/1UH5kRt9hzUjjnrBVgFRODjToZpld6m_j/view?usp=drive_link"],
    ["Flange","Sambungan perpipaan",Activity,"https://drive.google.com/file/d/1_NR0iIaRgz41jjMCnKc5P6zH2UKaLp7Q/view?usp=drive_link"],
    ["O-Ring","Sistem penyekat",Boxes,"https://drive.google.com/file/d/1zqcM5-r60p7U0byWZaHW3I4xYIXG2eG2/view?usp=share_link"]
  ];
  return <div className="catalog-grid">{items.map(([name,sub,Icon,url]) => <article key={name}><div className="catalog-art"><Icon size={42} /></div><b>{name}</b><small>{sub}</small><button onClick={() => window.open(url,"_blank","noopener,noreferrer")}>Lihat katalog <ArrowRight size={15} /></button></article>)}</div>;
}
function CircleIcon(props){ return <Activity {...props}/>; }

function Stang({ notify }) {
  const remote = useRemoteData(() => apiGet(ENDPOINTS.stang, { action:"getDatabaseStang" }));
  const summary = remote.data?.rangkuman || {};
  const submit = async (data) => {
    const params = data.action === "pinjam"
      ? { action:"pinjam", kode:"", keluar:toIdDate(data.tanggal), namaKeluar:data.group, digunakan:data.lokasi, kembali:"", namaKembali:"", dari:"", merk:data.merk, durasi:"0", keterangan:data.keterangan }
      : { action:"kembali", kode:data.kode, keluar:"", namaKeluar:"", digunakan:"", kembali:toIdDate(data.tanggal), namaKembali:data.group, dari:data.lokasi, merk:data.merk, durasi:data.durasi || "0", keterangan:data.keterangan };
    const result = await apiGet(ENDPOINTS.stang, params);
    if (!isSuccess(result)) throw new Error(result.message || "Transaksi stang gagal.");
    notify("Transaksi stang berhasil disimpan dan tersinkron.");
    remote.reload();
  };
  return <><div className="stats-grid three"><Stat icon={SlidersHorizontal} label="Total dikeluarkan" value={summary.totalDikeluarkan || "…"} detail="Data Spreadsheet" tone="blue" /><Stat icon={Warehouse} label="Sudah kembali" value={summary.totalSudahKembali || "…"} detail="Data Spreadsheet" tone="mint" /><Stat icon={History} label="Belum kembali" value={summary.totalBelumKembali || "…"} detail="Perlu ditelusuri" tone="amber" /></div><FormPanel title="Sirkulasi stang" onSubmit={submit} submit="Simpan transaksi"><Field label="Jenis transaksi"><select name="action"><option value="pinjam">Keluar / pinjam</option><option value="kembali">Kembali</option></select></Field><Field label="Kode stang"><input name="kode" placeholder={remote.data?.nextKode || "Otomatis untuk peminjaman"} /></Field><Field label="Tanggal"><input name="tanggal" type="date" defaultValue={new Date().toISOString().slice(0,10)} /></Field><Field label="Merk"><select name="merk">{asArray(remote.data?.merk).map(x => <option key={x}>{x}</option>)}</select></Field><Field label="Group"><select name="group">{asArray(remote.data?.group).map(x => <option key={x}>{x}</option>)}</select></Field><Field label="Lokasi"><select name="lokasi">{asArray(remote.data?.lokasi).map(x => <option key={x}>{x}</option>)}</select></Field><Field label="Durasi (hari, untuk kembali)"><input name="durasi" type="number" /></Field><Field label="Keterangan" wide><textarea name="keterangan" /></Field></FormPanel>
  <Panel title="Stang belum kembali"><RemoteState loading={remote.loading} error={remote.error} empty={!asArray(remote.data?.belumKembali).length} onRetry={remote.reload} />{asArray(remote.data?.belumKembali).length > 0 && <SimpleTable headers={["Kode","Tanggal keluar","Group","Digunakan"]} rows={remote.data.belumKembali.map(x => [x.kode,x.keluar,x.namaKeluar,x.digunakan])} />}</Panel></>;
}

function machineNameFromScan(value) {
  const text=String(value||"").trim();
  if (!text) return "";
  try {
    const url=new URL(text);
    return String(url.searchParams.get("namaMesin")||url.searchParams.get("mesin")||url.searchParams.get("nama")||"").trim();
  } catch {
    return text;
  }
}

function Scanner({ go, notify }) {
  const [code,setCode] = useState("");
  const [scanning,setScanning]=useState(false);
  const [scanError,setScanError]=useState("");
  const videoRef=useRef(null);
  const streamRef=useRef(null);
  const frameRef=useRef(0);
  const stopScanner=()=>{
    if (frameRef.current) cancelAnimationFrame(frameRef.current);
    frameRef.current=0;
    streamRef.current?.getTracks().forEach(track=>track.stop());
    streamRef.current=null;
    if (videoRef.current) videoRef.current.srcObject=null;
    setScanning(false);
  };
  useEffect(()=>()=>stopScanner(),[]);
  const openOrder=raw=>{
    const name=machineNameFromScan(raw);
    if (!name) {
      setScanError("Kode tidak memuat parameter namaMesin atau mesin.");
      return;
    }
    stopScanner();
    notify(`Mesin ${name} ditemukan. Lengkapi order kerja.`);
    go("createOrder",{fromScanner:true,namaMesin:name});
  };
  const startScanner=async()=>{
    setScanError("");
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("Browser tidak menyediakan akses kamera.");
      if (!("BarcodeDetector" in window)) throw new Error("Pemindai kamera belum didukung browser ini. Gunakan Chrome/Brave terbaru atau masukkan kode secara manual.");
      const supported=await window.BarcodeDetector.getSupportedFormats();
      const requested=["qr_code","code_128","code_39","ean_13","ean_8"].filter(format=>supported.includes(format));
      if (!requested.length) throw new Error("Format QR/barcode tidak didukung browser ini.");
      const stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:"environment"}},audio:false});
      streamRef.current=stream;
      setScanning(true);
      const video=videoRef.current;
      video.srcObject=stream;
      await video.play();
      const detector=new window.BarcodeDetector({formats:requested});
      const detect=async()=>{
        if (!streamRef.current) return;
        try {
          const results=await detector.detect(video);
          if (results.length) return openOrder(results[0].rawValue);
        } catch {}
        frameRef.current=requestAnimationFrame(detect);
      };
      frameRef.current=requestAnimationFrame(detect);
    } catch(error) {
      stopScanner();
      setScanError(error?.message||"Kamera tidak dapat dibuka. Pastikan izin kamera diberikan.");
    }
  };
  return <div className="scanner-card">
    <div className={`scan-frame ${scanning?"active":""}`}><span /><span /><span /><span /><video ref={videoRef} playsInline muted />{!scanning&&<QrCode size={108} />}</div>
    <h2>Pindai kode mesin</h2>
    <p>QR aset akan membuka formulir pembuatan order dan mengisi data mesin dari Firestore seperti alur aplikasi Android.</p>
    {scanError&&<div className="remote-error"><AlertTriangle size={17}/><span>{scanError}</span></div>}
    <button className={scanning?"secondary wide":"primary wide"} type="button" onClick={scanning?stopScanner:startScanner}>{scanning?"Hentikan kamera":"Aktifkan kamera dan pindai"}</button>
    <div className="manual-code"><input value={code} onChange={(e) => setCode(e.target.value)} onKeyDown={event=>event.key==="Enter"&&openOrder(code)} placeholder="Atau masukkan nama/kode mesin" /><button className="primary" onClick={() => code ? openOrder(code) : notify("Masukkan kode mesin terlebih dahulu.")}>Buka mesin</button></div>
  </div>;
}

function SettingsPage({ notify,themeMode,onThemeChange }) {
  return <Panel title="Preferensi">
    <div className="theme-setting">
      <div><p className="eyebrow">Tema antarmuka</p><h3>Pilih tampilan SiTeki</h3><small>Preferensi tersimpan otomatis pada perangkat ini.</small></div>
      <div className="theme-options">
        <button type="button" className={themeMode==="light"?"active":""} onClick={()=>onThemeChange("light")}><Sun size={19}/><span><b>Terang</b><small>Tampilan cerah</small></span>{themeMode==="light"&&<Check size={16}/>}</button>
        <button type="button" className={themeMode==="dark"?"active":""} onClick={()=>onThemeChange("dark")}><Moon size={19}/><span><b>Gelap</b><small>Nyaman di malam hari</small></span>{themeMode==="dark"&&<Check size={16}/>}</button>
      </div>
    </div>
    <div className="settings-list">{[["Notifikasi order kerja","Aktifkan pemberitahuan order baru"],["Pengingat perawatan","Notifikasi jadwal mendatang"],["Mode ringkas tabel","Tampilkan lebih banyak baris"]].map(([a,b],i) => <label key={a}><span><b>{a}</b><small>{b}</small></span><input type="checkbox" defaultChecked={i < 2} /></label>)}<button className="primary" onClick={() => notify("Pengaturan berhasil disimpan.")}>Simpan pengaturan</button></div>
  </Panel>;
}

const EMPTY_USER = {
  username:"",password:"",nama:"",role:"Teknik",fungsi:"",nik:"",jabatan:"",bagian:"",regu:"",
  tglMasuk:"",lamaKerja:"",kontrakTerakhir:"",pendidikan:"",jurusan:"",statusPegawai:"Kontrak",
  statusGaji:"Harian",tunjangan:"",tLahir:"",tglLahir:"",usia:"",alamat:"",noTelp:"",
  noTelpDarurat:"",gajiPokok:"0",gajiHarian:"0",keterangan:""
};
const USER_FIELDS = [
  ["username","Username","text"],["password","Password baru","password"],["nama","Nama lengkap","text"],
  ["role","Role sistem","role"],["fungsi","Fungsi","text"],["nik","NIK","text"],["jabatan","Jabatan","text"],
  ["bagian","Bagian","text"],["regu","Regu","text"],["tglMasuk","Tanggal masuk","date"],
  ["lamaKerja","Lama kerja","readonly"],["kontrakTerakhir","Kontrak terakhir","date"],
  ["pendidikan","Pendidikan","text"],["jurusan","Jurusan","text"],["statusPegawai","Status pegawai","pegawai"],
  ["statusGaji","Status gaji","gaji"],["tunjangan","Tunjangan","number"],["tLahir","Tempat lahir","text"],
  ["tglLahir","Tanggal lahir","date"],["usia","Usia","readonly"],["alamat","Alamat","textarea"],
  ["noTelp","Nomor telepon","tel"],["noTelpDarurat","Nomor darurat","tel"],["gajiPokok","Gaji pokok","number"],
  ["gajiHarian","Gaji harian","number"],["keterangan","Keterangan","textarea"]
];
const toDateInput = value => {
  const match=String(value||"").match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : String(value||"").slice(0,10);
};

function OvertimeEntry({ session, notify }) {
  const now=new Date();
  const initialCutoff=new Date(now);
  if (now.getDate()<22) initialCutoff.setMonth(initialCutoff.getMonth()-1);
  const [year,setYear]=useState(initialCutoff.getFullYear());
  const [month,setMonth]=useState(initialCutoff.getMonth()+1);
  const [selected,setSelected]=useState("");
  const [hours,setHours]=useState("");
  const [note,setNote]=useState("");
  const [saving,setSaving]=useState(false);
  const [formError,setFormError]=useState("");
  const remote=useRemoteData(async ()=>{
    if (!session.token) throw new Error("Sesi aman tidak tersedia. Silakan logout dan login kembali.");
    const result=await apiPost(ENDPOINTS.users,{action:"getOvertimeCalendar",token:session.token,year,month},{timeout:90000});
    if (!isSuccess(result)) throw new Error(result.message||"Kalender lembur tidak dapat dibuka.");
    return result;
  },[session.token,year,month]);
  const entries=asArray(remote.data);
  const entryMap=useMemo(()=>new Map(entries.map(item=>[item.tanggal,item])),[entries]);
  const holidayMap=useMemo(()=>new Map(asArray(remote.data?.holidays).map(item=>[item.tanggal,item.nama])),[remote.data]);
  const cutoff=remote.data?.cutoff||{};
  const daysInMonth=new Date(year,month,0).getDate();
  const leading=(new Date(year,month-1,1).getDay()+6)%7;
  const money=value=>new Intl.NumberFormat("id-ID",{style:"currency",currency:"IDR",maximumFractionDigits:0}).format(Number(value||0));
  const shortDate=value=>value?new Intl.DateTimeFormat("id-ID",{day:"numeric",month:"short",year:"numeric"}).format(new Date(`${value}T12:00:00`)):"-";
  const cutoffLabel=cutoff.tanggalAwal&&cutoff.tanggalAkhir?`${shortDate(cutoff.tanggalAwal)} – ${shortDate(cutoff.tanggalAkhir)}`:`22 ${SCHEDULE_MONTHS[month-1]} – 21 bulan berikutnya`;
  const years=Array.from(new Set([2024,2025,2026,now.getFullYear(),now.getFullYear()+1])).sort((a,b)=>b-a);
  const dateKey=day=>`${year}-${String(month).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
  const openDay=day=>{
    const key=dateKey(day),existing=entryMap.get(key);
    setSelected(key);setHours(existing?.jam??"");setNote(existing?.keterangan??"");setFormError("");
  };
  const close=()=>{setSelected("");setHours("");setNote("");setFormError("");};
  const save=async event=>{
    event.preventDefault();setSaving(true);setFormError("");
    try {
      const result=await apiPost(ENDPOINTS.users,{action:"saveOvertime",token:session.token,tanggal:selected,jam:Number(hours),keterangan:note},{timeout:90000});
      if (!isSuccess(result)) throw new Error(result.message||"Data lembur gagal disimpan.");
      notify(result.message||"Data lembur berhasil disimpan.");close();remote.reload();
    } catch(error) { setFormError(error?.message||"Data lembur gagal disimpan."); }
    finally { setSaving(false); }
  };
  const remove=async ()=>{
    setSaving(true);setFormError("");
    try {
      const result=await apiPost(ENDPOINTS.users,{action:"deleteOvertime",token:session.token,tanggal:selected},{timeout:90000});
      if (!isSuccess(result)) throw new Error(result.message||"Data lembur gagal dihapus.");
      notify("Data lembur berhasil dihapus.");close();remote.reload();
    } catch(error) { setFormError(error?.message||"Data lembur gagal dihapus."); }
    finally { setSaving(false); }
  };
  const selectedDate=selected?new Date(`${selected}T12:00:00`):null;
  const existing=selected?entryMap.get(selected):null;
  const selectedHoliday=selected?holidayMap.get(selected):"";
  return <>
    <div className="stats-grid three">
      <Stat icon={CalendarDays} label="Catatan cutoff" value={remote.loading?"…":String(cutoff.jumlahData||0)} detail={cutoffLabel} tone="blue"/>
      <Stat icon={Clock3} label="Total jam lembur" value={remote.loading?"…":`${Number(cutoff.totalJam||0).toLocaleString("id-ID",{maximumFractionDigits:2})} jam`} detail={cutoffLabel} tone="mint"/>
      <Stat icon={FileBarChart} label="Total upah" value={remote.loading?"…":money(cutoff.totalUpah)} detail={cutoffLabel} tone="amber"/>
    </div>
    <Panel title="Kalender Lemburan" action={<div className="overtime-filters"><select value={month} onChange={e=>{setMonth(Number(e.target.value));close();}}>{SCHEDULE_MONTHS.map((name,index)=><option key={name} value={index+1}>{name}</option>)}</select><select value={year} onChange={e=>{setYear(Number(e.target.value));close();}}>{years.map(value=><option key={value}>{value}</option>)}</select></div>}>
      <div className="overtime-calendar-note"><ShieldCheck size={15}/><span>Klik tanggal untuk mengisi lembur. Ringkasan mengikuti cutoff <b>{cutoffLabel}</b>. Hari Minggu dan libur nasional dihitung sebagai <b>Hari Besar</b>.</span></div>
      <RemoteState loading={remote.loading} error={remote.error} onRetry={remote.reload}/>
      {!remote.loading&&!remote.error&&<div className="overtime-calendar">
        <div className="overtime-weekdays">{["Sen","Sel","Rab","Kam","Jum","Sab","Min"].map(day=><b key={day}>{day}</b>)}</div>
        <div className="overtime-days">
          {Array.from({length:leading},(_,index)=><span className="empty-day" key={`empty-${index}`}/>)}
          {Array.from({length:daysInMonth},(_,index)=>{
            const day=index+1,key=dateKey(day),entry=entryMap.get(key),holiday=holidayMap.get(key);
            const today=key===`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}-${String(now.getDate()).padStart(2,"0")}`;
            const entryNote=String(entry?.keterangan||"").trim();
            return <button key={key} className={`${holiday?"holiday":""} ${entry?"has-entry":""} ${today?"today":""}`} onClick={()=>openDay(day)} title={entryNote||undefined}>
              <div className="overtime-day-head"><span>{day}</span>{entryNote&&<em>{entryNote}</em>}</div>
              {holiday&&<small>{holiday}</small>}
              {entry&&<div className="overtime-entry"><strong>{Number(entry.jam).toLocaleString("id-ID")} jam</strong></div>}
            </button>;
          })}
        </div>
      </div>}
      <div className="overtime-legend"><span><i className="holiday-dot"/>Tanggal merah / hari besar</span><span><i className="entry-dot"/>Lembur sudah diisi</span></div>
    </Panel>
    {selected&&<div className="overtime-modal-backdrop" onMouseDown={event=>event.target===event.currentTarget&&close()}>
      <form className="overtime-modal" onSubmit={save}>
        <div className="overtime-modal-head"><div><p className="eyebrow">{existing?"Edit catatan":"Catatan baru"}</p><h3>{new Intl.DateTimeFormat("id-ID",{weekday:"long",day:"numeric",month:"long",year:"numeric"}).format(selectedDate)}</h3></div><button type="button" onClick={close}><X size={18}/></button></div>
        <div className={`overtime-day-status ${selectedHoliday?"holiday":""}`}><CalendarDays size={17}/><span><b>{selectedHoliday?"Lembur Hari Besar":"Lembur Hari Kerja"}</b><small>{selectedHoliday||"Perhitungan normal"}</small></span></div>
        <label className="modal-field"><span>Jumlah jam lembur</span><input type="number" min=".5" max="24" step=".5" value={hours} onChange={e=>setHours(e.target.value)} placeholder="Contoh: 2" required/></label>
        <label className="modal-field"><span>Keterangan pekerjaan</span><textarea value={note} onChange={e=>setNote(e.target.value)} placeholder="Tuliskan pekerjaan yang dilakukan saat lembur…" required/></label>
        {existing&&<div className="overtime-existing"><span>Upah tercatat</span><b>{money(existing.totalUpah)}</b></div>}
        {formError&&<div className="remote-error"><AlertTriangle size={17}/><span>{formError}</span></div>}
        <div className="overtime-modal-actions">{existing&&<button type="button" className="danger-button" onClick={remove} disabled={saving}>Hapus</button>}<button type="submit" className="primary" disabled={saving}>{saving?<><span className="spinner"/>Menyimpan…</>:<><Check size={17}/>Simpan lembur</>}</button></div>
      </form>
    </div>}
  </>;
}

function OvertimeAdmin({ session }) {
  const now=new Date();
  const [year,setYear]=useState(now.getFullYear());
  const [month,setMonth]=useState(now.getMonth()+1);
  const remote=useRemoteData(async ()=>{
    if (!session.token) throw new Error("Sesi aman tidak tersedia. Silakan logout dan login kembali.");
    const result=await apiPost(ENDPOINTS.users,{action:"getOvertimeAdmin",token:session.token,year,month},{timeout:90000});
    if (!isSuccess(result)) throw new Error(result.message||"Rekap lembur tidak dapat diakses.");
    return result;
  },[session.token,year,month]);
  const summary=remote.data?.summary||{};
  const cutoff=remote.data?.cutoff||{};
  const rows=asArray(remote.data);
  const money=value=>new Intl.NumberFormat("id-ID",{style:"currency",currency:"IDR",maximumFractionDigits:0}).format(Number(value||0));
  const shortDate=value=>value?new Intl.DateTimeFormat("id-ID",{day:"numeric",month:"short",year:"numeric"}).format(new Date(`${value}T12:00:00`)):"-";
  const cutoffLabel=cutoff.tanggalAwal&&cutoff.tanggalAkhir?`${shortDate(cutoff.tanggalAwal)} – ${shortDate(cutoff.tanggalAkhir)}`:`22 ${SCHEDULE_MONTHS[month-1]} – 21 bulan berikutnya`;
  const years=Array.from(new Set([2024,2025,2026,now.getFullYear()])).sort((a,b)=>b-a);
  return <>
    <div className="stats-grid three">
      <Stat icon={Users} label="Karyawan lembur" value={remote.loading?"…":String(summary.jumlahKaryawan||0)} detail={`${summary.jumlahData||0} catatan • ${cutoffLabel}`} tone="blue"/>
      <Stat icon={Clock3} label="Total jam lembur" value={remote.loading?"…":`${Number(summary.totalJam||0).toLocaleString("id-ID",{maximumFractionDigits:2})} jam`} detail={cutoffLabel} tone="mint"/>
      <Stat icon={FileBarChart} label="Total upah lembur" value={remote.loading?"…":money(summary.totalUpah)} detail={cutoffLabel} tone="amber"/>
    </div>
    <Panel title="Total Upah Lemburan" action={<div className="overtime-filters">
      <select value={month} onChange={e=>setMonth(Number(e.target.value))}>{SCHEDULE_MONTHS.map((name,index)=><option key={name} value={index+1}>{name}</option>)}</select>
      <select value={year} onChange={e=>setYear(Number(e.target.value))}>{years.map(value=><option key={value}>{value}</option>)}</select>
    </div>}>
      <p className="sensitive-data-note"><ShieldCheck size={15}/> Rekap periode cutoff <b>{cutoffLabel}</b>. Data upah hanya ditampilkan kepada Admin dengan token sesi yang diverifikasi server.</p>
      <RemoteState loading={remote.loading} error={remote.error} empty={!rows.length} onRetry={remote.reload}/>
      {!remote.loading&&!remote.error&&rows.length>0&&<SimpleTable
        headers={["Nama karyawan","Role","Jumlah lembur","Total jam","Total upah"]}
        rows={rows.map(item=>[
          item.nama||"-",item.role||"-",`${item.jumlahData||0} kali`,
          `${Number(item.totalJam||0).toLocaleString("id-ID",{maximumFractionDigits:2})} jam`,
          <b className="money-value">{money(item.totalUpah)}</b>
        ])}
      />}
    </Panel>
  </>;
}

function UserManagement({ session, notify }) {
  const [query,setQuery]=useState("");
  const [editing,setEditing]=useState(null);
  const [form,setForm]=useState(EMPTY_USER);
  const [saving,setSaving]=useState(false);
  const [saveError,setSaveError]=useState("");
  const remote=useRemoteData(async ()=>{
    if (!session.token) throw new Error("Sesi aman belum tersedia. Keluar lalu login kembali setelah Apps Script baru diterapkan.");
    const result=await apiPost(ENDPOINTS.users,{action:"getAllUsers",token:session.token},{timeout:90000});
    if (!isSuccess(result)) throw new Error(result.message||"Akses daftar teknisi ditolak.");
    return asArray(result);
  },[session.token]);
  if (session.role!=="Admin") return <SecurityLocked title="Khusus administrator"/>;
  const rows=remote.data.filter(user=>`${user.nama} ${user.nik} ${user.username} ${user.bagian}`.toLowerCase().includes(query.toLowerCase()));
  const edit=user=>{
    setEditing(user.nik||user.username);
    setForm({...EMPTY_USER,...user,password:"",tglMasuk:toDateInput(user.tglMasuk),kontrakTerakhir:toDateInput(user.kontrakTerakhir),tglLahir:toDateInput(user.tglLahir),originalNik:user.nik,originalUsername:user.username});
  };
  const add=()=>{setEditing("new");setForm({...EMPTY_USER});};
  const change=(key,value)=>setForm(current=>({...current,[key]:value}));
  const save=async event=>{
    event.preventDefault();
    setSaving(true); setSaveError("");
    try {
      const result=await apiPost(ENDPOINTS.users,{action:"updateOrCreateUser",token:session.token,...form},{timeout:90000});
      if (!isSuccess(result)) throw new Error(result.message||"Data teknisi gagal disimpan.");
      notify(editing==="new"?"Teknisi baru berhasil ditambahkan.":"Data teknisi berhasil diperbarui.");
      setEditing(null); setForm(EMPTY_USER); remote.reload();
    } catch (error) {
      setSaveError(error?.message||"Data teknisi gagal disimpan.");
    } finally { setSaving(false); }
  };
  return <div className="user-management-layout">
    <Panel title="Database teknisi" action={<button className="primary small" onClick={add}><Plus size={16}/> Tambah teknisi</button>}>
      <Toolbar query={query} setQuery={setQuery}/>
      <RemoteState loading={remote.loading} error={remote.error} empty={!rows.length} onRetry={remote.reload}/>
      {!remote.loading&&!remote.error&&rows.length>0&&<div className="technician-list">{rows.map(user=><button key={user.nik||user.username} onClick={()=>edit(user)}>
        <span className="avatar">{String(user.nama||"?").split(" ").map(x=>x[0]).slice(0,2).join("")}</span>
        <span><b>{user.nama||"-"}</b><small>{user.nik||"-"} · {user.bagian||"Tanpa bagian"}</small></span>
        <Badge text={user.role||"Lainnya"}/><Edit3 size={16}/>
      </button>)}</div>}
    </Panel>
    {editing?<form className="panel form-panel technician-form" onSubmit={save}>
      <div className="panel-head"><div><p className="eyebrow">{editing==="new"?"Data baru":"Edit data"}</p><h3>{editing==="new"?"Tambah teknisi":"Ubah profil teknisi"}</h3></div><button type="button" className="secondary small" onClick={()=>setEditing(null)}><X size={15}/> Tutup</button></div>
      <div className="form-grid">{USER_FIELDS.map(([key,label,type])=><Field key={key} label={label} wide={type==="textarea"}>
        {type==="role"?<select value={form[key]} onChange={e=>change(key,e.target.value)}><option>Admin</option><option>Teknik</option><option>Operator</option><option>Gudang</option><option>Lainnya</option></select>
        :type==="pegawai"?<select value={form[key]} onChange={e=>change(key,e.target.value)}><option>Tetap</option><option>Kontrak</option><option>Harian</option><option>Magang</option></select>
        :type==="gaji"?<select value={form[key]} onChange={e=>change(key,e.target.value)}><option>Bulanan</option><option>Harian</option></select>
        :type==="textarea"?<textarea value={form[key]} onChange={e=>change(key,e.target.value)}/>
        :<input type={type==="readonly"?"text":type} value={form[key]} readOnly={type==="readonly"} placeholder={key==="password"&&editing!=="new"?"Kosongkan jika tidak diubah":""} onChange={e=>change(key,e.target.value)} required={["username","nama","nik"].includes(key)}/>}
      </Field>)}</div>
      {saveError&&<div className="remote-error"><AlertTriangle size={17}/><span>{saveError}</span></div>}
      <div className="form-footer"><p><ShieldCheck size={16}/> Hanya sesi Admin tervalidasi yang dapat menyimpan.</p><button className="primary" type="submit" disabled={saving}>{saving?<><span className="spinner"/>Menyimpan…</>:<><Check size={17}/> Simpan data teknisi</>}</button></div>
    </form>:<Panel title="Editor teknisi"><div className="user-editor-empty"><Users size={34}/><b>Pilih teknisi atau tambah data baru</b><p>Admin dapat mengelola seluruh kolom isian. Kolom usia dan lama kerja mengikuti formula Spreadsheet.</p></div></Panel>}
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

function DataTablePage({ kind }) {
  const remote = useRemoteData(async () => {
    if (kind === "listrik") return asArray(await apiGet(ENDPOINTS.electricity, { action:"getData", bulan:currentIndonesianMonth(), tglAwal:"", tglAkhir:"" }));
    if (kind === "bon") return asArray(await apiGet(ENDPOINTS.partRequests, { action:"getDaftarBon" })).filter(x => String(x.status).toLowerCase() === "open");
    return asArray(await apiGet(ENDPOINTS.transformerData, { action:"getDataTravo" }));
  });
  const config = {
    listrik: { headers:["Tanggal","Jam","HUHE H","HUHE HH","KWH","KVAR","Kesimpulan"], map:x=>[x.tanggal,x.jam,x.huhe_h,x.huhe_hh,x.nilai_kwh,x.nilai_kvar,x.kesimpulan] },
    bon: { headers:["Tanggal","Pemesan","Part","Jumlah","Kegunaan","Status"], map:x=>[x.tglPesan||x.tanggal,x.pemesan,x.nama,`${x.jmlPesan||x.jumlah} ${x.satuan||""}`,x.kegunaan,x.status] },
    travo: { headers:["Kode","Nama","Merk","Tipe","Tegangan","Pengadaan"], map:x=>[x.kode,x.nama,x.merk,x.tipe,x.tegangan,x.pengadaan] }
  }[kind];
  const rows = remote.data.map(config.map);
  return <Panel title="Data terbaru" action={<button className="secondary small" onClick={() => exportCsv(config.headers, rows, kind)}><Download size={16}/> Ekspor</button>}><Toolbar /><RemoteState loading={remote.loading} error={remote.error} empty={!rows.length} onRetry={remote.reload} />{rows.length > 0 && <SimpleTable headers={config.headers} rows={rows} />}</Panel>;
}

function Toolbar({ query = "", setQuery = () => {}, children }) {
  return <div className="toolbar"><label className="search"><Search size={17} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Cari data..." /></label>{children}<button className="filter"><SlidersHorizontal size={17} /> Filter</button></div>;
}

function SimpleTable({ headers, rows }) {
  return <div className="table-wrap"><table><thead><tr>{headers.map(h => <th key={h}>{h}</th>)}</tr></thead><tbody>{rows.map((row,i) => <tr key={i}>{row.map((cell,j) => <td key={j}>{j === row.length - 1 && typeof cell === "string" ? <Badge text={cell} /> : cell}</td>)}</tr>)}</tbody></table></div>;
}

function Badge({ text }) {
  const value = String(text).toLowerCase();
  const tone = value.includes("tinggi") || value.includes("perhatian") ? "danger" : value.includes("sedang") || value.includes("monitor") || value.includes("hari ini") ? "warning" : value.includes("open") || value.includes("proses") || value.includes("jadwal") ? "info" : "success";
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
  return <form className="panel form-panel" onSubmit={handleSubmit}><div className="panel-head"><div><p className="eyebrow">Data entry</p><h3>{title}</h3></div>{extra}</div><div className="form-grid">{children}</div>{error && <div className="remote-error"><AlertTriangle size={17}/><span>{error}</span></div>}<div className="form-footer"><p><ShieldCheck size={16} /> Data akan disimpan ke sistem SiTeki.</p><button className="primary" type="submit" disabled={saving}>{saving ? <><span className="spinner"/>Menyimpan…</> : <><Check size={17} /> {submit}</>}</button></div></form>;
}

function Field({ label, wide, children }) {
  return <label className={wide ? "wide" : ""}><span>{label}</span>{children}</label>;
}

function RemoteState({ loading, error, empty, onRetry }) {
  if (loading) return <div className="remote-state"><span className="spinner dark" /> Mengambil data terbaru…</div>;
  if (error) return <div className="remote-error"><AlertTriangle size={17}/><span><b>Koneksi data gagal</b><small>{error}</small></span><button onClick={onRetry}>Coba lagi</button></div>;
  if (empty) return <div className="remote-state"><Database size={18}/> Belum ada data untuk ditampilkan.</div>;
  return null;
}

function exportCsv(headers, rows, filename) {
  const quote = (value) => `"${String(value?.props?.children ?? value ?? "").replaceAll('"','""')}"`;
  const csv = [headers, ...rows].map(row => row.map(quote).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type:"text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `siteki-${filename}-${new Date().toISOString().slice(0,10)}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

createRoot(document.getElementById("root")).render(<React.StrictMode><App /></React.StrictMode>);
