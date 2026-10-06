const RETRY_ATTEMPTS = 3;
const RETRY_DELAY_MS = 600;

function isModuleFetchError(error) {
  const message = error?.message || "";
  return /failed to fetch dynamically imported module|error loading dynamically imported module|importing a module script failed/i.test(message);
}

async function retryImport(importFn) {
  let lastError;
  for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt += 1) {
    try {
      return await importFn();
    } catch (error) {
      lastError = error;
      if (!isModuleFetchError(error) || attempt === RETRY_ATTEMPTS) {
        break;
      }
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS * attempt));
    }
  }
  if (isModuleFetchError(lastError)) {
    throw new Error(
      "Gagal mengunduh modul pengolah Excel dari server (koneksi terputus atau sesi hosting kedaluwarsa). Silakan refresh halaman (Ctrl + F5) dan coba lagi."
    );
  }
  throw lastError;
}

let dataWorkbookPromise = null;
let directWorkbookPromise = null;

export function loadDataWorkbook() {
  if (!dataWorkbookPromise) {
    dataWorkbookPromise = retryImport(() => import("./dataWorkbook.js")).catch(error => {
      dataWorkbookPromise = null;
      throw error;
    });
  }
  return dataWorkbookPromise;
}

export function loadDirectWorkbook() {
  if (!directWorkbookPromise) {
    directWorkbookPromise = retryImport(() => import("./directWorkbook.js")).catch(error => {
      directWorkbookPromise = null;
      throw error;
    });
  }
  return directWorkbookPromise;
}

export function preloadWorkbookModules() {
  loadDataWorkbook().catch(() => {});
  loadDirectWorkbook().catch(() => {});
}
