require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const multer = require('multer');

const { uploadFileToDrive } = require('./config/googleDrive');
const { sendClaimReceivedEmail, sendClaimApprovalEmail } = require('./config/mailer');
const {
  saveClaim,
  getAllClaims,
  getClaimById,
  approveClaim,
  rejectClaim,
  getStats
} = require('./config/supabase');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Sajikan folder public untuk aset statis (HTML, CSS, JS, Uploads fallback)
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'public', 'uploads')));

// Konfigurasi Multer (Memory Storage agar efisien di-stream ke Google Drive)
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 200 * 1024 * 1024 // Batas ukuran 200MB (Mendukung Foto Resolusi Tinggi & Video Bukti Kendala Panjang)
  },
  fileFilter: (req, file, cb) => {
    // Validasi tipe file (Gambar, Video, atau Dokumen PDF)
    const allowedMime = [
      'image/jpeg',
      'image/png',
      'image/webp',
      'image/jpg',
      'video/mp4',
      'video/quicktime',
      'video/x-msvideo',
      'video/webm',
      'application/pdf'
    ];
    if (allowedMime.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Tipe file tidak didukung. Harap upload foto (JPG/PNG), video (MP4/MOV), atau dokumen PDF.'), false);
    }
  }
});

// Helper untuk generate Nomor Tiket Unik VANCARE: VC-YYYYMMDD-XXXX
function generateTicketNumber() {
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const randomSuffix = Math.floor(1000 + Math.random() * 9000);
  return `VC-${dateStr}-${randomSuffix}`;
}

// ===============================================
// ROUTE HALAMAN UTAMA & ADMIN
// ===============================================

// Halaman Form Klaim Pelanggan
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Halaman Dashboard Admin
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// ===============================================
// REST API ENDPOINTS
// ===============================================

/**
 * 1. POST /api/claims
 * Form submission klaim garansi oleh pelanggan.
 * Menerima data pelanggan + file foto/video bukti kerusakan,
 * upload ke Google Drive, simpan ke database, dan kirim email tanda terima.
 */
app.post('/api/claims', upload.fields([
  { name: 'proof_photo', maxCount: 1 },
  { name: 'proof_video', maxCount: 1 },
  { name: 'proof_file', maxCount: 1 }
]), async (req, res) => {
  try {
    const {
      customer_name,
      customer_email,
      customer_phone,
      customer_address,
      product_category,
      product_name,
      serial_number,
      purchase_date,
      issue_description
    } = req.body;

    // Validasi field wajib
    if (!customer_name || !customer_email || !customer_phone || !product_name || !serial_number || !issue_description) {
      return res.status(400).json({
        success: false,
        message: 'Mohon lengkapi semua data wajib: Nama, Email, Telepon, Kategori & Tipe Produk, Serial Number, dan Deskripsi Kendala.'
      });
    }

    const photoFile = (req.files && req.files.proof_photo && req.files.proof_photo[0]) || 
                      (req.files && req.files.proof_file && req.files.proof_file[0]) || 
                      req.file;
    const videoFile = req.files && req.files.proof_video && req.files.proof_video[0];

    // Minimal upload 1 bukti (foto atau video)
    if (!photoFile && !videoFile) {
      return res.status(400).json({
        success: false,
        message: 'Mohon lampirkan minimal 1 foto bukti kendala/nota atau video rekaman.'
      });
    }

    // 1. Upload file foto & video ke Google Drive 400GB (atau fallback lokal)
    let photoResult = { fileId: null, webViewLink: null, webContentLink: null, fileName: null };
    let videoResult = { fileId: null, webViewLink: null, webContentLink: null, fileName: null };

    if (photoFile) {
      console.log(`[Claim API] Upload Foto: ${photoFile.originalname} (${photoFile.size} bytes)`);
      photoResult = await uploadFileToDrive(photoFile);
    }

    if (videoFile) {
      console.log(`[Claim API] Upload Video: ${videoFile.originalname} (${videoFile.size} bytes)`);
      videoResult = await uploadFileToDrive(videoFile);
    }

    // 2. Buat objek data klaim
    const ticketNumber = generateTicketNumber();
    const newClaimData = {
      ticket_number: ticketNumber,
      customer_name: customer_name.trim(),
      customer_email: customer_email.trim().toLowerCase(),
      customer_phone: customer_phone.trim(),
      customer_address: customer_address ? customer_address.trim() : '',
      product_category: (product_category || 'Perangkat').trim(),
      product_name: product_name.trim(),
      serial_number: serial_number.trim().toUpperCase(),
      purchase_date: purchase_date || null,
      issue_description: issue_description.trim(),
      // Foto Bukti
      photo_file_id: photoResult.fileId,
      photo_url: photoResult.webViewLink,
      photo_file_name: photoResult.fileName,
      // Video Bukti
      video_file_id: videoResult.fileId,
      video_url: videoResult.webViewLink,
      video_file_name: videoResult.fileName,
      // Fallback compatibilitas
      drive_file_id: photoResult.fileId || videoResult.fileId,
      drive_file_url: photoResult.webViewLink || videoResult.webViewLink,
      drive_file_name: photoResult.fileName || videoResult.fileName,
      is_google_drive: !!(photoResult.isGoogleDrive || videoResult.isGoogleDrive),
      status: 'PENDING'
    };

    // 3. Simpan ke database Supabase (atau fallback JSON)
    const savedClaim = await saveClaim(newClaimData);
    console.log(`[Claim API] Klaim berhasil disimpan dengan nomor tiket: ${ticketNumber}`);

    // 4. Kirim notifikasi email tanda terima otomatis ke pelanggan
    sendClaimReceivedEmail(savedClaim).catch(mailErr => {
      console.error('[Claim API] Background email error:', mailErr.message);
    });

    return res.status(201).json({
      success: true,
      message: 'Permohonan klaim garansi VANCARE berhasil dikirim!',
      ticket_number: ticketNumber,
      claim: savedClaim
    });
  } catch (error) {
    console.error('[Claim API] Error proses submit klaim:', error);
    return res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan sistem saat memproses klaim: ' + error.message
    });
  }
});

/**
 * 2. GET /api/claims
 * Ambil daftar semua klaim untuk Dashboard Admin.
 * Mendukung filter status (?status=PENDING / APPROVED) & pencarian (?search=keyword)
 */
app.get('/api/claims', async (req, res) => {
  try {
    const { status, search } = req.query;
    let claims = await getAllClaims({ status });

    if (search && search.trim() !== '') {
      const q = search.toLowerCase().trim();
      claims = claims.filter(c =>
        (c.ticket_number && c.ticket_number.toLowerCase().includes(q)) ||
        (c.customer_name && c.customer_name.toLowerCase().includes(q)) ||
        (c.customer_email && c.customer_email.toLowerCase().includes(q)) ||
        (c.product_name && c.product_name.toLowerCase().includes(q)) ||
        (c.serial_number && c.serial_number.toLowerCase().includes(q))
      );
    }

    return res.json({
      success: true,
      count: claims.length,
      data: claims
    });
  } catch (error) {
    console.error('[Admin API] Error get claims:', error);
    return res.status(500).json({
      success: false,
      message: 'Gagal mengambil data klaim: ' + error.message
    });
  }
});

/**
 * 3. GET /api/claims/:id
 * Detail klaim berdasarkan ID atau Nomor Tiket
 */
app.get('/api/claims/:id', async (req, res) => {
  try {
    const claim = await getClaimById(req.params.id);
    if (!claim) {
      return res.status(404).json({
        success: false,
        message: 'Klaim tidak ditemukan'
      });
    }
    return res.json({
      success: true,
      data: claim
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * 4. POST /api/claims/:id/approve
 * TOMBOL "SEKALI KLIK APPROVE"
 * Mengubah status klaim menjadi APPROVED dan mengirim email instruksi servis resmi ke pelanggan
 */
app.post('/api/claims/:id/approve', async (req, res) => {
  try {
    const { notes } = req.body || {};
    const id = req.params.id;

    console.log(`[Admin API] Memproses SEKALI KLIK APPROVE untuk klaim ID/Tiket: ${id}`);

    // Update status di database Supabase
    const updatedClaim = await approveClaim(id, notes || 'Disetujui oleh Admin VANCARE');

    if (!updatedClaim) {
      return res.status(404).json({
        success: false,
        message: 'Klaim tidak ditemukan atau gagal diperbarui'
      });
    }

    // Kirim email konfirmasi approval ke pelanggan via Nodemailer
    const emailResult = await sendClaimApprovalEmail(updatedClaim);

    return res.json({
      success: true,
      message: `Klaim #${updatedClaim.ticket_number} berhasil disetujui! Email instruksi penanganan telah dikirim ke ${updatedClaim.customer_email}.`,
      emailStatus: emailResult,
      claim: updatedClaim
    });
  } catch (error) {
    console.error('[Admin API] Gagal approve klaim:', error);
    return res.status(500).json({
      success: false,
      message: 'Gagal memproses persetujuan klaim: ' + error.message
    });
  }
});

/**
 * 5. POST /api/claims/:id/reject
 * Menolak klaim garansi dengan alasan
 */
app.post('/api/claims/:id/reject', async (req, res) => {
  try {
    const { reason } = req.body || {};
    const id = req.params.id;

    const updatedClaim = await rejectClaim(id, reason || 'Tidak memenuhi syarat & ketentuan garansi resmi');

    return res.json({
      success: true,
      message: `Klaim #${updatedClaim.ticket_number} ditolak.`,
      claim: updatedClaim
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Gagal menolak klaim: ' + error.message
    });
  }
});

/**
 * 6. GET /api/stats
 * Statistik ringkas untuk widget KPI Admin Dashboard
 */
app.get('/api/stats', async (req, res) => {
  try {
    const stats = await getStats();
    return res.json({
      success: true,
      stats
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// Middleware penanganan Multer Error (misal ukuran melebihi 200MB)
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        success: false,
        message: 'Ukuran file melebihi batas maksimal 200MB. Harap perkecil ukuran file atau kompres video Anda.'
      });
    }
    return res.status(400).json({ success: false, message: 'Upload error: ' + err.message });
  } else if (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
  next();
});

// Start Server
app.listen(PORT, () => {
  console.log(`================================================================`);
  console.log(`🚀 VANCARE ADVAN WARRANTY SYSTEM SERVER AKTIF`);
  console.log(`📍 URL Formulir Pelanggan : http://localhost:${PORT}`);
  console.log(`📍 URL Dashboard Admin   : http://localhost:${PORT}/admin`);
  console.log(`📁 Upload Dir Bukti     : http://localhost:${PORT}/uploads`);
  console.log(`================================================================`);
});
