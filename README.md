# SiTeki Web

Versi web responsif dari aplikasi Android SiTeki. Navigasi, pembagian role, urutan alur layar, Firestore, dan Google Apps Script memakai sumber data yang sama dengan Android.

## Menjalankan

```bash
npm install
npm run dev
```

Build produksi:

```bash
npm run build
```

Login menggunakan API Google Apps Script yang sama dengan Android. Tidak ada bypass login; role pengguna selalu berasal dari respons database.

## Sumber data

- Firestore `master_mesin` dan `master_part`
- Spreadsheet order kerja dan penyelesaian
- Spreadsheet laporan kerja
- Spreadsheet perawatan dan master perawatan
- Spreadsheet listrik
- Spreadsheet stok part dan daftar bon
- Spreadsheet pengguna
- Spreadsheet trafo dan inspeksi
- Spreadsheet lembur dan rekap
- Spreadsheet stang
- Spreadsheet KPI dan downtime

Tidak ada mode data contoh. Jika backend tidak dapat dijangkau, halaman menampilkan status koneksi dan tombol coba lagi.

Untuk memeriksa seluruh koneksi baca:

```bash
npm run check:connections
```
