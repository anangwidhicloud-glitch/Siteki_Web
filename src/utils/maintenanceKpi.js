/**
 * Enhanced Maintenance KPI Module
 *
 * Menambahkan fitur KPI dari RBKIC yang belum ada di SiTeki_Web:
 * - MTTR (Mean Time To Repair)
 * - MTBF (Mean Time Between Failures)
 * - Active Repair Average
 * - Repeat Failure Analysis
 * - WO Status Breakdown
 * - Priority Breakdown
 *
 * Usage:
 *   import { MaintenanceKpiPanel } from './MaintenanceKpi';
 *   <MaintenanceKpiPanel />
 */

/**
 * Helper function to parse date string
 */
function parseDate(value) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (!value) return null;
  const str = String(value).trim();

  // Format: DD/MM/YYYY, optionally followed by HH:mm[:ss]
  let match = str.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (match) {
    return new Date(
      Number(match[3]), Number(match[2]) - 1, Number(match[1]),
      Number(match[4] || 0), Number(match[5] || 0), Number(match[6] || 0)
    );
  }

  // Format: YYYY-MM-DD, optionally followed by HH:mm[:ss]
  match = str.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (match) {
    return new Date(
      Number(match[1]), Number(match[2]) - 1, Number(match[3]),
      Number(match[4] || 0), Number(match[5] || 0), Number(match[6] || 0)
    );
  }

  // Try native parsing
  const parsed = new Date(str);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Calculate MTTR (Mean Time To Repair)
 * Average time from order creation to completion
 *
 * @param {Array} orders - Array of work orders
 * @returns {Object} MTTR metrics
 */
export function calculateMTTR(orders) {
  if (!orders || !orders.length) {
    return { avgMinutes: 0, avgHours: 0, total: 0, count: 0 };
  }

  const durations = orders
    .map(order => {
      // Try different date field combinations
      const startDate = parseDate(order.tanggal_order || order.tanggal || order.tanggalMulai);
      const endDate = parseDate(
        order.tanggal_selesai || order.tanggal_selesai_order || order.tglSelesai ||
        order.jamSelesai || order.akhir
      );

      if (!startDate || !endDate) return null;

      const diffMs = endDate.getTime() - startDate.getTime();
      if (diffMs < 0) return null; // End before start

      return diffMs / 60000; // Convert to minutes
    })
    .filter(v => v !== null && v >= 0);

  if (!durations.length) {
    return { avgMinutes: 0, avgHours: 0, total: 0, count: 0 };
  }

  const total = durations.reduce((sum, d) => sum + d, 0);
  const avgMinutes = Math.round(total / durations.length);
  const avgHours = Math.round(avgMinutes / 60 * 10) / 10;

  return { avgMinutes, avgHours, total: Math.round(total), count: durations.length };
}

/**
 * Calculate MTBF (Mean Time Between Failures)
 * Average time between consecutive failures for each machine
 *
 * @param {Array} orders - Array of work orders
 * @returns {Object} MTBF metrics
 */
export function calculateMTBF(orders) {
  if (!orders || !orders.length) {
    return { avgHours: 0, intervals: 0, byMachine: {} };
  }

  // Group by machine
  const byMachine = {};
  orders.forEach(order => {
    const machineName = order.namaMesin || order.mesin || order.nama_mesin;
    if (!machineName) return;
    if (!byMachine[machineName]) byMachine[machineName] = [];
    byMachine[machineName].push(order);
  });

  // Sort and calculate intervals
  const allIntervals = [];
  const machineIntervals = {};

  Object.entries(byMachine).forEach(([machine, machineOrders]) => {
    // Sort by date
    const sorted = [...machineOrders].sort((a, b) => {
      const dateA = parseDate(a.tanggal_order || a.tanggal);
      const dateB = parseDate(b.tanggal_order || b.tanggal);
      if (!dateA || !dateB) return 0;
      return dateA.getTime() - dateB.getTime();
    });

    const intervals = [];
    for (let i = 1; i < sorted.length; i++) {
      const prev = parseDate(sorted[i - 1].tanggal_order || sorted[i - 1].tanggal);
      const curr = parseDate(sorted[i].tanggal_order || sorted[i].tanggal);

      if (prev && curr) {
        const hours = (curr.getTime() - prev.getTime()) / 3600000;
        if (hours > 0) {
          intervals.push(hours);
          allIntervals.push(hours);
        }
      }
    }

    if (intervals.length) {
      machineIntervals[machine] = {
        avgHours: Math.round(intervals.reduce((a, b) => a + b, 0) / intervals.length * 10) / 10,
        count: intervals.length,
        minHours: Math.round(Math.min(...intervals) * 10) / 10,
        maxHours: Math.round(Math.max(...intervals) * 10) / 10
      };
    }
  });

  const avgHours = allIntervals.length
    ? Math.round(allIntervals.reduce((a, b) => a + b, 0) / allIntervals.length * 10) / 10
    : 0;

  return { avgHours, intervals: allIntervals.length, byMachine: machineIntervals };
}

/**
 * Calculate Repeat Failure
 * Machines with the most work orders
 *
 * @param {Array} orders - Array of work orders
 * @returns {Array} Ranked list of machines by failure count
 */
export function calculateRepeatFailure(orders) {
  if (!orders || !orders.length) return [];

  const counts = {};
  orders.forEach(order => {
    const machineName = order.namaMesin || order.mesin || order.nama_mesin;
    if (!machineName) return;
    counts[machineName] = (counts[machineName] || 0) + 1;
  });

  return Object.entries(counts)
    .map(([machine, count]) => ({ machine, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);
}

/**
 * Calculate WO Status Breakdown
 * Count orders by status
 *
 * @param {Array} orders - Array of work orders
 * @returns {Object} Status breakdown
 */
export function calculateStatusBreakdown(orders) {
  if (!orders || !orders.length) {
    return { open: 0, inProgress: 0, closed: 0, waitingPart: 0, waitingTech: 0, total: 0 };
  }

  const breakdown = {
    open: 0,
    inProgress: 0,
    closed: 0,
    waitingPart: 0,
    waitingTech: 0,
    total: orders.length
  };

  orders.forEach(order => {
    const status = String(order.status || order.statusOrder || '').toLowerCase();

    if (status.includes('open') || status === 'open') {
      breakdown.open++;
    } else if (status.includes('progress') || status.includes('proses')) {
      breakdown.inProgress++;
    } else if (status.includes('close') || status.includes('selesai') || status.includes('done')) {
      breakdown.closed++;
    } else if (status.includes('part') || status.includes('spare')) {
      breakdown.waitingPart++;
    } else if (status.includes('tech') || status.includes('teknisi')) {
      breakdown.waitingTech++;
    } else {
      // Default to open if unknown status
      breakdown.open++;
    }
  });

  return breakdown;
}

/**
 * Calculate Priority Breakdown
 * Count orders by priority
 *
 * @param {Array} orders - Array of work orders
 * @returns {Object} Priority breakdown
 */
export function calculatePriorityBreakdown(orders) {
  if (!orders || !orders.length) {
    return { rendah: 0, biasa: 0, tinggi: 0, kritis: 0 };
  }

  const breakdown = { rendah: 0, biasa: 0, tinggi: 0, kritis: 0 };

  orders.forEach(order => {
    const urgensi = String(order.urgensi || '').toLowerCase();

    if (urgensi.includes('kritis') || urgensi.includes('emergency') || urgensi.includes('urgent') || urgensi.includes('penting sekali')) {
      breakdown.kritis++;
    } else if (urgensi.includes('rendah') || urgensi.includes('low')) {
      breakdown.rendah++;
    } else if (urgensi.includes('biasa') || urgensi.includes('normal') || !urgensi) {
      breakdown.biasa++;
    } else if (urgensi.includes('tinggi') || urgensi.includes('high') || urgensi.includes('penting')) {
      breakdown.tinggi++;
    } else {
      breakdown.biasa++;
    }
  });

  return breakdown;
}

/**
 * Calculate Active Repair Average
 * Average active repair time excluding waiting time
 *
 * @param {Array} orders - Array of work orders
 * @returns {Object} Active repair metrics
 */
export function calculateActiveRepair(orders) {
  if (!orders || !orders.length) {
    return { avgMinutes: 0, avgHours: 0, count: 0 };
  }

  const activeRepairDurations = orders
    .map(order => {
      const recordedHours = Number(order.totalJam ?? order.total_jam ?? order.durasi);
      if (Number.isFinite(recordedHours) && recordedHours > 0) return recordedHours * 60;

      const startDate = parseDate(order.jamMulai || order.awal || order.tanggalMulai);
      const endDate = parseDate(order.jamSelesai || order.akhir || order.tanggalSelesai);

      if (!startDate || !endDate) return null;

      const totalMinutes = (endDate.getTime() - startDate.getTime()) / 60000;
      if (totalMinutes <= 0) return null;

      return totalMinutes;
    })
    .filter(v => v !== null && v > 0);

  if (!activeRepairDurations.length) {
    return { avgMinutes: 0, avgHours: 0, count: 0 };
  }

  const total = activeRepairDurations.reduce((a, b) => a + b, 0);
  const avgMinutes = Math.round(total / activeRepairDurations.length);
  const avgHours = Math.round(avgMinutes / 60 * 10) / 10;

  return { avgMinutes, avgHours, count: activeRepairDurations.length };
}

/**
 * Calculate PM Achievement
 * Planned vs achieved preventive maintenance
 *
 * @param {Array} maintenance - Array of maintenance records
 * @param {number} machineCount - Total active machines
 * @param {number} targetPerMonth - Target inspections per machine per month (default: 4)
 * @returns {Object} PM achievement metrics
 */
export function calculatePmAchievement(maintenance, machineCount = 68, targetPerMonth = 4) {
  const planned = machineCount * targetPerMonth;
  const rows = Array.isArray(maintenance) ? maintenance : [];
  const now = new Date();
  const parsedRows = rows.map(item => ({ item, date:parseDate(item.tanggal) }));
  const hasDatedRows = parsedRows.some(entry => entry.date);
  const periodRows = hasDatedRows
    ? parsedRows
      .filter(entry => entry.date && entry.date.getMonth() === now.getMonth() && entry.date.getFullYear() === now.getFullYear())
      .map(entry => entry.item)
    : rows;
  const achieved = periodRows.length;
  const missed = Math.max(0, planned - achieved);
  const achievementPercent = planned > 0 ? Math.round(achieved / planned * 100) : 0;

  // Breakdown by frequency
  const byFreq = { M: 0, B: 0 };
  periodRows.forEach(m => {
    const freq = String(m.waktu || m.jenis_perawatan || '').toUpperCase();
    if (freq === 'M' || freq === 'MINGGUAN') byFreq.M++;
    if (freq === 'B' || freq === 'BULANAN') byFreq.B++;
  });

  return { planned, achieved, missed, achievementPercent, byFreq };
}

/**
 * Calculate Quality Stats
 * Breakdown of repair quality
 *
 * @param {Array} orders - Array of completed orders
 * @returns {Object} Quality breakdown
 */
export function calculateQualityStats(orders) {
  if (!orders || !orders.length) {
    return { bagus: 0, cukup: 0, tidakBagus: 0, total: 0, bagusPercent: 0 };
  }

  const stats = { bagus: 0, cukup: 0, tidakBagus: 0 };

  orders.forEach(order => {
    const nilai = String(order.nilaiPerbaikan || order.status_mesin || '').toLowerCase();

    if (nilai.includes('bagus') || nilai.includes('good') || nilai.includes('normal')) {
      stats.bagus++;
    } else if (nilai.includes('cukup') || nilai.includes('sufficient')) {
      stats.cukup++;
    } else if (nilai.includes('tidak') || nilai.includes('bad') || nilai.includes('rusak')) {
      stats.tidakBagus++;
    }
  });

  const total = stats.bagus + stats.cukup + stats.tidakBagus;
  const bagusPercent = total > 0 ? Math.round(stats.bagus / total * 100) : 0;

  return { ...stats, total, bagusPercent };
}

/**
 * Complete Maintenance KPI Calculator
 * Combines all KPI calculations
 *
 * @param {Object} data - { orders: [], maintenance: [] }
 * @returns {Object} Complete KPI metrics
 */
export function calculateAllMaintenanceKPI(data = {}) {
  const { orders = [], maintenance = [], repairRecords = orders } = data;

  const mttr = calculateMTTR(orders);
  const mtbf = calculateMTBF(orders);
  const repeatFailure = calculateRepeatFailure(orders);
  const statusBreakdown = calculateStatusBreakdown(orders);
  const priorityBreakdown = calculatePriorityBreakdown(orders);
  const activeRepair = calculateActiveRepair(repairRecords);
  const pmAchievement = calculatePmAchievement(maintenance);
  const qualityStats = calculateQualityStats(repairRecords);

  return {
    // Summary
    totalOrders: orders.length,
    activeOrders: orders.length - statusBreakdown.closed,
    closedOrders: statusBreakdown.closed,

    // KPI Metrics
    mttr,
    mtbf,
    activeRepair,
    repeatFailure,
    statusBreakdown,
    priorityBreakdown,
    pmAchievement,
    qualityStats
  };
}

/**
 * Format minutes to human readable
 */
export function formatDuration(minutes) {
  if (!minutes || minutes < 0) return '-';
  if (minutes < 60) return `${Math.round(minutes)} menit`;
  const hours = Math.floor(minutes / 60);
  const mins = Math.round(minutes % 60);
  return mins > 0 ? `${hours}j ${mins}m` : `${hours} jam`;
}

/**
 * Format hours to human readable
 */
export function formatHours(hours) {
  if (!hours || hours < 0) return '-';
  if (hours < 24) return `${Math.round(hours * 10) / 10} jam`;
  const days = Math.floor(hours / 24);
  const remainingHours = Math.round((hours % 24) * 10) / 10;
  return `${days} hari ${remainingHours} jam`;
}
