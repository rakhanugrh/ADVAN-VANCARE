const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// Cek apakah konfigurasi Supabase valid
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

const isSupabaseConfigured =
  supabaseUrl &&
  supabaseKey &&
  !supabaseUrl.includes('your-project') &&
  !supabaseKey.includes('your-supabase');

let supabase = null;

if (isSupabaseConfigured) {
  try {
    supabase = createClient(supabaseUrl, supabaseKey);
    console.log('[Supabase] Terhubung ke Supabase Database:', supabaseUrl);
  } catch (err) {
    console.error('[Supabase] Gagal inisialisasi Supabase:', err.message);
  }
} else {
  console.log('[Supabase] Kunci Supabase belum dikonfigurasi. Menggunakan penyimpanan data lokal (data/claims.json).');
}

// --- PENYIMPANAN DATA LOKAL (Fallback jika Supabase belum diset) ---
const localDataDir = path.join(__dirname, '..', 'data');
const localDataFile = path.join(localDataDir, 'claims.json');

function initLocalStore() {
  if (!fs.existsSync(localDataDir)) {
    fs.mkdirSync(localDataDir, { recursive: true });
  }
  if (!fs.existsSync(localDataFile)) {
    // Buat data contoh agar admin dashboard langsung terlihat menarik
    const seedData = [
      {
        id: '1',
        ticket_number: 'VC-20261110-8901',
        customer_name: 'Budi Pratama',
        customer_email: 'budi.pratama@example.com',
        customer_phone: '081234567890',
        customer_address: 'Jl. Merdeka No. 45, Jakarta Pusat',
        product_name: 'Advan Workplus (Ryzen 5)',
        serial_number: 'ADVWP-2025-882190',
        purchase_date: '2025-08-15',
        issue_description: 'Keyboard tombol Spacebar dan Enter tidak merespon setelah pemakaian 2 bulan.',
        drive_file_id: 'drive_sample_id_1',
        drive_file_url: 'https://images.unsplash.com/photo-1588872657578-7efd1f1555ed?w=800',
        drive_file_name: 'foto_kendala_keyboard.jpg',
        is_google_drive: false,
        status: 'PENDING',
        created_at: new Date(Date.now() - 3600000 * 5).toISOString(),
        approved_at: null
      },
      {
        id: '2',
        ticket_number: 'VC-20261110-7712',
        customer_name: 'Siti Rahmawati',
        customer_email: 'siti.rahma@example.com',
        customer_phone: '085712345678',
        customer_address: 'Komp. Melati Indah B4, Bandung',
        product_name: 'Advan Tab VX Neo',
        serial_number: 'ADVTAB-VX-339101',
        purchase_date: '2025-09-01',
        issue_description: 'Layar berkedip garis halus saat baterai di bawah 20%.',
        drive_file_id: 'drive_sample_id_2',
        drive_file_url: 'https://images.unsplash.com/photo-1544244015-0df4b3ffc6b0?w=800',
        drive_file_name: 'layar_bergaris.jpg',
        is_google_drive: false,
        status: 'APPROVED',
        created_at: new Date(Date.now() - 3600000 * 24).toISOString(),
        approved_at: new Date(Date.now() - 3600000 * 18).toISOString()
      }
    ];
    fs.writeFileSync(localDataFile, JSON.stringify(seedData, null, 2));
  }
}

function readLocalClaims() {
  initLocalStore();
  try {
    const raw = fs.readFileSync(localDataFile, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    return [];
  }
}

function writeLocalClaims(data) {
  initLocalStore();
  fs.writeFileSync(localDataFile, JSON.stringify(data, null, 2));
}

// ===============================================
// API METODE DATABASE (Supabase dengan Local Fallback)
// ===============================================

/**
 * Simpan klaim baru
 */
async function saveClaim(claimData) {
  const claimRecord = {
    ...claimData,
    created_at: new Date().toISOString(),
    status: claimData.status || 'PENDING'
  };

  if (supabase) {
    try {
      const { data, error } = await supabase
        .from('vancare_claims')
        .insert([claimRecord])
        .select()
        .single();

      if (error) {
        console.error('[Supabase Error] insert claim:', error.message);
        throw error;
      }
      return data;
    } catch (err) {
      console.warn('[Supabase Fallback] Mengalihkan ke penyimpanan lokal karena:', err.message);
    }
  }

  // Simpan ke lokal
  const claims = readLocalClaims();
  claimRecord.id = String(Date.now());
  claims.unshift(claimRecord);
  writeLocalClaims(claims);
  return claimRecord;
}

/**
 * Ambil semua data klaim
 */
async function getAllClaims(filter = {}) {
  if (supabase) {
    try {
      let query = supabase
        .from('vancare_claims')
        .select('*')
        .order('created_at', { ascending: false });

      if (filter.status && filter.status !== 'ALL') {
        query = query.eq('status', filter.status);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data;
    } catch (err) {
      console.warn('[Supabase Fallback] Mengambil dari lokal:', err.message);
    }
  }

  // Dari penyimpanan lokal
  let claims = readLocalClaims();
  if (filter.status && filter.status !== 'ALL') {
    claims = claims.filter(c => c.status === filter.status);
  }
  return claims;
}

/**
 * Cari klaim berdasarkan ID atau Nomor Tiket
 */
async function getClaimById(idOrTicket) {
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from('vancare_claims')
        .select('*')
        .or(`id.eq.${idOrTicket},ticket_number.eq.${idOrTicket}`)
        .single();

      if (!error && data) return data;
    } catch (err) {
      // Abaikan dan cari di lokal
    }
  }

  const claims = readLocalClaims();
  return claims.find(c => String(c.id) === String(idOrTicket) || c.ticket_number === idOrTicket) || null;
}

/**
 * Update status klaim menjadi APPROVED
 */
async function approveClaim(idOrTicket, notes = '') {
  const approvedAt = new Date().toISOString();

  if (supabase) {
    try {
      const { data, error } = await supabase
        .from('vancare_claims')
        .update({
          status: 'APPROVED',
          approved_at: approvedAt,
          admin_notes: notes
        })
        .or(`id.eq.${idOrTicket},ticket_number.eq.${idOrTicket}`)
        .select()
        .single();

      if (!error && data) return data;
    } catch (err) {
      console.warn('[Supabase Fallback] Gagal update Supabase:', err.message);
    }
  }

  // Update di lokal
  const claims = readLocalClaims();
  const index = claims.findIndex(c => String(c.id) === String(idOrTicket) || c.ticket_number === idOrTicket);
  if (index === -1) {
    throw new Error('Data klaim tidak ditemukan');
  }

  claims[index].status = 'APPROVED';
  claims[index].approved_at = approvedAt;
  if (notes) claims[index].admin_notes = notes;

  writeLocalClaims(claims);
  return claims[index];
}

/**
 * Update status klaim menjadi REJECTED
 */
async function rejectClaim(idOrTicket, reason = '') {
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from('vancare_claims')
        .update({
          status: 'REJECTED',
          rejected_reason: reason
        })
        .or(`id.eq.${idOrTicket},ticket_number.eq.${idOrTicket}`)
        .select()
        .single();

      if (!error && data) return data;
    } catch (err) {
      console.warn('[Supabase Fallback] Gagal reject Supabase:', err.message);
    }
  }

  const claims = readLocalClaims();
  const index = claims.findIndex(c => String(c.id) === String(idOrTicket) || c.ticket_number === idOrTicket);
  if (index === -1) {
    throw new Error('Data klaim tidak ditemukan');
  }

  claims[index].status = 'REJECTED';
  claims[index].rejected_reason = reason;

  writeLocalClaims(claims);
  return claims[index];
}

/**
 * Ambil statistik ringkasan klaim untuk dashboard admin
 */
async function getStats() {
  const claims = await getAllClaims();
  return {
    total: claims.length,
    pending: claims.filter(c => c.status === 'PENDING').length,
    approved: claims.filter(c => c.status === 'APPROVED').length,
    rejected: claims.filter(c => c.status === 'REJECTED').length
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
