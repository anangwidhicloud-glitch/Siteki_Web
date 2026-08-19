import {
  HttpError, database, dateKey, idDate, idDateTime, identity, isoDate,
  isoDateTime, number, required, requireSession, rowKey, text,
} from "../lib/core.js";

const machineObject = row => ({
  id: row.id, Kategori: row.category || "Mesin", Jenis: row.machine_type || "", Nama: row.name,
  kategori: row.category || "Mesin", jenis: row.machine_type || "", nama: row.name,
});
const partObject = row => ({
  id: row.id, Kategori: row.category || "", Nama: row.name, Ukuran: row.size || "",
  "Jenis Komponen": row.component_type || "", kategori: row.category || "", nama: row.name,
  ukuran: row.size || "", jenisKomponen: row.component_type || "",
});

export async function machines(env) {
  const sql = database(env);
  return (await sql`SELECT id, category, machine_type, name FROM machines WHERE is_active ORDER BY category, machine_type, name`).map(machineObject);
}

export async function parts(env) {
  const sql = database(env);
  return (await sql`SELECT id, category, name, size, component_type FROM parts WHERE is_active ORDER BY category, name, size`).map(partObject);
}

function orderObject(row) {
  return {
    id: row.id, rowIndex: rowKey(row), row: rowKey(row),
    tanggal: idDateTime(row.ordered_at), tanggal_order: idDateTime(row.ordered_at),
    bagianOrder: row.requester_department || "", namaOrder: row.requester_name || "",
    bagianTujuan: row.assigned_department || "", kategoriMesin: row.machine_category || "",
    jenis: row.machine_type || "", namaMesin: row.machine_name || "",
    jenisPekerjaan: row.job_type || "", kerusakan: row.problem_description || "",
    urgensi: row.urgency || "", perbaikanDilakukan: row.repair_action || "",
    jamMulai: idDateTime(row.started_at), jamSelesai: idDateTime(row.finished_at),
    statusMesin: row.machine_status || "", totalJam: Number(row.total_hours || 0),
    status: row.order_status || "Open", nilaiPerbaikan: row.repair_rating || "",
    sparePart: row.spare_part_name || "", ukuranSparePart: row.spare_part_size || "",
    keterangan: row.notes || "",
  };
}

async function getOrders(env, params) {
  const sql = database(env);
  const rows = await sql`SELECT * FROM work_orders ORDER BY ordered_at DESC`;
  const includeClosed = String(params.includeClosed || params.all || "") === "1";
  return rows.filter(row => includeClosed || String(row.order_status).toLowerCase() === "open").map(orderObject);
}

async function createOrder(env, body) {
  const department = required(body.bagianOrder, "Bagian order");
  const requester = required(body.namaOrder, "Nama pengorder");
  const assigned = required(body.bagianTujuan, "Bagian tujuan");
  const machineName = required(body.namaMesin, "Nama mesin");
  const machineType = required(body.jenis, "Jenis mesin");
  const jobType = required(body.jenisPekerjaan, "Jenis pekerjaan");
  const problem = required(body.kerusakan, "Kerusakan/permasalahan");
  const urgency = text(body.urgensi) || "Biasa";
  const category = assigned === "Bengkel" ? "Armada" : "Mesin";
  const sql = database(env);
  const machineRows = await sql`
    SELECT id FROM machines WHERE lower(name)=lower(${machineName})
    ORDER BY (lower(coalesce(machine_type,''))=lower(${machineType})) DESC LIMIT 1
  `;
  const rows = await sql`
    INSERT INTO work_orders (
      requester_department, requester_name, assigned_department, machine_category,
      machine_type, machine_name, job_type, problem_description, urgency,
      order_status, machine_id, source_name, legacy_data
    ) VALUES (
      ${department}, ${requester}, ${assigned}, ${category}, ${machineType}, ${machineName},
      ${jobType}, ${problem}, ${urgency}, 'Open', ${machineRows[0]?.id || null},
      'Neon API', ${JSON.stringify(body)}::jsonb
    ) RETURNING id
  `;
  return { status: "success", message: "Order kerja berhasil dibuat.", row: rows[0].id, rowIndex: rows[0].id, orderStatus: "Open" };
}

async function completeOrder(request, env, body) {
  await requireSession(request, env, body);
  const key = required(body.rowIndex, "Identitas order");
  const repair = required(body.perbaikanDilakukan, "Perbaikan yang dilakukan");
  const startedAt = isoDateTime(body.jamMulai);
  const finishedAt = isoDateTime(body.jamSelesai);
  if (!startedAt || !finishedAt) throw new HttpError(400, "Format waktu tidak valid.");
  const totalHours = (new Date(finishedAt).getTime() - new Date(startedAt).getTime()) / 3_600_000;
  if (totalHours < 0) throw new HttpError(400, "Waktu selesai tidak boleh sebelum waktu mulai.");
  const sql = database(env);
  const rows = await sql`
    WITH updated AS (
      UPDATE work_orders SET
        repair_action=${repair}, started_at=${startedAt}, finished_at=${finishedAt},
        machine_status=${required(body.statusMesin, "Status mesin")}, total_hours=${totalHours},
        order_status='Closed', repair_rating=${text(body.nilaiPerbaikan) || "Bagus"},
        spare_part_name=${text(body.sparePart) || "Tidak Pakai"},
        spare_part_size=${text(body.ukuranSparePart) || "Tidak Pakai"}, notes=${text(body.keterangan)}
      WHERE id::text=${key} OR legacy_sheet_row::text=${key}
      RETURNING *
    ), report AS (
      INSERT INTO work_reports (
        work_order_id, machine_id, report_date, department, machine_category, machine_type,
        machine_name, job_type, work_description, started_at, finished_at, total_hours,
        spare_part_name, spare_part_size, order_type, order_status, repair_rating, notes,
        source_sheet, legacy_sheet_row, legacy_data
      ) SELECT id, machine_id, (${startedAt}::timestamptz AT TIME ZONE 'Asia/Jakarta')::date,
        assigned_department, machine_category, machine_type, machine_name, job_type, ${repair},
        ${startedAt}, ${finishedAt}, ${totalHours}, ${text(body.sparePart)}, ${text(body.ukuranSparePart)},
        'Dengan Order', 'Closed', ${text(body.nilaiPerbaikan) || "Bagus"}, ${text(body.keterangan)},
        'Neon API', NULL, ${JSON.stringify(body)}::jsonb FROM updated
      ON CONFLICT DO NOTHING RETURNING id
    ) SELECT id FROM updated
  `;
  if (!rows.length) throw new HttpError(404, "Order tidak ditemukan.");
  return { status: "success", message: "Order berhasil diselesaikan.", rowIndex: key, orderStatus: "Closed", reportSync: { synced: true } };
}

function reportObject(row) {
  return {
    id: row.id, rowIndex: rowKey(row), sheetName: row.source_sheet || "Neon API", sheetId: "neon",
    tanggal: idDate(row.report_date), bagian: row.department || "",
    kategoriMesin: row.machine_category || "", jenis: row.machine_type || "",
    mesin: row.machine_name || "", namaMesin: row.machine_name || "",
    jenisPekerjaan: row.job_type || "", laporan: row.work_description || "",
    laporanPekerjaan: row.work_description || "", jenisKomponen: row.component_type || "",
    jamMulai: idDateTime(row.started_at), jamSelesai: idDateTime(row.finished_at),
    totalJam: Number(row.total_hours || 0), definisi: row.definition || "",
    sparepart: row.spare_part_name || "", ukuranPart: row.spare_part_size || "",
    order: row.order_type || "", statusOrder: row.order_status || "",
    nilaiPerbaikan: row.repair_rating || "", keterangan: row.notes || "",
    partKategori: row.part_category || "",
  };
}

async function reports(env, params) {
  const sql = database(env);
  let rows = await sql`SELECT * FROM work_reports ORDER BY report_date DESC, created_at DESC`;
  const start = isoDate(params.tglAwal);
  const end = isoDate(params.tglAkhir);
  if (start) rows = rows.filter(row => dateKey(row.report_date) >= start);
  if (end) rows = rows.filter(row => dateKey(row.report_date) <= end);
  if (params.bulan) {
    const query = String(params.bulan).toLocaleLowerCase("id-ID");
    rows = rows.filter(row => new Intl.DateTimeFormat("id-ID", { month: "long", year: "numeric", timeZone: "UTC" })
      .format(new Date(`${dateKey(row.report_date)}T00:00:00Z`)).toLocaleLowerCase("id-ID") === query);
  }
  return rows.map(reportObject);
}

async function findMachineAndPart(sql, body) {
  const machine = await sql`SELECT id FROM machines WHERE lower(name)=lower(${text(body.namaMesin) || ""}) LIMIT 1`;
  const partName = text(body.partNama || body.sparepart);
  const partSize = text(body.partUkuran || body.ukuranPart);
  const part = partName && partName.toLowerCase() !== "tidak pakai"
    ? await sql`SELECT id FROM parts WHERE lower(name)=lower(${partName}) AND lower(coalesce(size,''))=lower(${partSize || ""}) LIMIT 1`
    : [];
  return { machineId: machine[0]?.id || null, partId: part[0]?.id || null };
}

async function insertReport(request, env, body) {
  await requireSession(request, env, body);
  const reportDate = isoDate(body.tanggal);
  if (!reportDate) throw new HttpError(400, "Tanggal laporan tidak valid.");
  const startedAt = isoDateTime(body.jamMulai);
  const finishedAt = isoDateTime(body.jamSelesai);
  const hours = number(body.totalJam, startedAt && finishedAt ? (new Date(finishedAt)-new Date(startedAt))/3_600_000 : null);
  const sql = database(env);
  const refs = await findMachineAndPart(sql, body);
  const rows = await sql`
    INSERT INTO work_reports (
      machine_id, part_id, report_date, department, machine_category, machine_type,
      machine_name, job_type, work_description, component_type, started_at, finished_at,
      total_hours, definition, spare_part_name, spare_part_size, order_type, order_status,
      repair_rating, notes, is_new_machine, is_new_part, part_category,
      source_sheet, legacy_sheet_row, legacy_data
    ) VALUES (
      ${refs.machineId}, ${refs.partId}, ${reportDate}, ${text(body.bagian)}, ${text(body.kategoriMesin)},
      ${text(body.jenis)}, ${required(body.namaMesin, "Nama mesin")}, ${text(body.jenisPekerjaan)},
      ${required(body.laporan, "Laporan pekerjaan")}, ${text(body.jenisKomponen)}, ${startedAt}, ${finishedAt},
      ${hours}, ${text(body.definisi)}, ${text(body.sparepart)}, ${text(body.ukuranPart)}, ${text(body.order)},
      ${text(body.statusOrder)}, ${text(body.nilaiPerbaikan)}, ${text(body.keterangan)}, false, false,
      ${text(body.partKategori)}, 'Neon API', NULL, ${JSON.stringify(body)}::jsonb
    ) RETURNING id
  `;
  return { status: "success", message: "Laporan kerja berhasil disimpan.", id: rows[0].id, rowIndex: rows[0].id };
}

async function updateReport(request, env, body) {
  await requireSession(request, env, body, ["Admin"]);
  const key = required(body.rowIndex, "Identitas laporan");
  const sql = database(env);
  const refs = await findMachineAndPart(sql, body);
  const rows = await sql`
    UPDATE work_reports SET
      report_date=coalesce(${isoDate(body.tanggal)}::date,report_date), department=${text(body.bagian)},
      machine_category=${text(body.kategoriMesin)}, machine_type=${text(body.jenis)},
      machine_name=${text(body.namaMesin)}, machine_id=coalesce(${refs.machineId}::uuid,machine_id),
      job_type=${text(body.jenisPekerjaan)}, work_description=${text(body.laporan)},
      component_type=${text(body.jenisKomponen)}, started_at=${isoDateTime(body.jamMulai)},
      finished_at=${isoDateTime(body.jamSelesai)}, total_hours=${number(body.totalJam)},
      definition=${text(body.definisi)}, spare_part_name=${text(body.sparepart)},
      spare_part_size=${text(body.ukuranPart)}, part_id=${refs.partId}, order_type=${text(body.order)},
      order_status=${text(body.statusOrder)}, repair_rating=${text(body.nilaiPerbaikan)},
      notes=${text(body.keterangan)}, part_category=${text(body.partKategori)}
    WHERE id::text=${key} OR legacy_sheet_row::text=${key} RETURNING id
  `;
  if (!rows.length) throw new HttpError(404, "Laporan tidak ditemukan.");
  return { status: "success", message: "Laporan kerja berhasil diperbarui." };
}

async function deleteReport(request, env, body) {
  await requireSession(request, env, body, ["Admin"]);
  const key = required(body.rowIndex, "Identitas laporan");
  const sql = database(env);
  const rows = await sql`DELETE FROM work_reports WHERE id::text=${key} OR legacy_sheet_row::text=${key} RETURNING id`;
  if (!rows.length) throw new HttpError(404, "Laporan tidak ditemukan.");
  return { status: "success", message: "Laporan kerja berhasil dihapus." };
}

async function addMasterPart(request, env, body) {
  await requireSession(request, env, body, ["Admin"]);
  const category = required(body.kategori, "Kategori");
  const name = required(body.nama, "Nama part");
  const size = required(body.ukuran, "Ukuran");
  const key = identity(category, name, size);
  const sql = database(env);
  let rows = await sql`SELECT id FROM parts WHERE identity_key=${key} LIMIT 1`;
  const duplicate = rows.length > 0;
  if (!rows.length) rows = await sql`
    INSERT INTO parts (category,name,size,component_type,identity_key,legacy_data)
    VALUES (${category},${name},${size},${text(body.jenisKomponen)},${key},${JSON.stringify(body)}::jsonb)
    RETURNING id
  `;
  const balance = await sql`SELECT id FROM inventory_balances WHERE part_id=${rows[0].id} LIMIT 1`;
  if (!balance.length) await sql`
    INSERT INTO inventory_balances (part_id,category,part_name,part_size,incoming_quantity,outgoing_quantity,current_quantity,unit,legacy_data)
    VALUES (${rows[0].id},${category},${name},${size},${number(body.stokAwal,0)},0,${number(body.stokAwal,0)},${text(body.satuan)||"Pcs"},${JSON.stringify(body)}::jsonb)
  `;
  return { status:"success", message: duplicate ? "Master part sudah tersedia." : "Master part berhasil ditambahkan.", duplicate, stockSynced:true, data:{id:rows[0].id} };
}

async function stock(env) {
  const sql = database(env);
  return (await sql`SELECT * FROM inventory_balances ORDER BY category,part_name,part_size`).map(row => ({
    id:row.id, kategori:row.category||"", nama:row.part_name||"", ukuran:row.part_size||"",
    masuk:Number(row.incoming_quantity||0), keluar:Number(row.outgoing_quantity||0), stok:Number(row.current_quantity||0), satuan:row.unit||"",
    Kategori:row.category||"", Nama:row.part_name||"", Ukuran:row.part_size||"", Stok:Number(row.current_quantity||0), Satuan:row.unit||"",
  }));
}

async function partRequests(env) {
  const sql = database(env);
  return (await sql`SELECT * FROM part_requests ORDER BY requested_on DESC NULLS LAST,created_at DESC`).map(row => ({
    id:row.id, tanggal:idDate(row.requested_on), tglPesan:idDate(row.requested_on), kategori:row.category||"",
    nama:row.part_name||"", ukuran:row.part_size||"", keterangan:row.notes||"", kegunaan:row.purpose||"",
    jmlPesan:Number(row.requested_quantity||0), bagian:row.department||"", pemesan:row.requester_name||"",
    mesin:row.machine_name||"", tglDatang:idDate(row.arrived_on), jmlDatang:Number(row.arrived_quantity||0), status:row.status,
  }));
}

async function partMetadata(env) {
  const [partRows, machineRows] = await Promise.all([parts(env), machines(env)]);
  const sql = database(env);
  const departments = await sql`SELECT DISTINCT department FROM users WHERE department IS NOT NULL ORDER BY department`;
  const requesters = await sql`SELECT full_name FROM users WHERE is_active ORDER BY full_name`;
  return { status:"success", stok:partRows, bagian:departments.map(row=>row.department), mesin:machineRows.map(row=>row.Nama), pemesan:requesters.map(row=>row.full_name) };
}

async function submitPartOrder(request, env, body) {
  await requireSession(request, env, body);
  const requestedOn = isoDate(body.tglPesan);
  if (!requestedOn) throw new HttpError(400,"Tanggal pesan tidak valid.");
  const category=required(body.kategori,"Kategori"), name=required(body.nama,"Nama part"), size=text(body.ukuran);
  const sql=database(env);
  const partRows=await sql`SELECT id FROM parts WHERE lower(name)=lower(${name}) AND lower(coalesce(size,''))=lower(${size||""}) ORDER BY (lower(coalesce(category,''))=lower(${category})) DESC LIMIT 1`;
  const rows=await sql`
    INSERT INTO part_requests (part_id,requested_on,category,part_name,part_size,purpose,requested_quantity,requested_quantity_text,department,requester_name,machine_name,status,source_sheet,legacy_sheet_row,legacy_data)
    VALUES (${partRows[0]?.id||null},${requestedOn},${category},${name},${size},${text(body.kegunaan)},${number(body.jmlPesan)},${String(body.jmlPesan||"")},${text(body.bagian)},${required(body.pemesan,"Pemesan")},${text(body.mesin)},${text(body.status)||"Open"},'Neon API',NULL,${JSON.stringify(body)}::jsonb)
    RETURNING id
  `;
  return {status:"success",message:"Order part berhasil disimpan.",data:{id:rows[0].id}};
}

export async function handleData({ request, env, url, resource, body }) {
  const params=Object.fromEntries(url.searchParams);
  const action=text(request.method==="POST"?body.action:params.action)||"";
  if(resource==="machines"||resource==="maintenance-master") return machines(env);
  if(resource==="parts") return parts(env);
  if(resource==="orders") {
    if(request.method==="GET") return getOrders(env,params);
    if(action==="complete") return completeOrder(request,env,body);
    return createOrder(env,body);
  }
  if(resource==="jobs") {
    if(request.method==="GET") {
      if(action==="getCapabilities") return {status:"success",version:"neon-1",capabilities:["getDataLapKerja","getMachines","getParts","getKPI","updateReport","deleteReport","addMasterPart"]};
      return reports(env,params);
    }
    if(action==="updateReport") return updateReport(request,env,body);
    if(action==="deleteReport") return deleteReport(request,env,body);
    if(action==="addMasterPart") return addMasterPart(request,env,body);
    return insertReport(request,env,body);
  }
  if(resource==="stock") return stock(env);
  if(resource==="part-requests") return partRequests(env);
  if(resource==="part-order") return request.method==="GET"?partMetadata(env):submitPartOrder(request,env,body);
  return null;
}
