import { HttpError, database, isoDate, isoDateTime, number, requireSession, required, text } from "../lib/core.js";

const DATASETS = [
  ["users","Pengguna","users",["id"]],
  ["machines","Mesin","machines",["id"]],
  ["parts","Suku Cadang","parts",["id"]],
  ["inventory_balances","Stok","inventory_balances",["id"]],
  ["work_orders","Order Kerja","work_orders",["id"]],
  ["work_order_parts","Part Order Kerja","work_order_parts",["work_order_id","part_id"]],
  ["work_reports","Laporan Kerja","work_reports",["id"]],
  ["part_requests","Permintaan Part","part_requests",["id"]],
  ["stock_movements","Pemakaian Part","stock_movements",["id"]],
  ["maintenance_check_items","Item Perawatan","maintenance_check_items",["id"]],
  ["maintenance_plans","Rencana Perawatan","maintenance_plans",["id"]],
  ["maintenance_inspections","Inspeksi Perawatan","maintenance_inspections",["id"]],
  ["maintenance_check_results","Hasil Perawatan","maintenance_check_results",["inspection_id","item_id"]],
  ["maintenance_monthly_targets","Target Perawatan","maintenance_monthly_targets",["month"]],
  ["kpi_monthly_targets","Target KPI","kpi_monthly_targets",["month"]],
  ["overtime_entries","Lemburan","overtime_entries",["id"]],
  ["electricity_officers","Petugas Listrik","electricity_officers",["id"]],
  ["electricity_checks","Cek Listrik PLN","electricity_checks",["id"]],
  ["electricity_panels","Panel Listrik","electricity_panels",["id"]],
  ["electricity_power_factor_readings","Cos Phi Panel","electricity_power_factor_readings",["id"]],
  ["oil_reservoirs","Reservoir Oli","oil_reservoirs",["id"]],
  ["oil_checks","Cek Oli","oil_checks",["id"]],
  ["stang_brands","Merek Stang","stang_brands",["id"]],
  ["stang_groups","Grup Stang","stang_groups",["id"]],
  ["stang_locations","Lokasi Stang","stang_locations",["id"]],
  ["stang_transactions","Transaksi Stang","stang_transactions",["id"]],
  ["welding_transformer_brands","Merek Trafo","welding_transformer_brands",["id"]],
  ["welding_transformer_locations","Lokasi Trafo","welding_transformer_locations",["id"]],
  ["welding_transformers","Trafo Las","welding_transformers",["id"]],
  ["welding_transformer_inspections","Inspeksi Trafo","welding_transformer_inspections",["id"]],
  ["national_holidays","Hari Libur","national_holidays",["holiday_date"]],
].map(([key,label,table,keyColumns])=>({key,label,table,keyColumns,sheet:label.slice(0,31)}));

const HIDDEN_COLUMNS = new Set([
  "password_hash","legacy_data","created_at","updated_at",
]);
const datasetByKey = new Map(DATASETS.map(dataset=>[dataset.key,dataset]));
const quoteIdentifier = value => `"${String(value).replace(/"/g,'""')}"`;

async function tableColumns(sql, table) {
  const rows=await sql.query(
    `SELECT column_name,data_type,is_nullable,column_default
       FROM information_schema.columns
      WHERE table_schema='public' AND table_name=$1
      ORDER BY ordinal_position`,
    [table]
  );
  return rows
    .filter(column=>!HIDDEN_COLUMNS.has(column.column_name))
    .map(column=>({
      name:column.column_name,
      type:column.data_type,
      required:column.is_nullable==="NO"&&!column.column_default,
    }));
}

function importValue(value) {
  if(value===undefined)return undefined;
  if(value===null||value==="")return null;
  if(typeof value==="string")return value.trim();
  if(typeof value==="number"||typeof value==="boolean")return value;
  throw new HttpError(400,"Workbook memuat nilai sel yang tidak didukung.");
}

function strictDate(value, label) {
  const result=isoDate(value);
  if(!result)throw new HttpError(400,`${label} tidak valid.`);
  const [year,month,day]=result.split("-").map(Number);
  const candidate=new Date(Date.UTC(year,month-1,day));
  if(candidate.getUTCFullYear()!==year||candidate.getUTCMonth()!==month-1||candidate.getUTCDate()!==day){
    throw new HttpError(400,`${label} tidak valid.`);
  }
  return result;
}

function directMetadata(row) {
  return JSON.stringify({source_file:text(row.source_file,200),source_row:Number(row.source_row)||null});
}

export function prepareDirectMaintenanceRow(row) {
  if(!row||typeof row!=="object"||Array.isArray(row))throw new HttpError(400,"Format baris Rekap Perawatan tidak valid.");
  const scheduleCode=required(row.schedule_code,"Waktu").toUpperCase();
  if(!/^[MB]$/.test(scheduleCode))throw new HttpError(400,"Waktu Rekap Perawatan harus M atau B.");
  if(!Array.isArray(row.checks)||row.checks.length>150)throw new HttpError(400,"Checklist Rekap Perawatan tidak valid.");
  const checks=row.checks.map(check=>({
    name:required(check?.name,"Nama item checklist").slice(0,300),
    raw_status:required(check?.raw_status,"Status checklist").slice(0,100),
  }));
  return {
    inspected_on:strictDate(row.inspected_on,"Tanggal perawatan"),
    machine_category:required(row.machine_category,"Kategori mesin"),
    machine_type:required(row.machine_type,"Jenis mesin"),
    machine_name:required(row.machine_name,"Nama mesin"),
    schedule_code:scheduleCode,
    maintenance_type:scheduleCode==="B"?"Bulanan":"Mingguan",
    notes:text(row.notes),checks,source_row:Number(row.source_row)||null,metadata:directMetadata(row),
  };
}

export function prepareDirectWorkReportRow(row) {
  if(!row||typeof row!=="object"||Array.isArray(row))throw new HttpError(400,"Format baris Laporan Kerja tidak valid.");
  const startedAt=row.started_at?isoDateTime(row.started_at):null;
  const finishedAt=row.finished_at?isoDateTime(row.finished_at):null;
  if(row.started_at&&!startedAt)throw new HttpError(400,"Jam mulai Laporan Kerja tidak valid.");
  if(row.finished_at&&!finishedAt)throw new HttpError(400,"Jam selesai Laporan Kerja tidak valid.");
  return {
    report_date:strictDate(row.report_date,"Tanggal laporan"),department:text(row.department),
    machine_category:text(row.machine_category),machine_type:text(row.machine_type),
    machine_name:required(row.machine_name,"Nama mesin"),job_type:text(row.job_type),
    work_description:required(row.work_description,"Laporan pekerjaan"),component_type:text(row.component_type),
    started_at:startedAt,finished_at:finishedAt,total_hours:number(row.total_hours),definition:text(row.definition),
    spare_part_name:text(row.spare_part_name),spare_part_size:text(row.spare_part_size),
    order_type:text(row.order_type),order_status:text(row.order_status),repair_rating:text(row.repair_rating),
    notes:text(row.notes),is_new_machine:Boolean(row.is_new_machine),is_new_part:Boolean(row.is_new_part),
    part_category:text(row.part_category),source_row:Number(row.source_row)||null,metadata:directMetadata(row),
  };
}

const MAINTENANCE_EXISTS=`
  EXISTS (
    SELECT 1 FROM maintenance_inspections saved
    WHERE saved.inspected_on=input.inspected_on
      AND lower(btrim(saved.machine_name))=lower(btrim(input.machine_name))
      AND (
        (
          lower(btrim(saved.machine_category))=lower(btrim(input.machine_category))
          AND lower(btrim(coalesce(saved.machine_type,'')))=lower(btrim(coalesce(input.machine_type,'')))
          AND lower(btrim(coalesce(saved.schedule_code,'')))=lower(btrim(coalesce(input.schedule_code,'')))
        ) OR (
          saved.source_sheet IN ('Mesin','Armada')
          AND (lower(btrim(coalesce(saved.machine_type,'')))='x' OR lower(btrim(coalesce(saved.schedule_code,'')))='x')
        )
      )
  )`;

const WORK_REPORT_EXISTS=`
  EXISTS (
    SELECT 1 FROM work_reports saved
    WHERE saved.report_date=input.report_date
      AND lower(btrim(coalesce(saved.department,'')))=lower(btrim(coalesce(input.department,'')))
      AND lower(btrim(coalesce(saved.machine_category,'')))=lower(btrim(coalesce(input.machine_category,'')))
      AND lower(btrim(coalesce(saved.machine_type,'')))=lower(btrim(coalesce(input.machine_type,'')))
      AND lower(btrim(saved.machine_name))=lower(btrim(input.machine_name))
      AND lower(btrim(coalesce(saved.job_type,'')))=lower(btrim(coalesce(input.job_type,'')))
      AND lower(btrim(saved.work_description))=lower(btrim(input.work_description))
      AND lower(btrim(coalesce(saved.component_type,'')))=lower(btrim(coalesce(input.component_type,'')))
      AND saved.started_at IS NOT DISTINCT FROM input.started_at
      AND saved.finished_at IS NOT DISTINCT FROM input.finished_at
      AND saved.total_hours IS NOT DISTINCT FROM input.total_hours
      AND lower(btrim(coalesce(saved.definition,'')))=lower(btrim(coalesce(input.definition,'')))
      AND lower(btrim(coalesce(saved.spare_part_name,'')))=lower(btrim(coalesce(input.spare_part_name,'')))
      AND lower(btrim(coalesce(saved.spare_part_size,'')))=lower(btrim(coalesce(input.spare_part_size,'')))
      AND lower(btrim(coalesce(saved.order_type,'')))=lower(btrim(coalesce(input.order_type,'')))
      AND lower(btrim(coalesce(saved.order_status,'')))=lower(btrim(coalesce(input.order_status,'')))
      AND lower(btrim(coalesce(saved.repair_rating,'')))=lower(btrim(coalesce(input.repair_rating,'')))
      AND lower(btrim(coalesce(saved.notes,'')))=lower(btrim(coalesce(input.notes,'')))
      AND saved.is_new_machine=input.is_new_machine
      AND saved.is_new_part=input.is_new_part
      AND lower(btrim(coalesce(saved.part_category,'')))=lower(btrim(coalesce(input.part_category,'')))
  )`;

export async function validateDirectMaintenance(sql,rows) {
  const payload=rows.map(({checks,metadata,...row})=>row);
  const result=await sql.query(`
    WITH input AS (
      SELECT * FROM jsonb_to_recordset($1::jsonb) AS value(
        inspected_on date,machine_category text,machine_type text,machine_name text,
        schedule_code text,maintenance_type text,notes text,source_row integer
      )
    )
    SELECT count(*)::integer AS processed,
      count(*) FILTER (WHERE ${MAINTENANCE_EXISTS})::integer AS skipped,
      count(*) FILTER (WHERE NOT ${MAINTENANCE_EXISTS})::integer AS inserted,
      count(*) FILTER (WHERE NOT EXISTS (
        SELECT 1 FROM machines machine WHERE lower(btrim(machine.name))=lower(btrim(input.machine_name))
      ))::integer AS unmatched_machines,
      coalesce(jsonb_agg(jsonb_build_object(
        'source_row',input.source_row,'inspected_on',input.inspected_on,'machine_name',input.machine_name,'schedule_code',input.schedule_code
      ) ORDER BY input.inspected_on,input.machine_name) FILTER (WHERE NOT ${MAINTENANCE_EXISTS}),'[]'::jsonb) AS candidate_rows
    FROM input`,[JSON.stringify(payload)]);
  return result[0]||{};
}

export async function validateDirectWorkReports(sql,rows) {
  const payload=rows.map(({metadata,...row})=>row);
  const result=await sql.query(`
    WITH input AS (
      SELECT * FROM jsonb_to_recordset($1::jsonb) AS value(
        report_date date,department text,machine_category text,machine_type text,machine_name text,
        job_type text,work_description text,component_type text,started_at timestamptz,
        finished_at timestamptz,total_hours numeric(16,3),definition text,spare_part_name text,
        spare_part_size text,order_type text,order_status text,repair_rating text,notes text,
        is_new_machine boolean,is_new_part boolean,part_category text,source_row integer
      )
    )
    SELECT count(*)::integer AS processed,
      count(*) FILTER (WHERE ${WORK_REPORT_EXISTS})::integer AS skipped,
      count(*) FILTER (WHERE NOT ${WORK_REPORT_EXISTS})::integer AS inserted,
      count(*) FILTER (WHERE NOT EXISTS (
        SELECT 1 FROM machines machine WHERE lower(btrim(machine.name))=lower(btrim(input.machine_name))
      ))::integer AS unmatched_machines,
      count(*) FILTER (WHERE input.spare_part_name IS NOT NULL
        AND lower(btrim(input.spare_part_name))<>'tidak pakai'
        AND NOT EXISTS (
          SELECT 1 FROM parts part
          WHERE lower(btrim(part.name))=lower(btrim(input.spare_part_name))
            AND lower(btrim(coalesce(part.size,'')))=lower(btrim(coalesce(input.spare_part_size,'')))
        ))::integer AS unmatched_parts,
      count(*) FILTER (WHERE input.started_at IS NOT NULL AND input.finished_at IS NOT NULL
        AND input.finished_at<input.started_at)::integer AS time_anomalies,
      count(*) FILTER (WHERE input.total_hours<0 OR (
        input.started_at IS NOT NULL AND input.finished_at IS NOT NULL AND input.total_hours IS NOT NULL
        AND abs(extract(epoch FROM (input.finished_at-input.started_at))/3600-input.total_hours)>0.06
      ))::integer AS duration_anomalies,
      coalesce(jsonb_agg(jsonb_build_object(
        'source_row',input.source_row,'report_date',input.report_date,'machine_name',input.machine_name,'work_description',input.work_description
      ) ORDER BY input.report_date,input.machine_name) FILTER (WHERE NOT ${WORK_REPORT_EXISTS}),'[]'::jsonb) AS candidate_rows
    FROM input`,[JSON.stringify(payload)]);
  return result[0]||{};
}

export function maintenanceInsert(row) {
  return {
    statement:`
      WITH refs AS (
        SELECT
          (SELECT id FROM machines WHERE lower(btrim(name))=lower(btrim($4))
            ORDER BY (lower(btrim(coalesce(category,'')))=lower(btrim($2)) AND lower(btrim(coalesce(machine_type,'')))=lower(btrim($3))) DESC LIMIT 1) AS machine_id,
          (SELECT id FROM maintenance_plans WHERE planned_on=$1::date AND lower(btrim(machine_name))=lower(btrim($4))
            ORDER BY (lower(btrim(coalesce(schedule_code,'')))=lower(btrim($5))) DESC LIMIT 1) AS plan_id
      ), inserted AS (
        INSERT INTO maintenance_inspections (
          plan_id,machine_id,inspected_on,machine_category,machine_type,machine_name,schedule_code,
          maintenance_type,notes,source_sheet,legacy_sheet_row,legacy_data
        )
        SELECT refs.plan_id,refs.machine_id,$1::date,$2,$3,$4,$5,$6,$7,'Excel det_rawat',NULL,$8::jsonb FROM refs
        WHERE NOT EXISTS (
          SELECT 1 FROM maintenance_inspections saved
          WHERE saved.inspected_on=$1::date
            AND lower(btrim(saved.machine_name))=lower(btrim($4))
            AND (
              (
                lower(btrim(saved.machine_category))=lower(btrim($2))
                AND lower(btrim(coalesce(saved.machine_type,'')))=lower(btrim(coalesce($3,'')))
                AND lower(btrim(coalesce(saved.schedule_code,'')))=lower(btrim(coalesce($5,'')))
              ) OR (
                saved.source_sheet IN ('Mesin','Armada')
                AND (lower(btrim(coalesce(saved.machine_type,'')))='x' OR lower(btrim(coalesce(saved.schedule_code,'')))='x')
              )
            )
        ) RETURNING id
      ), saved_results AS (
        INSERT INTO maintenance_check_results (inspection_id,item_id,status,raw_status)
        SELECT inserted.id,item.id,
          CASE
            WHEN lower(btrim(entry.raw_status)) IN ('bagus','baik') THEN 'good'
            WHEN lower(btrim(entry.raw_status)) IN ('perbaikan','rusak') THEN 'repair_needed'
            WHEN lower(btrim(entry.raw_status)) IN ('x','-','t.a','t.a.','tidak berlaku') THEN 'not_applicable'
            ELSE 'other'
          END,entry.raw_status
        FROM inserted
        CROSS JOIN jsonb_to_recordset($9::jsonb) AS entry(name text,raw_status text)
        JOIN LATERAL (
          SELECT id FROM maintenance_check_items
          WHERE lower(btrim(machine_category))=lower(btrim($2)) AND lower(btrim(name))=lower(btrim(entry.name))
          ORDER BY sort_order LIMIT 1
        ) item ON true
        ON CONFLICT (inspection_id,item_id) DO NOTHING RETURNING 1
      )
      SELECT (SELECT count(*) FROM inserted)::integer AS inserted,
        (SELECT count(*) FROM saved_results)::integer AS result_count`,
    values:[row.inspected_on,row.machine_category,row.machine_type,row.machine_name,row.schedule_code,
      row.maintenance_type,row.notes,row.metadata,JSON.stringify(row.checks)],
  };
}

export function workReportInsert(row) {
  return {
    statement:`
      WITH refs AS (
        SELECT
          (SELECT id FROM machines WHERE lower(btrim(name))=lower(btrim($5))
            ORDER BY (lower(btrim(coalesce(category,'')))=lower(btrim(coalesce($3,''))) AND lower(btrim(coalesce(machine_type,'')))=lower(btrim(coalesce($4,'')))) DESC LIMIT 1) AS machine_id,
          (SELECT id FROM parts WHERE lower(btrim(name))=lower(btrim(coalesce($13,'')))
            AND lower(btrim(coalesce(size,'')))=lower(btrim(coalesce($14,'')))
            ORDER BY (lower(btrim(coalesce(category,'')))=lower(btrim(coalesce($22,'')))) DESC LIMIT 1) AS part_id
      ), inserted AS (
        INSERT INTO work_reports (
          machine_id,part_id,report_date,department,machine_category,machine_type,machine_name,job_type,
          work_description,component_type,started_at,finished_at,total_hours,definition,spare_part_name,
          spare_part_size,order_type,order_status,repair_rating,notes,is_new_machine,is_new_part,
          time_anomaly,duration_anomaly,part_category,source_sheet,legacy_sheet_row,legacy_data
        )
        SELECT refs.machine_id,refs.part_id,$1::date,$2,$3,$4,$5,$6,$7,$8,$9::timestamptz,$10::timestamptz,
          $11::numeric,$12,$13,$14,$15,$16,$17,$18,$19::boolean,$20::boolean,
          ($9::timestamptz IS NOT NULL AND $10::timestamptz IS NOT NULL AND $10::timestamptz<$9::timestamptz),
          ($11::numeric<0 OR ($9::timestamptz IS NOT NULL AND $10::timestamptz IS NOT NULL AND $11::numeric IS NOT NULL
            AND abs(extract(epoch FROM ($10::timestamptz-$9::timestamptz))/3600-$11::numeric)>0.06)),
          $22,'Excel lap_kerja',NULL,$21::jsonb FROM refs
        WHERE NOT EXISTS (
          SELECT 1 FROM work_reports saved
          WHERE saved.report_date=$1::date
            AND lower(btrim(coalesce(saved.department,'')))=lower(btrim(coalesce($2,'')))
            AND lower(btrim(coalesce(saved.machine_category,'')))=lower(btrim(coalesce($3,'')))
            AND lower(btrim(coalesce(saved.machine_type,'')))=lower(btrim(coalesce($4,'')))
            AND lower(btrim(saved.machine_name))=lower(btrim($5))
            AND lower(btrim(coalesce(saved.job_type,'')))=lower(btrim(coalesce($6,'')))
            AND lower(btrim(saved.work_description))=lower(btrim($7))
            AND lower(btrim(coalesce(saved.component_type,'')))=lower(btrim(coalesce($8,'')))
            AND saved.started_at IS NOT DISTINCT FROM $9::timestamptz
            AND saved.finished_at IS NOT DISTINCT FROM $10::timestamptz
            AND saved.total_hours IS NOT DISTINCT FROM $11::numeric(16,3)
            AND lower(btrim(coalesce(saved.definition,'')))=lower(btrim(coalesce($12,'')))
            AND lower(btrim(coalesce(saved.spare_part_name,'')))=lower(btrim(coalesce($13,'')))
            AND lower(btrim(coalesce(saved.spare_part_size,'')))=lower(btrim(coalesce($14,'')))
            AND lower(btrim(coalesce(saved.order_type,'')))=lower(btrim(coalesce($15,'')))
            AND lower(btrim(coalesce(saved.order_status,'')))=lower(btrim(coalesce($16,'')))
            AND lower(btrim(coalesce(saved.repair_rating,'')))=lower(btrim(coalesce($17,'')))
            AND lower(btrim(coalesce(saved.notes,'')))=lower(btrim(coalesce($18,'')))
            AND saved.is_new_machine=$19::boolean
            AND saved.is_new_part=$20::boolean
            AND lower(btrim(coalesce(saved.part_category,'')))=lower(btrim(coalesce($22,'')))
        ) RETURNING id
      ) SELECT count(*)::integer AS inserted FROM inserted`,
    values:[row.report_date,row.department,row.machine_category,row.machine_type,row.machine_name,row.job_type,
      row.work_description,row.component_type,row.started_at,row.finished_at,row.total_hours,row.definition,
      row.spare_part_name,row.spare_part_size,row.order_type,row.order_status,row.repair_rating,row.notes,
      row.is_new_machine,row.is_new_part,row.metadata,row.part_category],
  };
}

async function importDirectDataset(sql,body) {
  if(!Array.isArray(body.rows)||!body.rows.length)throw new HttpError(400,"Tidak ada baris yang dapat diimpor.");
  if(body.rows.length>100)throw new HttpError(413,"Maksimal 100 baris Excel per proses impor.");
  const documentType=text(body.documentType,50);
  const maintenance=documentType==="maintenance";
  if(!maintenance&&documentType!=="work_reports")throw new HttpError(400,"Jenis dokumen Excel tidak dikenal.");
  const prepared=body.rows.map((row,index)=>{
    try{return maintenance?prepareDirectMaintenanceRow(row):prepareDirectWorkReportRow(row);}
    catch(error){throw new HttpError(error.status||400,`Baris Excel ${Number(row?.source_row)||index+2}: ${error.message}`);}
  });
  if(body.validateOnly){
    const result=maintenance?await validateDirectMaintenance(sql,prepared):await validateDirectWorkReports(sql,prepared);
    return {status:"success",validated:Number(result.processed||0),inserted:Number(result.inserted||0),
      skipped:Number(result.skipped||0),candidateRows:Array.isArray(result.candidate_rows)?result.candidate_rows:[],
      warnings:{unmatchedMachines:Number(result.unmatched_machines||0),unmatchedParts:Number(result.unmatched_parts||0),
        timeAnomalies:Number(result.time_anomalies||0),durationAnomalies:Number(result.duration_anomalies||0)}};
  }
  const statements=prepared.map(row=>maintenance?maintenanceInsert(row):workReportInsert(row));
  try{
    const results=await sql.transaction(statements.map(item=>sql.query(item.statement,item.values)));
    const inserted=results.reduce((total,result)=>total+Number(result[0]?.inserted||0),0);
    return {status:"success",processed:prepared.length,inserted,skipped:prepared.length-inserted};
  }catch(error){
    console.error("direct workbook import",documentType,error);
    throw new HttpError(400,`Impor ${maintenance?"Rekap Perawatan":"Laporan Kerja"} dibatalkan. Periksa data dan referensi master.`);
  }
}

export function prepareImportRow(row, columns, keyColumns) {
  if(!row||typeof row!=="object"||Array.isArray(row))throw new HttpError(400,"Format baris impor tidak valid.");
  const allowed=new Set(columns.map(column=>column.name));
  const source={};
  for(const [name,raw] of Object.entries(row)){
    if(!allowed.has(name))continue;
    const value=importValue(raw);
    if(value!==undefined)source[name]=value;
  }
  const hasKey=keyColumns.every(key=>source[key]!==null&&source[key]!==undefined&&source[key]!=="");
  if(!hasKey){
    for(const key of keyColumns)if(source[key]===null||source[key]==="")delete source[key];
    for(const [name,value] of Object.entries(source))if(value===null)delete source[name];
  }
  if(!Object.keys(source).length)throw new HttpError(400,"Baris kosong tidak dapat diimpor.");
  return {source,hasKey};
}

export function buildUpsertStatement(dataset, columns, row) {
  const {source,hasKey}=prepareImportRow(row,columns,dataset.keyColumns);
  const generatedId=dataset.keyColumns.length===1&&dataset.keyColumns[0]==="id";
  if(generatedId&&hasKey)return {statement:"",values:[],mode:"skip"};
  const names=Object.keys(source);
  const values=names.map(name=>source[name]);
  const statement=`INSERT INTO ${quoteIdentifier(dataset.table)} (${names.map(quoteIdentifier).join(",")}) VALUES (${names.map((_,index)=>`$${index+1}`).join(",")}) ON CONFLICT DO NOTHING RETURNING 1`;
  return {statement,values,mode:"insert"};
}

async function manifest(sql) {
  const tables=DATASETS.map(dataset=>dataset.table);
  const [allColumns,counts]=await Promise.all([
    sql.query(
      `SELECT table_name,column_name,data_type,is_nullable,column_default
         FROM information_schema.columns
        WHERE table_schema='public' AND table_name=ANY($1::text[])
        ORDER BY table_name,ordinal_position`,
      [tables]
    ),
    sql.query(DATASETS.map(dataset=>
      `SELECT '${dataset.key}'::text AS dataset,count(*)::integer AS count FROM ${quoteIdentifier(dataset.table)}`
    ).join(" UNION ALL ")),
  ]);
  const countByKey=new Map(counts.map(row=>[row.dataset,Number(row.count||0)]));
  return DATASETS.map(dataset=>({
    ...dataset,
    count:countByKey.get(dataset.key)||0,
    operationalFormat:dataset.key==="maintenance_inspections"?"maintenance":
      dataset.key==="work_reports"?"work_reports":null,
    columns:allColumns
      .filter(column=>column.table_name===dataset.table&&!HIDDEN_COLUMNS.has(column.column_name))
      .map(column=>({name:column.column_name,type:column.data_type,required:column.is_nullable==="NO"&&!column.column_default})),
  }));
}

async function exportDataset(sql,key) {
  const dataset=datasetByKey.get(key);
  if(!dataset)throw new HttpError(400,"Kelompok data tidak dikenal.");
  const columns=await tableColumns(sql,dataset.table);
  const projection=columns.map(column=>quoteIdentifier(column.name)).join(",");
  const order=dataset.keyColumns.map(quoteIdentifier).join(",");
  const rows=await sql.query(`SELECT ${projection} FROM ${quoteIdentifier(dataset.table)} ORDER BY ${order}`);
  return {dataset:{...dataset,columns},rows};
}

export async function exportDirectDataset(sql,documentType){
  if(documentType==="maintenance"){
    const [items,rows]=await Promise.all([
      sql.query(`SELECT machine_category,name,sort_order
        FROM maintenance_check_items
        ORDER BY CASE WHEN lower(machine_category)='mesin' THEN 0 ELSE 1 END,sort_order,name`),
      sql.query(`SELECT to_char(inspection.inspected_on,'YYYY-MM-DD') AS inspected_on,
          inspection.machine_category,inspection.machine_type,
          inspection.machine_name,inspection.schedule_code,inspection.notes,
          coalesce(jsonb_object_agg(
            lower(btrim(item.machine_category))||'|'||lower(btrim(item.name)),
            coalesce(result.raw_status,CASE result.status
              WHEN 'good' THEN 'Bagus'
              WHEN 'repair_needed' THEN 'Perbaikan'
              WHEN 'not_applicable' THEN 'X'
              ELSE result.status END)
          ) FILTER (WHERE item.id IS NOT NULL),'{}'::jsonb) AS checks
        FROM maintenance_inspections inspection
        LEFT JOIN maintenance_check_results result ON result.inspection_id=inspection.id
        LEFT JOIN maintenance_check_items item ON item.id=result.item_id
        GROUP BY inspection.id
        ORDER BY inspection.inspected_on,inspection.machine_category,inspection.machine_type,inspection.machine_name`),
    ]);
    return {documentType,filename:"Rekap Perawatan.xlsx",sheet:"det_rawat",items,rows};
  }
  if(documentType==="work_reports"){
    const rows=await sql.query(`SELECT to_char(report_date,'YYYY-MM-DD') AS report_date,
        department,machine_category,machine_type,machine_name,job_type,work_description,component_type,
        to_char(started_at AT TIME ZONE 'Asia/Jakarta','YYYY-MM-DD"T"HH24:MI:SS') AS started_at,
        to_char(finished_at AT TIME ZONE 'Asia/Jakarta','YYYY-MM-DD"T"HH24:MI:SS') AS finished_at,
        total_hours,definition,
        spare_part_name,spare_part_size,order_type,order_status,repair_rating,notes,is_new_machine,
        is_new_part,part_category
      FROM work_reports
      ORDER BY report_date,started_at NULLS LAST,machine_name,id`);
    return {documentType,filename:"Laporan Kerja.xlsx",sheet:"lap_kerja",rows};
  }
  throw new HttpError(400,"Jenis backup format master tidak dikenal.");
}

async function importDataset(sql,body) {
  const dataset=datasetByKey.get(text(body.dataset,100));
  if(!dataset)throw new HttpError(400,"Kelompok data tidak dikenal.");
  if(!Array.isArray(body.rows)||!body.rows.length)throw new HttpError(400,"Tidak ada baris yang dapat diimpor.");
  if(body.rows.length>250)throw new HttpError(413,"Maksimal 250 baris per proses impor.");
  const columns=await tableColumns(sql,dataset.table);
  const prepared=body.rows.map((row,index)=>{
    try{return buildUpsertStatement(dataset,columns,row);}
    catch(error){throw new HttpError(error.status||400,`${dataset.label} baris ${index+2}: ${error.message}`);}
  });
  if(body.validateOnly)return {
    status:"success",validated:prepared.length,
    inserted:prepared.filter(item=>item.mode==="insert").length,
    skipped:prepared.filter(item=>item.mode==="skip").length,
  };
  try{
    const candidates=prepared.filter(item=>item.mode==="insert");
    const results=candidates.length?await sql.transaction(candidates.map(item=>sql.query(item.statement,item.values))):[];
    const inserted=results.reduce((total,result)=>total+result.length,0);
    return {
      status:"success",processed:prepared.length,inserted,
      skipped:prepared.length-inserted,
    };
  }catch(error){
    console.error("backup import",dataset.key,error);
    throw new HttpError(400,`Impor ${dataset.label} dibatalkan. Periksa kolom wajib, ID referensi, dan format nilainya.`);
  }
}

export async function handleBackup({request,env,url,body}) {
  await requireSession(request,env,body,["admin"]);
  const sql=database(env);
  if(request.method==="GET"){
    const action=text(url.searchParams.get("action"),30)||"manifest";
    if(action==="manifest")return {status:"success",version:1,datasets:await manifest(sql)};
    if(action==="export")return {status:"success",...(await exportDataset(sql,text(url.searchParams.get("dataset"),100)))};
    if(action==="direct-export")return {status:"success",...(await exportDirectDataset(sql,text(url.searchParams.get("documentType"),50)))};
    throw new HttpError(400,"Aksi backup tidak dikenal.");
  }
  if(request.method==="POST"&&body.action==="direct-import")return importDirectDataset(sql,body);
  if(request.method==="POST"&&body.action==="import")return importDataset(sql,body);
  throw new HttpError(405,"Metode backup tidak didukung.");
}

export { DATASETS };
