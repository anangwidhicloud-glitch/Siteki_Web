import { HttpError, database, dateKey, monthName, text } from "../lib/core.js";

function shortMonth(value) {
  const key = dateKey(value);
  if (!key) return "";
  return new Intl.DateTimeFormat("id-ID", { month: "short", timeZone: "UTC" })
    .format(new Date(`${key}T00:00:00Z`)).replace(".", "");
}

async function maintenanceKpi(env) {
  const sql = database(env);
  const rows = await sql`SELECT * FROM monthly_maintenance_kpi ORDER BY month`;
  return rows.map(row => ({
    bulan: shortMonth(row.month),
    pencapaian: Number(row.achievement_ratio || 0),
    target: Number(row.target_ratio || 0.8),
    bagus: row.good_count || 0,
    perlu_perbaikan: row.repair_needed_count || 0,
    rencana: row.planned_count || 0,
    aktual: row.inspection_count || 0,
    target_jumlah: row.target_inspection_count || 272,
  }));
}

async function combinedKpi(env) {
  const sql = database(env);
  const rows = await sql`
    WITH report_summary AS (
      SELECT
        date_trunc('month', report_date)::date AS month,
        coalesce(sum(total_hours) FILTER (WHERE lower(trim(coalesce(job_type, ''))) = 'perbaikan'), 0)::numeric(16, 3) AS total_hours,
        count(*)::integer AS order_count,
        count(*) FILTER (WHERE lower(coalesce(repair_rating, '')) = 'bagus')::integer AS good_count,
        count(*) FILTER (WHERE lower(coalesce(repair_rating, '')) = 'cukup')::integer AS fair_count,
        count(*) FILTER (WHERE lower(replace(coalesce(repair_rating, ''), ' ', '')) = 'tidakbagus')::integer AS poor_count
      FROM work_reports
      GROUP BY date_trunc('month', report_date)::date
    )
    SELECT
      targets.month,
      coalesce(summary.total_hours, 0)::numeric(16, 3) AS total_hours,
      targets.target_hours,
      coalesce(summary.order_count, 0) AS order_count,
      coalesce(summary.good_count, 0) AS good_count,
      coalesce(summary.fair_count, 0) AS fair_count,
      coalesce(summary.poor_count, 0) AS poor_count
    FROM kpi_monthly_targets targets
    LEFT JOIN report_summary summary USING (month)
    ORDER BY targets.month
  `;
  return {
    status: "success",
    rekap: rows.map(row => ({
      bulan: shortMonth(row.month), jam: Number(row.total_hours || 0),
      target: Number(row.target_hours || 500), order: row.order_count || 0,
      bagus: row.good_count || 0, cukup: row.fair_count || 0,
      tidakBagus: row.poor_count || 0,
    })),
  };
}

async function dailyDashboardKpi(env, params) {
  const currentYear = new Date().getFullYear();
  const year = Number(params.year) || currentYear;
  if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new HttpError(400, "Tahun KPI harian tidak valid.");
  const start = `${year}-01-01`, end = `${year + 1}-01-01`, sql = database(env);
  const [maintenance, downtime, orders] = await Promise.all([
    sql`SELECT inspected_on AS day, count(*)::integer AS value
        FROM maintenance_inspections
        WHERE inspected_on >= ${start}::date AND inspected_on < ${end}::date
        GROUP BY inspected_on ORDER BY inspected_on`,
    sql`SELECT report_date AS day, coalesce(sum(total_hours), 0) AS value
        FROM work_reports
        WHERE report_date >= ${start}::date AND report_date < ${end}::date
          AND lower(trim(coalesce(job_type, ''))) = 'perbaikan'
        GROUP BY report_date ORDER BY report_date`,
    sql`SELECT report_date AS day, count(*)::integer AS value
        FROM work_reports
        WHERE report_date >= ${start}::date AND report_date < ${end}::date
        GROUP BY report_date ORDER BY report_date`,
  ]);
  const map = rows => rows.map(row => ({ tanggal: dateKey(row.day), value: Number(row.value || 0) }));
  return { status: "success", year, data: { maintenance: map(maintenance), downtime: map(downtime), orders: map(orders) } };
}

async function downtime(env) {
  const sql = database(env);
  const [monthly, reports] = await Promise.all([
    sql`
      WITH report_summary AS (
        SELECT
          date_trunc('month', report_date)::date AS month,
          coalesce(sum(total_hours) FILTER (WHERE lower(trim(coalesce(job_type, ''))) = 'perbaikan'), 0)::numeric(16, 3) AS total_hours
        FROM work_reports
        GROUP BY date_trunc('month', report_date)::date
      )
      SELECT targets.month, coalesce(summary.total_hours, 0)::numeric(16, 3) AS total_hours, targets.target_hours
      FROM kpi_monthly_targets targets
      LEFT JOIN report_summary summary USING (month)
      ORDER BY targets.month
    `,
    sql`SELECT report_date, machine_type, machine_name, department, component_type, total_hours
        FROM work_reports
        WHERE lower(trim(coalesce(job_type, ''))) = 'perbaikan'
        ORDER BY report_date`,
  ]);
  return {
    status: "success",
    rekap: monthly.map(row => ({ bulan: shortMonth(row.month), jam: Number(row.total_hours || 0), target: Number(row.target_hours || 500) })),
    laporan_mentah: reports.map(row => ({
      bulan: shortMonth(row.report_date), jenis: row.machine_type || "Lainnya",
      mesin: row.machine_name || "Lainnya", bagian: row.department || "Lainnya",
      komponen: row.component_type || "Lainnya", total_jam: Number(row.total_hours || 0),
    })),
  };
}

async function maintenanceDetail(env, params) {
  const sql = database(env);
  const [plans, inspections] = await Promise.all([
    sql`SELECT planned_on,maintenance_type,machine_type,machine_name FROM maintenance_plans`,
    sql`SELECT inspected_on,maintenance_type,machine_type,machine_name FROM maintenance_inspections`,
  ]);
  const requestedMonth = text(params.bulan);
  const requestedType = text(params.jenis);
  const acceptsMonth = value => !requestedMonth || requestedMonth === "Semua Bulan" || monthName(value) === requestedMonth;
  const acceptsType = value => !requestedType || requestedType === "Semua Jenis" || String(value || "") === requestedType;
  const selectedPlans = plans.filter(row => acceptsMonth(row.planned_on));
  const selectedInspections = inspections.filter(row => acceptsMonth(row.inspected_on));
  const ratio = (actual, planned) => planned ? Math.min(100, actual / planned * 100) : (actual ? 100 : 0);
  const group = (planRows, inspectionRows, key) => {
    const keys = new Set([...planRows.map(row => row[key]), ...inspectionRows.map(row => row[key])].filter(Boolean));
    return [...keys].map(name => ({
      name,
      achievement: ratio(
        inspectionRows.filter(row => row[key] === name).length,
        planRows.filter(row => row[key] === name).length,
      ),
    }));
  };
  const byType = group(selectedPlans, selectedInspections, "maintenance_type")
    .map(row => ({ jenis:row.name, pencapaian:row.achievement }));
  const typedPlans = selectedPlans.filter(row => acceptsType(row.maintenance_type || row.machine_type));
  const typedInspections = selectedInspections.filter(row => acceptsType(row.maintenance_type || row.machine_type));
  const byMachine = group(typedPlans, typedInspections, "machine_name")
    .map(row => ({ nama_mesin:row.name, pencapaian:row.achievement }));
  return {
    status:"success", data_per_jenis:byType, data_per_mesin:byMachine,
    total_jenis:new Set(selectedPlans.map(row=>row.machine_type).filter(Boolean)).size,
    total_mesin:new Set(selectedPlans.map(row=>row.machine_name).filter(Boolean)).size,
  };
}

export async function handleAnalytics({ env, url, resource }) {
  if(resource==="kpi") return maintenanceKpi(env);
  if(resource==="kpi-combined") return combinedKpi(env);
  if(resource==="kpi-daily") return dailyDashboardKpi(env,Object.fromEntries(url.searchParams));
  if(resource==="downtime") return downtime(env);
  if(resource==="maintenance-detail") return maintenanceDetail(env,Object.fromEntries(url.searchParams));
  return null;
}
