# Cutover SiTeki ke Neon PostgreSQL

## Arsitektur produksi

```text
Browser SiTeki
    |
    | HTTPS + bearer session
    v
Cloudflare Worker: siteki-neon-api
    |
    | DATABASE_URL (secret Worker)
    v
Neon PostgreSQL
```

Frontend tidak terhubung langsung ke PostgreSQL. Password pengguna disimpan sebagai hash bcrypt dan token sesi disimpan dalam bentuk SHA-256 pada tabel `api_sessions`.

## Resource API

Satu Worker melayani resource berikut melalui query `resource`:

- `users`: login, logout, profil, teknisi, lembur, dan rekap lembur.
- `orders`: baca, membuat, dan menyelesaikan order kerja.
- `maintenance` dan `maintenance-master`.
- `jobs`: laporan kerja dan master part.
- `stock`, `parts`, `part-order`, dan `part-requests`.
- `electricity`, `stang`, `transformers`, dan `oil`.
- `kpi`, `kpi-combined`, `downtime`, dan `maintenance-detail`.

## Status migrasi historis

Migration `001` sampai `021` telah diterapkan. Audit terakhir mencakup:

- 89 mesin dan 35 pengguna.
- 520 part, 517 saldo stok, dan 742 permintaan part.
- 21 order kerja dan 1.807 laporan kerja.
- 1.281 jadwal serta 1.276 inspeksi perawatan.
- 38 lembur, 134 pemeriksaan listrik, dan 2.026 transaksi stang.
- 95 trafo, 5 inspeksi trafo, 31 reservoir, dan 162 pemeriksaan oli.

Seluruh jumlah sumber cocok dengan Neon. Data historis yang relasinya belum pasti tetap disimpan lengkap pada kolom denormalisasi dan `legacy_data`.

## Urutan deployment

1. Pastikan `.env` lokal memiliki `DATABASE_URL` Neon yang benar.
2. Jalankan `npm run db:migrate`.
3. Jalankan `npm run worker:smoke`.
4. Simpan `DATABASE_URL` menggunakan `npx wrangler secret put DATABASE_URL`.
5. Jalankan `npm run worker:deploy`.
6. Jalankan `npm run check:connections`.
7. Jalankan `npm run build`.
8. Unggah isi `dist/` ke hosting frontend.
9. Logout dan login kembali. Token Apps Script lama tidak berlaku pada API Neon.
10. Jalankan uji baca/tulis untuk order, laporan, perawatan, listrik, part, trafo, stang, lembur, pengguna, dan oli.

## Cutover dan pengarsipan

Setelah frontend Neon diterbitkan:

- Jangan lagi memasukkan data baru melalui Spreadsheet atau aplikasi lama.
- Simpan Spreadsheet dalam mode hanya-baca selama masa observasi.
- Jangan menjalankan ulang importer satu kali terhadap tabel Neon yang sudah aktif.
- Gunakan backup/restore Neon sebelum perubahan schema besar.
- Folder `google-apps-script/` boleh disimpan sebagai arsip, tetapi bukan bagian runtime.

## Rollback

Jika API Neon bermasalah sebelum cutover dinyatakan stabil:

1. Jangan menghapus data baru yang sudah masuk ke Neon.
2. Kembalikan frontend build sebelumnya.
3. Ekspor record Neon yang dibuat setelah waktu cutover.
4. Rekonsiliasi record tersebut sebelum mengaktifkan kembali input pada sistem lama.

Rollback frontend tidak otomatis menyalin data Neon kembali ke Spreadsheet.
