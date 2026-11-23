require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const crypto = require('crypto');
const csv = require('csv-parser');
const { Readable } = require('stream');
const rateLimit = require('express-rate-limit');

const {
  uploadFileToDrive,
  createResumableSession,
  finalizeResumableFile,
  verifyResumableFile,
  downloadDriveFile
} = require('./config/googleDrive');
const {
  sendClaimReceivedEmail,
  sendClaimApprovalEmail,
  sendClaimRejectionEmail,
  isValidEmailAddress
} = require('./config/mailer');
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

// Penting karena aplikasi di-deploy di Vercel (di balik reverse proxy)
app.set('trust proxy', 1);

// 1. Limiter khusus login admin (anti brute-force)
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 menit
  max: 5, // maksimal 5 percobaan per IP dalam 15 menit
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Terlalu banyak percobaan login. Coba lagi 15 menit lagi.',
    message: 'Terlalu banyak percobaan login. Coba lagi 15 menit lagi.'
  }
});

// 2. Limiter khusus kirim klaim / upload media (anti spam klaim & abuse kuota)
const claimLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 menit
  max: 15, // maksimal 15 submit klaim per IP dalam 10 menit
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Batas pengiriman klaim tercapai. Silakan tunggu beberapa menit.',
    message: 'Batas pengiriman klaim tercapai. Silakan tunggu beberapa menit.'
  }
});
const driveUploadLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Batas permintaan upload tercapai. Silakan tunggu beberapa menit.'
  }
});
const MAX_CLAIM_FILE_SIZE = 200 * 1024 * 1024;
const ALLOWED_CLAIM_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/jpg',
  'image/heic',
  'image/heif',
  'video/mp4',
  'video/quicktime',
  'video/x-msvideo',
  'video/webm'
];

function normalizeClaimMimeType(fileName, mimeType) {
  const normalizedMime = typeof mimeType === 'string' ? mimeType.toLowerCase().trim() : '';
  if (normalizedMime && normalizedMime !== 'application/octet-stream') {
    return normalizedMime;
  }

  const extension = String(fileName || '').toLowerCase().split('.').pop();
  if (extension === 'heic') return 'image/heic';
  if (extension === 'heif') return 'image/heif';
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg';
  if (extension === 'png') return 'image/png';
  if (extension === 'webp') return 'image/webp';
  return normalizedMime || 'application/octet-stream';
}

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
    fileSize: MAX_CLAIM_FILE_SIZE // Batas ukuran 200MB
  },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_CLAIM_MIME_TYPES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Tipe file tidak didukung. Harap upload foto (JPG/PNG/WEBP) atau video (MP4/MOV/AVI/WEBM).'), false);
    }
  }
});

// Konfigurasi Multer khusus Import CSV
const csvUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 } // Maksimal 10MB untuk CSV
});

// Helper untuk generate Nomor Tiket Unik VANCARE: VC-YYYYMMDD-XXXX
function generateTicketNumber() {
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const randomSuffix = Math.floor(1000 + Math.random() * 9000);
  return `VC-${dateStr}-${randomSuffix}`;
}

function getLocalDateString() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// ===============================================
// SISTEM AUTENTIKASI ADMIN
// ===============================================
// SISTEM AUTENTIKASI ADMIN (Stateless HMAC Token untuk Vercel / Multi-Instance)
// ===============================================

const JWT_SECRET = process.env.SESSION_SECRET || 'vancare_advan_secret_session_2026';

function generateAdminToken(username) {
  const payload = {
    username,
    exp: Date.now() + 7 * 24 * 60 * 60 * 1000 // Berlaku 7 hari
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', JWT_SECRET).update(payloadB64).digest('base64url');
  return `${payloadB64}.${signature}`;
}

function verifyAdminToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;

  const [payloadB64, signature] = parts;
  const expectedSig = crypto.createHmac('sha256', JWT_SECRET).update(payloadB64).digest('base64url');
  if (signature !== expectedSig) return null;

  try {
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    if (payload.exp && Date.now() > payload.exp) return null;
    return payload;
  } catch (e) {
    return null;
  }
}

// Middleware: Validasi token admin
function requireAdminAuth(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: 'Unauthorized: Token tidak ditemukan.' });
  }
  const token = auth.slice(7);
  const session = verifyAdminToken(token);
  if (!session) {
    return res.status(401).json({ success: false, message: 'Unauthorized: Sesi login sudah kadaluarsa. Silakan login kembali.' });
  }
  req.adminUser = session;
  next();
}

async function verifyTurnstileToken(token, clientIp) {
  const secretKey = process.env.TURNSTILE_SECRET_KEY;
  if (!secretKey) {
    const error = new Error('Verifikasi Turnstile belum dikonfigurasi pada server.');
    error.statusCode = 503;
    throw error;
  }
  if (typeof token !== 'string' || token.length === 0 || token.length > 2048) {
    return false;
  }

  const body = new URLSearchParams({
    secret: secretKey,
    response: token
  });
  if (typeof clientIp === 'string' && clientIp) {
    body.set('remoteip', clientIp);
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);
  let response;
  try {
    response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: controller.signal
    });
  } catch (cause) {
    const error = new Error('Layanan verifikasi Turnstile tidak dapat dijangkau.');
    error.statusCode = 502;
    error.cause = cause;
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    const error = new Error('Layanan verifikasi Turnstile mengembalikan respons gagal.');
    error.statusCode = 502;
    throw error;
  }

  let result;
  try {
    result = await response.json();
  } catch (cause) {
    const error = new Error('Respons verifikasi Turnstile tidak valid.');
    error.statusCode = 502;
    error.cause = cause;
    throw error;
  }

  if (!result || typeof result.success !== 'boolean') {
    const error = new Error('Respons verifikasi Turnstile tidak valid.');
    error.statusCode = 502;
    throw error;
  }

  return result.success === true;
}

// ===============================================
// ROUTE HALAMAN UTAMA & ADMIN
// ===============================================

// Halaman Form Klaim Pelanggan
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Halaman Login Admin
app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Halaman Dashboard Admin (proteksi client-side via JS di admin.html)
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/api/config', (req, res) => {
  res.json({ turnstileSiteKey: process.env.TURNSTILE_SITE_KEY || '' });
});

// API: Login Admin (mendukung rute lama dan /api/login, dengan rate limiting)
app.post(['/api/login', '/api/auth/login', '/api/admin/login'], loginLimiter, async (req, res) => {
  const { username, password, captchaToken } = req.body || {};
  const validUser = process.env.ADMIN_USERNAME;
  const validPass = process.env.ADMIN_PASSWORD;

  if (!validUser || !validPass) {
    return res.status(503).json({
      success: false,
      message: 'Login admin belum dikonfigurasi pada server.'
    });
  }

  try {
    const captchaValid = await verifyTurnstileToken(captchaToken, req.ip);
    if (!captchaValid) {
      return res.status(403).json({ success: false, message: 'Verifikasi CAPTCHA gagal. Silakan coba lagi.' });
    }
  } catch (err) {
    console.error('[Auth] Error verifikasi Turnstile:', err.message);
    return res.status(err.statusCode || 502).json({ success: false, message: err.message });
  }

  if (username === validUser && password === validPass) {
    const token = generateAdminToken(username);
    console.log(`[Auth] Login berhasil: ${username}`);
    return res.json({ success: true, token, user: { username } });
  }
  console.log(`[Auth] Login gagal: ${username}`);
  return res.status(401).json({ success: false, message: 'Username atau password salah.' });
});

// API: Verifikasi Token
app.get('/api/auth/verify', (req, res) => {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.json({ success: true, valid: false });
  }
  const token = auth.slice(7);
  const session = verifyAdminToken(token);
  if (!session) return res.json({ success: true, valid: false });
  return res.json({ success: true, valid: true, user: { username: session.username } });
});

// API: Logout Admin
app.post('/api/auth/logout', (req, res) => {
  return res.json({ success: true });
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
app.post('/api/claims', claimLimiter, upload.fields([
  { name: 'proof_photo', maxCount: 5 },
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
      issue_description,
      captchaToken
    } = req.body;

    // Validasi field wajib
    const requiredFields = {
      customer_name,
      customer_email,
      customer_phone,
      customer_address,
      product_category,
      product_name,
      serial_number,
      purchase_date,
      issue_description
    };
    const missingFields = Object.entries(requiredFields)
      .filter(([, value]) => typeof value !== 'string' || value.trim() === '')
      .map(([field]) => field);

    if (missingFields.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Mohon lengkapi semua data wajib sebelum mengirim formulir: ${missingFields.join(', ')}.`
      });
    }

    if (/[\r\n]/.test(customer_email) || !isValidEmailAddress(customer_email)) {
      return res.status(400).json({
        success: false,
        message: 'Format alamat email tidak valid.'
      });
    }

    const captchaValid = await verifyTurnstileToken(captchaToken, req.ip);
    if (!captchaValid) {
      return res.status(403).json({ success: false, message: 'Verifikasi CAPTCHA gagal. Silakan coba lagi.' });
    }

    const purchaseDateValue = purchase_date.trim();
    const dateParts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(purchaseDateValue);
    const parsedPurchaseDate = dateParts
      ? new Date(Date.UTC(Number(dateParts[1]), Number(dateParts[2]) - 1, Number(dateParts[3])))
      : null;
    if (!parsedPurchaseDate ||
        parsedPurchaseDate.getUTCFullYear() !== Number(dateParts[1]) ||
        parsedPurchaseDate.getUTCMonth() !== Number(dateParts[2]) - 1 ||
        parsedPurchaseDate.getUTCDate() !== Number(dateParts[3])) {
      return res.status(400).json({
        success: false,
        message: 'Tanggal pembelian tidak valid. Harap pilih tanggal secara manual.'
      });
    }

    const hasJsonFiles = req.is('application/json') &&
      Object.prototype.hasOwnProperty.call(req.body || {}, 'files');
    const submittedFiles = req.body && req.body.files;
    if (hasJsonFiles && !Array.isArray(submittedFiles)) {
      return res.status(400).json({ success: false, message: 'Daftar file bukti tidak valid.' });
    }

    let photoResult = { fileId: null, webViewLink: null, webContentLink: null, fileName: null, isGoogleDrive: false };
    let videoResult = { fileId: null, webViewLink: null, webContentLink: null, fileName: null, isGoogleDrive: false };
    const uploadedFiles = [];

    if (hasJsonFiles) {
      if (submittedFiles.length > 6) {
        return res.status(400).json({ success: false, message: 'Maksimal 5 foto dan 1 video yang dapat dilampirkan.' });
      }
      let photoCount = 0;
      for (const file of submittedFiles) {
        if (!file || (file.type !== 'photo' && file.type !== 'video') ||
            typeof file.fileId !== 'string' || !/^[a-zA-Z0-9_-]{10,256}$/.test(file.fileId) ||
            typeof file.uploadToken !== 'string' || !/^[a-f0-9]{64}$/.test(file.uploadToken)) {
          return res.status(400).json({ success: false, message: 'Metadata file bukti tidak valid.' });
        }

        if (file.type === 'photo') {
          photoCount++;
          if (photoCount > 5) {
            return res.status(400).json({ success: false, message: 'Maksimal 5 foto yang dapat dilampirkan.' });
          }
        }
        if (file.type === 'video' && videoResult.fileId) {
          return res.status(400).json({ success: false, message: 'Hanya satu file video yang dapat dilampirkan.' });
        }

        const fileId = file.fileId.trim();
        const verifiedFile = await verifyResumableFile(fileId, file.uploadToken);
        const isPhoto = verifiedFile.mimeType.startsWith('image/');
        const isVideo = verifiedFile.mimeType.startsWith('video/');
        if ((file.type === 'photo' && !isPhoto) || (file.type === 'video' && !isVideo)) {
          return res.status(400).json({ success: false, message: 'Jenis file tidak sesuai dengan lampiran klaim.' });
        }

        const canonicalViewLink = `https://drive.google.com/file/d/${encodeURIComponent(fileId)}/view`;
        const canonicalContentLink = `https://drive.google.com/uc?id=${encodeURIComponent(fileId)}&export=download`;
        const result = {
          fileId,
          fileName: verifiedFile.name,
          webViewLink: typeof file.webViewLink === 'string' && file.webViewLink.startsWith('https://drive.google.com/')
            ? file.webViewLink
            : canonicalViewLink,
          webContentLink: typeof file.webContentLink === 'string' && file.webContentLink.startsWith('https://drive.google.com/')
            ? file.webContentLink
            : canonicalContentLink,
          isGoogleDrive: true
        };
        const metadata = {
          type: file.type,
          fileId: result.fileId,
          fileName: result.fileName,
          originalName: typeof file.originalName === 'string' ? file.originalName : result.fileName,
          mimeType: verifiedFile.mimeType,
          size: Number(verifiedFile.size),
          webViewLink: result.webViewLink,
          webContentLink: result.webContentLink,
          isGoogleDrive: true
        };

        uploadedFiles.push(metadata);
        if (file.type === 'photo') {
          if (!photoResult.fileId) photoResult = result;
        } else {
          videoResult = result;
        }
      }
    } else {
      const videoFile = req.files && req.files.proof_video && req.files.proof_video[0];

      let photoFiles = req.files && req.files.proof_photo ? req.files.proof_photo : [];
      if (photoFiles.length === 0 && req.files && req.files.proof_file) {
        photoFiles = req.files.proof_file.slice(0, 5);
      } else if (photoFiles.length === 0 && req.file) {
        photoFiles = [req.file];
      }
      if (photoFiles.length > 5) {
        return res.status(400).json({ success: false, message: 'Maksimal 5 foto yang dapat dilampirkan.' });
      }
      for (const photoFile of photoFiles) {
        console.log(`[Claim API] Upload Foto: ${photoFile.originalname} (${photoFile.size} bytes)`);
        const uploadedPhoto = await uploadFileToDrive(photoFile);
        if (!photoResult.fileId) photoResult = uploadedPhoto;
        uploadedFiles.push({
          type: 'photo',
          fileId: uploadedPhoto.fileId,
          fileName: uploadedPhoto.fileName,
          originalName: photoFile.originalname,
          mimeType: photoFile.mimetype,
          size: photoFile.size,
          webViewLink: uploadedPhoto.webViewLink,
          webContentLink: uploadedPhoto.webContentLink,
          isGoogleDrive: !!uploadedPhoto.isGoogleDrive
        });
      }

      if (videoFile) {
        console.log(`[Claim API] Upload Video: ${videoFile.originalname} (${videoFile.size} bytes)`);
        videoResult = await uploadFileToDrive(videoFile);
        uploadedFiles.push({
          type: 'video',
          fileId: videoResult.fileId,
          fileName: videoResult.fileName,
          originalName: videoFile.originalname,
          mimeType: videoFile.mimetype,
          size: videoFile.size,
          webViewLink: videoResult.webViewLink,
          webContentLink: videoResult.webContentLink,
          isGoogleDrive: !!videoResult.isGoogleDrive
        });
      }
    }

    // Minimal upload 1 bukti (foto atau video)
    if (uploadedFiles.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Mohon lampirkan minimal 1 foto bukti kendala/nota atau video rekaman.'
      });
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
      purchase_date: purchaseDateValue,
      issue_description: issue_description.trim(),
      uploaded_files: uploadedFiles,
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

    // 4. Kirim notifikasi email tanda terima otomatis ke pelanggan (WAJIB di-await agar tidak dihentikan serverless Vercel)
    try {
      await sendClaimReceivedEmail(savedClaim);
    } catch (mailErr) {
      console.error('[Claim API] Error mengirim email tanda terima:', mailErr.message);
    }

    return res.status(201).json({
      success: true,
      message: 'Permohonan klaim garansi VANCARE berhasil dikirim!',
      ticket_number: ticketNumber,
      claim: savedClaim
    });
  } catch (error) {
    console.error('[Claim API] Error proses submit klaim:', error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.statusCode
        ? error.message
        : 'Terjadi kesalahan sistem saat memproses klaim: ' + error.message
    });
  }
});

/**
 * 2. GET /api/claims
 * Ambil daftar semua klaim untuk Dashboard Admin.
 * Mendukung filter status (?status=PENDING / APPROVED) & pencarian (?search=keyword)
 */
app.get('/api/claims', requireAdminAuth, async (req, res) => {
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
app.get('/api/claims/:id', requireAdminAuth, async (req, res) => {
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
app.post('/api/claims/:id/approve', requireAdminAuth, async (req, res) => {
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
 * Menolak klaim garansi dengan alasan & kirim email notifikasi ke pelanggan
 */
app.post('/api/claims/:id/reject', requireAdminAuth, async (req, res) => {
  try {
    const { reason } = req.body || {};
    const id = req.params.id;

    console.log(`[Admin API] Memproses PENOLAKAN untuk klaim ID/Tiket: ${id}, Alasan: ${reason}`);

    const updatedClaim = await rejectClaim(id, reason || 'Tidak memenuhi syarat & ketentuan garansi resmi');

    if (!updatedClaim) {
      return res.status(404).json({
        success: false,
        message: 'Klaim tidak ditemukan'
      });
    }

    // Kirim email notifikasi penolakan ke pelanggan (WAJIB di-await agar tidak dihentikan serverless Vercel)
    try {
      await sendClaimRejectionEmail(updatedClaim);
    } catch (mailErr) {
      console.error('[Admin API] Background rejection email error:', mailErr.message);
    }

    return res.json({
      success: true,
      message: `Klaim #${updatedClaim.ticket_number} berhasil ditolak. Email pemberitahuan telah dikirim ke pelanggan.`,
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
app.get('/api/stats', requireAdminAuth, async (req, res) => {
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

/**
 * 7. POST /api/admin/import-csv
 * Import data klaim secara massal dari file CSV ke database
 */
app.post('/api/admin/import-csv', requireAdminAuth, csvUpload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, message: 'Tidak ada file CSV yang diunggah.' });
  }

  const rows = [];
  const stream = Readable.from(req.file.buffer.toString('utf8'));

  stream
    .pipe(csv())
    .on('data', (row) => rows.push(row))
    .on('end', async () => {
      try {
        let importedCount = 0;

        for (const row of rows) {
          if (!row.customer_name && !row.serial_number) continue;

          const claimPayload = {
            ticket_number: row.ticket_number ? row.ticket_number.trim() : generateTicketNumber(),
            customer_name: (row.customer_name || 'Pelanggan Import').trim(),
            customer_email: (row.customer_email || row.email || '').trim().toLowerCase(),
            customer_phone: (row.customer_phone || row.phone_number || '').trim(),
            customer_address: (row.customer_address || '').trim(),
            product_category: (row.product_category || 'Perangkat').trim(),
            product_name: (row.product_name || row.product_model || '').trim(),
            serial_number: (row.serial_number || '').trim().toUpperCase(),
            purchase_date: row.purchase_date && String(row.purchase_date).trim()
              ? String(row.purchase_date).trim()
              : getLocalDateString(),
            issue_description: (row.issue_description || row.problem_description || '-').trim(),
            status: (row.status || 'PENDING').trim().toUpperCase()
          };

          await saveClaim(claimPayload);
          importedCount++;
        }

        console.log(`[Admin API] Berhasil import ${importedCount} data klaim dari CSV.`);
        return res.json({
          success: true,
          message: `Berhasil mengimpor ${importedCount} data klaim ke sistem VANCARE.`
        });
      } catch (err) {
        console.error('[Admin API] Error saat import CSV:', err);
        return res.status(500).json({
          success: false,
          message: 'Gagal memproses data CSV: ' + err.message
        });
      }
    })
    .on('error', (err) => {
      return res.status(400).json({
        success: false,
        message: 'Format file CSV tidak valid: ' + err.message
      });
    });
});

// Meminta sesi upload langsung ke Google Drive
app.post('/api/drive/init-upload', driveUploadLimiter, async (req, res) => {
  try {
    const { fileName, fileSize, fileType } = req.body || {};
    const mimeType = normalizeClaimMimeType(fileName, req.body?.mimeType);
    if (typeof fileName !== 'string' || !fileName.trim() || fileName.trim().length > 255 ||
        typeof mimeType !== 'string' || !mimeType ||
        !['photo', 'video'].includes(fileType)) {
      return res.status(400).json({ success: false, message: 'Metadata file tidak lengkap.' });
    }
    if (!Number.isSafeInteger(fileSize) || fileSize <= 0 || fileSize > MAX_CLAIM_FILE_SIZE) {
      return res.status(400).json({ success: false, message: 'Ukuran file harus lebih dari 0 dan maksimal 200MB.' });
    }
    const isPhotoMime = mimeType.startsWith('image/');
    const isVideoMime = mimeType.startsWith('video/');
    if (!ALLOWED_CLAIM_MIME_TYPES.includes(mimeType) ||
        (fileType === 'photo' && !isPhotoMime) ||
        (fileType === 'video' && !isVideoMime)) {
      return res.status(400).json({ success: false, message: 'Tipe file tidak didukung.' });
    }

    const session = await createResumableSession({
      fileName,
      mimeType,
      fileSize,
      fileType,
      origin: req.headers.origin
    });

    return res.json({ success: true, ...session });
  } catch (err) {
    console.error('[Drive Init Upload Error]:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// Memverifikasi file hasil upload dan mengembalikan metadata untuk klaim
app.post('/api/drive/finalize-upload', driveUploadLimiter, async (req, res) => {
  try {
    const { fileId, uploadToken } = req.body || {};
    if (typeof fileId !== 'string' || !/^[a-zA-Z0-9_-]{10,256}$/.test(fileId) ||
        typeof uploadToken !== 'string' || !/^[a-f0-9]{64}$/.test(uploadToken)) {
      return res.status(400).json({ success: false, message: 'Identitas file atau sesi upload tidak valid.' });
    }

    const result = await finalizeResumableFile(fileId, uploadToken);
    return res.json({ success: true, file: result });
  } catch (err) {
    console.error('[Drive Finalize Error]:', err.message);
    return res.status(err.statusCode || 500).json({ success: false, message: err.message });
  }
});

app.get('/api/admin/drive/:fileId', requireAdminAuth, async (req, res) => {
  const { fileId } = req.params;
  if (!/^[a-zA-Z0-9_-]{10,256}$/.test(fileId)) {
    return res.status(400).json({ success: false, message: 'ID file tidak valid.' });
  }

  try {
    const { metadata, stream } = await downloadDriveFile(fileId);
    if (!ALLOWED_CLAIM_MIME_TYPES.includes(metadata.mimeType) ||
        !Number.isSafeInteger(Number(metadata.size)) ||
        Number(metadata.size) <= 0 ||
        Number(metadata.size) > MAX_CLAIM_FILE_SIZE) {
      return res.status(415).json({ success: false, message: 'Tipe atau ukuran file tidak didukung.' });
    }

    res.setHeader('Content-Type', metadata.mimeType);
    res.setHeader('Content-Disposition', 'inline');
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    stream.on('error', err => {
      console.error('[Drive File Proxy Error]:', err.message);
      if (!res.headersSent) {
        res.status(502).json({ success: false, message: 'Gagal membaca file dari Google Drive.' });
      } else {
        res.destroy(err);
      }
    });
    stream.pipe(res);
  } catch (err) {
    console.error('[Drive File Proxy Error]:', err.message);
    return res.status(err.statusCode || (err.code === 404 ? 404 : 500)).json({
      success: false,
      message: err.statusCode ? err.message : 'Gagal membaca file dari Google Drive.'
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
if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`================================================================`);
    console.log(`🚀 VANCARE ADVAN WARRANTY SYSTEM SERVER AKTIF`);
    console.log(`📍 URL Formulir Pelanggan : http://localhost:${PORT}`);
    console.log(`📍 URL Dashboard Admin   : http://localhost:${PORT}/admin`);
    console.log(`📁 Upload Dir Bukti     : http://localhost:${PORT}/uploads`);
    console.log(`================================================================`);
  });
}

module.exports = app;