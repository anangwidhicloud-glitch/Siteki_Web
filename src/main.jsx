import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Activity, AlertTriangle, AppWindow, ArrowLeft, ArrowRight, BarChart3, Bell,
  BookOpen, Boxes, CalendarDays, Check, CheckCircle2, ChevronDown, ClipboardCheck,
  ClipboardList, Clock3, Database, Download, Edit3, Eye, FileBarChart,
  FilePlus2, Gauge, HardHat, History, Home, LogOut, Menu, MoreHorizontal, Package,
  Plus, QrCode, Search, Settings, ShieldCheck, SlidersHorizontal, Sparkles,
  TimerReset, Users, Warehouse, Wrench, X, Zap
} from "lucide-react";
import "./styles.css";
import { apiGet, apiPost, asArray, ENDPOINTS, isSuccess } from "./lib/api";
import { getFirestoreCollection } from "./lib/firebase";
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
  ["catalog", "Katalog", BookOpen],
  ["settings", "Pengaturan", Settings]
];

const categoryAccess = {
  Admin: ["maintenance", "jobs", "kpi", "electricity", "stang", "orders", "stock", "more"],
  Teknik: ["maintenance", "jobs", "kpi", "electricity", "stang", "orders", "stock", "more"],
  Gudang: ["kpi", "stang", "stock", "more"],
  Operator: ["kpi", "orders", "more"]
};

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

  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(""), 3200);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  const go = (target, data) => {
    setHistory((old) => [...old, page]);
    if (data) setSelectedOrder(data);
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
          <PageRouter page={page} go={go} session={session} selectedOrder={selectedOrder} notify={setToast} />
        </div>
      </main>
      <MobileNav page={page} go={go} />
      {toast && <div className="toast"><CheckCircle2 size={19} />{toast}</div>}
    </div>
  );
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
      const result = await apiGet(ENDPOINTS.login, { action: "login", username, password });
      if (String(result.status).toLowerCase() !== "success") throw new Error(result.message || "Kredensial tidak dikenali.");
      const profile = result.profile || {};
      onLogin({ username: profile.username || username, name: profile.nama || "Karyawan Raja Besi", role: profile.role || "Operator" });
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

function PageRouter({ page, go, session, selectedOrder, notify }) {
  const props = { go, notify, session };
  switch (page) {
    case "dashboard": return <Dashboard {...props} />;
    case "orders": return <Orders {...props} />;
    case "orderDetail": return selectedOrder ? <OrderDetail {...props} order={selectedOrder} /> : <RemoteState empty />;
    case "finishOrder": return selectedOrder ? <FinishOrder {...props} order={selectedOrder} /> : <RemoteState empty />;
    case "createOrder": return <WorkOrderForm {...props} />;
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
    case "overtime": return <SecurityLocked title="Lemburan dikunci" />;
    case "overtimeRecap": return <SecurityLocked title="Rekap lembur dikunci" />;
    case "users": return <SecurityLocked title="Manajemen pengguna dikunci" />;
    case "catalog": return <Catalog />;
    case "stang": return <Stang {...props} />;
    case "scanner": return <Scanner {...props} />;
    case "settings": return <SettingsPage notify={notify} />;
    default: return <Dashboard {...props} />;
  }
}

function Dashboard({ go, session }) {
  const ordersRemote = useRemoteData(async () =>
    asArray(await apiGet(ENDPOINTS.dashboardOrders, { action: "getAllOrders" }))
      .map(normalizeOrder)
      .filter((o) => o.status.toLowerCase() === "open")
  );
  const maintenanceRemote = useRemoteData(async () =>
    asArray(await apiGet(ENDPOINTS.maintenance, { action: "getPerawatan" }))
  );
  const kpiRemote = useRemoteData(async () => asArray(await apiGet(ENDPOINTS.kpi)));
  const stockRemote = useRemoteData(async () => asArray(await apiGet(ENDPOINTS.stock, { action:"getStokPart", bulan:currentIndonesianMonth() })));
  const activeOrders = ordersRemote.data;
  const actualMaintenance = maintenanceRemote.data;
  const health = Math.round(Number(kpiRemote.data.at(-1)?.pencapaian || 0) * 100);
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
      <Stat icon={Wrench} label="Data perawatan" value={maintenanceRemote.loading ? "…" : String(actualMaintenance.length).padStart(2,"0")} detail="Data Spreadsheet" tone="blue" />
      <Stat icon={Gauge} label="KPI perawatan" value={kpiRemote.loading ? "…" : `${health}%`} detail="Data KPI terbaru" tone="amber" />
      <Stat icon={Package} label="Stok di bawah 10" value={stockRemote.loading ? "…" : String(lowStock).padStart(2,"0")} detail="Perlu perhatian" tone="violet" />
    </div>
    <div className="section-title"><div><p className="eyebrow">Quick access</p><h2>Kategori kerja</h2></div></div>
    <div className="category-grid">{categories.map(([id, label, Icon, sub, tone]) => <button className="category-card" key={id} onClick={() => go(id)}><span className={`icon-box ${tone}`}><Icon size={23} /></span><b>{label}</b><small>{sub}</small><ArrowRight size={17} /></button>)}</div>
    <div className="dashboard-columns">
      <Panel title="Order kerja aktif" action={<button onClick={() => go("orders")}>Lihat semua <ArrowRight size={15} /></button>}>
        <RemoteState loading={ordersRemote.loading} error={ordersRemote.error} empty={!activeOrders.length} onRetry={ordersRemote.reload} />
        {!ordersRemote.loading && !ordersRemote.error && activeOrders.length > 0 && <OrderTable orders={activeOrders.slice(0, 5)} onClick={(o) => go("orderDetail", o)} />}
      </Panel>
      <Panel title="Agenda terdekat" action={<button onClick={() => go("schedule")}>Jadwal</button>}>
        <RemoteState loading={maintenanceRemote.loading} error={maintenanceRemote.error} empty={!actualMaintenance.length} onRetry={maintenanceRemote.reload} />
        <div className="agenda">{actualMaintenance.slice(-5).reverse().map((m, i) => <button key={`${m.nama_mesin}-${m.tanggal}-${i}`} onClick={() => go("maintenanceForm")}><span className={`date-box ${i === 0 ? "today" : ""}`}><b>{String(m.tanggal || "--").split("/")[0]}</b><small>{String(m.tanggal || "").split("/")[1] || ""}</small></span><span><b>{m.nama_mesin || m.nama || "-"}</b><small>{m.jenis_perawatan || m.waktu || "Perawatan"} · Tersimpan</small></span><ArrowRight size={16} /></button>)}</div>
      </Panel>
    </div>
  </>;
}

function Stat({ icon: Icon, label, value, detail, tone }) {
  return <article className="stat"><span className={`icon-box ${tone}`}><Icon size={21} /></span><div><small>{label}</small><strong>{value}</strong><p><span>↗</span> {detail}</p></div></article>;
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
  const rows = remote.data.filter((o) => `${o.namaMesin} ${o.kerusakan}`.toLowerCase().includes(query.toLowerCase()));
  return <Panel title="Daftar order" action={<button className="primary small" onClick={() => go("createOrder")}><Plus size={16} /> Buat order</button>}>
    <Toolbar query={query} setQuery={setQuery}><select value={month} onChange={(e) => setMonth(e.target.value)}><option>Semua Bulan</option><option>Juli</option><option>Juni</option></select></Toolbar>
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

function WorkOrderForm({ notify, go }) {
  const machines = useRemoteData(() => getFirestoreCollection("master_mesin"));
  const submit = async (data) => {
    const result = await apiPost(ENDPOINTS.createOrder, { action: "create", ...data });
    if (!isSuccess(result)) throw new Error(result.message || "Order gagal dikirim.");
    notify("Order kerja berhasil dikirim dan tersinkron.");
    go("dashboard");
  };
  return <FormPanel title="Informasi permintaan" onSubmit={submit} submit="Kirim order kerja">
    <Field label="Bagian order"><select name="bagianOrder" required><option>Produksi</option><option>Utility</option><option>Gudang</option></select></Field>
    <Field label="Nama pengorder"><input name="namaOrder" placeholder="Nama lengkap" required /></Field>
    <Field label="Kategori mesin"><select name="kategoriMesin" required>{[...new Set(machines.data.map(x => x.Kategori || x.kategori).filter(Boolean))].map(x => <option key={x}>{x}</option>)}</select></Field>
    <Field label="Bagian tujuan"><select name="bagianTujuan"><option>Teknik</option><option>Elektrik</option></select></Field>
    <Field label="Jenis mesin"><input name="jenis" placeholder="Jenis mesin" /></Field>
    <Field label="Nama mesin / aset"><select name="namaMesin" required><option value="">Pilih mesin</option>{machines.data.map(x => <option key={x.id} value={x.Nama || x.nama}>{x.Nama || x.nama}</option>)}</select></Field>
    <Field label="Jenis pekerjaan"><select name="jenisPekerjaan"><option>Perbaikan</option><option>Pemeriksaan</option><option>Fabrikasi</option></select></Field>
    <Field label="Urgensi"><select name="urgensi"><option>Rendah</option><option>Sedang</option><option>Tinggi</option></select></Field>
    <Field label="Deskripsi kerusakan" wide><textarea name="kerusakan" placeholder="Jelaskan gejala atau kerusakan..." required /></Field>
  </FormPanel>;
}

function FinishOrder({ order, notify, go }) {
  const submit = async (data) => {
    const result = await apiPost(ENDPOINTS.completeOrder, { action:"complete", rowIndex:order.rowIndex, ...data });
    if (!isSuccess(result)) throw new Error(result.message || "Penyelesaian order gagal disimpan.");
    notify("Order ditandai selesai dan tersinkron.");
    go("dashboard");
  };
  return <FormPanel title={`Penyelesaian · ${order.namaMesin}`} onSubmit={submit} submit="Selesaikan order">
    <Field label="Waktu mulai"><input name="jamMulai" type="time" required /></Field>
    <Field label="Waktu selesai"><input name="jamSelesai" type="time" required /></Field>
    <Field label="Tindakan perbaikan" wide><textarea name="perbaikanDilakukan" placeholder="Uraikan tindakan yang dilakukan..." required /></Field>
    <Field label="Status mesin"><select name="statusMesin"><option>Beroperasi</option><option>Monitoring</option><option>Belum Selesai</option></select></Field>
    <Field label="Nilai perbaikan"><select name="nilaiPerbaikan"><option>Baik</option><option>Cukup</option><option>Kurang</option></select></Field>
    <Field label="Spare part"><input name="sparePart" placeholder="Part yang digunakan" /></Field>
    <Field label="Ukuran spare part"><input name="ukuranSparePart" /></Field>
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

function Schedule({ go }) {
  const now = new Date();
  const days = Array.from({ length: new Date(now.getFullYear(), now.getMonth()+1, 0).getDate() }, (_, i) => i + 1);
  const remote = useRemoteData(async () => {
    const [master, actual] = await Promise.all([
      apiGet(ENDPOINTS.maintenanceMaster, { action:"getRawatMaster" }),
      apiGet(ENDPOINTS.maintenance, { action:"getPerawatan" })
    ]);
    return { master:asArray(master), actual:asArray(actual) };
  });
  const machines = [...new Set(asArray(remote.data?.master).map(x => x.nama_mesin || x.nama).filter(Boolean))];
  const isDone = (name, day) => asArray(remote.data?.actual).some(x => {
    const parts = String(x.tanggal || "").split("/");
    return (x.nama_mesin || x.nama) === name && Number(parts[0]) === day && Number(parts[1]) === now.getMonth()+1 && Number(parts[2]) === now.getFullYear();
  });
  return <Panel title={new Intl.DateTimeFormat("id-ID",{month:"long",year:"numeric"}).format(now)} action={<div className="legend"><span className="done" /> Aktual tersimpan</div>}>
    <RemoteState loading={remote.loading} error={remote.error} empty={!machines.length} onRetry={remote.reload} />
    <div className="schedule-table"><div className="schedule-row schedule-head"><b>Mesin</b>{days.map((d) => <span key={d}>{d}</span>)}</div>{machines.map((name) => <div className="schedule-row" key={name}><b>{name}</b>{days.map((d) => <button aria-label={`${name} tanggal ${d}`} onClick={() => go("maintenanceForm")} className={isDone(name,d) ? "done" : ""} key={d} />)}</div>)}</div>
  </Panel>;
}

function MaintenanceForm({ notify }) {
  const master = useRemoteData(async () =>
    asArray(await apiGet(ENDPOINTS.maintenanceMaster, { action:"getRawatMaster" }))
  );
  const submit = async (data) => {
    const payload = { ...data, tanggal: toIdDate(data.tanggal), waktu: data.waktu === "Mingguan" ? "M" : "B", kondisi_mesin: data.kondisi };
    const result = await apiPost(ENDPOINTS.maintenance, payload);
    if (!isSuccess(result)) throw new Error(result.message || "Data perawatan gagal disimpan.");
    notify("Data perawatan berhasil disimpan dan tersinkron.");
  };
  return <FormPanel title="Aktual preventive maintenance" onSubmit={submit} submit="Simpan perawatan">
    <Field label="Kategori"><select name="kategori">{[...new Set(master.data.map(x => x.kategori).filter(Boolean))].map(x => <option key={x}>{x}</option>)}</select></Field>
    <Field label="Jenis"><select name="jenis">{[...new Set(master.data.map(x => x.jenis).filter(Boolean))].map(x => <option key={x}>{x}</option>)}</select></Field>
    <Field label="Nama mesin"><select name="nama_mesin" required><option value="">Pilih mesin</option>{[...new Set(master.data.map(x => x.nama_mesin || x.nama).filter(Boolean))].map(x => <option key={x}>{x}</option>)}</select></Field>
    <Field label="Tanggal"><input name="tanggal" type="date" defaultValue={new Date().toISOString().slice(0,10)} required /></Field>
    <Field label="Jenis perawatan"><select name="waktu"><option>Mingguan</option><option>Bulanan</option></select></Field>
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

function KpiChartPanel({ title, data, target = 0, maxValue, color, unit, targetLabel = "Target", onDetail }) {
  return <Panel title={title} className="kpi-chart-panel" action={onDetail && <button onClick={onDetail}>Detail <ArrowRight size={14}/></button>}>
    <LineChart data={data} target={target} maxValue={maxValue} color={color} unit={unit} targetLabel={targetLabel} />
  </Panel>;
}

function LineChart({ data, target = 0, maxValue = 100, color = "#069b70", unit = "", targetLabel = "Target" }) {
  const [selected, setSelected] = useState(null);
  const width = 960, height = 300, left = 42, right = 24, top = 30, bottom = 50;
  const chartWidth = width-left-right, chartHeight = height-top-bottom;
  const safeMax = Math.max(1, maxValue, target, ...data.map(x => Number(x.value || 0)));
  const x = i => left + (data.length > 1 ? i * chartWidth/(data.length-1) : chartWidth/2);
  const y = value => top + chartHeight - Math.min(Math.max(Number(value || 0),0),safeMax)/safeMax*chartHeight;
  const points = data.map((item,i) => `${x(i)},${y(item.value)}`).join(" ");
  const fill = data.length ? `${left},${top+chartHeight} ${points} ${x(data.length-1)},${top+chartHeight}` : "";
  const targetY = y(target);
  if (!data.length) return <div className="chart-empty"><Database size={20}/> Belum ada data grafik.</div>;
  return <div className="line-chart" onMouseLeave={() => setSelected(null)}>
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Grafik ${data.length} bulan`}>
      {[0,.25,.5,.75,1].map(p => {
        const gy=top+chartHeight-chartHeight*p;
        return <g key={p}><line x1={left} x2={width-right} y1={gy} y2={gy} className="chart-grid"/><text x={left-8} y={gy+4} textAnchor="end">{Math.round(safeMax*p)}</text></g>;
      })}
      {target > 0 && <g><line x1={left} x2={width-right} y1={targetY} y2={targetY} className="target-line"/><text x={width-right} y={targetY-8} textAnchor="end" className="target-text">{targetLabel} {target}{unit.trim()}</text></g>}
      <polygon points={fill} fill={color} opacity=".09"/>
      <polyline points={points} fill="none" stroke={color} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"/>
      {data.map((item,i) => <g key={`${item.label}-${i}`} className="chart-point" onMouseEnter={() => setSelected(i)} onClick={() => setSelected(i)}>
        <circle cx={x(i)} cy={y(item.value)} r="12" fill="transparent"/>
        <circle cx={x(i)} cy={y(item.value)} r="5" fill="white" stroke={color} strokeWidth="3"/>
        <text x={x(i)} y={height-18} textAnchor="middle">{String(item.label).slice(0,3)}</text>
      </g>)}
      {selected !== null && <line x1={x(selected)} x2={x(selected)} y1={top} y2={top+chartHeight} className="hover-line"/>}
    </svg>
    {selected !== null && <div className="chart-tooltip" style={{left:`${Math.min(88,Math.max(3,x(selected)/width*100))}%`}}>
      <b>{data[selected].label}</b><span><i style={{background:color}} />{Number(data[selected].value).toLocaleString("id-ID",{maximumFractionDigits:1})}{unit}</span>
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

function Jobs({ go }) {
  const remote = useRemoteData(async () => asArray(await apiGet(ENDPOINTS.jobs, { action:"getDataLapKerja", bulan:currentIndonesianMonth(), tglAwal:"", tglAkhir:"" })));
  const rows = remote.data.map(x => [x.tanggal, x.mesin || x.namaMesin, x.bagian, x.laporan, x.durasi]);
  return <Panel title="Riwayat laporan" action={<button className="primary small" onClick={() => go("jobForm")}><Plus size={16} /> Isi laporan</button>}><Toolbar /><RemoteState loading={remote.loading} error={remote.error} empty={!rows.length} onRetry={remote.reload} />{!remote.loading && !remote.error && rows.length > 0 && <SimpleTable headers={["Tanggal","Mesin","Bagian","Laporan pekerjaan","Durasi"]} rows={rows} />}</Panel>;
}

function JobForm({ notify, go }) {
  const machines = useRemoteData(() => getFirestoreCollection("master_mesin"));
  const partsRemote = useRemoteData(() => getFirestoreCollection("master_part"));
  const submit = async (data) => {
    const payload = {
      tanggal:toIdDate(data.tanggal), bagian:data.bagian, kategoriMesin:data.kategoriMesin,
      jenis:data.jenis, namaMesin:data.namaMesin, jenisPekerjaan:data.jenisPekerjaan,
      laporan:data.laporan, jenisKomponen:data.jenisKomponen,
      jamMulai:`${toIdDate(data.tglMulai)} ${data.jamMulai}`, jamSelesai:`${toIdDate(data.tglSelesai)} ${data.jamSelesai}`,
      totalJam:data.totalJam, definisi:data.definisi, sparepart:data.sparepart,
      ukuranPart:data.ukuranPart, order:data.order || "Tidak", statusOrder:data.statusOrder || "",
      nilaiPerbaikan:data.nilaiPerbaikan, keterangan:data.keterangan,
      isNewMachine:false, isNewPart:false, partKategori:data.partKategori || "",
      partNama:data.sparepart, partUkuran:data.ukuranPart
    };
    const result = await apiPost(ENDPOINTS.jobs, payload);
    if (!isSuccess(result)) throw new Error(result.message || "Laporan gagal disimpan.");
    notify("Laporan kerja berhasil disimpan dan tersinkron.");
    go("jobs");
  };
  return <FormPanel title="Dokumentasi pekerjaan" onSubmit={submit} submit="Simpan laporan">
    <Field label="Tanggal laporan"><input name="tanggal" type="date" defaultValue={new Date().toISOString().slice(0,10)} required /></Field><Field label="Bagian"><select name="bagian"><option>Tek. Shift A</option><option>Tek. Shift B</option><option>Teknik</option></select></Field>
    <Field label="Kategori mesin"><input name="kategoriMesin" /></Field><Field label="Jenis mesin"><input name="jenis" /></Field>
    <Field label="Mesin"><select name="namaMesin" required><option value="">Pilih mesin</option>{machines.data.map(x => <option key={x.id}>{x.Nama || x.nama}</option>)}</select></Field><Field label="Jenis pekerjaan"><select name="jenisPekerjaan"><option>Perbaikan</option><option>Perawatan</option><option>Fabrikasi</option><option>Lainnya</option></select></Field>
    <Field label="Laporan pekerjaan" wide><textarea name="laporan" required /></Field><Field label="Jenis komponen"><input name="jenisKomponen" /></Field>
    <Field label="Tanggal mulai"><input name="tglMulai" type="date" /></Field><Field label="Jam mulai"><input name="jamMulai" type="time" /></Field><Field label="Tanggal selesai"><input name="tglSelesai" type="date" /></Field><Field label="Jam selesai"><input name="jamSelesai" type="time" /></Field>
    <Field label="Total jam"><input name="totalJam" type="number" step="any" /></Field><Field label="Definisi"><input name="definisi" /></Field>
    <Field label="Spare part"><select name="sparepart"><option value="">Tidak pakai</option>{partsRemote.data.map(x => <option key={x.id}>{x.Nama || x.nama}</option>)}</select></Field><Field label="Ukuran part"><input name="ukuranPart" /></Field>
    <Field label="Nilai perbaikan"><select name="nilaiPerbaikan"><option>Bagus</option><option>Cukup</option><option>Tidak Bagus</option></select></Field><Field label="Keterangan" wide><textarea name="keterangan" /></Field>
  </FormPanel>;
}

function Stock({ go }) {
  const [q,setQ] = useState("");
  const remote = useRemoteData(async () => asArray(await apiGet(ENDPOINTS.stock, { action:"getStokPart", bulan:currentIndonesianMonth() })));
  const filtered = remote.data.filter((p) => `${p.nama} ${p.ukuran}`.toLowerCase().includes(q.toLowerCase()));
  const totalStock = remote.data.reduce((n,p) => n + Number(p.stok || 0), 0);
  const low = remote.data.filter(p => Number(p.stok || 0) < 10).length;
  return <><div className="stats-grid three"><Stat icon={Boxes} label="Total jenis part" value={remote.loading ? "…" : remote.data.length} detail="Data Spreadsheet" tone="blue" /><Stat icon={Package} label="Stok tersedia" value={remote.loading ? "…" : totalStock} detail="Seluruh gudang" tone="mint" /><Stat icon={AlertTriangle} label="Di bawah 10" value={remote.loading ? "…" : low} detail="Perlu perhatian" tone="amber" /></div>
    <Panel title="Inventori spare part" action={<div className="button-row"><button className="secondary small" onClick={() => go("partRequests")}><History size={16} /> Daftar bon</button><button className="primary small" onClick={() => go("partOrder")}><Plus size={16} /> Order part</button></div>}><Toolbar query={q} setQuery={setQ} /><RemoteState loading={remote.loading} error={remote.error} empty={!filtered.length} onRetry={remote.reload} />{!remote.loading && !remote.error && filtered.length > 0 && <SimpleTable headers={["Nama part","Ukuran / jenis","Stok","Satuan"]} rows={filtered.map(p => [p.nama,p.ukuran,<b className={Number(p.stok)<10 ? "low-stock" : ""}>{p.stok}</b>,p.satuan])} />}</Panel></>;
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

function Scanner({ go, notify }) {
  const [code,setCode] = useState("");
  return <div className="scanner-card"><div className="scan-frame"><span /><span /><span /><span /><QrCode size={108} /></div><h2>Pindai kode mesin</h2><p>Arahkan kamera ke QR aset untuk membuka form order kerja seperti pada aplikasi Android.</p><div className="manual-code"><input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Atau masukkan kode mesin" /><button className="primary" onClick={() => code ? go("createOrder") : notify("Masukkan kode mesin terlebih dahulu.")}>Buka mesin</button></div></div>;
}

function SettingsPage({ notify }) {
  return <Panel title="Preferensi"><div className="settings-list">{[["Notifikasi order kerja","Aktifkan pemberitahuan order baru"],["Pengingat perawatan","Notifikasi jadwal mendatang"],["Mode ringkas tabel","Tampilkan lebih banyak baris"]].map(([a,b],i) => <label key={a}><span><b>{a}</b><small>{b}</small></span><input type="checkbox" defaultChecked={i < 2} /></label>)}<button className="primary" onClick={() => notify("Pengaturan berhasil disimpan.")}>Simpan pengaturan</button></div></Panel>;
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
