import bcrypt from "bcryptjs";
import {
  HttpError, database, bearerToken, dateKey, isoDate, number, randomToken,
  required, requireSession, sha256, text,
} from "../lib/core.js";

function userObject(row) {
  return {
    id: row.id,
    username: row.username || "",
    nama: row.full_name || "",
    role: row.role || "Lainnya",
    fungsi: row.function_name || "",
    nik: row.employee_number || "",
    jabatan: row.job_title || "",
    bagian: row.department || "",
    regu: row.team || "",
    tglMasuk: dateKey(row.joined_on),
    lamaKerja: row.tenure_display || "",
    kontrakTerakhir: dateKey(row.last_contract_on),
    pendidikan: row.education || "",
    jurusan: row.major || "",
    statusPegawai: row.employment_status || "",
    statusGaji: row.salary_status || "",
    tunjangan: Number(row.allowance || 0),
    tLahir: row.birth_place || "",
    tglLahir: dateKey(row.birth_date),
    usia: row.age_display || "",
    alamat: row.address || "",
    noTelp: row.phone || "",
    noTelpDarurat: row.emergency_phone || "",
    gajiPokok: Number(row.base_salary || 0),
    gajiHarian: Number(row.daily_salary || 0),
    keterangan: row.notes || "",
  };
}

const USER_SELECT = `
  id, username, full_name, role, function_name, employee_number, job_title,
  department, team, joined_on, tenure_display, last_contract_on, education,
  major, employment_status, salary_status, allowance, birth_place, birth_date,
  age_display, address, phone, emergency_phone, base_salary, daily_salary, notes
`;

async function login(request, env, body) {
  const username = required(body.username, "Username");
  const password = required(body.password, "Password");
  const sql = database(env);
  const rows = await sql`
    SELECT id, username, password_hash, full_name, role, login_enabled, is_active
    FROM users WHERE lower(username) = lower(${username}) LIMIT 1
  `;
  const user = rows[0];
  const valid = user?.password_hash && await bcrypt.compare(password, user.password_hash);
  if (!user || !user.login_enabled || !user.is_active || !valid) {
    throw new HttpError(401, "Username atau password salah.");
  }
  const token = randomToken();
  const tokenHash = await sha256(token);
  await sql`
    INSERT INTO api_sessions (user_id, token_hash, expires_at, user_agent, ip_address)
    VALUES (
      ${user.id}, ${tokenHash}, now() + interval '30 days',
      ${text(request.headers.get("User-Agent"), 1000)},
      ${text(request.headers.get("CF-Connecting-IP"), 100)}
    )
  `;
  return {
    status: "success",
    token,
    profile: { username: user.username, nama: user.full_name, role: user.role },
  };
}

async function logout(request, env, body) {
  const token = bearerToken(request, body);
  if (token) {
    const sql = database(env);
    await sql`DELETE FROM api_sessions WHERE token_hash = ${await sha256(token)}`;
  }
  return { status: "success" };
}

async function allUsers(request, env, body) {
  await requireSession(request, env, body, ["Admin"]);
  const sql = database(env);
  const rows = await sql`
    SELECT id, username, full_name, role, function_name, employee_number, job_title,
      department, team, joined_on, tenure_display, last_contract_on, education,
      major, employment_status, salary_status, allowance, birth_place, birth_date,
      age_display, address, phone, emergency_phone, base_salary, daily_salary, notes
    FROM users WHERE is_active ORDER BY full_name
  `;
  return { status: "success", data: rows.map(userObject) };
}

async function myProfile(request, env, body) {
  const session = await requireSession(request, env, body);
  const sql = database(env);
  const rows = await sql`
    SELECT id, username, full_name, role, function_name, employee_number, job_title,
      department, team, joined_on, tenure_display, last_contract_on, education,
      major, employment_status, salary_status, allowance, birth_place, birth_date,
      age_display, address, phone, emergency_phone, base_salary, daily_salary, notes
    FROM users WHERE id = ${session.id} LIMIT 1
  `;
  if (!rows.length) throw new HttpError(404, "Profil tidak ditemukan.");
  return { status: "success", data: userObject(rows[0]) };
}

async function saveUser(request, env, body) {
  const session = await requireSession(request, env, body);
  const isAdmin = String(session.role).toLowerCase() === "admin";
  const sql = database(env);
  let target;
  if (isAdmin) {
    const rows = await sql`
      SELECT * FROM users
      WHERE (${text(body.originalNik || body.nik)} IS NOT NULL AND employee_number = ${text(body.originalNik || body.nik)})
         OR lower(username) = lower(${text(body.originalUsername || body.username) || ""})
      LIMIT 1
    `;
    target = rows[0];
  } else {
    const rows = await sql`SELECT * FROM users WHERE id = ${session.id} LIMIT 1`;
    target = rows[0];
  }

  const username = isAdmin ? required(body.username, "Username") : target.username;
  const fullName = required(body.nama || target?.full_name, "Nama");
  const employeeNumber = isAdmin ? required(body.nik, "NIK") : target.employee_number;
  const role = isAdmin ? text(body.role) || "Lainnya" : target.role;
  const duplicate = await sql`
    SELECT id FROM users
    WHERE (lower(username) = lower(${username}) OR employee_number = ${employeeNumber})
      AND id <> coalesce(${target?.id || null}::uuid, '00000000-0000-0000-0000-000000000000'::uuid)
    LIMIT 1
  `;
  if (duplicate.length) throw new HttpError(409, "Username atau NIK sudah digunakan.");

  let passwordHash = target?.password_hash || null;
  if (text(body.password)) passwordHash = await bcrypt.hash(String(body.password), 12);
  if (!target && !passwordHash) throw new HttpError(400, "Password wajib diisi untuk teknisi baru.");

  const values = {
    username, passwordHash, fullName, role,
    functionName: text(body.fungsi ?? target?.function_name),
    employeeNumber,
    jobTitle: text(body.jabatan ?? target?.job_title),
    department: text(body.bagian ?? target?.department),
    team: text(body.regu ?? target?.team),
    joinedOn: isoDate(body.tglMasuk) || target?.joined_on || null,
    lastContractOn: isoDate(body.kontrakTerakhir) || target?.last_contract_on || null,
    education: text(body.pendidikan ?? target?.education),
    major: text(body.jurusan ?? target?.major),
    employmentStatus: text(body.statusPegawai ?? target?.employment_status),
    salaryStatus: isAdmin ? text(body.statusGaji) : target?.salary_status,
    allowance: isAdmin ? number(body.tunjangan) : target?.allowance,
    birthPlace: text(body.tLahir ?? target?.birth_place),
    birthDate: isoDate(body.tglLahir) || target?.birth_date || null,
    address: text(body.alamat ?? target?.address),
    phone: text(body.noTelp ?? target?.phone),
    emergencyPhone: text(body.noTelpDarurat ?? target?.emergency_phone),
    baseSalary: isAdmin ? number(body.gajiPokok) : target?.base_salary,
    dailySalary: isAdmin ? number(body.gajiHarian) : target?.daily_salary,
    notes: text(body.keterangan ?? target?.notes),
  };

  let rows;
  if (target) {
    rows = await sql`
      UPDATE users SET
        username=${values.username}, password_hash=${values.passwordHash}, full_name=${values.fullName}, role=${values.role},
        function_name=${values.functionName}, employee_number=${values.employeeNumber}, job_title=${values.jobTitle},
        department=${values.department}, team=${values.team}, joined_on=${values.joinedOn},
        last_contract_on=${values.lastContractOn}, education=${values.education}, major=${values.major},
        employment_status=${values.employmentStatus}, salary_status=${values.salaryStatus}, allowance=${values.allowance},
        birth_place=${values.birthPlace}, birth_date=${values.birthDate}, address=${values.address}, phone=${values.phone},
        emergency_phone=${values.emergencyPhone}, base_salary=${values.baseSalary}, daily_salary=${values.dailySalary},
        notes=${values.notes}, must_change_password=false
      WHERE id=${target.id}
      RETURNING id, username, full_name, role, function_name, employee_number, job_title,
        department, team, joined_on, tenure_display, last_contract_on, education,
        major, employment_status, salary_status, allowance, birth_place, birth_date,
        age_display, address, phone, emergency_phone, base_salary, daily_salary, notes
    `;
  } else {
    rows = await sql`
      INSERT INTO users (
        username, password_hash, must_change_password, full_name, role, function_name,
        employee_number, job_title, department, team, joined_on, last_contract_on,
        education, major, employment_status, salary_status, allowance, birth_place,
        birth_date, address, phone, emergency_phone, base_salary, daily_salary, notes
      ) VALUES (
        ${values.username}, ${values.passwordHash}, false, ${values.fullName}, ${values.role}, ${values.functionName},
        ${values.employeeNumber}, ${values.jobTitle}, ${values.department}, ${values.team}, ${values.joinedOn},
        ${values.lastContractOn}, ${values.education}, ${values.major}, ${values.employmentStatus},
        ${values.salaryStatus}, ${values.allowance}, ${values.birthPlace}, ${values.birthDate}, ${values.address},
        ${values.phone}, ${values.emergencyPhone}, ${values.baseSalary}, ${values.dailySalary}, ${values.notes}
      ) RETURNING id, username, full_name, role, function_name, employee_number, job_title,
        department, team, joined_on, tenure_display, last_contract_on, education,
        major, employment_status, salary_status, allowance, birth_place, birth_date,
        age_display, address, phone, emergency_phone, base_salary, daily_salary, notes
    `;
  }
  return { status: "success", message: "Data teknisi berhasil disimpan.", data: userObject(rows[0]) };
}

export async function handleAuth({ request, env, body }) {
  const action = text(body.action) || "";
  if (action === "login") return login(request, env, body);
  if (action === "logout") return logout(request, env, body);
  if (action === "getMyProfile") return myProfile(request, env, body);
  if (action === "getAllUser" || action === "getAllUsers") return allUsers(request, env, body);
  if (action === "updateOrCreateUser") return saveUser(request, env, body);
  return null;
}

export { userObject, USER_SELECT };
