const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Cek apakah konfigurasi Supabase valid
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_KEY;

const isSupabaseConfigured =
  supabaseUrl &&
  supabaseKey &&
  !supabaseUrl.includes('your-project') &&
  !supabaseKey.includes('your-supabase');

let supabase = null;

if (isSupabaseConfigured) {
  try {
    supabase = createClient(supabaseUrl, supabaseKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false
      }
    });
    console.log('[Supabase] Terhubung ke Supabase Database:', supabaseUrl);
  } catch (err) {
    console.error('[Supabase] Gagal inisialisasi Supabase:', err.message);
  }
} else {
  console.log('[Supabase] Kunci Supabase belum dikonfigurasi. Menggunakan penyimpanan data lokal.');
}

// Deteksi lingkungan Serverless (Vercel / AWS Lambda)
const isServerless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
const localDataDir = isServerless
  ? path.join(os.tmpdir(), 'vancare_data')
  : path.join(__dirname, '..', 'data');
const localDataFile = path.join(localDataDir, 'claims.json');

// In-Memory cache sebagai proteksi jika filesystem serverless read-only
let inMemoryClaims = [];

function initLocalStore() {
  try {
    if (!fs.existsSync(localDataDir)) {
      fs.mkdirSync(localDataDir, { recursive: true });
    }
    if (!fs.existsSync(localDataFile)) {
      fs.writeFileSync(localDataFile, JSON.stringify([], null, 2));
    }
  } catch (err) {
    console.warn('[LocalStorage] Direktori lokal tidak dapat dibuat/ditulisi, fallback ke memori:', err.message);
  }
}

function readLocalClaims() {
  try {
    initLocalStore();
    if (fs.existsSync(localDataFile)) {
      const raw = fs.readFileSync(localDataFile, 'utf8');
      return JSON.parse(raw);
    }
  } catch (err) {
    console.warn('[LocalStorage] Gagal membaca file lokal, fallback ke memori:', err.message);
  }
  return inMemoryClaims;
}

function writeLocalClaims(data) {
  inMemoryClaims = data;
  try {
    initLocalStore();
    fs.writeFileSync(localDataFile, JSON.stringify(data, null, 2));
  } catch (err) {
    console.warn('[LocalStorage] Gagal menulis ke disk lokal, tersimpan di memori:', err.message);
  }
}

let detectedTable = null;

async function getTargetTable() {
  if (!supabase) return null;
  if (detectedTable) return detectedTable;

  try {
    const { error } = await supabase.from('claims').select('id').limit(1);
    if (!error) {
      detectedTable = 'claims';
      return 'claims';
    }
  } catch (e) {}

  try {
    const { error } = await supabase.from('vancare_claims').select('id').limit(1);
    if (!error) {
      detectedTable = 'vancare_claims';
      return 'vancare_claims';
    }
  } catch (e) {}

  detectedTable = 'claims';
  return 'claims';
}

function mapToClaimsTable(claimData) {
  const driveLinks = [];
  if (claimData.photo_url) driveLinks.push(claimData.photo_url);
  if (claimData.video_url && !driveLinks.includes(claimData.video_url)) driveLinks.push(claimData.video_url);
  if (claimData.drive_file_url && !driveLinks.includes(claimData.drive_file_url)) driveLinks.push(claimData.drive_file_url);

  return {
    ticket_number: claimData.ticket_number,
    nama_lengkap: claimData.customer_name || claimData.nama_lengkap || '',
    nomor_hp: claimData.customer_phone || claimData.nomor_hp || '',
    email: (claimData.customer_email || claimData.email || '').toLowerCase(),
    alamat: claimData.customer_address || claimData.alamat || '',
    kota: claimData.kota || claimData.customer_city || claimData.customer_address || '-',
    kategori_produk: claimData.product_category || claimData.kategori_produk || '',
    tipe_seri: claimData.product_name || claimData.tipe_seri || '',
    nomor_seri: claimData.serial_number || claimData.nomor_seri || '',
    kendala: claimData.issue_description || claimData.kendala || '',
    status: claimData.status || 'Pending',
    uploaded_files: Array.isArray(claimData.uploaded_files) ? claimData.uploaded_files : [],
    drive_links: driveLinks,
    created_at: claimData.created_at || new Date().toISOString()
  };
}

function mapToVancareClaimsTable(claimData) {
  return {
    ticket_number: claimData.ticket_number,
    customer_name: claimData.customer_name || claimData.nama_lengkap || '',
    customer_email: (claimData.customer_email || claimData.email || '').toLowerCase(),
    customer_phone: claimData.customer_phone || claimData.nomor_hp || '',
    customer_address: claimData.customer_address || claimData.alamat || '',
    product_category: claimData.product_category || claimData.kategori_produk || '',
    product_name: claimData.product_name || claimData.tipe_seri || '',
    serial_number: claimData.serial_number || claimData.nomor_seri || '',
    purchase_date: claimData.purchase_date || null,
    issue_description: claimData.issue_description || claimData.kendala || '',
    uploaded_files: Array.isArray(claimData.uploaded_files) ? claimData.uploaded_files : [],
    photo_file_id: claimData.photo_file_id || null,
    photo_url: claimData.photo_url || null,
    photo_file_name: claimData.photo_file_name || null,
    video_file_id: claimData.video_file_id || null,
    video_url: claimData.video_url || null,
    video_file_name: claimData.video_file_name || null,
    drive_file_id: claimData.drive_file_id || claimData.photo_file_id || claimData.video_file_id || null,
    drive_file_url: claimData.drive_file_url || claimData.photo_url || claimData.video_url || null,
    drive_file_name: claimData.drive_file_name || claimData.photo_file_name || claimData.video_file_name || null,
    is_google_drive: typeof claimData.is_google_drive === 'boolean' ? claimData.is_google_drive : false,
    status: claimData.status || 'PENDING',
    created_at: claimData.created_at || new Date().toISOString()
  };
}

function normalizeClaimRow(row) {
  if (!row) return null;
  const driveLinks = Array.isArray(row.drive_links) ? row.drive_links : [];
  const uploadedFiles = Array.isArray(row.uploaded_files) ? row.uploaded_files : [];
  const photoFile = uploadedFiles.find(f => f.type === 'photo');
  const videoFile = uploadedFiles.find(f => f.type === 'video');

  const photoUrl = (photoFile && photoFile.webViewLink) || driveLinks[0] || row.photo_url || row.drive_file_url || null;
  const videoUrl = (videoFile && videoFile.webViewLink) || (driveLinks[1] || (driveLinks[0] !== photoUrl ? driveLinks[0] : null)) || row.video_url || null;

  return {
    ...row,
    id: row.id,
    ticket_number: row.ticket_number,
    customer_name: row.nama_lengkap || row.customer_name || '',
    customer_email: row.email || row.customer_email || '',
    customer_phone: row.nomor_hp || row.customer_phone || '',
    customer_address: row.alamat || row.customer_address || '',
    kota: row.kota || '',
    product_category: row.kategori_produk || row.product_category || '',
    product_name: row.tipe_seri || row.product_name || '',
    serial_number: row.nomor_seri || row.serial_number || '',
    purchase_date: row.purchase_date || null,
    issue_description: row.kendala || row.issue_description || '',
    status: (row.status || 'PENDING').toUpperCase(),
    uploaded_files: uploadedFiles,
    drive_links: driveLinks,
    photo_url: photoUrl,
    video_url: videoUrl,
    drive_file_url: photoUrl || videoUrl || row.drive_file_url || null,
    admin_notes: row.admin_notes || null,
    rejected_reason: row.rejected_reason || null,
    created_at: row.created_at || new Date().toISOString(),
    approved_at: row.approved_at || null
  };
}

function applyIdOrTicketFilter(query, idOrTicket) {
  const clean = String(idOrTicket).trim();
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clean);
  if (isUuid) {
    return query.eq('id', clean);
  }
  return /^\d+$/.test(clean)
    ? query.eq('id', clean)
    : query.eq('ticket_number', clean);
}

// ===============================================
// API METODE DATABASE (Supabase dengan Local Fallback)
// ===============================================

/**
 * Simpan klaim baru
 */
async function saveClaim(claimData) {
  const getLocalDateString = () => {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const claimRecord = {
    ...claimData,
    purchase_date: claimData.purchase_date && String(claimData.purchase_date).trim()
      ? String(claimData.purchase_date).trim()
      : getLocalDateString(),
    created_at: claimData.created_at || new Date().toISOString(),
    status: claimData.status || 'PENDING'
  };

  if (supabase) {
    try {
      const table = await getTargetTable();
      const payload = table === 'claims'
        ? mapToClaimsTable(claimRecord)
        : mapToVancareClaimsTable(claimRecord);

      const { data, error } = await supabase
        .from(table)
        .insert([payload])
        .select()
        .single();

      if (error) {
        console.error(`[Supabase Error] insert claim to ${table}:`, error.message);
        throw error;
      }
      return normalizeClaimRow(data);
    } catch (err) {
      console.warn('[Supabase Fallback] Mengalihkan ke penyimpanan lokal karena:', err.message);
    }
  }

  // Simpan ke lokal
  const claims = readLocalClaims();
  claimRecord.id = String(Date.now());
  claims.unshift(claimRecord);
  writeLocalClaims(claims);
  return normalizeClaimRow(claimRecord);
}

/**
 * Ambil semua data klaim
 */
async function getAllClaims(filter = {}) {
  if (supabase) {
    try {
      const table = await getTargetTable();
      let query = supabase
        .from(table)
        .select('*')
        .order('created_at', { ascending: false });

      if (filter.status && filter.status !== 'ALL') {
        query = query.ilike('status', filter.status);
      }

      const { data, error } = await query;
      if (error) throw error;
      return (data || []).map(normalizeClaimRow);
    } catch (err) {
      console.warn('[Supabase Fallback] Mengambil dari lokal:', err.message);
    }
  }

  // Dari penyimpanan lokal
  let claims = readLocalClaims().map(normalizeClaimRow);
  if (filter.status && filter.status !== 'ALL') {
    const targetStatus = filter.status.toUpperCase();
    claims = claims.filter(c => (c.status || '').toUpperCase() === targetStatus);
  }
  return claims;
}

/**
 * Cari klaim berdasarkan ID atau Nomor Tiket
 */
async function getClaimById(idOrTicket) {
  if (supabase) {
    try {
      const table = await getTargetTable();
      const clean = String(idOrTicket).trim();
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clean);

      if (isUuid) {
        const { data, error } = await supabase.from(table).select('*').eq('id', clean).maybeSingle();
        if (!error && data) return normalizeClaimRow(data);
      } else {
        const ticketQuery = supabase.from(table).select('*').eq('ticket_number', clean).maybeSingle();
        const ticketResult = await ticketQuery;
        if (!ticketResult.error && ticketResult.data) return normalizeClaimRow(ticketResult.data);

        if (/^\d+$/.test(clean)) {
          const idQuery = supabase.from(table).select('*').eq('id', clean).maybeSingle();
          const idResult = await idQuery;
          if (!idResult.error && idResult.data) return normalizeClaimRow(idResult.data);
        }
      }
    } catch (err) {
      console.warn('[Supabase Fallback] Gagal getClaimById:', err.message);
    }
  }

  const claims = readLocalClaims().map(normalizeClaimRow);
  const cleanId = String(idOrTicket).trim();
  return claims.find(c => String(c.id) === cleanId || c.ticket_number === cleanId) || null;
}

/**
 * Update status klaim menjadi APPROVED
 */
async function approveClaim(idOrTicket, notes = '') {
  const approvedAt = new Date().toISOString();

  if (supabase) {
    try {
      const table = await getTargetTable();
      const resolvedClaim = await getClaimById(idOrTicket);
      const targetId = resolvedClaim?.id || idOrTicket;
      let query = supabase.from(table).update({
        status: 'APPROVED',
        approved_at: approvedAt,
        admin_notes: notes
      });
      query = applyIdOrTicketFilter(query, targetId);

      let { data, error } = await query.select();
      if (error && error.code === 'PGRST204') {
        let retryQuery = supabase.from(table).update({ status: 'APPROVED' });
        retryQuery = applyIdOrTicketFilter(retryQuery, targetId);
        const retryRes = await retryQuery.select();
        data = retryRes.data;
        error = retryRes.error;
      }

      if (!error && data && data.length > 0) {
        return normalizeClaimRow(data[0]);
      }
    } catch (err) {
      console.warn('[Supabase Fallback] Gagal update approve Supabase:', err.message);
    }
  }

  // Update di lokal
  const claims = readLocalClaims();
  const cleanId = String(idOrTicket).trim();
  const index = claims.findIndex(c => String(c.id) === cleanId || c.ticket_number === cleanId);
  if (index === -1) {
    throw new Error('Data klaim tidak ditemukan');
  }

  claims[index].status = 'APPROVED';
  claims[index].approved_at = approvedAt;
  if (notes) claims[index].admin_notes = notes;

  writeLocalClaims(claims);
  return normalizeClaimRow(claims[index]);
}

/**
 * Update status klaim menjadi REJECTED
 */
async function rejectClaim(idOrTicket, reason = '') {
  if (supabase) {
    try {
      const table = await getTargetTable();
      const resolvedClaim = await getClaimById(idOrTicket);
      const targetId = resolvedClaim?.id || idOrTicket;
      let query = supabase.from(table).update({
        status: 'REJECTED',
        rejected_reason: reason
      });
      query = applyIdOrTicketFilter(query, targetId);

      let { data, error } = await query.select();
      if (error && error.code === 'PGRST204') {
        let retryQuery = supabase.from(table).update({ status: 'REJECTED' });
        retryQuery = applyIdOrTicketFilter(retryQuery, targetId);
        const retryRes = await retryQuery.select();
        data = retryRes.data;
        error = retryRes.error;
      }

      if (!error && data && data.length > 0) {
        return normalizeClaimRow(data[0]);
      }
    } catch (err) {
      console.warn('[Supabase Fallback] Gagal reject Supabase:', err.message);
    }
  }

  const claims = readLocalClaims();
  const cleanId = String(idOrTicket).trim();
  const index = claims.findIndex(c => String(c.id) === cleanId || c.ticket_number === cleanId);
  if (index === -1) {
    throw new Error('Data klaim tidak ditemukan');
  }

  claims[index].status = 'REJECTED';
  claims[index].rejected_reason = reason;

  writeLocalClaims(claims);
  return normalizeClaimRow(claims[index]);
}

/**
 * Ambil statistik ringkasan klaim untuk dashboard admin
 */
async function getStats() {
  const claims = await getAllClaims();
  return {
    total: claims.length,
    pending: claims.filter(c => (c.status || '').toUpperCase() === 'PENDING').length,
    approved: claims.filter(c => (c.status || '').toUpperCase() === 'APPROVED').length,
    rejected: claims.filter(c => (c.status || '').toUpperCase() === 'REJECTED').length
  };
}

module.exports = {
  supabase,
  saveClaim,
  getAllClaims,
  getClaimById,
  approveClaim,
  rejectClaim,
  getStats
};
