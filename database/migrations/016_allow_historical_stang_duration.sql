BEGIN;

-- Riwayat Spreadsheet memuat durasi negatif akibat tanggal kembali yang lebih
-- awal daripada tanggal keluar. Nilai sumber dipertahankan dan ditandai melalui
-- stang_transactions.data_anomaly, bukan ditolak oleh database.
ALTER TABLE stang_transactions
  DROP CONSTRAINT IF EXISTS stang_transactions_duration_nonnegative;

COMMIT;
