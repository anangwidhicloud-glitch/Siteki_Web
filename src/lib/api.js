const BASE = "https://script.google.com/macros/s/";

export const ENDPOINTS = {
  login: `${BASE}AKfycbzzdAkBlB9PVR3aAtPmkuZ5OCO9Cz31S-zlGiQfPcPsUkhTfjsHQt6gasEO4qNvSFU/exec`,
  dashboardOrders: `${BASE}AKfycbyP84TUvoujsa0uuCYLR172Ft7EHzY_ofH_XkmJnYh1Y3qDICdSnlBBkGf9VU1WivQ/exec`,
  orders: `${BASE}AKfycbw5xLyV1iIkfNofQsJC87fYscocDAJ8GU5iQh1WunHjYy8zS-T6sFkb77z79AptiTY/exec`,
  createOrder: `${BASE}AKfycbzvd9W_bXkvRd5J0j3xU_ytpKfoo7pMS57wBeBOkKl991DcH10qElnrIdUvUKdwc30/exec`,
  completeOrder: `${BASE}AKfycbyEz9WL-SsHlsl8nROHs28HVijqVu_UptKDuLMBI3z2mo6pDH_vIxOVM9B_fjmNow/exec`,
  maintenance: `${BASE}AKfycbwQ7ocBNsl4x5-rGLrSyvkyluhSRl3B_LvmkA3cFuvuL9pBbVAOUI3i_Vu6jwfkfOA/exec`,
  maintenanceMaster: `${BASE}AKfycbwSnaaYVxXWVngeGQYU2im2G5FQ6L7WstjTkx7IW3jVYcuELECt0_cyvM0cFx4Uf8U/exec`,
  jobs: `${BASE}AKfycbwYHHf8ONKbs9m5CppnzUuo067CBvrqRRfLYzl5ABwOH81sVWnFD8AyPx6F6Vf3uC4/exec`,
  electricity: `${BASE}AKfycbx4YbnLXFsnwDDV-Kso7Lx3Cu2R6tEYBkaEnRM_fnU-RBUoSWo-xZR9DIoHfzjwYd0/exec`,
  stock: `${BASE}AKfycbxHnZzPQ3jCrMU3tvRGTiQnBIZe7pETN7iWr8e4amU4cdgi22TVzEFjB84ZXUohBDvD/exec`,
  partOrder: `${BASE}AKfycbwHVQ2pB4rKZXuZTLcffgIAHiRgo4lP_wPCieNNOd2XFdOxhHehcoo5DgxSBd2wUl8/exec`,
  partRequests: `${BASE}AKfycbxJOKT1yM71bQr1PbJSJ7X6q-RdJ1nmUpjvutRzkBvIYuPbZM2cGh3NuQ0X62GCJkVd/exec`,
  transformer: `${BASE}AKfycbyX0U2MaTrjBTZjLkTH64E3bIXg2lyHhtPdTJ1QbEFco34m3FK18gDDE0Lqk7ja-k-C/exec`,
  transformerData: `${BASE}AKfycbyaJ1oCCTfcti5u98MYyWP9OBA96SGPEmL_dchslJ9myC4dEv4ku8bZebYAxyqt0aA/exec`,
  stang: `${BASE}AKfycbw2mqd4JU5ILu85ql2HrEmT4ksv0vR95bo9MqGWwRyXqOWUEdBWk3yYG9CTYXoTF9g/exec`,
  kpi: `${BASE}AKfycbyEO5MruO0r1StkK0iyEoQmfaa3iTZJDCAh4vg9-jdpqItGlt1yuPDe7orWDHwXRyU/exec`,
  kpiCombined: `${BASE}AKfycbxWrt_-ItPd_61v0uLh1oLn1g0l3v5ov9ApsQFKoNuq8r7OGQIT8yXyRytgx7RSvbM/exec`,
  downtime: `${BASE}AKfycbwXEeFSt5dCP-gPUtSbLX1WCfvPfSe7wJGnMs4vwEt1djVQNVjXxUdv8_ly9uFvM4o/exec`,
  maintenanceDetail: `${BASE}AKfycbzxLaO2nEOxkUmBQnM0jAYzay7GGKBnOjhR3Afk9ZLUadK145ZdvOE-0NvIJ55EFKs/exec`
};

function withQuery(url, params = {}) {
  const target = new URL(url);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      target.searchParams.set(key, String(value));
    }
  });
  target.searchParams.set("_", Date.now());
  return target.toString();
}

async function parseResponse(response) {
  const text = await response.text();
  if (!response.ok) throw new Error(`Permintaan server gagal (HTTP ${response.status}).`);
  if (!text.trim()) return { status: "success" };
  try {
    return JSON.parse(text);
  } catch {
    return { status: /success/i.test(text) ? "success" : "unknown", message: text };
  }
}

export async function apiGet(endpoint, params = {}, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeout || 30000);
  try {
    const response = await fetch(withQuery(endpoint, params), {
      method: "GET",
      cache: "no-store",
      signal: controller.signal,
      redirect: "follow"
    });
    return await parseResponse(response);
  } finally {
    clearTimeout(timeout);
  }
}

export async function apiPost(endpoint, payload, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeout || 30000);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload),
      signal: controller.signal,
      redirect: "follow"
    });
    return await parseResponse(response);
  } finally {
    clearTimeout(timeout);
  }
}

export function asArray(value, keys = ["data", "rows", "result"]) {
  if (Array.isArray(value)) return value;
  for (const key of keys) if (Array.isArray(value?.[key])) return value[key];
  return [];
}

export function isSuccess(value) {
  if (!value) return false;
  if (value.status === undefined) return true;
  return /success|ok|berhasil/i.test(String(value.status)) ||
    /success|berhasil/i.test(String(value.message || ""));
}
