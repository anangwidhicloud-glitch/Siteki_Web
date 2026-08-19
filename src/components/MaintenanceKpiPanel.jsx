/**
 * Maintenance KPI Panel Component
 *
 * Komponen untuk menampilkan KPI Maintenance lengkap
 * dengan data dari SiTeki_Web
 */

import React, { useMemo } from 'react';
import {
  Activity, Clock, Gauge, TrendingUp, Wrench
} from 'lucide-react';
import {
  calculateAllMaintenanceKPI,
  calculateRepeatFailure,
  calculateStatusBreakdown,
  calculatePriorityBreakdown,
  calculatePmAchievement,
  calculateQualityStats,
  formatDuration,
  formatHours
} from '../utils/maintenanceKpi';

/**
 * Main Maintenance KPI Panel
 * Displays complete maintenance KPI dashboard
 */
export function MaintenanceKpiPanel({ orders = [], maintenance = [], repairRecords = orders, compact = false }) {
  const kpi = useMemo(() => {
    return calculateAllMaintenanceKPI({ orders, maintenance, repairRecords });
  }, [orders, maintenance, repairRecords]);

  if (compact) {
    return <MaintenanceKpiCompact data={kpi} />;
  }

  return (
    <div className="maintenance-kpi-panel">
      {/* KPI Summary Cards */}
      <div className="stats-grid">
        <KpiCard
          icon={Clock}
          label="MTTR"
          value={formatDuration(kpi.mttr.avgMinutes)}
          detail={kpi.mttr.count?`Rata-rata ${kpi.mttr.count} WO`:"Waktu selesai WO belum tersedia"}
          tone="blue"
        />
        <KpiCard
          icon={TrendingUp}
          label="MTBF"
          value={formatHours(kpi.mtbf.avgHours)}
          detail={`${kpi.mtbf.intervals} interval`}
          tone="mint"
        />
        <KpiCard
          icon={Wrench}
          label="Active Repair"
          value={formatDuration(kpi.activeRepair.avgMinutes)}
          detail={`${kpi.activeRepair.count} durasi aktual`}
          tone="amber"
        />
        <KpiCard
          icon={Gauge}
          label="PM Achievement"
          value={`${kpi.pmAchievement.achievementPercent}%`}
          detail={`${kpi.pmAchievement.achieved}/${kpi.pmAchievement.planned}`}
          tone="violet"
        />
      </div>

      {/* Order Stats */}
      <div className="kpi-section">
        <h3>Status Work Order</h3>
        <div className="status-grid">
          <StatusBadge label="Open" value={kpi.statusBreakdown.open} color="#d97706" />
          <StatusBadge label="In Progress" value={kpi.statusBreakdown.inProgress} color="#3279e6" />
          <StatusBadge label="Waiting Part" value={kpi.statusBreakdown.waitingPart} color="#79a839" />
          <StatusBadge label="Waiting Tech" value={kpi.statusBreakdown.waitingTech} color="#7557d9" />
          <StatusBadge label="Closed" value={kpi.statusBreakdown.closed} color="#069b70" />
        </div>
      </div>

      {/* Priority Breakdown */}
      <div className="kpi-section">
        <h3>Prioritas</h3>
        <div className="priority-bar">
          {kpi.priorityBreakdown.rendah > 0 && (
            <div
              className="priority-segment rendah"
              style={{ width: `${(kpi.priorityBreakdown.rendah / kpi.totalOrders) * 100}%` }}
              title={`Rendah: ${kpi.priorityBreakdown.rendah}`}
            />
          )}
          {kpi.priorityBreakdown.biasa > 0 && (
            <div
              className="priority-segment biasa"
              style={{ width: `${(kpi.priorityBreakdown.biasa / kpi.totalOrders) * 100}%` }}
              title={`Biasa: ${kpi.priorityBreakdown.biasa}`}
            />
          )}
          {kpi.priorityBreakdown.tinggi > 0 && (
            <div
              className="priority-segment tinggi"
              style={{ width: `${(kpi.priorityBreakdown.tinggi / kpi.totalOrders) * 100}%` }}
              title={`Tinggi: ${kpi.priorityBreakdown.tinggi}`}
            />
          )}
          {kpi.priorityBreakdown.kritis > 0 && (
            <div
              className="priority-segment kritis"
              style={{ width: `${(kpi.priorityBreakdown.kritis / kpi.totalOrders) * 100}%` }}
              title={`Kritis: ${kpi.priorityBreakdown.kritis}`}
            />
          )}
        </div>
        <div className="priority-legend">
          <span><i className="kritis" /> Kritis</span>
          <span><i className="tinggi" /> Tinggi</span>
          <span><i className="biasa" /> Biasa</span>
          <span><i className="rendah" /> Rendah</span>
        </div>
      </div>

      {/* Repeat Failure */}
      <div className="kpi-section">
        <h3>Repeat Failure (Top 5)</h3>
        <div className="repeat-failure-list">
          {kpi.repeatFailure.slice(0, 5).map((item, index) => (
            <div key={index} className="repeat-item">
              <span className="rank">#{index + 1}</span>
              <span className="machine">{item.machine}</span>
              <span className="count">{item.count} WO</span>
              <div className="bar-bg">
                <div
                  className="bar-fill"
                  style={{ width: `${(item.count / (kpi.repeatFailure[0]?.count || 1)) * 100}%` }}
                />
              </div>
            </div>
          ))}
          {kpi.repeatFailure.length === 0 && (
            <p className="empty">Belum ada data repeat failure</p>
          )}
        </div>
      </div>

      {/* PM Achievement */}
      <div className="kpi-section">
        <h3>PM Achievement</h3>
        <div className="pm-achievement">
          <div className="pm-progress">
            <div
              className="pm-fill"
              style={{ width: `${Math.min(100, kpi.pmAchievement.achievementPercent)}%` }}
            />
            <span className="pm-target" style={{ left: '80%' }} />
          </div>
          <div className="pm-stats">
            <span><strong>{kpi.pmAchievement.achieved}</strong> terealisasi</span>
            <span><strong>{kpi.pmAchievement.planned}</strong> rencana</span>
            <span><strong>{kpi.pmAchievement.missed}</strong> terlewat</span>
          </div>
        </div>
      </div>

      {/* Quality Stats */}
      <div className="kpi-section">
        <h3>Kualitas Perbaikan</h3>
        <div className="quality-breakdown">
          <div className="quality-bar">
            {kpi.qualityStats.bagus > 0 && (
              <div
                className="quality-segment bagus"
                style={{ width: `${kpi.qualityStats.bagusPercent}%` }}
                title={`Bagus: ${kpi.qualityStats.bagus}`}
              />
            )}
            {kpi.qualityStats.cukup > 0 && (
              <div
                className="quality-segment cukup"
                style={{ width: `${(kpi.qualityStats.cukup / kpi.qualityStats.total) * 100}%` }}
                title={`Cukup: ${kpi.qualityStats.cukup}`}
              />
            )}
            {kpi.qualityStats.tidakBagus > 0 && (
              <div
                className="quality-segment tidak-bagus"
                style={{ width: `${(kpi.qualityStats.tidakBagus / kpi.qualityStats.total) * 100}%` }}
                title={`Tidak Bagus: ${kpi.qualityStats.tidakBagus}`}
              />
            )}
          </div>
          <div className="quality-legend">
            <span><i className="bagus" /> Bagus: {kpi.qualityStats.bagus}</span>
            <span><i className="cukup" /> Cukup: {kpi.qualityStats.cukup}</span>
            <span><i className="tidak-bagus" /> Tidak: {kpi.qualityStats.tidakBagus}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Compact KPI View
 */
function MaintenanceKpiCompact({ data }) {
  return (
    <div className="kpi-compact">
      <div className="kpi-mini">
        <Clock size={16} />
        <span>MTTR: {formatDuration(data.mttr.avgMinutes)}</span>
      </div>
      <div className="kpi-mini">
        <TrendingUp size={16} />
        <span>MTBF: {formatHours(data.mtbf.avgHours)}</span>
      </div>
      <div className="kpi-mini">
        <Gauge size={16} />
        <span>PM: {data.pmAchievement.achievementPercent}%</span>
      </div>
      <div className="kpi-mini">
        <Wrench size={16} />
        <span>Aktif: {data.activeOrders} WO</span>
      </div>
    </div>
  );
}

/**
 * KPI Card Component
 */
function KpiCard({ icon: Icon, label, value, detail, tone = 'blue' }) {
  return (
    <div className={`stat ${tone}`}>
      <span className={`icon-box ${tone}`}>
        <Icon size={21} />
      </span>
      <div>
        <small>{label}</small>
        <strong>{value}</strong>
        <p>{detail}</p>
      </div>
    </div>
  );
}

/**
 * Status Badge Component
 */
function StatusBadge({ label, value, color }) {
  return (
    <div className="status-badge" style={{ borderColor: color }}>
      <span className="badge-value" style={{ color }}>{value}</span>
      <span className="badge-label">{label}</span>
    </div>
  );
}

/**
 * KPI Stats Row Component
 */
export function KpiStatsRow({ orders = [], maintenance = [] }) {
  const repeatFailure = useMemo(() => calculateRepeatFailure(orders), [orders]);
  const statusBreakdown = useMemo(() => calculateStatusBreakdown(orders), [orders]);
  const pmAchievement = useMemo(() => calculatePmAchievement(maintenance), [maintenance]);

  return (
    <div className="kpi-stats-row">
      <div className="stat-item">
        <span className="stat-label">Repeat Failure</span>
        <span className="stat-value">{repeatFailure[0]?.machine || '-'}</span>
        <span className="stat-detail">{repeatFailure[0]?.count || 0} WO</span>
      </div>
      <div className="stat-item">
        <span className="stat-label">Aktif</span>
        <span className="stat-value">{statusBreakdown.open + statusBreakdown.inProgress}</span>
        <span className="stat-detail">WO terbuka</span>
      </div>
      <div className="stat-item">
        <span className="stat-label">PM</span>
        <span className="stat-value">{pmAchievement.achievementPercent}%</span>
        <span className="stat-detail">{pmAchievement.achieved}/{pmAchievement.planned}</span>
      </div>
    </div>
  );
}

/**
 * KPI Inline Badge
 * For embedding in other components
 */
export function KpiBadge({ orders = [], maintenance = [] }) {
  const mttr = useMemo(() => {
    const { mttr } = calculateAllMaintenanceKPI({ orders, maintenance });
    return formatDuration(mttr.avgMinutes);
  }, [orders, maintenance]);

  const pm = useMemo(() => {
    const { pmAchievement } = calculateAllMaintenanceKPI({ orders, maintenance });
    return pmAchievement.achievementPercent;
  }, [orders, maintenance]);

  return (
    <div className="kpi-badge">
      <Activity size={14} />
      <span>MTTR: {mttr} | PM: {pm}%</span>
    </div>
  );
}

export default MaintenanceKpiPanel;
