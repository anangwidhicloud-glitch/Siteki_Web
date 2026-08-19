# SiTeki Web

Dashboard engineering SiTeki berbasis React/Vite. Runtime produksi menggunakan satu sumber data utama: Neon PostgreSQL melalui Cloudflare Worker `siteki-neon-api`.

Google Spreadsheet dan Firestore tidak digunakan lagi oleh frontend maupun API produksi. Folder `google-apps-script/` dan script `import-*.mjs` dipertahankan hanya sebagai arsip serta alat migrasi historis.

## Menjalankan frontend

```bash
npm install
npm run dev
```

Build produksi:

```bash
npm run build
```

Alamat API ditentukan oleh:

```env
VITE_API_URL="https://siteki-neon-api.siteki.workers.dev"
```

`DATABASE_URL` tidak boleh menggunakan awalan `VITE_` dan tidak boleh dimasukkan ke frontend.

## Database Neon

Terapkan seluruh migration:

```bash
npm run db:migrate
```

Verifikasi data historis Spreadsheet-versus-Neon:

```bash
npm run db:verify:all
```

Verifier tersebut hanya digunakan selama masa rekonsiliasi. Setelah Spreadsheet diarsipkan, pemeriksaan runtime memakai:

```bash
npm run worker:smoke
```

## API Neon

Validasi bundle Worker tanpa deployment:

```bash
npm run worker:check
```

Secret database harus disimpan pada Cloudflare, bukan di repository:

```bash
npx wrangler secret put DATABASE_URL
```

Deployment:

```bash
npm run worker:deploy
```

Setelah deployment, periksa seluruh koneksi remote:

```bash
npm run check:connections
```

Rincian cutover dan rollback tersedia di `docs/NEON_CUTOVER.md`.
