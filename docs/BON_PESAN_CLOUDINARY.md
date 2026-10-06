# Foto Bon Pesan dengan Cloudinary

Worker SiTeki mengunggah foto yang sudah dikompres oleh browser melalui API Cloudinary bertanda tangan. API secret tidak pernah dikirim ke frontend.

Isi bagian Cloudinary pada `.env.deploy.local`:

```dotenv
CLOUDINARY_CLOUD_NAME=nama_cloud_anda
CLOUDINARY_API_KEY=api_key_anda
CLOUDINARY_API_SECRET=api_secret_anda
CLOUDINARY_BON_FOLDER=siteki/bon-pesan
```

File `.env.deploy.local` sudah diabaikan oleh Git. Jangan menyalin nilainya ke file frontend yang memakai awalan `VITE_`, karena variabel tersebut dapat masuk ke bundle browser.

Sinkronkan nilainya ke secret Cloudflare Worker, kemudian jalankan migrasi dan deploy:

```powershell
npm run worker:secrets:cloudinary
npm run db:migrate
npm run worker:deploy
```

Perintah sinkronisasi hanya membaca empat variabel Cloudinary dan tidak membaca atau mengirim kredensial FTP. Nilai credential juga tidak dicetak ke terminal.

Foto asli dibatasi 12 MB. Browser mencoba AVIF, WebP, dan JPEG, lalu memilih hasil terkecil yang didukung perangkat dengan kualitas tinggi. Foto dokumen bon ditargetkan di bawah 600 KB dengan dimensi terpanjang maksimal 1.800 piksel. AVIF/WebP biasanya memberi ukuran lebih kecil daripada JPEG pada kejernihan visual yang setara; JPEG tetap tersedia sebagai fallback kompatibilitas.

Setiap barang dalam satu transaksi juga dapat memiliki satu foto sampel opsional. Foto sampel digunakan ketika ukuran atau jenis barang belum pasti dan perlu diperlihatkan kepada bagian pembelian. Foto ini diproses tanpa mode scanner, ditargetkan di bawah 320 KB dengan dimensi terpanjang maksimal 1.400 piksel, lalu disimpan sebagai aset Cloudinary terpisah. URL dan metadata foto disimpan pada item `part_requests` melalui migrasi `031_add_part_request_sample_photos.sql`.

Saat transaksi dihapus, Worker juga mencoba menghapus foto dokumen dan seluruh foto sampel item dari Cloudinary. Foto sampel dapat dilihat melalui thumbnail pada detail Bon Pesan.

Mode scan mendeteksi tepi kertas, memotong latar di luar bon, mengoreksi perspektif, meningkatkan kontras, dan mengubah hasil menjadi hitam-putih. Jika tepi dokumen tidak terdeteksi dengan aman, foto penuh dipertahankan agar isi bon tidak terpotong. Mode ini tidak menggunakan OCR dan tidak mengisi daftar barang secara otomatis.
