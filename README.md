# VANCARE Advan - Sistem Web Klaim Garansi Resmi

Aplikasi web manajemen klaim garansi resmi untuk produk Advan (**VANCARE**) yang terintegrasi langsung dengan:
1. **Google Drive API (Storage 400GB)**: Penyimpanan foto dan video rekaman bukti kerusakan unit secara otomatis.
2. **Nodemailer (Gmail SMTP)**: Pengiriman email tanda terima tiket dan notifikasi persetujuan (approval) dengan panduan penanganan unit ke pelanggan.
3. **Supabase Database**: Penyimpanan data klaim garansi yang cepat dan terstruktur (lengkap dengan skema SQL & fallback lokal).
4. **Dashboard Admin Modern**: Dilengkapi tabel antrean, filter status, pencarian, preview file media, dan tombol **"⚡ Sekali Klik Approve"**.

---

## 📁 Struktur Folder & File Proyek

```
vancare-app/
├── config/
│   ├── googleDrive.js      # Integrasi Google Drive API & Service Account (Upload Foto/Video)
│   ├── mailer.js           # Integrasi Nodemailer Gmail SMTP (Email Konfirmasi & Approval)
│   └── supabase.js         # Koneksi Supabase Database (CRUD Klaim & Fallback Otomatis)
├── public/
│   ├── index.html          # Form Klaim Garansi untuk Pelanggan (Upload File, Validasi, Respon Cepat)
│   ├── admin.html          # Dashboard Admin VANCARE (Tabel Klaim, Preview Drive, 1-Click Approve)
│   └── uploads/            # Direktori penyimpanan file lokal (Fallback otomatis jika Drive offline)
├── .env                    # Variabel konfigurasi lingkungan aktif
├── .env.example            # Template konfigurasi variabel lingkungan
├── credentials.json        # File Kunci Service Account Google Cloud (Drive 400GB)
├── database.sql            # Skrip SQL untuk inisialisasi tabel di Supabase
├── package.json            # Daftar modul dependensi Express, Multer, Supabase, Nodemailer, dll.
├── server.js               # Main Express Server & REST API Endpoints
└── README.md               # Dokumentasi lengkap proyek
```

---

## 🚀 Cara Menjalankan Aplikasi

### 1. Install Dependencies
Buka terminal di direktori proyek `d:\vancare-app`, lalu jalankan:
```bash
npm install
```

### 2. Konfigurasi Lingkungan (`.env`)
Buka file `.env` dan sesuaikan parameter berikut:
```env
PORT=3000

# Supabase (Dapatkan dari https://supabase.com -> Project Settings -> API)
SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_KEY=your-supabase-key

# Google Drive (ID Folder tujuan penyimpanan 400GB)
GOOGLE_APPLICATION_CREDENTIALS=credentials.json
GOOGLE_DRIVE_FOLDER_ID=your_shared_drive_folder_id

# Email Notifikasi Gmail (App Password 16 Digit)
EMAIL_USER=vancare.advan@gmail.com
EMAIL_PASS=your_gmail_app_password
EMAIL_FROM_NAME="VANCARE Advan Customer Care"
```

> **Catatan:** Jika Supabase, Google Drive, atau Gmail belum disetup secara penuh, aplikasi memiliki **Built-in Fallback System** (penyimpanan lokal dan log simulasi) sehingga aplikasi **dapat langsung diuji tanpa error**!

### 3. Jalankan Server
```bash
npm start
```
Atau untuk mode pengembangan:
```bash
npm run dev
```

### 4. Buka di Browser
- **Formulir Klaim Pelanggan:** [http://localhost:3000](http://localhost:3000)
- **Dashboard Admin VANCARE:** [http://localhost:3000/admin](http://localhost:3000/admin)

---

## 🛠️ Konfigurasi Modul Eksternal

### A. Google Drive API (Penyimpanan Foto/Video 400GB)
1. Buka [Google Cloud Console](https://console.cloud.google.com).
2. Aktifkan **Google Drive API**.
3. Buat **Service Account** di menu *IAM & Admin* > *Service Accounts*.
4. Buat kunci baru bertipe **JSON**, lalu simpan isinya ke file `credentials.json` di root folder.
5. Buka Google Drive (Folder / Shared Drive 400GB Anda), lalu bagikan (Share) folder tersebut ke email Service Account (misal: `xxx@xxx.iam.gserviceaccount.com`) dengan hak akses **Editor** / **Penyelenggara Konten**.
6. Salin ID folder dari URL browser ke variabel `GOOGLE_DRIVE_FOLDER_ID` di `.env`.

### B. Nodemailer (Gmail App Password)
1. Buka Akun Google Anda -> **Keamanan (Security)**.
2. Pastikan **Verifikasi 2 Langkah (2-Step Verification)** aktif.
3. Cari menu **Sandi Aplikasi (App Passwords)**.
4. Buat sandi baru untuk aplikasi (misal beri nama `VANCARE`), Anda akan mendapatkan kode 16 digit.
5. Masukkan email Anda ke `EMAIL_USER` dan kode 16 digit ke `EMAIL_PASS` di `.env`.

### C. Supabase Database
1. Buka [Supabase](https://supabase.com) dan buat proyek baru.
2. Buka menu **SQL Editor**, lalu jalankan query yang ada di file [database.sql](database.sql).
3. Salin **Project URL** dan **Anon / Service Key** ke file `.env`.

---

## ⚡ Fitur Utama

- **Validasi Lengkap & Upload Drag-and-Drop:** Pelanggan dapat mengunggah foto maupun rekaman video kendala hingga 50MB.
- **Generate Tiket Unik Otomatis:** Format standar `VC-YYYYMMDD-XXXX`.
- **Sekali Klik Approve (One-Click Approval):** Admin cukup menekan 1 tombol untuk menyetujui klaim, otomatis mengupdate status di database dan mengirimkan email instruksi pengiriman/servis ke pelanggan.
- **Preview Media Drive:** Link langsung ke file di Google Drive untuk mempermudah pengecekan teknisi.
