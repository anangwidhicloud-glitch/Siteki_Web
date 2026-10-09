import {
  HttpError, database, dateKey, idDate, idDateTime, isoDate, isoDateTime,
  number, required, requireSession, rowKey, text,
} from "../lib/core.js";
import { calculateElectricityAssessment, summarizeMonthlyReactiveEnergy } from "../../src/lib/electricity.js";
import { queueSystemNotification,sendSystemNotification } from "../lib/push.js";

function cleanNotes(notes) {
  if (!notes) return "";
  const parts = String(notes).split(/\s*—\s*/).map(p => p.trim()).filter(Boolean);
  return parts.filter((p, i) => parts.indexOf(p) === i).join(" — ");
}

function maintenanceObject(row) {
  const legacy = row.legacy_data && typeof row.legacy_data === "object" ? row.legacy_data : {};
  const noteContent = cleanNotes(row.notes || legacy.keterangan || legacy.hasil_pemeriksaan || "");
  return {
    id:row.id, rowIndex:rowKey(row), tanggal:idDate(row.inspected_on),
    kategori:row.machine_category||"", jenis:row.machine_type||"",
    nama_mesin:row.machine_name||"", nama:row.machine_name||"",
    waktu:row.schedule_code||(/bulanan/i.test(row.maintenance_type||"")?"B":"M"),
    jenis_perawatan:row.schedule_code||row.maintenance_type||"",
    kondisi_mesin:legacy.kondisi_mesin||legacy.kondisi||"",
    hasil_pemeriksaan:noteContent, keterangan:noteContent,
  };
}

async function getMaintenance(env, params = {}) {
  const sql = database(env);
  const days = params.days ? Number(params.days) : null;
  const limit = params.limit ? Math.min(Math.max(1, Number(params.limit)), 5000) : null;
  let rows;
  if (days && Number.isFinite(days)) {
    rows = await sql`
      SELECT * FROM maintenance_inspections
      WHERE inspected_on >= CURRENT_DATE - (${days} * INTERVAL '1 day')
      ORDER BY inspected_on DESC, created_at DESC
      ${limit ? sql`LIMIT ${limit}` : sql``}
    `;
  } else if (limit) {
    rows = await sql`
      SELECT * FROM maintenance_inspections
      ORDER BY inspected_on DESC, created_at DESC
      LIMIT ${limit}
    `;
  } else {
    rows = await sql`SELECT * FROM maintenance_inspections ORDER BY inspected_on, created_at`;
  }
  return rows.map(maintenanceObject);
}

async function getMaintenancePrintData(request,env) {
  await requireSession(request,env);
  const sql=database(env);
  const rows=await sql`
    SELECT inspection.*,
      coalesce(jsonb_agg(jsonb_build_object(
        'name',item.name,
        'sort_order',item.sort_order,
        'status',result.status,
        'raw_status',coalesce(result.raw_status,
          CASE result.status
            WHEN 'good' THEN 'Bagus'
            WHEN 'repair_needed' THEN 'Perbaikan'
            WHEN 'not_applicable' THEN 'T.A'
            ELSE result.status
          END)
      ) ORDER BY item.sort_order,item.name) FILTER (WHERE item.id IS NOT NULL),'[]'::jsonb) AS checks
    FROM maintenance_inspections inspection
    LEFT JOIN maintenance_check_results result ON result.inspection_id=inspection.id
    LEFT JOIN maintenance_check_items item ON item.id=result.item_id
    GROUP BY inspection.id
    ORDER BY inspection.inspected_on DESC,inspection.machine_category,inspection.machine_type,inspection.machine_name
  `;
  return {status:"success",data:rows.map(row=>({
    ...maintenanceObject(row),tanggal_iso:dateKey(row.inspected_on),
    kategori:row.machine_category||"",jenis:row.machine_type||"",
    nama_mesin:row.machine_name||"",perawatan:row.maintenance_type||row.schedule_code||"",
    checks:Array.isArray(row.checks)?row.checks:[],
  }))};
}

async function getInspectionChecks(request, env, inspectionId) {
  if (!inspectionId) throw new HttpError(400, "ID perawatan diperlukan.");
  const sql = database(env);
  const rows = await sql`
    SELECT 
      item.name,
      item.sort_order,
      result.status,
      coalesce(result.raw_status,
        CASE result.status
          WHEN 'good' THEN 'Bagus'
          WHEN 'repair_needed' THEN 'Perbaikan'
          WHEN 'not_applicable' THEN 'T.A'
          ELSE result.status
        END) AS raw_status
    FROM maintenance_check_results result
    JOIN maintenance_check_items item ON item.id = result.item_id
    WHERE result.inspection_id = ${inspectionId}
    ORDER BY item.sort_order, item.name
  `;
  return {
    status: "success",
    data: rows.map(r => ({
      name: r.name,
      sort_order: r.sort_order,
      status: r.status,
      raw_status: r.raw_status
    }))
  };
}

async function syncInspectionCheckResults(sql, inspectionId, category, checks, defaultCondition) {
  const rawChecks = Array.isArray(checks) ? checks : [];
  if (rawChecks.length > 0) {
    const existingItems = await sql`
      SELECT id, lower(btrim(name)) AS name_lower, sort_order
      FROM maintenance_check_items
      WHERE lower(btrim(machine_category)) = lower(btrim(${category}))
    `;
    const existingMap = new Map();
    existingItems.forEach(item => existingMap.set(item.name_lower, item.id));

    for (let index = 0; index < rawChecks.length; index += 1) {
      const check = rawChecks[index];
      const itemName = text(check.name);
      if (!itemName) continue;
      const key = itemName.toLowerCase().trim();
      if (!existingMap.has(key)) {
        const sortOrder = Number(check.sort_order ?? check.sortOrder ?? index + 1);
        const newItem = await sql`
          INSERT INTO maintenance_check_items (machine_category, name, sort_order)
          VALUES (${category}, ${itemName}, ${sortOrder})
          ON CONFLICT (machine_category, name, sort_order) DO UPDATE SET is_active=true
          RETURNING id, lower(btrim(name)) AS name_lower
        `;
        if (newItem[0]?.id) {
          existingMap.set(newItem[0].name_lower, newItem[0].id);
        }
      }
    }

    const resultsToInsert = [];
    for (let index = 0; index < rawChecks.length; index += 1) {
      const check = rawChecks[index];
      const itemName = text(check.name);
      if (!itemName) continue;
      const key = itemName.toLowerCase().trim();
      const itemId = existingMap.get(key);
      if (!itemId) continue;

      const rawStatus = text(check.raw_status || check.rawStatus || check.status) || "Bagus";
      const status = /repair|perbaikan|rusak/i.test(rawStatus)
        ? "repair_needed"
        : /not_applicable|t\.a|tidak ada|tidak berlaku|^x$/i.test(rawStatus)
        ? "not_applicable"
        : /baik|bagus|normal/i.test(rawStatus)
        ? "good"
        : "other";

      resultsToInsert.push({
        inspection_id: inspectionId,
        item_id: itemId,
        status,
        raw_status: rawStatus
      });
    }

    if (resultsToInsert.length > 0) {
      await sql`
        INSERT INTO maintenance_check_results (inspection_id, item_id, status, raw_status)
        SELECT
          r.inspection_id::uuid,
          r.item_id::uuid,
          r.status,
          r.raw_status
        FROM jsonb_to_recordset(${JSON.stringify(resultsToInsert)}::jsonb) AS r(
          inspection_id uuid,
          item_id uuid,
          status text,
          raw_status text
        )
        ON CONFLICT (inspection_id, item_id) DO UPDATE
        SET status = excluded.status,
            raw_status = excluded.raw_status
      `;
    }
  } else if (defaultCondition) {
    const items = await sql`
      INSERT INTO maintenance_check_items (machine_category, name, sort_order)
      VALUES (${category}, 'Kondisi mesin (input web)', 9999)
      ON CONFLICT (machine_category, name, sort_order) DO UPDATE SET is_active=true
      RETURNING id
    `;
    const status = /baik|bagus|normal/i.test(defaultCondition) ? "good" : "repair_needed";
    await sql`
      INSERT INTO maintenance_check_results (inspection_id, item_id, status, raw_status)
      VALUES (${inspectionId}, ${items[0].id}, ${status}, ${defaultCondition})
      ON CONFLICT (inspection_id, item_id) DO UPDATE SET status=excluded.status, raw_status=excluded.raw_status
    `;
  }
}

async function saveMaintenance(request,env,body) {
  await requireSession(request,env,body);
  const inspectedOn=isoDate(body.tanggal);
  if(!inspectedOn) throw new HttpError(400,"Tanggal perawatan tidak valid.");
  const category=text(body.kategori)||"Mesin", type=text(body.jenis), name=required(body.nama_mesin,"Nama mesin");
  const code=text(body.waktu)||"M", maintenanceType=code.toUpperCase()==="B"?"Bulanan":"Mingguan";
  const rawNotes=[text(body.keterangan),text(body.hasil_pemeriksaan)].filter(Boolean).join(" — ");
  const notes=cleanNotes(rawNotes)||null;
  const sql=database(env);

  // Pengaman kuota perawatan bulanan: 3x Mingguan dan 1x Bulanan
  const monthCounts = await sql`
    SELECT 
      count(*) FILTER (WHERE upper(coalesce(schedule_code,'')) = 'B' OR lower(coalesce(maintenance_type,'')) LIKE '%bulanan%')::int AS count_b,
      count(*) FILTER (WHERE upper(coalesce(schedule_code,'')) != 'B' AND lower(coalesce(maintenance_type,'')) NOT LIKE '%bulanan%')::int AS count_m
    FROM maintenance_inspections
    WHERE lower(btrim(machine_name)) = lower(btrim(${name}))
      AND date_trunc('month', inspected_on::date) = date_trunc('month', ${inspectedOn}::date)
  `;
  const countB = Number(monthCounts[0]?.count_b || 0);
  const countM = Number(monthCounts[0]?.count_m || 0);
  if (countM >= 3 && countB >= 1) {
    throw new HttpError(400, `Mesin ${name} sudah mencapai batas maksimal perawatan untuk bulan ini (3x Mingguan dan 1x Bulanan). Perawatan tidak dapat ditambah lagi.`);
  }

  const machine=await sql`SELECT id, category, machine_type FROM machines WHERE lower(name)=lower(${name}) ORDER BY (lower(coalesce(machine_type,''))=lower(${type||""})) DESC LIMIT 1`;
  const resolvedCategory = category && category !== "Mesin" ? category : (machine[0]?.category || category || "Mesin");
  const resolvedType = type || machine[0]?.machine_type || "";
  const plan=await sql`SELECT id FROM maintenance_plans WHERE planned_on=${inspectedOn}::date AND lower(machine_name)=lower(${name}) ORDER BY (lower(coalesce(schedule_code,''))=lower(${code})) DESC LIMIT 1`;
  const rows=await sql`
    INSERT INTO maintenance_inspections (plan_id,machine_id,inspected_on,machine_category,machine_type,machine_name,schedule_code,maintenance_type,notes,source_sheet,legacy_sheet_row,legacy_data)
    VALUES (${plan[0]?.id||null},${machine[0]?.id||null},${inspectedOn},${resolvedCategory},${resolvedType},${name},${code},${maintenanceType},${notes},'Neon API',NULL,${JSON.stringify(body)}::jsonb)
    RETURNING id
  `;
  const condition=text(body.kondisi_mesin||body.kondisi);
  await syncInspectionCheckResults(sql, rows[0].id, resolvedCategory, body.checks, condition);
  return {status:"success",message:"Data perawatan berhasil disimpan.",data:{id:rows[0].id}};
}

async function updateMaintenance(request,env,body) {
  await requireSession(request,env,body,["Admin"]);
  const id=required(body.id,"ID perawatan");
  const inspectedOn=isoDate(body.tanggal);
  if(!inspectedOn) throw new HttpError(400,"Tanggal perawatan tidak valid.");
  const category=text(body.kategori)||"Mesin", type=text(body.jenis), name=required(body.nama_mesin,"Nama mesin");
  const code=text(body.waktu)||"M", maintenanceType=code.toUpperCase()==="B"?"Bulanan":"Mingguan";
  const rawNotes=[text(body.keterangan),text(body.hasil_pemeriksaan)].filter(Boolean).join(" — ");
  const notes=cleanNotes(rawNotes)||null;
  const sql=database(env);
  const machine=await sql`SELECT id, category, machine_type FROM machines WHERE lower(name)=lower(${name}) ORDER BY (lower(coalesce(machine_type,''))=lower(${type||""})) DESC LIMIT 1`;
  const resolvedCategory = category && category !== "Mesin" ? category : (machine[0]?.category || category || "Mesin");
  const resolvedType = type || machine[0]?.machine_type || "";
  const plan=await sql`SELECT id FROM maintenance_plans WHERE planned_on=${inspectedOn}::date AND lower(machine_name)=lower(${name}) ORDER BY (lower(coalesce(schedule_code,''))=lower(${code})) DESC LIMIT 1`;
  const rows=await sql`
    UPDATE maintenance_inspections
    SET plan_id=${plan[0]?.id||null},
        machine_id=${machine[0]?.id||null},
        inspected_on=${inspectedOn},
        machine_category=${resolvedCategory},
        machine_type=${resolvedType},
        machine_name=${name},
        schedule_code=${code},
        maintenance_type=${maintenanceType},
        notes=${notes},
        legacy_data=coalesce(legacy_data,'{}'::jsonb) || ${JSON.stringify(body)}::jsonb,
        updated_at=now()
    WHERE id=${id}
    RETURNING id
  `;
  if(!rows.length) throw new HttpError(404,"Data perawatan tidak ditemukan.");
  const condition=text(body.kondisi_mesin||body.kondisi);
  if (Array.isArray(body.checks) && body.checks.length > 0) {
    await sql`DELETE FROM maintenance_check_results WHERE inspection_id=${id}`;
  }
  await syncInspectionCheckResults(sql, id, resolvedCategory, body.checks, condition);
  return {status:"success",message:"Data perawatan berhasil diperbarui.",data:{id}};
}

async function deleteMaintenance(request,env,body) {
  await requireSession(request,env,body,["Admin"]);
  const id=required(body.id,"ID perawatan");
  const sql=database(env);
  await sql`DELETE FROM maintenance_check_results WHERE inspection_id=${id}`;
  const rows=await sql`DELETE FROM maintenance_inspections WHERE id=${id} RETURNING id`;
  if(!rows.length) throw new HttpError(404,"Data perawatan tidak ditemukan.");
  return {status:"success",message:"Data perawatan berhasil dihapus."};
}

function electricityObject(row,panelReadings=[]){
  // Data historis tetap dapat dibaca meski ditandai oleh selisih meter negatif;
  // validasi ketat tetap diterapkan ketika menyimpan pemeriksaan baru.
  const assessment=calculateElectricityAssessment(row,{allowNegative:true});
  const panelValues=Object.fromEntries(panelReadings.map(reading=>[reading.code,Number(reading.power_factor)]));
  return{
  id:row.id,tanggal:idDateTime(row.checked_at),tanggal_input:dateKey(new Date(row.checked_at)),
  jam:new Date(row.checked_at).toLocaleTimeString("id-ID",{timeZone:"Asia/Jakarta",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}),
  jam_input:new Date(row.checked_at).toLocaleTimeString("en-GB",{timeZone:"Asia/Jakarta",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}),
  petugas:row.officer_name||"",huhe_h:Number(row.huhe_h||0),huhe_hh:Number(row.huhe_hh||0),
  huar_heh:Number(row.huar_heh||0),huar_hh:Number(row.huar_hh||0),grid_pln:Number(row.grid_from_mwh||0),
  pv_plts:Number(row.pv_from_mwh||0),to_grid:Number(row.grid_to_mwh||0),nilai_kwh:assessment.reactiveLimitKvarh,
  nilai_kvar:assessment.reactiveKvarh,selisih:assessment.marginKvarh,kesimpulan:assessment.conclusion,
  pemakaian_kwh:assessment.activeKwh,batas_kvarh:assessment.reactiveLimitKvarh,
  faktor_daya:assessment.powerFactor,kelebihan_kvarh:assessment.excessReactiveKvarh,
  panel_cos_phi:panelValues,panel_readings:panelReadings.map(reading=>({code:reading.code,name:reading.name,powerFactor:Number(reading.power_factor)})),
  cos_phi_panel_1:panelValues.panel_1??null,cos_phi_panel_2:panelValues.panel_2??null,
  cos_phi_panel_3:panelValues.panel_3??null,cos_phi_panel_4:panelValues.panel_4??null,
};}

async function getElectricity(env,dataOnly=false){
  const sql=database(env);
  const[rows,officers,panels,readings]=await Promise.all([
    sql`SELECT * FROM electricity_checks ORDER BY checked_at DESC`,
    sql`SELECT DISTINCT btrim(full_name) AS name
      FROM users
      WHERE login_enabled AND btrim(full_name)<>''
        AND lower(btrim(full_name)) IN ('dody kumala','herwidodo','irham abdurahman','m. rizal adi p')
      ORDER BY name`,
    sql`SELECT id,code,name,sort_order FROM electricity_panels WHERE is_active ORDER BY sort_order,name`,
    sql`SELECT r.electricity_check_id,p.code,p.name,r.power_factor,r.checked_at,r.officer_name
        FROM electricity_power_factor_readings r
        JOIN electricity_panels p ON p.id=r.panel_id
        ORDER BY r.checked_at DESC,p.sort_order,p.name`,
  ]);
  const byCheck=new Map();
  readings.forEach(reading=>{
    const key=String(reading.electricity_check_id);
    if(!byCheck.has(key))byCheck.set(key,[]);
    byCheck.get(key).push(reading);
  });
  const data=rows.map(row=>electricityObject(row,byCheck.get(String(row.id))||[]));
  if(dataOnly)return data;
  const latestByPanel=new Map();
  readings.forEach(reading=>{if(!latestByPanel.has(reading.code))latestByPanel.set(reading.code,reading);});
  return {status:"success",prevData:data[0]||{},petugas:officers.map(row=>row.name),panels:panels.map(panel=>{
    const latest=latestByPanel.get(panel.code);
    return{id:panel.id,code:panel.code,name:panel.name,sortOrder:panel.sort_order,latestPowerFactor:latest?Number(latest.power_factor):null};
  }),data};
}

async function getPanelPowerFactorData(env){
  const sql=database(env);
  const rows=await sql`
    SELECT r.id,r.checked_at,r.officer_name,r.power_factor,p.code,p.name
    FROM electricity_power_factor_readings r
    JOIN electricity_panels p ON p.id=r.panel_id
    ORDER BY r.checked_at DESC,p.sort_order,p.name
  `;
  return rows.map(row=>({
    id:row.id,tanggal:idDateTime(row.checked_at),
    jam:new Date(row.checked_at).toLocaleTimeString("id-ID",{timeZone:"Asia/Jakarta",hour:"2-digit",minute:"2-digit",hour12:false}),
    panel:row.name,code:row.code,cos_phi:Number(row.power_factor),petugas:row.officer_name||"",
  }));
}

async function getMonthlyReactiveEnergy(env,yearValue){
  const currentYear=new Date().getFullYear();
  const year=Number(yearValue)||currentYear;
  if(!Number.isInteger(year)||year<2000||year>2100)throw new HttpError(400,"Tahun grafik listrik tidak valid.");
  const sql=database(env);
  const rows=await sql`
    SELECT checked_at,huhe_h,huhe_hh,huar_heh,huar_hh
    FROM electricity_checks
    WHERE checked_at>=${`${year}-01-01T00:00:00+07:00`}::timestamptz
      AND checked_at<${`${year+1}-01-01T00:00:00+07:00`}::timestamptz
    ORDER BY checked_at
  `;
  return {status:"success",year,periodBasis:"calendar-month",throughDate:idDate(new Date()),
    data:summarizeMonthlyReactiveEnergy(rows,{year,now:new Date()})};
}

async function saveElectricity(request,env,body,executionCtx){
  const profile=await requireSession(request,env,body);const day=isoDate(body.tanggal),time=text(body.jam)||"00:00";
  if(!day)throw new HttpError(400,"Tanggal listrik tidak valid.");
  const checkedAt=`${day}T${time}:00+07:00`,officer=profile.role==="Admin"?required(body.petugas||profile.full_name,"Petugas"):required(profile.full_name,"Nama akun"),sql=database(env);
  let officers=await sql`SELECT id FROM electricity_officers WHERE lower(name)=lower(${officer}) LIMIT 1`;
  if(!officers.length)officers=await sql`INSERT INTO electricity_officers(name) VALUES(${officer}) ON CONFLICT(name) DO UPDATE SET is_active=true RETURNING id`;
  const h=number(body.huhe_h),hh=number(body.huhe_hh),heh=number(body.huar_heh),ahh=number(body.huar_hh);
  if([h,hh,heh,ahh].some(value=>value===null))throw new HttpError(400,"Empat nilai meter wajib berupa angka.");
  let assessment;
  try{assessment=calculateElectricityAssessment({huhe_h:h,huhe_hh:hh,huar_heh:heh,huar_hh:ahh});}
  catch(error){throw new HttpError(400,error.message);}
  const kwh=assessment.reactiveLimitKvarh,kvar=assessment.reactiveKvarh,difference=assessment.marginKvarh,conclusion=assessment.conclusion;
  const rows=await sql`INSERT INTO electricity_checks(officer_id,checked_at,officer_name,huhe_h,huhe_hh,huar_heh,huar_hh,grid_from_mwh,pv_from_mwh,grid_to_mwh,kwh,kvar,difference,conclusion,source_sheet,legacy_sheet_row,legacy_data) VALUES(${officers[0].id},${checkedAt},${officer},${h},${hh},${heh},${ahh},${number(body.grid_pln)},${number(body.pv_plts)},${number(body.to_grid)},${kwh},${kvar},${difference},${conclusion},'Neon API',NULL,${JSON.stringify(body)}::jsonb) RETURNING id`;
  queueSystemNotification(executionCtx,sendSystemNotification(env,{
    type:"kvar_check",title:"Pengecekan kVAr baru",body:`${officer} mencatat ${Number(kvar||0).toLocaleString("id-ID",{maximumFractionDigits:2})} kVArh — ${conclusion}.`,
    url:"./?open=electricityData",entityId:rows[0].id,
  }));
  return{status:"success",message:"Data listrik berhasil disimpan.",data:{id:rows[0].id}};
}

async function updateElectricity(request,env,body){
  const profile=await requireSession(request,env,body,["Admin"]);
  const id=required(body.id,"ID pemeriksaan");
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)){
    throw new HttpError(400,"ID pemeriksaan listrik tidak valid.");
  }
  const day=isoDate(body.tanggal),time=text(body.jam)||"00:00";
  if(!day||!/^([01]\d|2[0-3]):[0-5]\d$/.test(time))throw new HttpError(400,"Tanggal atau jam listrik tidak valid.");
  const checkedAt=`${day}T${time}:00+07:00`,officer=required(body.petugas||profile.full_name,"Petugas");
  const h=number(body.huhe_h),hh=number(body.huhe_hh),heh=number(body.huar_heh),ahh=number(body.huar_hh);
  if([h,hh,heh,ahh].some(value=>value===null))throw new HttpError(400,"Empat nilai meter wajib berupa angka.");
  let assessment;
  try{assessment=calculateElectricityAssessment({huhe_h:h,huhe_hh:hh,huar_heh:heh,huar_hh:ahh});}
  catch(error){throw new HttpError(400,error.message);}
  const sql=database(env);
  let officers=await sql`SELECT id FROM electricity_officers WHERE lower(name)=lower(${officer}) LIMIT 1`;
  if(!officers.length)officers=await sql`INSERT INTO electricity_officers(name) VALUES(${officer}) ON CONFLICT(name) DO UPDATE SET is_active=true RETURNING id`;
  const rows=await sql`
    UPDATE electricity_checks SET
      officer_id=${officers[0].id},checked_at=${checkedAt},officer_name=${officer},
      huhe_h=${h},huhe_hh=${hh},huar_heh=${heh},huar_hh=${ahh},
      grid_from_mwh=${number(body.grid_pln)},pv_from_mwh=${number(body.pv_plts)},grid_to_mwh=${number(body.to_grid)},
      kwh=${assessment.reactiveLimitKvarh},kvar=${assessment.reactiveKvarh},difference=${assessment.marginKvarh},
      conclusion=${assessment.conclusion},calculation_anomaly=false,
      legacy_data=coalesce(legacy_data,'{}'::jsonb)||${JSON.stringify({...body,updated_by:profile.username})}::jsonb
    WHERE id=${id}::uuid
    RETURNING id
  `;
  if(!rows.length)throw new HttpError(404,"Data pemeriksaan listrik tidak ditemukan.");
  return{status:"success",message:"Data listrik berhasil diperbarui dan dihitung ulang.",data:{id:rows[0].id}};
}

async function savePanelPowerFactor(request,env,body){
  const profile=await requireSession(request,env,body);
  const day=isoDate(body.tanggal),time=text(body.jam)||"00:00";
  if(!day)throw new HttpError(400,"Tanggal pembacaan cos phi tidak valid.");
  const checkedAt=`${day}T${time}:00+07:00`,officer=profile.role==="Admin"?required(body.petugas||profile.full_name,"Petugas"):required(profile.full_name,"Nama akun");
  const panelCode=required(body.panel,"Panel"),powerFactor=number(body.cos_phi);
  if(powerFactor===null||powerFactor<0||powerFactor>1)throw new HttpError(400,"Nilai cos phi harus antara 0 dan 1.");
  const sql=database(env);
  const panels=await sql`SELECT id,name FROM electricity_panels WHERE code=${panelCode} AND is_active LIMIT 1`;
  if(!panels.length)throw new HttpError(404,"Panel listrik tidak ditemukan.");
  let officers=await sql`SELECT id FROM electricity_officers WHERE lower(name)=lower(${officer}) LIMIT 1`;
  if(!officers.length)officers=await sql`INSERT INTO electricity_officers(name) VALUES(${officer}) ON CONFLICT(name) DO UPDATE SET is_active=true RETURNING id`;
  const rows=await sql`INSERT INTO electricity_power_factor_readings(panel_id,officer_id,checked_at,officer_name,power_factor) VALUES(${panels[0].id},${officers[0].id},${checkedAt},${officer},${powerFactor}) RETURNING id`;
  return{status:"success",message:`Data cos phi ${panels[0].name} berhasil disimpan.`,data:{id:rows[0].id}};
}

function transformerObject(row){return{id:row.id,kode:row.code,nama:row.name,merk:row.brand_name||"",tipe:row.transformer_type||"",tegangan:row.voltage||"",pengadaan:idDate(row.acquired_on)};}
async function transformers(env){const sql=database(env);return(await sql`SELECT * FROM welding_transformers WHERE is_active ORDER BY code`).map(transformerObject);}
async function transformerRefs(env){const sql=database(env);const[brands,locations]=await Promise.all([sql`SELECT name FROM welding_transformer_brands WHERE is_active ORDER BY name`,sql`SELECT name FROM welding_transformer_locations WHERE is_active ORDER BY name`]);return{status:"success",merk:brands.map(x=>x.name),lokasi:locations.map(x=>x.name)};}
async function saveTransformer(request,env,body){
  await requireSession(request,env,body);const code=required(body.kode,"Kode trafo"),location=text(body.lokasi),sql=database(env);
  const assets=await sql`SELECT id,name FROM welding_transformers WHERE code=${code} LIMIT 1`;if(!assets.length)throw new HttpError(404,"Trafo tidak ditemukan.");
  let locations=[];if(location){locations=await sql`SELECT id FROM welding_transformer_locations WHERE lower(name)=lower(${location}) LIMIT 1`;if(!locations.length)locations=await sql`INSERT INTO welding_transformer_locations(name,legacy_source) VALUES(${location},'Neon API') RETURNING id`;}
  const rows=await sql`INSERT INTO welding_transformer_inspections(transformer_id,inspected_at,transformer_code,transformer_name,location_id,location_name,condition,operational_status,welding_rod_status,cable_status,ground_clamp_status,notes,source_sheet,legacy_sheet_row,legacy_data) VALUES(${assets[0].id},now(),${code},${assets[0].name},${locations[0]?.id||null},${location},${text(body.kondisi)},${text(body.status)},${text(body.stang)},${text(body.kabel)},${text(body.masa)},${text(body.keterangan)},'Neon API',NULL,${JSON.stringify(body)}::jsonb) RETURNING id`;
  return{status:"success",message:"Inspeksi trafo berhasil disimpan.",data:{id:rows[0].id}};
}

async function stangDatabase(env){
  const sql=database(env);const[summary,brands,groups,locations,transactions]=await Promise.all([sql`SELECT * FROM stang_summary`,sql`SELECT name FROM stang_brands WHERE is_active ORDER BY name`,sql`SELECT name FROM stang_groups WHERE is_active ORDER BY name`,sql`SELECT name FROM stang_locations WHERE is_active ORDER BY name`,sql`SELECT * FROM stang_transaction_status ORDER BY issued_on DESC,created_at DESC LIMIT 500`]);
  const maxCode=transactions.reduce((max,row)=>Math.max(max,Number(String(row.code||"").match(/\d+/)?.[0]||0)),0);
  return{status:"success",rangkuman:{totalDikeluarkan:summary[0]?.total_issued||0,totalSudahKembali:summary[0]?.total_returned||0,totalBelumKembali:summary[0]?.total_open||0},nextKode:String(maxCode+1).padStart(4,"0"),merk:brands.map(x=>x.name),group:groups.map(x=>x.name),lokasi:locations.map(x=>x.name),data:transactions.map(row=>({id:row.id,kode:row.code||"",keluar:idDate(row.issued_on),namaKeluar:row.issued_by_name||"",digunakan:row.used_location_name||"",kembali:idDate(row.returned_on),namaKembali:row.returned_by_name||"",dari:row.from_location_name||"",merk:row.brand_name||"",durasi:row.duration_days,status:row.status,keterangan:row.notes||""}))};
}
async function referenceId(sql,table,name){if(!name)return null;let rows;if(table==="brand")rows=await sql`SELECT id FROM stang_brands WHERE lower(name)=lower(${name}) LIMIT 1`;else if(table==="group")rows=await sql`SELECT id FROM stang_groups WHERE lower(name)=lower(${name}) LIMIT 1`;else rows=await sql`SELECT id FROM stang_locations WHERE lower(name)=lower(${name}) LIMIT 1`;return rows[0]?.id||null;}
async function saveStang(request,env,body){
  await requireSession(request,env,body);const action=text(body.action),sql=database(env);
  if(action==="pinjam"){
    const issued=isoDate(body.keluar);if(!issued)throw new HttpError(400,"Tanggal keluar tidak valid.");
    const group=text(body.namaKeluar),location=text(body.digunakan),brand=text(body.merk);const[groupId,locationId,brandId]=await Promise.all([referenceId(sql,"group",group),referenceId(sql,"location",location),referenceId(sql,"brand",brand)]);
    const codeRows=await sql`SELECT coalesce(max((regexp_match(code,'[0-9]+'))[1]::integer),0)+1 AS next FROM stang_transactions WHERE code~'[0-9]+'`;const code=String(codeRows[0].next).padStart(4,"0");
    await sql`INSERT INTO stang_transactions(code,issued_on,issued_group_id,issued_by_name,used_location_id,used_location_name,brand_id,brand_name,duration_days,notes,source_sheet,legacy_sheet_row,legacy_data) VALUES(${code},${issued},${groupId},${group},${locationId},${location},${brandId},${brand},0,${text(body.keterangan)},'Neon API',NULL,${JSON.stringify(body)}::jsonb)`;
    return{status:"success",message:"Stang berhasil dikeluarkan.",kode:code};
  }
  if(action==="kembali"){
    const code=required(body.kode,"Kode stang"),returned=isoDate(body.kembali);if(!returned)throw new HttpError(400,"Tanggal kembali tidak valid.");
    const group=text(body.namaKembali),location=text(body.dari),brand=text(body.merk);const[groupId,locationId,brandId]=await Promise.all([referenceId(sql,"group",group),referenceId(sql,"location",location),referenceId(sql,"brand",brand)]);
    const rows=await sql`UPDATE stang_transactions SET returned_on=${returned},returned_group_id=${groupId},returned_by_name=${group},from_location_id=${locationId},from_location_name=${location},brand_id=coalesce(${brandId}::uuid,brand_id),brand_name=coalesce(${brand},brand_name),duration_days=${number(body.durasi)},notes=${text(body.keterangan)} WHERE code=${code} AND returned_on IS NULL RETURNING id`;
    if(!rows.length)throw new HttpError(404,"Kode stang tidak ditemukan atau sudah kembali.");return{status:"success",message:"Pengembalian stang berhasil disimpan."};
  }
  throw new HttpError(400,"Action stang tidak dikenal.");
}

async function oilDashboard(env){
  const sql=database(env);const[summaryRows,reservoirRows,historyRows]=await Promise.all([sql`SELECT * FROM oil_monitoring_summary`,sql`SELECT reservoirs.id,reservoirs.name,reservoirs.capacity_liters,reservoirs.oil_type,reservoirs.minimum_level_percent,reservoirs.check_interval_days,reservoirs.machine_id,machines.name AS machine_name,latest.checked_on,latest.level_percent,latest.estimated_oil_liters,latest.level_status,latest.notes,CASE WHEN latest.checked_on IS NULL THEN true ELSE latest.checked_on+reservoirs.check_interval_days<current_date END AS is_overdue FROM oil_reservoirs reservoirs LEFT JOIN machines ON machines.id=reservoirs.machine_id LEFT JOIN latest_oil_checks latest ON latest.reservoir_id=reservoirs.id WHERE reservoirs.is_active ORDER BY CASE latest.level_status WHEN 'KRITIS' THEN 0 WHEN 'PERHATIAN' THEN 1 ELSE 2 END,reservoirs.name`,sql`SELECT details.id,details.reservoir_id,details.reservoir_name,details.checked_on,details.level_percent,details.estimated_oil_liters,details.level_status,details.refill_liters,details.oil_condition,details.notes,coalesce(details.created_by_name,users.full_name) AS checked_by FROM oil_check_details details LEFT JOIN users ON users.id=details.checked_by_user_id ORDER BY details.checked_on DESC,details.created_at DESC LIMIT 200`]);
  const numeric=(row,fields)=>{const out={...row};fields.forEach(key=>{if(out[key]!=null)out[key]=Number(out[key]);});return out;};
  return{summary:numeric(summaryRows[0]||{},["reservoir_count","checked_reservoir_count","critical_count","attention_count","overdue_count","never_checked_count"]),reservoirs:reservoirRows.map(row=>({...numeric(row,["capacity_liters","minimum_level_percent","check_interval_days","level_percent","estimated_oil_liters"]),checked_on:dateKey(row.checked_on)})),history:historyRows.map(row=>({...numeric(row,["level_percent","estimated_oil_liters","refill_liters"]),checked_on:dateKey(row.checked_on)}))};
}
async function saveOil(request,env,body){
  const session=await requireSession(request,env,body,["Admin","Teknik"]),reservoirId=required(body.reservoirId,"Titik oli"),checkedOn=isoDate(body.checkedOn),level=number(body.levelPercent),refill=number(body.refillLiters);
  if(!checkedOn)throw new HttpError(400,"Tanggal pemeriksaan tidak valid.");if(level===null||level<0||level>100)throw new HttpError(400,"Level oli harus antara 0 sampai 100 persen.");if(refill!==null&&refill<0)throw new HttpError(400,"Jumlah pengisian tidak boleh negatif.");
  const sql=database(env);const rows=await sql`INSERT INTO oil_checks(reservoir_id,machine_id,checked_on,checked_by_user_id,level_percent,refill_liters,oil_condition,notes,source_sheet,legacy_sheet_row,created_by_username,created_by_name) SELECT id,machine_id,${checkedOn},${session.id},${level},${refill},${text(body.oilCondition)},${text(body.notes)},'Neon API',NULL,${session.username},${session.full_name} FROM oil_reservoirs WHERE id=${reservoirId}::uuid AND is_active RETURNING id`;
  if(!rows.length)throw new HttpError(404,"Titik oli tidak ditemukan.");return{status:"success",message:"Pemeriksaan oli berhasil disimpan ke Neon.",data:{id:rows[0].id}};
}

export async function handleAssets({request,env,url,resource,body,executionCtx}){
  const params=Object.fromEntries(url.searchParams),action=text(request.method==="POST"?body.action:params.action)||"";
  if(resource==="maintenance") {
    if(request.method==="GET") {
      if(action==="getPrintData") return getMaintenancePrintData(request,env);
      if(action==="getInspectionChecks"||action==="getChecks") return getInspectionChecks(request,env,params.id);
      return getMaintenance(env, params);
    }
    if(action==="delete"||action==="hapus") return deleteMaintenance(request,env,body);
    if(action==="update"||action==="edit"||(body.id&&action!=="insert")) return updateMaintenance(request,env,body);
    return saveMaintenance(request,env,body);
  }
  if(resource==="electricity"){
    if(request.method==="GET"){
      if(action==="getPanelData")return getPanelPowerFactorData(env);
      if(action==="getMonthlyKvarh")return getMonthlyReactiveEnergy(env,params.year);
      return getElectricity(env,action==="getData");
    }
    if(action==="update")return updateElectricity(request,env,body);
    if(action==="insertPanelCosPhi")return savePanelPowerFactor(request,env,body);
    return saveElectricity(request,env,body,executionCtx);
  }
  if(resource==="transformers"){
    if(request.method==="POST")return saveTransformer(request,env,body);
    return action==="getReferensi"?transformerRefs(env):transformers(env);
  }
  if(resource==="transformer-data")return transformers(env);
  if(resource==="stang")return request.method==="GET"?stangDatabase(env):saveStang(request,env,body);
  if(resource==="oil"){
    if(request.method==="GET"){await requireSession(request,env,body,["Admin","Teknik"]);return{status:"success",data:await oilDashboard(env)};}
    return saveOil(request,env,body);
  }
  return null;
}
