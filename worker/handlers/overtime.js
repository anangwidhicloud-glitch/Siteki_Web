import {
  HttpError, database, dateKey, isoDate, number, requireSession, text,
} from "../lib/core.js";

function cutoff(year, month) {
  const start = new Date(Date.UTC(year, month - 1, 22));
  const end = new Date(Date.UTC(year, month, 21));
  return { start: dateKey(start), end: dateKey(end) };
}

async function holidayMap(sql, start, end) {
  const rows = await sql`
    SELECT holiday_date, name FROM national_holidays
    WHERE holiday_date BETWEEN ${start}::date AND ${end}::date
  `;
  return new Map(rows.map(row => [dateKey(row.holiday_date), row.name]));
}

function sundaysAndHolidays(year, month, holidays) {
  const result = [];
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  for (let day = 1; day <= days; day += 1) {
    const key = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const sunday = new Date(`${key}T00:00:00Z`).getUTCDay() === 0;
    if (holidays.has(key) || sunday) result.push({ tanggal: key, nama: holidays.get(key) || "Hari Minggu" });
  }
  return result;
}

function holidayInfo(key, holidays) {
  const sunday = new Date(`${key}T00:00:00Z`).getUTCDay() === 0;
  return { isHoliday: holidays.has(key) || sunday, name: holidays.get(key) || (sunday ? "Hari Minggu" : "") };
}

async function calendar(request, env, body) {
  const session = await requireSession(request, env, body);
  const year = Number(body.year) || new Date().getFullYear();
  const month = Number(body.month) || new Date().getMonth() + 1;
  if (month < 1 || month > 12) throw new HttpError(400, "Bulan tidak valid.");
  const sql = database(env);
  const monthStart = `${year}-${String(month).padStart(2, "0")}-01`;
  const monthEnd = dateKey(new Date(Date.UTC(year, month, 0)));
  const range = cutoff(year, month);
  const [entries, summaryRows, holidays] = await Promise.all([
    sql`
      SELECT overtime_date, overtime_hours, overtime_type, total_wage, notes
      FROM overtime_entries
      WHERE user_id = ${session.id}
        AND overtime_date BETWEEN ${monthStart}::date AND ${monthEnd}::date
      ORDER BY overtime_date
    `,
    sql`
      SELECT count(*)::integer AS count, coalesce(sum(overtime_hours),0) AS hours,
        coalesce(sum(total_wage),0) AS wage
      FROM overtime_entries
      WHERE user_id = ${session.id}
        AND overtime_date BETWEEN ${range.start}::date AND ${range.end}::date
    `,
    holidayMap(sql, monthStart, monthEnd),
  ]);
  const data = entries.map(row => {
    const key = dateKey(row.overtime_date);
    const holiday = holidayInfo(key, holidays);
    return {
      tanggal: key, jam: Number(row.overtime_hours || 0), jenis: row.overtime_type || "",
      totalUpah: Number(row.total_wage || 0), keterangan: row.notes || "",
      hariBesar: holiday.isHoliday, namaLibur: holiday.name,
    };
  });
  const summary = summaryRows[0];
  return {
    status: "success", year, month, data,
    holidays: sundaysAndHolidays(year, month, holidays),
    cutoff: {
      jumlahData: summary.count, totalJam: Number(summary.hours || 0),
      totalUpah: Number(summary.wage || 0), tanggalAwal: range.start, tanggalAkhir: range.end,
    },
  };
}

async function save(request, env, body) {
  const session = await requireSession(request, env, body);
  const key = isoDate(body.tanggal);
  const hours = number(body.jam);
  const notes = text(body.keterangan);
  if (!key) throw new HttpError(400, "Tanggal lembur tidak valid.");
  if (!hours || hours <= 0 || hours > 24) throw new HttpError(400, "Jam lembur harus lebih dari 0 dan maksimal 24 jam.");
  if (!notes) throw new HttpError(400, "Keterangan pekerjaan lembur wajib diisi.");
  const salary = Number(session.base_salary || 0);
  if (salary <= 0) throw new HttpError(400, "Gaji pokok pengguna belum tersedia.");
  const sql = database(env);
  const holidays = await holidayMap(sql, key, key);
  const holiday = holidayInfo(key, holidays);
  const type = holiday.isHoliday ? "HariBesar" : (hours < 2 ? "Normal_Kecil" : "Normal_Besar");
  const hourly = salary / 173;
  const rows = await sql`
    INSERT INTO overtime_entries (
      user_id, recorded_at, overtime_date, employee_name, role_snapshot,
      overtime_hours, overtime_type, hourly_salary_snapshot, total_wage,
      notes, source_sheet, legacy_sheet_row
    ) VALUES (
      ${session.id}, now(), ${key}::date, ${session.full_name}, ${session.role},
      ${hours}, ${type}, ${hourly}, calculate_overtime_wage(${salary}, ${hours}, ${type}),
      ${notes}, 'Neon API', NULL
    )
    ON CONFLICT (user_id, overtime_date) WHERE user_id IS NOT NULL DO UPDATE SET
      recorded_at=now(), employee_name=excluded.employee_name, role_snapshot=excluded.role_snapshot,
      overtime_hours=excluded.overtime_hours, overtime_type=excluded.overtime_type,
      hourly_salary_snapshot=excluded.hourly_salary_snapshot, total_wage=excluded.total_wage,
      notes=excluded.notes, source_sheet='Neon API'
    RETURNING total_wage
  `;
  return {
    status: "success", message: "Data lembur disimpan.",
    data: { tanggal: key, jam: hours, jenis: type, totalUpah: Number(rows[0].total_wage), keterangan: notes, hariBesar: holiday.isHoliday, namaLibur: holiday.name },
  };
}

async function remove(request, env, body) {
  const session = await requireSession(request, env, body);
  const key = isoDate(body.tanggal);
  if (!key) throw new HttpError(400, "Tanggal lembur tidak valid.");
  const sql = database(env);
  const rows = await sql`DELETE FROM overtime_entries WHERE user_id=${session.id} AND overtime_date=${key}::date RETURNING id`;
  if (!rows.length) throw new HttpError(404, "Data lembur pada tanggal tersebut tidak ditemukan.");
  return { status: "success", message: "Data lembur dihapus." };
}

async function chart(request, env, body) {
  await requireSession(request, env, body, ["Admin", "Teknik"]);
  const year = Number(body.year) || new Date().getFullYear();
  const sql = database(env);
  const [rows,dailyRows] = await Promise.all([sql`
      SELECT extract(month FROM overtime_date)::integer AS month,
        coalesce(sum(overtime_hours),0) AS hours, count(*)::integer AS count
      FROM overtime_entries entries
      JOIN users ON users.id=entries.user_id
      WHERE extract(year FROM overtime_date)=${year}
        AND lower(users.role) IN ('admin','teknik')
      GROUP BY extract(month FROM overtime_date)
    `,sql`
      SELECT overtime_date AS day,coalesce(sum(overtime_hours),0) AS hours
      FROM overtime_entries entries
      JOIN users ON users.id=entries.user_id
      WHERE extract(year FROM overtime_date)=${year}
        AND lower(users.role) IN ('admin','teknik')
      GROUP BY overtime_date ORDER BY overtime_date
    `]);
  const byMonth = new Map(rows.map(row => [row.month, row]));
  return {
    status: "success", year,
    data: Array.from({ length: 12 }, (_, index) => ({
      bulan: index + 1, totalJam: Number(byMonth.get(index + 1)?.hours || 0),
      jumlahData: byMonth.get(index + 1)?.count || 0,
    })),
    daily:dailyRows.map(row=>({tanggal:dateKey(row.day),value:Number(row.hours||0)})),
  };
}

async function admin(request, env, body) {
  await requireSession(request, env, body, ["Admin"]);
  const year = Number(body.year) || new Date().getFullYear();
  const month = Number(body.month) || new Date().getMonth() + 1;
  const range = cutoff(year, month);
  const sql = database(env);
  const [rows, entryRows] = await Promise.all([
    sql`
      SELECT coalesce(users.full_name, entries.employee_name) AS name,
        coalesce(users.role, entries.role_snapshot) AS role,
        count(*)::integer AS count, sum(entries.overtime_hours) AS hours,
        sum(entries.total_wage) AS wage
      FROM overtime_entries entries
      LEFT JOIN users ON users.id=entries.user_id
      WHERE entries.overtime_date BETWEEN ${range.start}::date AND ${range.end}::date
      GROUP BY coalesce(users.full_name, entries.employee_name),
        coalesce(users.role, entries.role_snapshot)
      ORDER BY sum(entries.overtime_hours) DESC,
        coalesce(users.full_name, entries.employee_name)
    `,
    sql`
      SELECT entries.id, entries.overtime_date,
        coalesce(users.full_name, entries.employee_name) AS name,
        coalesce(users.role, entries.role_snapshot) AS role,
        entries.overtime_hours, entries.overtime_type, entries.total_wage,
        entries.notes
      FROM overtime_entries entries
      LEFT JOIN users ON users.id=entries.user_id
      WHERE entries.overtime_date BETWEEN ${range.start}::date AND ${range.end}::date
      ORDER BY entries.overtime_date DESC,
        coalesce(users.full_name, entries.employee_name), entries.recorded_at DESC
    `,
  ]);
  const data = rows.map(row => ({ nama: row.name, role: row.role, totalJam: Number(row.hours || 0), totalUpah: Number(row.wage || 0), jumlahData: row.count }));
  const entries = entryRows.map(row => ({
    id: row.id, tanggal: dateKey(row.overtime_date), nama: row.name || "-",
    role: row.role || "-", jam: Number(row.overtime_hours || 0),
    jenis: row.overtime_type || "", totalUpah: Number(row.total_wage || 0),
    keterangan: row.notes || "",
  }));
  return {
    status: "success", year, month,
    cutoff: { tanggalAwal: range.start, tanggalAkhir: range.end },
    summary: {
      jumlahKaryawan: data.length,
      totalJam: data.reduce((sum, row) => sum + row.totalJam, 0),
      totalUpah: data.reduce((sum, row) => sum + row.totalUpah, 0),
      jumlahData: data.reduce((sum, row) => sum + row.jumlahData, 0),
    }, data, entries,
  };
}

export async function handleOvertime({ request, env, body }) {
  const action = text(body.action) || "";
  if (action === "getOvertimeCalendar") return calendar(request, env, body);
  if (action === "saveOvertime") return save(request, env, body);
  if (action === "deleteOvertime") return remove(request, env, body);
  if (action === "getOvertimeChart") return chart(request, env, body);
  if (action === "getOvertimeAdmin") return admin(request, env, body);
  return null;
}
