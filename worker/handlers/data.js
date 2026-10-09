import {
  HttpError, database, dateKey, idDate, idDateTime, identity, isoDate,
  isoDateTime, number, required, requireSession, rowKey, text,
} from "../lib/core.js";
import { queueSystemNotification,sendSystemNotification } from "../lib/push.js";

export function calculatePartArrival(requestedQuantity,previousArrived,receivedNow,createRemainderBon=false) {
  const totalArrived=Number(previousArrived||0)+Number(receivedNow||0);
  const remainingQuantity=Math.max(0,Number(requestedQuantity||0)-totalArrived);
  const fulfilled=remainingQuantity<=0.000001;
  return{totalArrived,remainingQuantity,fulfilled,shouldClose:fulfilled||Boolean(createRemainderBon)};
}

const machineObject = row => ({
  id: row.id, Kategori: row.category || "Mesin", Jenis: row.machine_type || "", Nama: row.name,
  kategori: row.category || "Mesin", jenis: row.machine_type || "", nama: row.name,
});
const partObject = row => ({
  id: row.id, Kategori: row.category || "", Nama: row.name, Ukuran: row.size || "",
  Satuan:row.unit||"",
  "Jenis Komponen": row.component_type || "", kategori: row.category || "", nama: row.name,
  ukuran: row.size || "", satuan:row.unit||"", jenisKomponen: row.component_type || "",
  photoUrl:row.photo_url||"",photoPublicId:row.photo_public_id||"",photoBytes:Number(row.photo_bytes||0),
  photoWidth:Number(row.photo_width||0),photoHeight:Number(row.photo_height||0),
});

export async function machines(env) {
  const sql = database(env);
  return (await sql`SELECT id, category, machine_type, name FROM machines WHERE is_active ORDER BY category, machine_type, name`).map(machineObject);
}

export async function parts(env) {
  const sql = database(env);
  return (await sql`SELECT id, category, name, size, unit, component_type,photo_url,photo_public_id,photo_bytes,photo_width,photo_height FROM parts WHERE is_active ORDER BY category, name, size`).map(partObject);
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

async function createOrder(env, body,executionCtx) {
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
  queueSystemNotification(executionCtx,sendSystemNotification(env,{
    type:"order_new",title:"Order kerja baru",body:`${machineName} — ${problem}`,
    url:"./?open=orders",entityId:rows[0].id,
  }));
  return { status: "success", message: "Order kerja berhasil dibuat.", row: rows[0].id, rowIndex: rows[0].id, orderStatus: "Open" };
}

async function deleteOrders(request,env,body) {
  await requireSession(request,env,body,["Admin"]);
  const source=Array.isArray(body.orderIds)?body.orderIds:[];
  const orderIds=[...new Set(source.map(value=>text(value,100)).filter(Boolean))];
  if(!orderIds.length)throw new HttpError(400,"Pilih minimal satu order yang akan dihapus.");
  if(orderIds.length>250)throw new HttpError(400,"Maksimal 250 order dapat dihapus dalam satu proses.");
  const sql=database(env);
  const rows=await sql.query(
    `DELETE FROM work_orders
      WHERE id::text=ANY($1::text[])
         OR legacy_sheet_row::text=ANY($1::text[])
      RETURNING id`,
    [orderIds]
  );
  if(!rows.length)throw new HttpError(404,"Order yang dipilih tidak ditemukan.");
  return{status:"success",message:`${rows.length} order kerja berhasil dihapus.`,data:{deletedCount:rows.length}};
}

async function completeOrder(request, env, body,executionCtx) {
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
    ) SELECT id,machine_name FROM updated
  `;
  if (!rows.length) throw new HttpError(404, "Order tidak ditemukan.");
  queueSystemNotification(executionCtx,Promise.all([
    sendSystemNotification(env,{type:"order_close",title:"Order kerja Close",body:`${rows[0].machine_name||"Order kerja"} telah diselesaikan.`,url:"./?open=orders",entityId:rows[0].id}),
    sendSystemNotification(env,{type:"report_new",title:"Laporan kerja baru",body:`Laporan penyelesaian ${rows[0].machine_name||"order kerja"} telah disimpan.`,url:"./?open=jobs",entityId:`order-${rows[0].id}`}),
  ]));
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

const INDONESIAN_MONTH_MAP = {
  januari: 1, februari: 2, maret: 3, april: 4, mei: 5, juni: 6,
  juli: 7, agustus: 8, september: 9, oktober: 10, november: 11, desember: 12
};

function parseMonthPeriod(bulan, yearParam, monthParam) {
  if (yearParam && monthParam) {
    const y = Number(yearParam);
    const m = Number(monthParam);
    if (y && m >= 1 && m <= 12) {
      const startDate = `${y}-${String(m).padStart(2, "0")}-01`;
      const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
      const endDate = `${y}-${String(m).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
      return { startDate, endDate };
    }
  }
  if (!bulan) return null;
  const str = String(bulan).trim().toLowerCase();
  const isoMatch = str.match(/^(\d{4})-(\d{1,2})$/);
  if (isoMatch) {
    const y = Number(isoMatch[1]);
    const m = Number(isoMatch[2]);
    if (y && m >= 1 && m <= 12) {
      const startDate = `${y}-${String(m).padStart(2, "0")}-01`;
      const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
      const endDate = `${y}-${String(m).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
      return { startDate, endDate };
    }
  }
  const parts = str.split(/\s+/);
  if (parts.length >= 2) {
    const monthName = parts[0];
    const year = Number(parts[1]);
    const monthNum = INDONESIAN_MONTH_MAP[monthName];
    if (year && monthNum) {
      const startDate = `${year}-${String(monthNum).padStart(2, "0")}-01`;
      const lastDay = new Date(Date.UTC(year, monthNum, 0)).getUTCDate();
      const endDate = `${year}-${String(monthNum).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
      return { startDate, endDate };
    }
  }
  return null;
}

async function reports(env, params) {
  const sql = database(env);
  const limit = params.limit ? Math.min(Math.max(1, Number(params.limit)), 5000) : null;
  const start = isoDate(params.tglAwal);
  const end = isoDate(params.tglAkhir);
  const period = parseMonthPeriod(params.bulan, params.year, params.month);

  let rows;
  if (start && end) {
    rows = await sql`
      SELECT id, machine_id, part_id, report_date, department, machine_category, machine_type,
             machine_name, job_type, work_description, component_type, started_at, finished_at,
             total_hours, definition, spare_part_name, spare_part_size, order_type, order_status,
             repair_rating, notes, part_category, source_sheet
      FROM work_reports
      WHERE report_date >= ${start}::date AND report_date <= ${end}::date
      ORDER BY report_date DESC, created_at DESC
      ${limit ? sql`LIMIT ${limit}` : sql``}
    `;
  } else if (period) {
    rows = await sql`
      SELECT id, machine_id, part_id, report_date, department, machine_category, machine_type,
             machine_name, job_type, work_description, component_type, started_at, finished_at,
             total_hours, definition, spare_part_name, spare_part_size, order_type, order_status,
             repair_rating, notes, part_category, source_sheet
      FROM work_reports
      WHERE report_date >= ${period.startDate}::date AND report_date <= ${period.endDate}::date
      ORDER BY report_date DESC, created_at DESC
      ${limit ? sql`LIMIT ${limit}` : sql``}
    `;
  } else if (start && !end) {
    rows = await sql`
      SELECT id, machine_id, part_id, report_date, department, machine_category, machine_type,
             machine_name, job_type, work_description, component_type, started_at, finished_at,
             total_hours, definition, spare_part_name, spare_part_size, order_type, order_status,
             repair_rating, notes, part_category, source_sheet
      FROM work_reports
      WHERE report_date >= ${start}::date
      ORDER BY report_date DESC, created_at DESC
      ${limit ? sql`LIMIT ${limit}` : sql``}
    `;
  } else if (limit) {
    rows = await sql`
      SELECT id, machine_id, part_id, report_date, department, machine_category, machine_type,
             machine_name, job_type, work_description, component_type, started_at, finished_at,
             total_hours, definition, spare_part_name, spare_part_size, order_type, order_status,
             repair_rating, notes, part_category, source_sheet
      FROM work_reports
      ORDER BY report_date DESC, created_at DESC
      LIMIT ${limit}
    `;
  } else {
    rows = await sql`
      SELECT id, machine_id, part_id, report_date, department, machine_category, machine_type,
             machine_name, job_type, work_description, component_type, started_at, finished_at,
             total_hours, definition, spare_part_name, spare_part_size, order_type, order_status,
             repair_rating, notes, part_category, source_sheet
      FROM work_reports
      ORDER BY report_date DESC, created_at DESC
    `;
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

async function insertReport(request, env, body,executionCtx) {
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
  queueSystemNotification(executionCtx,sendSystemNotification(env,{
    type:"report_new",title:"Laporan kerja baru",body:`${required(body.namaMesin,"Nama mesin")} — ${required(body.laporan,"Laporan pekerjaan")}`,
    url:"./?open=jobs",entityId:rows[0].id,
  }));
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
  const unit = text(body.satuan)||"Pcs";
  const location = text(body.lokasi);
  const key = identity(category, name, size);
  const sql = database(env);
  const uploadedPhoto=await uploadMasterPartPhoto(env,body.photo);
  const safeLegacy={...body,photo:body.photo?{fileName:body.photo.fileName,mimeType:body.photo.mimeType,bytes:body.photo.bytes,width:body.photo.width,height:body.photo.height}:null};
  let rows = await sql`SELECT id,photo_public_id FROM parts WHERE identity_key=${key} LIMIT 1`;
  const duplicate = rows.length > 0;
  if (!rows.length) rows = await sql`
    INSERT INTO parts (category,name,size,unit,component_type,identity_key,photo_url,photo_public_id,photo_bytes,photo_width,photo_height,legacy_data)
    VALUES (${category},${name},${size},${unit},${text(body.jenisKomponen)},${key},${uploadedPhoto?.url||null},${uploadedPhoto?.publicId||null},${uploadedPhoto?.bytes||null},${uploadedPhoto?.width||null},${uploadedPhoto?.height||null},${JSON.stringify(safeLegacy)}::jsonb)
    RETURNING id
  `;
  else await sql`
    UPDATE parts SET
      unit=coalesce(nullif(${unit},''),unit),
      component_type=coalesce(nullif(${text(body.jenisKomponen)},''),component_type),
      photo_url=coalesce(${uploadedPhoto?.url||null},photo_url),photo_public_id=coalesce(${uploadedPhoto?.publicId||null},photo_public_id),
      photo_bytes=coalesce(${uploadedPhoto?.bytes||null},photo_bytes),photo_width=coalesce(${uploadedPhoto?.width||null},photo_width),photo_height=coalesce(${uploadedPhoto?.height||null},photo_height)
    WHERE id=${rows[0].id}
  `;
  const balance = await sql`SELECT id FROM inventory_balances WHERE part_id=${rows[0].id} LIMIT 1`;
  if (!balance.length) await sql`
    INSERT INTO inventory_balances (part_id,category,part_name,part_size,incoming_quantity,outgoing_quantity,current_quantity,unit,location,legacy_data)
    VALUES (${rows[0].id},${category},${name},${size},${number(body.stokAwal,0)},0,${number(body.stokAwal,0)},${unit},${location},${JSON.stringify(safeLegacy)}::jsonb)
  `;
  else await sql`UPDATE inventory_balances SET
    unit=${unit},
    location=coalesce(nullif(${location},''),location)
    WHERE id=${balance[0].id}`;
  if(uploadedPhoto&&rows[0]?.photo_public_id&&rows[0].photo_public_id!==uploadedPhoto.publicId)await destroyPartRequestPhoto(env,rows[0].photo_public_id);
  return { status:"success", message: duplicate ? "Master part sudah tersedia." : "Master part berhasil ditambahkan.", duplicate, stockSynced:true, data:{id:rows[0].id,photoUrl:uploadedPhoto?.url||""} };
}

async function resolvePartId(sql,partId) {
  if(!partId)return null;
  const target=String(partId).trim();
  let rows=await sql`SELECT id FROM parts WHERE id::text=${target} LIMIT 1`;
  if(rows.length)return rows[0].id;
  rows=await sql`SELECT part_id FROM inventory_balances WHERE id::text=${target} AND part_id IS NOT NULL LIMIT 1`;
  if(rows.length)return rows[0].part_id;
  const balance=await sql`SELECT id,category,part_name,part_size,unit,location FROM inventory_balances WHERE id::text=${target} LIMIT 1`;
  if(balance.length) {
    const key=identity(balance[0].category,balance[0].part_name,balance[0].part_size);
    let existingPart=await sql`SELECT id FROM parts WHERE identity_key=${key} LIMIT 1`;
    if(!existingPart.length) {
      existingPart=await sql`
        INSERT INTO parts (category,name,size,unit,identity_key)
        VALUES (${balance[0].category},${balance[0].part_name},${balance[0].part_size},${balance[0].unit||'Pcs'},${key})
        RETURNING id
      `;
    }
    await sql`UPDATE inventory_balances SET part_id=${existingPart[0].id} WHERE id=${balance[0].id}`;
    return existingPart[0].id;
  }
  return null;
}

async function updateMasterPart(request,env,body) {
  await requireSession(request,env,body,["Admin"]);
  const rawId=required(body.partId,"Identitas part");
  const category=required(body.kategori,"Kategori");
  const name=required(body.nama,"Nama part");
  const size=required(body.ukuran,"Ukuran");
  const unit=required(body.satuan,"Satuan");
  const location=text(body.lokasi);
  const componentType=text(body.jenisKomponen);
  const key=identity(category,name,size);
  const sql=database(env);
  const partId=await resolvePartId(sql,rawId);
  if(!partId)throw new HttpError(404,"Master part tidak ditemukan.");
  const duplicate=await sql`SELECT id FROM parts WHERE identity_key=${key} AND id<>${partId} LIMIT 1`;
  if(duplicate.length)throw new HttpError(409,"Part dengan kategori, nama, dan ukuran tersebut sudah tersedia.");
  const [partRows]=await sql.transaction([
    sql`UPDATE parts SET category=${category},name=${name},size=${size},unit=${unit},component_type=${componentType},identity_key=${key},updated_at=now() WHERE id=${partId} RETURNING id,category,name,size,unit,component_type`,
    sql`UPDATE inventory_balances SET category=${category},part_name=${name},part_size=${size},unit=${unit},location=${location},updated_at=now() WHERE part_id=${partId} OR id::text=${rawId} RETURNING id`,
  ]);
  if(!partRows.length)throw new HttpError(404,"Master part tidak ditemukan.");
  return{status:"success",message:"Detail master part berhasil diperbarui.",data:partObject(partRows[0])};
}

async function updateMasterPartPhoto(request,env,body){
  await requireSession(request,env,body,["Admin"]);
  const rawId=required(body.partId,"Identitas part"),photo=await uploadMasterPartPhoto(env,body.photo),sql=database(env);
  if(!photo)throw new HttpError(400,"Foto part belum dipilih.");
  const partId=await resolvePartId(sql,rawId);
  if(!partId){await destroyPartRequestPhoto(env,photo.publicId);throw new HttpError(404,"Master part tidak ditemukan.");}
  const rows=await sql`
    WITH previous AS (SELECT photo_public_id FROM parts WHERE id=${partId} FOR UPDATE),
    updated AS (
      UPDATE parts SET photo_url=${photo.url},photo_public_id=${photo.publicId},photo_bytes=${photo.bytes},photo_width=${photo.width},photo_height=${photo.height},updated_at=now()
      WHERE id=${partId} RETURNING id
    ) SELECT previous.photo_public_id FROM previous JOIN updated ON true`;
  if(!rows.length){await destroyPartRequestPhoto(env,photo.publicId);throw new HttpError(404,"Master part tidak ditemukan.");}
  if(rows[0].photo_public_id&&rows[0].photo_public_id!==photo.publicId)await destroyPartRequestPhoto(env,rows[0].photo_public_id);
  return{status:"success",message:"Foto referensi part berhasil disimpan.",data:{photoUrl:photo.url,photoBytes:photo.bytes,photoWidth:photo.width,photoHeight:photo.height}};
}

async function removeMasterPartPhoto(request,env,body){
  await requireSession(request,env,body,["Admin"]);
  const rawId=required(body.partId,"Identitas part"),sql=database(env);
  const partId=await resolvePartId(sql,rawId);
  if(!partId)throw new HttpError(404,"Master part tidak ditemukan.");
  const rows=await sql`
    WITH previous AS (SELECT photo_public_id FROM parts WHERE id=${partId} FOR UPDATE),
    updated AS (
      UPDATE parts SET photo_url=NULL,photo_public_id=NULL,photo_bytes=NULL,photo_width=NULL,photo_height=NULL,updated_at=now()
      WHERE id=${partId} RETURNING id
    ) SELECT previous.photo_public_id FROM previous JOIN updated ON true`;
  if(rows[0]?.photo_public_id)await destroyPartRequestPhoto(env,rows[0].photo_public_id);
  return{status:"success",message:"Foto referensi part dihapus."};
}

async function stock(env) {
  const sql = database(env);
  return (await sql`SELECT balances.*,parts.component_type,parts.photo_url,parts.photo_public_id,parts.photo_bytes,parts.photo_width,parts.photo_height FROM inventory_balances balances LEFT JOIN parts ON parts.id=balances.part_id ORDER BY balances.category,balances.part_name,balances.part_size`).map(row => ({
    id:row.id, partId:row.part_id||"", kategori:row.category||"", nama:row.part_name||"", ukuran:row.part_size||"",
    masuk:Number(row.incoming_quantity||0), keluar:Number(row.outgoing_quantity||0), stok:Number(row.current_quantity||0), satuan:row.unit||"", lokasi:row.location||"",
    photoUrl:row.photo_url||"",photoPublicId:row.photo_public_id||"",photoBytes:Number(row.photo_bytes||0),photoWidth:Number(row.photo_width||0),photoHeight:Number(row.photo_height||0),
    jenisKomponen:row.component_type||"",
    Kategori:row.category||"", Nama:row.part_name||"", Ukuran:row.part_size||"", Stok:Number(row.current_quantity||0), Satuan:row.unit||"", Lokasi:row.location||"",
  }));
}

async function stockUsage(env) {
  const sql=database(env);
  return (await sql`
    SELECT id,occurred_on,category,part_name,part_size,quantity,unit,used_for,machine_name,
      user_name,department,notes,created_at
    FROM stock_movements
    WHERE lower(movement_type)='usage'
    ORDER BY occurred_on DESC NULLS LAST,created_at DESC
    LIMIT 250
  `).map(row=>({
    id:row.id,tanggal:idDate(row.occurred_on),kategori:row.category||"",nama:row.part_name||"",
    ukuran:row.part_size||"",jumlah:Number(row.quantity||0),satuan:row.unit||"",
    kegunaan:row.used_for||"",mesin:row.machine_name||"",pemakai:row.user_name||"",
    bagian:row.department||"",keterangan:row.notes||"",dibuatPada:idDateTime(row.created_at),
  }));
}

async function useStock(request,env,body) {
  const profile=await requireSession(request,env,body,["Admin","Teknik","Gudang"]);
  const sql=database(env),partId=required(body.partId,"Nama part"),occurredOn=isoDate(body.tanggal);
  const quantity=number(body.jumlah),machineName=text(body.mesin),purpose=required(body.kegunaan,"Kegunaan");
  if(!occurredOn)throw new HttpError(400,"Tanggal pemakaian tidak valid.");
  if(!Number.isFinite(quantity)||quantity<=0)throw new HttpError(400,"Jumlah pemakaian harus lebih dari 0.");
  const delegated=["admin","gudang"].includes(String(profile.role||"").toLowerCase());
  let userName=profile.full_name,department=profile.department||"Teknik";
  if(delegated) {
    const requesterId=required(body.requesterId,"Pemakai");
    const userRows=await sql`
      SELECT full_name,department FROM users
      WHERE id::text=${requesterId} AND is_active AND lower(btrim(role))='teknik' LIMIT 1
    `;
    if(!userRows.length)throw new HttpError(400,"Pemakai harus pengguna aktif dengan role Teknik.");
    userName=userRows[0].full_name;department=userRows[0].department||"Teknik";
  }
  const isWorkshop=String(department).trim().toLowerCase().includes("bengkel");
  if(isWorkshop) {
    if(!machineName)throw new HttpError(400,"Nama Armada wajib dipilih untuk bagian Bengkel.");
    const machineRows=await sql`SELECT id FROM machines WHERE is_active AND lower(btrim(category))='armada' AND lower(name)=lower(${machineName}) LIMIT 1`;
    if(!machineRows.length)throw new HttpError(400,"Mesin/kebutuhan untuk bagian Bengkel harus berasal dari kategori Armada.");
  } else if(machineName) {
    const armadaRows=await sql`SELECT id FROM machines WHERE is_active AND lower(btrim(category))='armada' AND lower(name)=lower(${machineName}) LIMIT 1`;
    if(armadaRows.length)throw new HttpError(400,"Nama Armada hanya dapat dipilih untuk pemakai bagian Bengkel.");
  }
  const movementId=crypto.randomUUID();
  const legacyData=JSON.stringify({source:"Pemakaian Stok SiTeki",createdBy:profile.id,createdByName:profile.full_name});
  const rows=await sql`
    WITH selected AS (
      SELECT balances.id,balances.part_id,balances.category,balances.part_name,balances.part_size,
        balances.unit,balances.current_quantity
      FROM inventory_balances balances
      WHERE balances.part_id::text=${partId}
      LIMIT 1
    ), updated AS (
      UPDATE inventory_balances balances SET
        outgoing_quantity=coalesce(balances.outgoing_quantity,0)+${quantity},
        current_quantity=coalesce(balances.current_quantity,0)-${quantity}
      FROM selected
      WHERE balances.id=selected.id AND coalesce(balances.current_quantity,0)>=${quantity}
      RETURNING balances.id,balances.part_id,balances.category,balances.part_name,balances.part_size,
        balances.unit,balances.current_quantity
    ), inserted AS (
      INSERT INTO stock_movements(
        id,part_id,occurred_on,category,part_name,part_size,quantity,quantity_text,unit,
        used_for,machine_name,user_name,department,notes,movement_type,source_sheet,legacy_sheet_row,legacy_data
      ) SELECT
        ${movementId},updated.part_id,${occurredOn},updated.category,updated.part_name,updated.part_size,
        ${quantity},${String(quantity)},updated.unit,${purpose},${machineName},${userName},${department},
        ${text(body.keterangan)},'usage','SiTeki',NULL,${legacyData}::jsonb
      FROM updated
      RETURNING id
    )
    SELECT updated.part_name,updated.part_size,updated.unit,updated.current_quantity,inserted.id
    FROM updated JOIN inserted ON true
  `;
  if(!rows.length) {
    const balanceRows=await sql`SELECT current_quantity,unit FROM inventory_balances WHERE part_id::text=${partId} LIMIT 1`;
    if(!balanceRows.length)throw new HttpError(404,"Part tidak ditemukan pada stok.");
    throw new HttpError(409,`Stok tidak mencukupi. Tersedia ${Number(balanceRows[0].current_quantity||0).toLocaleString("id-ID")} ${balanceRows[0].unit||""}.`);
  }
  return{status:"success",message:`Pemakaian ${rows[0].part_name} berhasil dicatat. Sisa stok ${Number(rows[0].current_quantity||0).toLocaleString("id-ID")} ${rows[0].unit||""}.`,data:{id:rows[0].id,stock:Number(rows[0].current_quantity||0)}};
}

async function resetInventoryTestTransactions(request,env,body) {
  await requireSession(request,env,body,["Admin"]);
  if(String(body.confirmation||"").trim()!=="HAPUS DATA UJI COBA")throw new HttpError(400,"Konfirmasi penghapusan tidak sesuai.");
  const sql=database(env);
  const [countRows,transactionPhotos,itemPhotos]=await Promise.all([
    sql`SELECT
      (SELECT count(*)::integer FROM part_request_transactions) AS transactions,
      (SELECT count(*)::integer FROM part_requests) AS items,
      (SELECT count(*)::integer FROM stock_movements) AS movements`,
    sql`SELECT photo_public_id AS public_id FROM part_request_transactions WHERE nullif(btrim(photo_public_id),'') IS NOT NULL`,
    sql`SELECT sample_photo_public_id AS public_id FROM part_requests WHERE nullif(btrim(sample_photo_public_id),'') IS NOT NULL`,
  ]);
  const counts=countRows[0]||{transactions:0,items:0,movements:0};
  await sql.transaction([
    sql`DELETE FROM stock_movements`,
    sql`DELETE FROM part_requests`,
    sql`DELETE FROM part_request_transactions`,
    sql`UPDATE inventory_balances SET incoming_quantity=0,outgoing_quantity=0,current_quantity=0`,
  ]);
  const publicIds=[...transactionPhotos,...itemPhotos].map(row=>row.public_id).filter(Boolean);
  const photoResults=await Promise.allSettled(publicIds.map(publicId=>destroyPartRequestPhoto(env,publicId)));
  const photosRemoved=photoResults.filter(result=>result.status==="fulfilled"&&result.value).length;
  return{status:"success",message:"Seluruh transaksi uji coba Bon Pesan, stok, dan pemakaian berhasil dihapus.",data:{...counts,balancesReset:true,photosRemoved,photoCount:publicIds.length}};
}

async function partRequests(env) {
  const sql = database(env);
  return (await sql`
    SELECT requests.*, transactions.request_number, transactions.photo_url,
      transactions.photo_public_id, transactions.photo_bytes, transactions.photo_width,
      transactions.photo_height, transactions.scan_enhanced, transactions.item_count,
      transactions.notes AS transaction_notes, transactions.status AS transaction_status
    FROM part_requests requests
    LEFT JOIN part_request_transactions transactions ON transactions.id=requests.transaction_id
    ORDER BY requests.requested_on DESC NULLS LAST, requests.transaction_id NULLS LAST,
      requests.item_position NULLS LAST, requests.created_at DESC
  `).map(row => ({
    id:row.id, tanggal:idDate(row.requested_on), tglPesan:idDate(row.requested_on), kategori:row.category||"",
    nama:row.part_name||"", ukuran:row.part_size||"", keterangan:row.notes||"", kegunaan:row.purpose||"",
    jmlPesan:Number(row.requested_quantity||0), bagian:row.department||"", pemesan:row.requester_name||"",
    mesin:row.machine_name||"", tglDatang:idDate(row.arrived_on), jmlDatang:Number(row.arrived_quantity||0), status:row.status,
    arrivedAt:"",arrivedAtLabel:idDate(row.arrived_on),
    transactionStatus:row.transaction_status||row.status,
    transactionId:row.transaction_id||"", transactionNumber:row.request_number||"", itemPosition:Number(row.item_position||0),
    itemCount:Number(row.item_count||1), photoUrl:row.photo_url||"", photoPublicId:row.photo_public_id||"",
    photoBytes:Number(row.photo_bytes||0), photoWidth:Number(row.photo_width||0), photoHeight:Number(row.photo_height||0),
    samplePhotoUrl:row.sample_photo_url||"",samplePhotoPublicId:row.sample_photo_public_id||"",
    samplePhotoBytes:Number(row.sample_photo_bytes||0),samplePhotoWidth:Number(row.sample_photo_width||0),samplePhotoHeight:Number(row.sample_photo_height||0),
    scanEnhanced:Boolean(row.scan_enhanced), transactionNotes:row.transaction_notes||"",
  }));
}

async function partMetadata(env) {
  const sql = database(env);
  const [rawPartRows, machineRows] = await Promise.all([
    sql`
      SELECT parts.id, parts.category, parts.name, parts.size, parts.component_type,parts.photo_url,parts.photo_public_id,parts.photo_bytes,parts.photo_width,parts.photo_height,
        coalesce(nullif(parts.unit,''),balance.unit,'') AS unit
      FROM parts
      LEFT JOIN LATERAL (
        SELECT unit FROM inventory_balances
        WHERE inventory_balances.part_id=parts.id
        ORDER BY inventory_balances.updated_at DESC NULLS LAST
        LIMIT 1
      ) balance ON true
      WHERE parts.is_active
      ORDER BY parts.category,parts.name,parts.size
    `,
    machines(env),
  ]);
  const partRows=rawPartRows.map(row=>({
    ...partObject(row),satuan:row.unit||"",Satuan:row.unit||"",
  }));
  const departments = await sql`SELECT DISTINCT department FROM users WHERE department IS NOT NULL ORDER BY department`;
  const requesters = await sql`
    SELECT id, full_name, department
    FROM users
    WHERE is_active AND lower(btrim(role))='teknik'
    ORDER BY full_name
  `;
  return {
    status:"success", stok:partRows, bagian:departments.map(row=>row.department),
    mesin:machineRows.map(row=>row.Nama), pemesan:requesters.map(row=>row.full_name),
    mesinDetail:machineRows,
    pemesanTeknik:requesters.map(row=>({
      id:row.id,nama:row.full_name,bagian:row.department||"Teknik",
    })),
    cloudinaryEnabled:Boolean(env.CLOUDINARY_CLOUD_NAME&&env.CLOUDINARY_API_KEY&&env.CLOUDINARY_API_SECRET),
    maxItems:10,
  };
}

async function sha1(value) {
  const digest=await crypto.subtle.digest("SHA-1",new TextEncoder().encode(String(value)));
  return [...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,"0")).join("");
}

async function uploadPartRequestPhoto(env, photo, requestNumber) {
  if (!photo?.dataUrl) return null;
  if (!env.CLOUDINARY_CLOUD_NAME||!env.CLOUDINARY_API_KEY||!env.CLOUDINARY_API_SECRET) {
    throw new HttpError(503,"Cloudinary belum dikonfigurasi pada Worker.");
  }
  const dataUrl=String(photo.dataUrl);
  const match=dataUrl.match(/^data:image\/(jpeg|png|webp|avif);base64,([a-zA-Z0-9+/=]+)$/);
  if (!match) throw new HttpError(400,"Format foto bon tidak valid.");
  const estimatedBytes=Math.floor(match[2].length*3/4);
  if (estimatedBytes>1_500_000) throw new HttpError(400,"Foto hasil kompresi maksimal 1,5 MB.");

  const timestamp=Math.floor(Date.now()/1000);
  const folder=text(env.CLOUDINARY_BON_FOLDER,200)||"siteki/bon-pesan";
  const publicId=String(requestNumber).toLowerCase();
  const signature=await sha1(`folder=${folder}&public_id=${publicId}&timestamp=${timestamp}${env.CLOUDINARY_API_SECRET}`);
  const form=new FormData();
  form.append("file",dataUrl);
  form.append("api_key",env.CLOUDINARY_API_KEY);
  form.append("timestamp",String(timestamp));
  form.append("folder",folder);
  form.append("public_id",publicId);
  form.append("signature",signature);
  const response=await fetch(`https://api.cloudinary.com/v1_1/${encodeURIComponent(env.CLOUDINARY_CLOUD_NAME)}/image/upload`,{
    method:"POST",body:form,
  });
  const result=await response.json().catch(()=>({}));
  if (!response.ok||!result.secure_url) {
    throw new HttpError(502,result?.error?.message||"Foto bon gagal diunggah ke Cloudinary.");
  }
  return {
    url:result.secure_url,publicId:result.public_id,bytes:Number(result.bytes||estimatedBytes),
    width:Number(result.width||photo.width||0),height:Number(result.height||photo.height||0),
  };
}

async function uploadMasterPartPhoto(env,photo){
  if(!photo?.dataUrl)return null;
  if(!env.CLOUDINARY_CLOUD_NAME||!env.CLOUDINARY_API_KEY||!env.CLOUDINARY_API_SECRET)throw new HttpError(503,"Cloudinary belum dikonfigurasi pada Worker.");
  const dataUrl=String(photo.dataUrl),match=dataUrl.match(/^data:image\/(jpeg|png|webp|avif);base64,([a-zA-Z0-9+/=]+)$/);
  if(!match)throw new HttpError(400,"Format foto referensi part tidak valid.");
  const estimatedBytes=Math.floor(match[2].length*3/4);
  if(estimatedBytes>500_000)throw new HttpError(400,"Foto referensi hasil kompresi maksimal 500 KB.");
  const timestamp=Math.floor(Date.now()/1000),folder="siteki/part-references",publicId=`part-${crypto.randomUUID()}`;
  const signature=await sha1(`folder=${folder}&public_id=${publicId}&timestamp=${timestamp}${env.CLOUDINARY_API_SECRET}`);
  const form=new FormData();
  form.append("file",dataUrl);form.append("api_key",env.CLOUDINARY_API_KEY);form.append("timestamp",String(timestamp));
  form.append("folder",folder);form.append("public_id",publicId);form.append("signature",signature);
  const response=await fetch(`https://api.cloudinary.com/v1_1/${encodeURIComponent(env.CLOUDINARY_CLOUD_NAME)}/image/upload`,{method:"POST",body:form});
  const result=await response.json().catch(()=>({}));
  if(!response.ok||!result.secure_url)throw new HttpError(502,result?.error?.message||"Foto referensi part gagal diunggah ke Cloudinary.");
  return{url:result.secure_url,publicId:result.public_id,bytes:Number(result.bytes||estimatedBytes),width:Number(result.width||photo.width||0),height:Number(result.height||photo.height||0)};
}

async function destroyPartRequestPhoto(env, publicId) {
  if(!publicId||!env.CLOUDINARY_CLOUD_NAME||!env.CLOUDINARY_API_KEY||!env.CLOUDINARY_API_SECRET)return false;
  const timestamp=Math.floor(Date.now()/1000);
  const signature=await sha1(`public_id=${publicId}&timestamp=${timestamp}${env.CLOUDINARY_API_SECRET}`);
  const form=new FormData();
  form.append("public_id",publicId);form.append("api_key",env.CLOUDINARY_API_KEY);
  form.append("timestamp",String(timestamp));form.append("signature",signature);
  const response=await fetch(`https://api.cloudinary.com/v1_1/${encodeURIComponent(env.CLOUDINARY_CLOUD_NAME)}/image/destroy`,{method:"POST",body:form});
  return response.ok;
}

async function updatePartOrder(request,env,body) {
  await requireSession(request,env,body,["Admin"]);
  const sql=database(env),transactionId=required(body.transactionId,"ID transaksi");
  const requestedOn=isoDate(body.tglPesan);
  if(!requestedOn)throw new HttpError(400,"Tanggal pesan tidak valid.");
  const requesterName=required(body.pemesan,"Pemesan");
  const requesterRows=await sql`
    SELECT full_name,department FROM users
    WHERE is_active AND lower(btrim(role))='teknik' AND lower(full_name)=lower(${requesterName})
    ORDER BY full_name LIMIT 1
  `;
  if(!requesterRows.length)throw new HttpError(400,"Pemesan harus pengguna aktif dari bagian Teknik.");
  const requester=requesterRows[0].full_name,department=requesterRows[0].department||"Teknik";
  let machine=text(body.mesin);
  if(String(department).trim().toLowerCase().includes("bengkel")) {
    machine=required(machine,"Nama armada");
    const machineRows=await sql`SELECT name FROM machines WHERE is_active AND lower(btrim(category))='armada' AND lower(name)=lower(${machine}) LIMIT 1`;
    if(!machineRows.length)throw new HttpError(400,"Mesin/kebutuhan harus dipilih dari kategori Armada.");
    machine=machineRows[0].name;
  }
  let sourceItems=body.items;
  if(typeof sourceItems==="string")try{sourceItems=JSON.parse(sourceItems);}catch{throw new HttpError(400,"Daftar barang tidak valid.");}
  if(!Array.isArray(sourceItems)||!sourceItems.length||sourceItems.length>10)throw new HttpError(400,"Bon harus memiliki 1 sampai 10 barang.");
  const currentItems=await sql`SELECT id::text AS id FROM part_requests WHERE transaction_id::text=${transactionId}`;
  const currentIds=new Set(currentItems.map(item=>item.id));
  const items=sourceItems.map((item,index)=>({
    id:required(item.id,`ID barang ${index+1}`),quantity:number(item.jmlPesan),purpose:text(item.kegunaan),
  }));
  if(items.length!==currentIds.size||items.some(item=>!currentIds.has(item.id)))throw new HttpError(400,"Daftar barang transaksi tidak cocok.");
  if(items.some(item=>!Number.isFinite(item.quantity)||item.quantity<=0))throw new HttpError(400,"Jumlah setiap barang harus lebih dari 0.");
  const notes=text(body.keterangan);
  const queries=[sql`
    UPDATE part_request_transactions SET requested_on=${requestedOn},requester_name=${requester},department=${department},
      machine_name=${machine},notes=${notes}
    WHERE id::text=${transactionId}
  `];
  items.forEach(item=>queries.push(sql`
    UPDATE part_requests SET requested_on=${requestedOn},requester_name=${requester},department=${department},
      machine_name=${machine},purpose=${item.purpose},requested_quantity=${item.quantity},
      requested_quantity_text=${String(item.quantity)}
    WHERE id::text=${item.id} AND transaction_id::text=${transactionId}
  `));
  await sql.transaction(queries);
  return{status:"success",message:"Bon Pesan berhasil diperbarui."};
}

async function deletePartOrder(request,env,body) {
  await requireSession(request,env,body,["Admin"]);
  const sql=database(env),transactionId=required(body.transactionId,"ID transaksi");
  const rows=await sql`SELECT request_number,photo_public_id FROM part_request_transactions WHERE id::text=${transactionId} LIMIT 1`;
  if(!rows.length)throw new HttpError(404,"Transaksi Bon Pesan tidak ditemukan.");
  const itemPhotoRows=await sql`SELECT sample_photo_public_id FROM part_requests WHERE transaction_id::text=${transactionId} AND sample_photo_public_id IS NOT NULL`;
  const received=await sql`
    SELECT movements.part_id,sum(movements.quantity)::numeric AS quantity,max(balances.current_quantity)::numeric AS current_quantity
    FROM stock_movements movements
    JOIN part_requests requests ON requests.id=movements.part_request_id
    LEFT JOIN inventory_balances balances ON balances.part_id=movements.part_id
    WHERE requests.transaction_id::text=${transactionId}
    GROUP BY movements.part_id
  `;
  if(received.some(row=>Number(row.current_quantity||0)<Number(row.quantity||0)))throw new HttpError(409,"Bon tidak dapat dihapus karena sebagian stok yang diterima sudah digunakan.");
  await sql.transaction([
    sql`UPDATE inventory_balances balances SET
      incoming_quantity=coalesce(balances.incoming_quantity,0)-received.quantity,
      current_quantity=coalesce(balances.current_quantity,0)-received.quantity
      FROM (SELECT movements.part_id,sum(movements.quantity)::numeric AS quantity FROM stock_movements movements
        JOIN part_requests requests ON requests.id=movements.part_request_id
        WHERE requests.transaction_id::text=${transactionId} GROUP BY movements.part_id) received
      WHERE balances.part_id=received.part_id`,
    sql`DELETE FROM stock_movements movements USING part_requests requests
      WHERE movements.part_request_id=requests.id AND requests.transaction_id::text=${transactionId}`,
    sql`DELETE FROM part_requests WHERE transaction_id::text=${transactionId}`,
    sql`DELETE FROM part_request_transactions WHERE id::text=${transactionId}`,
  ]);
  const photoRemovalResults=await Promise.allSettled([
    destroyPartRequestPhoto(env,rows[0].photo_public_id),
    ...itemPhotoRows.map(item=>destroyPartRequestPhoto(env,item.sample_photo_public_id)),
  ]);
  const photosRemoved=photoRemovalResults.filter(result=>result.status==="fulfilled"&&result.value).length;
  return{status:"success",message:`Bon ${rows[0].request_number} berhasil dihapus.`,data:{photoRemoved:photosRemoved>0,photosRemoved}};
}

async function closePartRequestItem(request,env,body,executionCtx) {
  const profile=await requireSession(request,env,body,["Admin"]);
  const sql=database(env),itemId=required(body.itemId,"ID barang"),arrivedOn=isoDate(body.tglDatang);
  if(!arrivedOn)throw new HttpError(400,"Tanggal datang tidak valid. Gunakan format dd/mm/yyyy.");
  const itemRows=await sql`
    SELECT requests.id,requests.transaction_id,requests.part_id,requests.requested_quantity,
      requests.arrived_quantity,requests.status,requests.requester_name,requests.notes,
      requests.category,requests.part_name,requests.part_size,requests.purpose,requests.machine_name,
      requests.department,transactions.request_number,transactions.notes AS transaction_notes,
      coalesce(nullif(parts.unit,''),balances.unit,'') AS unit
    FROM part_requests requests
    JOIN part_request_transactions transactions ON transactions.id=requests.transaction_id
    LEFT JOIN parts ON parts.id=requests.part_id
    LEFT JOIN inventory_balances balances ON balances.part_id=requests.part_id
    WHERE requests.id::text=${itemId} AND requests.transaction_id IS NOT NULL LIMIT 1
  `;
  if(!itemRows.length)throw new HttpError(404,"Item Bon Pesan tidak ditemukan.");
  const item=itemRows[0];
  if(String(item.status||"").toLowerCase()==="close")throw new HttpError(409,"Item ini sudah Close dan tidak dapat menerima kedatangan lagi.");
  const receivedNow=number(body.jmlDatang),previousArrived=Number(item.arrived_quantity||0);
  const requestedQuantity=Number(item.requested_quantity||0),epsilon=0.000001;
  const createRemainderBon=body.createRemainderBon===true||String(body.createRemainderBon||"").toLowerCase()==="true";
  const arrivalPlan=calculatePartArrival(requestedQuantity,previousArrived,receivedNow,createRemainderBon);
  const arrivedQuantity=arrivalPlan.totalArrived,remainingQuantity=arrivalPlan.remainingQuantity;
  if(!Number.isFinite(receivedNow)||receivedNow<=0)throw new HttpError(400,"Jumlah datang harus lebih dari 0.");
  if(arrivedQuantity-requestedQuantity>epsilon)throw new HttpError(400,`Jumlah datang melebihi sisa pesanan ${Math.max(0,requestedQuantity-previousArrived).toLocaleString("id-ID")} ${item.unit||""}.`);
  if(!item.part_id)throw new HttpError(409,"Item belum terhubung ke master Stok Part.");
  const movementRows=await sql`SELECT id,quantity FROM stock_movements WHERE part_request_id=${item.id} LIMIT 1`;
  const previousQuantity=Number(movementRows[0]?.quantity||0),delta=arrivedQuantity-previousQuantity;
  const balanceRows=await sql`SELECT id,current_quantity FROM inventory_balances WHERE part_id=${item.part_id} LIMIT 1`;
  if(balanceRows.length&&Number(balanceRows[0].current_quantity||0)+delta<0)throw new HttpError(409,"Koreksi jumlah ditolak karena stok tersebut sudah digunakan.");
  const shouldClose=arrivalPlan.shouldClose;
  const movementData=JSON.stringify({source:"Bon Pesan",partRequestId:item.id,requestNumber:item.request_number,partial:!shouldClose});
  const queries=[
    sql`UPDATE part_requests SET arrived_at=NULL,arrived_on=${arrivedOn},
      arrived_quantity=${arrivedQuantity},arrived_quantity_text=${String(arrivedQuantity)},status=${shouldClose?"Close":"Open"}
      WHERE id=${item.id}`,
    sql`UPDATE part_request_transactions SET status=CASE WHEN EXISTS(
      SELECT 1 FROM part_requests WHERE transaction_id=${item.transaction_id} AND lower(status)<>'close'
    ) THEN 'Open' ELSE 'Close' END WHERE id=${item.transaction_id}`,
    balanceRows.length
      ? sql`UPDATE inventory_balances SET incoming_quantity=coalesce(incoming_quantity,0)+${delta},current_quantity=coalesce(current_quantity,0)+${delta},unit=coalesce(nullif(unit,''),${item.unit}) WHERE id=${balanceRows[0].id}`
      : sql`INSERT INTO inventory_balances(part_id,category,part_name,part_size,incoming_quantity,outgoing_quantity,current_quantity,unit,legacy_data) VALUES(${item.part_id},${item.category},${item.part_name},${item.part_size},${arrivedQuantity},0,${arrivedQuantity},${item.unit},${movementData}::jsonb)`,
    sql`INSERT INTO stock_movements(part_request_id,part_id,occurred_on,category,part_name,part_size,quantity,quantity_text,unit,used_for,machine_name,user_name,department,notes,movement_type,source_sheet,legacy_data)
      VALUES(${item.id},${item.part_id},${arrivedOn},${item.category},${item.part_name},${item.part_size},${arrivedQuantity},${String(arrivedQuantity)},${item.unit},${item.purpose},${item.machine_name},${profile.full_name},${item.department},${`Penerimaan ${item.request_number}`},'receipt','Bon Pesan',${movementData}::jsonb)
      ON CONFLICT(part_request_id) DO UPDATE SET occurred_on=excluded.occurred_on,quantity=excluded.quantity,quantity_text=excluded.quantity_text,unit=excluded.unit,user_name=excluded.user_name,notes=excluded.notes,legacy_data=excluded.legacy_data`,
  ];
  let newRequestNumber="";
  if(createRemainderBon&&remainingQuantity>epsilon) {
    const transactionId=crypto.randomUUID(),newItemId=crypto.randomUUID();
    newRequestNumber=`BON-${arrivedOn.replaceAll("-","")}-${transactionId.slice(0,6).toUpperCase()}`;
    const reorderNote=`Bon ulang sisa ${remainingQuantity.toLocaleString("id-ID")} ${item.unit||""} dari ${item.request_number}`;
    queries.push(
      sql`UPDATE part_requests SET legacy_data=coalesce(legacy_data,'{}'::jsonb)||${JSON.stringify({reorderedTo:newRequestNumber,reorderedQuantity:remainingQuantity})}::jsonb WHERE id=${item.id}`,
      sql`INSERT INTO part_request_transactions(
        id,request_number,requested_on,requester_name,department,machine_name,notes,item_count,status,created_by
      ) VALUES(
        ${transactionId},${newRequestNumber},${arrivedOn},${item.requester_name},${item.department},${item.machine_name},${reorderNote},1,'Open',${profile.id}
      )`,
      sql`INSERT INTO part_requests(
        id,part_id,transaction_id,item_position,requested_on,category,part_name,part_size,notes,purpose,
        requested_quantity,requested_quantity_text,department,requester_name,machine_name,status,
        source_sheet,legacy_sheet_row,legacy_data
      ) VALUES(
        ${newItemId},${item.part_id},${transactionId},1,${arrivedOn},${item.category},${item.part_name},${item.part_size},${item.notes},${item.purpose},
        ${remainingQuantity},${String(remainingQuantity)},${item.department},${item.requester_name},${item.machine_name},'Open',
        'Neon API',NULL,${JSON.stringify({source:"Bon ulang",sourceRequestNumber:item.request_number,sourceItemId:item.id})}::jsonb
      )`
    );
  }
  await sql.transaction(queries);
  const transactionRows=await sql`SELECT status FROM part_request_transactions WHERE id=${item.transaction_id} LIMIT 1`;
  if(String(transactionRows[0]?.status||"").toLowerCase()==="close")queueSystemNotification(executionCtx,sendSystemNotification(env,{
    type:"bon_close",title:"Bon Pesan Close",body:`${item.request_number} telah selesai; seluruh barang sudah datang.`,
    url:"./?open=partRequests",entityId:item.transaction_id,
  }));
  if(newRequestNumber)queueSystemNotification(executionCtx,sendSystemNotification(env,{
    type:"bon_new",title:"Bon Pesan baru",body:`${newRequestNumber} dibuat untuk sisa ${item.part_name}.`,
    url:"./?open=partRequests",entityId:newRequestNumber,
  }));
  const status=shouldClose?"Close":"Open";
  const message=newRequestNumber
    ? `Kedatangan dicatat dan ${newRequestNumber} dibuat untuk sisa ${remainingQuantity.toLocaleString("id-ID")} ${item.unit||""}.`
    : `Kedatangan dicatat. Total datang ${arrivedQuantity.toLocaleString("id-ID")} dari ${requestedQuantity.toLocaleString("id-ID")} ${item.unit||""}; status ${status}.`;
  return{status:"success",message,data:{status,arrivedQuantity,remainingQuantity,newRequestNumber}};
}

async function submitPartOrder(request, env, body,executionCtx) {
  const profile=await requireSession(request, env, body);
  const sql=database(env);
  const requestedOn = isoDate(body.tglPesan);
  if (!requestedOn) throw new HttpError(400,"Tanggal pesan tidak valid.");
  let sourceItems=body.items;
  if (typeof sourceItems==="string") {
    try { sourceItems=JSON.parse(sourceItems); }
    catch { throw new HttpError(400,"Daftar barang tidak valid."); }
  }
  if (!Array.isArray(sourceItems)) sourceItems=[body];
  if (!sourceItems.length||sourceItems.length>10) throw new HttpError(400,"Satu bon harus berisi 1 sampai 10 barang.");
  const items=sourceItems.map((item,index)=>({
    partId:text(item.partId,100),
    category:required(item.kategori,`Kategori barang ${index+1}`),
    name:required(item.nama,`Nama barang ${index+1}`),
    size:text(item.ukuran),
    quantity:number(item.jmlPesan),
    unit:text(item.satuan),
    purpose:text(item.kegunaan),
    samplePhoto:item.samplePhoto?.dataUrl?item.samplePhoto:null,
  }));
  if (items.some(item=>!Number.isFinite(item.quantity)||item.quantity<=0)) {
    throw new HttpError(400,"Jumlah setiap barang harus lebih dari 0.");
  }
  const isAdmin=String(profile.role||"").toLowerCase()==="admin";
  let requester;
  let requestDepartment;
  if(isAdmin) {
    const requesterId=required(body.requesterId,"Pemesan");
    const requesterRows=await sql`
      SELECT full_name,department
      FROM users
      WHERE id::text=${requesterId} AND is_active AND lower(btrim(role))='teknik'
      LIMIT 1
    `;
    if(!requesterRows.length)throw new HttpError(400,"Pemesan harus pengguna aktif dari bagian Teknik.");
    requester=requesterRows[0].full_name;
    requestDepartment=requesterRows[0].department||"Teknik";
  } else {
    requester=required(profile.full_name,"Nama akun");
    requestDepartment=profile.department||text(body.bagian)||"Teknik";
  }
  const isWorkshop=String(requestDepartment).trim().toLowerCase().includes("bengkel");
  let requestMachine=text(body.mesin);
  if(isWorkshop) {
    requestMachine=required(body.mesin,"Nama armada");
    const machineRows=await sql`
      SELECT name FROM machines
      WHERE is_active AND lower(btrim(category))='armada' AND lower(name)=lower(${requestMachine})
      LIMIT 1
    `;
    if(!machineRows.length)throw new HttpError(400,"Mesin/kebutuhan harus dipilih dari kategori Armada.");
    requestMachine=machineRows[0].name;
  }
  const transactionId=crypto.randomUUID();
  const requestNumber=`BON-${requestedOn.replaceAll("-","")}-${transactionId.slice(0,6).toUpperCase()}`;
  const partIds=[];
  for (const item of items) {
    const matched=item.partId
      ? await sql`
          SELECT parts.id,parts.category,parts.name,parts.size,coalesce(nullif(parts.unit,''),balance.unit,'') AS unit
          FROM parts
          LEFT JOIN LATERAL (
            SELECT unit FROM inventory_balances WHERE inventory_balances.part_id=parts.id
            ORDER BY inventory_balances.updated_at DESC NULLS LAST LIMIT 1
          ) balance ON true
          WHERE parts.id::text=${item.partId} AND parts.is_active LIMIT 1
        `
      : await sql`
          SELECT parts.id,parts.category,parts.name,parts.size,coalesce(nullif(parts.unit,''),balance.unit,'') AS unit
          FROM parts
          LEFT JOIN LATERAL (
            SELECT unit FROM inventory_balances WHERE inventory_balances.part_id=parts.id
            ORDER BY inventory_balances.updated_at DESC NULLS LAST LIMIT 1
          ) balance ON true
          WHERE lower(parts.name)=lower(${item.name}) AND lower(coalesce(parts.size,''))=lower(${item.size||""})
          ORDER BY (lower(coalesce(parts.category,''))=lower(${item.category})) DESC LIMIT 1
        `;
    if(item.partId&&!matched.length)throw new HttpError(400,`Master barang ${item.name} tidak ditemukan atau sudah tidak aktif.`);
    if(matched.length) {
      item.category=matched[0].category||"";item.name=matched[0].name||"";
      item.size=matched[0].size||"";item.unit=matched[0].unit||"";
    }
    partIds.push(matched[0]?.id||null);
  }
  const photo=await uploadPartRequestPhoto(env,body.photo,requestNumber);
  const itemPhotoResults=await Promise.allSettled(items.map((item,index)=>
    uploadPartRequestPhoto(env,item.samplePhoto,`${requestNumber}-item-${String(index+1).padStart(2,"0")}`)
  ));
  const failedItemPhoto=itemPhotoResults.find(result=>result.status==="rejected");
  if(failedItemPhoto) {
    await Promise.allSettled([
      destroyPartRequestPhoto(env,photo?.publicId),
      ...itemPhotoResults.filter(result=>result.status==="fulfilled").map(result=>destroyPartRequestPhoto(env,result.value?.publicId)),
    ]);
    throw failedItemPhoto.reason;
  }
  const itemPhotos=itemPhotoResults.map(result=>result.value);
  const sharedLegacy={
    tglPesan:body.tglPesan,pemesan:requester,bagian:requestDepartment,mesin:requestMachine,
    keterangan:body.keterangan,status:body.status,itemCount:items.length,
    photo:body.photo?{
      fileName:body.photo.fileName,mimeType:body.photo.mimeType,bytes:body.photo.bytes,
      originalBytes:body.photo.originalBytes,width:body.photo.width,height:body.photo.height,
      quality:body.photo.quality,compressionRatio:body.photo.compressionRatio,
      documentDetected:Boolean(body.photo.documentDetected),cropConfidence:body.photo.cropConfidence,
      scanEnhanced:Boolean(body.photo.scanEnhanced),
    }:null,
  };
  const queries=[sql`
    INSERT INTO part_request_transactions (
      id,request_number,requested_on,requester_name,department,machine_name,notes,
      photo_url,photo_public_id,photo_bytes,photo_width,photo_height,scan_enhanced,
      item_count,status,created_by
    ) VALUES (
      ${transactionId},${requestNumber},${requestedOn},${requester},${requestDepartment},${requestMachine},${text(body.keterangan)},
      ${photo?.url||null},${photo?.publicId||null},${photo?.bytes||null},${photo?.width||null},${photo?.height||null},${Boolean(body.photo?.scanEnhanced)},
      ${items.length},'Open',${profile.id}
    ) RETURNING id
  `];
  items.forEach((item,index)=>queries.push(sql`
    INSERT INTO part_requests (
      part_id,transaction_id,item_position,requested_on,category,part_name,part_size,purpose,
      requested_quantity,requested_quantity_text,department,requester_name,machine_name,status,
      sample_photo_url,sample_photo_public_id,sample_photo_bytes,sample_photo_width,sample_photo_height,
      source_sheet,legacy_sheet_row,legacy_data
    ) VALUES (
      ${partIds[index]},${transactionId},${index+1},${requestedOn},${item.category},${item.name},${item.size},${item.purpose},
      ${item.quantity},${String(item.quantity)},${requestDepartment},${requester},${requestMachine},'Open',
      ${itemPhotos[index]?.url||null},${itemPhotos[index]?.publicId||null},${itemPhotos[index]?.bytes||null},${itemPhotos[index]?.width||null},${itemPhotos[index]?.height||null},
      'Neon API',NULL,${JSON.stringify({...sharedLegacy,item:{...item,samplePhoto:item.samplePhoto?{
        fileName:item.samplePhoto.fileName,mimeType:item.samplePhoto.mimeType,bytes:item.samplePhoto.bytes,
        originalBytes:item.samplePhoto.originalBytes,width:item.samplePhoto.width,height:item.samplePhoto.height,
        quality:item.samplePhoto.quality,compressionRatio:item.samplePhoto.compressionRatio,
      }:null},itemPosition:index+1})}::jsonb
    ) RETURNING id
  `));
  try {
    await sql.transaction(queries);
  } catch(error) {
    await Promise.allSettled([destroyPartRequestPhoto(env,photo?.publicId),...itemPhotos.map(itemPhoto=>destroyPartRequestPhoto(env,itemPhoto?.publicId))]);
    throw error;
  }
  queueSystemNotification(executionCtx,sendSystemNotification(env,{
    type:"bon_new",title:"Bon Pesan baru",body:`${requestNumber} — ${items.length} barang untuk ${requester}.`,
    url:"./?open=partRequests",entityId:transactionId,
  }));
  return {
    status:"success",message:`Bon ${requestNumber} berhasil disimpan dengan ${items.length} barang.`,
    data:{id:transactionId,requestNumber,itemCount:items.length,photoUrl:photo?.url||""},
  };
}

export async function handleData({ request, env, url, resource, body,executionCtx }) {
  const params=Object.fromEntries(url.searchParams);
  const action=text(request.method==="POST"?body.action:params.action)||"";
  if(resource==="machines"||resource==="maintenance-master") return machines(env);
  if(resource==="parts") return parts(env);
  if(resource==="orders") {
    if(request.method==="GET") return getOrders(env,params);
    if(action==="complete") return completeOrder(request,env,body,executionCtx);
    if(action==="deleteOrders") return deleteOrders(request,env,body);
    return createOrder(env,body,executionCtx);
  }
  if(resource==="jobs") {
    if(request.method==="GET") {
      if(action==="getCapabilities") return {status:"success",version:"neon-1",capabilities:["getDataLapKerja","getMachines","getParts","getKPI","updateReport","deleteReport","addMasterPart","updateMasterPart"]};
      return reports(env,params);
    }
    if(action==="updateReport") return updateReport(request,env,body);
    if(action==="deleteReport") return deleteReport(request,env,body);
    if(action==="addMasterPart") return addMasterPart(request,env,body);
    if(action==="updateMasterPart") return updateMasterPart(request,env,body);
    if(action==="updateMasterPartPhoto")return updateMasterPartPhoto(request,env,body);
    if(action==="removeMasterPartPhoto")return removeMasterPartPhoto(request,env,body);
    return insertReport(request,env,body,executionCtx);
  }
  if(resource==="stock") {
    if(request.method==="GET"&&action==="getUsage")return stockUsage(env);
    if(request.method==="POST"&&action==="useStock")return useStock(request,env,body);
    if(request.method==="POST"&&action==="resetTestTransactions")return resetInventoryTestTransactions(request,env,body);
    return stock(env);
  }
  if(resource==="part-requests") return partRequests(env);
  if(resource==="part-order") {
    if(request.method==="GET")return partMetadata(env);
    if(action==="updateOrder")return updatePartOrder(request,env,body);
    if(action==="deleteOrder")return deletePartOrder(request,env,body);
    if(action==="closeItem")return closePartRequestItem(request,env,body,executionCtx);
    return submitPartOrder(request,env,body,executionCtx);
  }
  return null;
}
