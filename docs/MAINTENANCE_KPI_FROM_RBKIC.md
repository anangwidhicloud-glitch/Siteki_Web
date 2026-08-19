# Fitur Maintenance KPI dari RBKIC

> Catatan sumber data: pencapaian bulanan dihitung dari jumlah pemeriksaan aktual
> (`maintenance_inspections`) hasil input atau unggahan Rekap Perawatan, dibagi target
> jumlah pemeriksaan bulanan. `maintenance_plans` hanya dipakai sebagai jadwal/agenda.
> Karena itu, jika belum ada data pemeriksaan aktual, grafik perawatan harus kosong.

## Ringkasan

Dokumen ini menjelaskan fitur baru yang ditambahkan ke SiTeki_Web berdasarkan fitur yang ada di RBKIC (D:\01. Pribadi\Website\06. Web RBKIC).

## Fitur Baru

### 1. Perhitungan KPI Maintenance

**File:** `src/utils/maintenanceKpi.js`

| KPI                 | Deskripsi                                                         |
| ------------------- | ----------------------------------------------------------------- |
| MTTR                | Mean Time To Repair - Waktu rata-rata dari laporan hingga selesai |
| MTBF                | Mean Time Between Failures - Waktu rata-rata antar kerusakan      |
| Active Repair       | Waktu perbaikan aktif (exclude waiting time)                      |
| Repeat Failure      | Mesin dengan jumlah WO terbanyak                                  |
| WO Status Breakdown | Count per status (Open, In Progress, Closed, dll)                 |
| Priority Breakdown  | Count per prioritas                                               |
| PM Achievement      | Pencapaian preventive maintenance                                 |
| Quality Stats       | Breakdown bagus/cukup/tidak bagus                                 |

### 2. Komponen React

**File:** `src/components/MaintenanceKpiPanel.jsx`

Komponen siap pakai untuk menampilkan KPI di dashboard.

---

## Cara Integrasi

### Opsi 1: Tambahkan Tab Baru di Menu KPI

Buka `src/main.jsx`, cari bagian `navItems` dan tambahkan:

```jsx
const navItems = [
  // ... existing items
  ["kpiFull", "KPI Lengkap", BarChart3, ["Admin", "Teknik"]],
];
```

Tambahkan route di `PageRouter`:

```jsx
import { MaintenanceKpiPanel } from "./components/MaintenanceKpiPanel";
import { calculateAllMaintenanceKPI } from "./utils/maintenanceKpi";

function PageRouter({ page, ...props }) {
  // ...

  switch (page) {
    // ...
    case "kpiFull":
      return <MaintenanceKpiPage {...props} />;
  }
}
```

Tambahkan fungsi baru:

```jsx
function MaintenanceKpiPage({ notify }) {
  const ordersRemote = useRemoteData(async () =>
    asArray(await apiGet(ENDPOINTS.orders, { action: "getAllOrders" })).map(
      normalizeOrder,
    ),
  );

  const maintenanceRemote = useRemoteData(async () =>
    asArray(await apiGet(ENDPOINTS.maintenance, { action: "getPerawatan" })),
  );

  return (
    <div className="page-content">
      <Panel title="KPI Maintenance RBKIC Style">
        <MaintenanceKpiPanel
          orders={ordersRemote.data}
          maintenance={maintenanceRemote.data}
        />
      </Panel>
    </div>
  );
}
```

### Opsi 2: Tambahkan di Dashboard Existing

Tambahkan di fungsi `Dashboard`:

```jsx
import { MaintenanceKpiPanel } from './components/MaintenanceKpiPanel';

// Di dalam fungsi Dashboard, tambahkan:
const orders = ordersRemote.data;
const maintenance = maintenanceRemote.data;

// Di return JSX:
<div className="section-title">
  <h2>KPI Maintenance</h2>
  <button onClick={() => go("kpi")}>Lihat lebih lengkap</button>
</div>

<MaintenanceKpiPanel
  orders={orders}
  maintenance={maintenance}
  compact={false}
/>
```

### Opsi 3: Badge Inline di Komponen Lain

```jsx
import { KpiBadge } from "./components/MaintenanceKpiPanel";

// Di JSX:
<KpiBadge orders={orders} maintenance={maintenance} />;
```

---

## API Functions

### calculateMTTR(orders)

```javascript
const result = calculateMTTR(orders);
// Returns: { avgMinutes: 245, avgHours: 4.1, total: 2450, count: 10 }
```

### calculateMTBF(orders)

```javascript
const result = calculateMTBF(orders);
// Returns: { avgHours: 72.5, intervals: 45, byMachine: {...} }
```

### calculateRepeatFailure(orders)

```javascript
const result = calculateRepeatFailure(orders);
// Returns: [{ machine: "Mesin A", count: 15 }, ...]
```

### calculateStatusBreakdown(orders)

```javascript
const result = calculateStatusBreakdown(orders);
// Returns: { open: 5, inProgress: 10, closed: 100, waitingPart: 3, ... }
```

### calculateAllMaintenanceKPI({ orders, maintenance })

```javascript
const result = calculateAllMaintenanceKPI({ orders, maintenance });
// Returns: { mttr, mtbf, activeRepair, repeatFailure, statusBreakdown, pmAchievement, ... }
```

---

## Komponen

### MaintenanceKpiPanel

```jsx
<MaintenanceKpiPanel
  orders={[]} // Array of work orders
  maintenance={[]} // Array of maintenance records
  compact={false} // true for compact view
/>
```

### KpiStatsRow

```jsx
<KpiStatsRow orders={[]} maintenance={[]} />
```

### KpiBadge

```jsx
<KpiBadge orders={[]} maintenance={[]} />
```

---

## File yang Ditambahkan

```
Siteki_Web/
├── src/
│   ├── utils/
│   │   └── maintenanceKpi.js      # KPI calculation functions
│   ├── components/
│   │   └── MaintenanceKpiPanel.jsx # React components
│   └── styles/
│       └── maintenance-kpi.css     # CSS styles
└── docs/
    └── MAINTENANCE_KPI_FROM_RBKIC.md # Dokumentasi ini
```

---

## Catatan

1. **Struktur data harus sesuai:**
   - Orders: perlu `tanggal`, `tanggal_selesai`, `status`, `urgensi`, `namaMesin`
   - Maintenance: perlu `tanggal`, `waktu`, `nama_mesin`

2. **Tidak mengubah alur existing** - komponen ini bisa ditambahkan tanpa mengubah flow yang ada

3. **Dark mode** sudah didukung oleh CSS
