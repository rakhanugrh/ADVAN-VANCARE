const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { Readable } = require('stream');
const { google } = require('googleapis');

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

/**
 * Inisialisasi Google Drive Client menggunakan OAuth2 (Akun Google Pribadi)
 */
function getDriveClient() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    console.warn('[Google Drive] GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, atau GOOGLE_REFRESH_TOKEN belum lengkap di .env. Mode lokal fallback aktif.');
    return null;
  }

  try {
    const oauth2Client = new google.auth.OAuth2(
      clientId,
      clientSecret,
      'https://developers.google.com/oauthplayground'
    );

    oauth2Client.setCredentials({
      refresh_token: refreshToken
    });

    return google.drive({ version: 'v3', auth: oauth2Client });
  } catch (err) {
    console.error('[Google Drive] Gagal menginisialisasi OAuth2 client:', err.message);
    return null;
  }
}

/**
 * Upload file bukti klaim ke Google Drive (atau fallback lokal)
 * @param {Object} file Objek file dari Multer (buffer, originalname, mimetype)
 * @returns {Promise<{fileId: string, webViewLink: string, webContentLink: string, fileName: string, isGoogleDrive: boolean}>}
 */
async function uploadFileToDrive(file) {
  if (!file) {
    return {
      fileId: null,
      webViewLink: null,
      webContentLink: null,
      fileName: null,
      isGoogleDrive: false
    };
  }

  const drive = getDriveClient();
  const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID && process.env.GOOGLE_DRIVE_FOLDER_ID !== 'your_google_drive_folder_id_here'
    ? process.env.GOOGLE_DRIVE_FOLDER_ID
    : null;

  // Jika Google Drive Client aktif dan valid, upload ke Drive
  if (drive) {
    try {
      const sanitizedName = `VANCARE_${Date.now()}_${file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
      const stream = Readable.from(file.buffer);

      const fileMetadata = {
        name: sanitizedName,
        description: 'Bukti Klaim Garansi VANCARE Advan'
      };

      if (folderId) {
        fileMetadata.parents = [folderId];
      }

      console.log(`[Google Drive] Mengupload ${file.originalname} ke Google Drive...`);

      const response = await drive.files.create({
        requestBody: fileMetadata,
        media: {
          mimeType: file.mimetype,
          body: stream
        },
        fields: 'id, name, webViewLink, webContentLink'
      });

      const fileId = response.data.id;

      console.log(`[Google Drive] Sukses upload: ${response.data.name} (ID: ${fileId})`);

      return {
        fileId: fileId,
        webViewLink: response.data.webViewLink || `https://drive.google.com/file/d/${fileId}/view`,
        webContentLink: response.data.webContentLink || `https://drive.google.com/uc?id=${fileId}&export=download`,
        fileName: response.data.name,
        isGoogleDrive: true
      };
    } catch (uploadErr) {
      console.error('[Google Drive] Gagal upload ke Drive API, beralih ke penyimpanan lokal:', uploadErr.message);
    }
  }

  // --- FALLBACK LOCAL STORAGE ---
  const isServerless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
  const uploadDir = isServerless
    ? path.join(os.tmpdir(), 'vancare_uploads')
    : path.join(__dirname, '..', 'public', 'uploads');

  try {
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
  } catch (dirErr) {
    console.warn('[Google Drive Fallback] Tidak dapat membuat direktori uploads lokal:', dirErr.message);
  }

  const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
  const ext = path.extname(file.originalname) || '';
  const localFileName = `proof-${uniqueSuffix}${ext}`;
  const localFilePath = path.join(uploadDir, localFileName);

  try {
    fs.writeFileSync(localFilePath, file.buffer);
    console.log(`[Penyimpanan Lokal] Bukti disimpan di ${localFilePath}`);
  } catch (writeErr) {
    console.warn('[Google Drive Fallback] Gagal menyimpan file ke disk lokal:', writeErr.message);
  }

  return {
    fileId: `local-${uniqueSuffix}`,
    webViewLink: `/uploads/${localFileName}`,
    webContentLink: `/uploads/${localFileName}`,
    fileName: file.originalname,
    isGoogleDrive: false
  };
}
/**
 * Membuat Resumable Upload Session URL langsung ke Google Drive
 */
async function createResumableSession({ fileName, mimeType, fileSize, fileType, origin }) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;
  const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID &&
    process.env.GOOGLE_DRIVE_FOLDER_ID !== 'your_google_drive_folder_id_here'
    ? process.env.GOOGLE_DRIVE_FOLDER_ID
    : null;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('Integrasi Google Drive belum dikonfigurasi. Lengkapi GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, dan GOOGLE_REFRESH_TOKEN.');
  }

  const oauth2Client = new google.auth.OAuth2(
    clientId,
    clientSecret,
    'https://developers.google.com/oauthplayground'
  );
  oauth2Client.setCredentials({ refresh_token: refreshToken });

  const uploadToken = crypto.randomBytes(32).toString('hex');
  let token;
  try {
    ({ token } = await oauth2Client.getAccessToken());
  } catch (err) {
    const errorCode = err.response?.data?.error || err.code || err.message;
    if (errorCode === 'invalid_grant') {
      throw new Error('Otorisasi Google Drive kedaluwarsa atau dicabut. Perbarui GOOGLE_REFRESH_TOKEN.');
    }
    throw err;
  }
  const sanitizedName = `VANCARE_${Date.now()}_${fileName.replace(/[^a-zA-Z0-9._-]/g, '_')}`;

  const metadata = {
    name: sanitizedName,
    description: 'Bukti Klaim Garansi VANCARE Advan',
    appProperties: {
      vancareUploadToken: uploadToken,
      vancareUploadMimeType: mimeType,
      vancareUploadSize: String(fileSize),
      vancareUploadType: fileType,
      vancareUploadCreatedAt: String(Date.now())
    },
    ...(folderId ? { parents: [folderId] } : {})
  };

  const initRes = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,webViewLink,webContentLink',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Type': mimeType,
        'X-Upload-Content-Length': String(fileSize),
        ...(origin ? { Origin: origin } : {})
      },
      body: JSON.stringify(metadata)
    }
  );

  if (!initRes.ok) {
    const errText = await initRes.text();
    throw new Error(`Gagal membuat sesi Google Drive: ${errText}`);
  }

  return {
    uploadUrl: initRes.headers.get('location'),
    fileName: sanitizedName,
    uploadToken
  };
}

async function verifyResumableFile(fileId, uploadToken) {
  if (typeof uploadToken !== 'string' || !/^[a-f0-9]{64}$/.test(uploadToken)) {
    const error = new Error('Token sesi upload tidak valid.');
    error.statusCode = 400;
    throw error;
  }

  const drive = getDriveClient();
  if (!drive) throw new Error('Drive client tidak aktif.');

  const fileMeta = await drive.files.get({
    fileId,
    fields: 'id,name,mimeType,size,parents,appProperties,webViewLink,webContentLink'
  });
  const file = fileMeta.data;

  if (file.appProperties?.vancareUploadToken !== uploadToken) {
    const error = new Error('File tidak terdaftar pada sesi upload ini.');
    error.statusCode = 403;
    throw error;
  }

  const uploadCreatedAt = Number(file.appProperties?.vancareUploadCreatedAt);
  if (!Number.isSafeInteger(uploadCreatedAt) ||
      uploadCreatedAt > Date.now() + 60 * 1000 ||
      Date.now() - uploadCreatedAt > 24 * 60 * 60 * 1000) {
    const error = new Error('Sesi upload sudah kedaluwarsa.');
    error.statusCode = 403;
    throw error;
  }

  const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID &&
    process.env.GOOGLE_DRIVE_FOLDER_ID !== 'your_google_drive_folder_id_here'
    ? process.env.GOOGLE_DRIVE_FOLDER_ID
    : null;
  if (folderId && !file.parents?.includes(folderId)) {
    const error = new Error('File tidak berada di folder upload VANCARE.');
    error.statusCode = 403;
    throw error;
  }

  const fileSize = Number(file.size);
  if (!ALLOWED_CLAIM_MIME_TYPES.includes(file.mimeType) ||
      !Number.isSafeInteger(fileSize) ||
      fileSize <= 0 ||
      fileSize > MAX_CLAIM_FILE_SIZE ||
      file.appProperties?.vancareUploadMimeType !== file.mimeType ||
      Number(file.appProperties?.vancareUploadSize) !== fileSize ||
      (file.appProperties?.vancareUploadType === 'photo' &&
        !file.mimeType.startsWith('image/')) ||
      (file.appProperties?.vancareUploadType === 'video' &&
        !file.mimeType.startsWith('video/')) ||
      !['photo', 'video'].includes(file.appProperties?.vancareUploadType)) {
    const error = new Error('Metadata atau ukuran file tidak memenuhi ketentuan klaim.');
    error.statusCode = 400;
    throw error;
  }

  return file;
}

/**
 * Memastikan file hasil upload berasal dari sesi VANCARE yang diberikan.
 */
async function finalizeResumableFile(fileId, uploadToken) {
  const file = await verifyResumableFile(fileId, uploadToken);

  return {
    fileId: file.id,
    fileName: file.name,
    webViewLink: file.webViewLink || `https://drive.google.com/file/d/${fileId}/view`,
    webContentLink: file.webContentLink || `https://drive.google.com/uc?id=${fileId}&export=download`,
    isGoogleDrive: true
  };
}

async function downloadDriveFile(fileId) {
  const drive = getDriveClient();
  if (!drive) throw new Error('Drive client tidak aktif.');

  const metadataResponse = await drive.files.get({
    fileId,
    fields: 'id,name,mimeType,size,parents'
  });
  const metadata = metadataResponse.data;
  const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID &&
    process.env.GOOGLE_DRIVE_FOLDER_ID !== 'your_google_drive_folder_id_here'
    ? process.env.GOOGLE_DRIVE_FOLDER_ID
    : null;
  if ((folderId && !metadata.parents?.includes(folderId)) ||
      typeof metadata.name !== 'string' ||
      !metadata.name.startsWith('VANCARE_')) {
    const error = new Error('File tidak berada di folder upload VANCARE.');
    error.statusCode = 404;
    throw error;
  }

  const fileSize = Number(metadata.size);
  if (!ALLOWED_CLAIM_MIME_TYPES.includes(metadata.mimeType) ||
      !Number.isSafeInteger(fileSize) ||
      fileSize <= 0 ||
      fileSize > MAX_CLAIM_FILE_SIZE) {
    const error = new Error('Tipe atau ukuran file tidak didukung.');
    error.statusCode = 415;
    throw error;
  }

  const contentResponse = await drive.files.get(
    { fileId, alt: 'media' },
    { responseType: 'stream' }
  );
  return { metadata, stream: contentResponse.data };
}

module.exports = {
  uploadFileToDrive,
  getDriveClient,
  createResumableSession,
  finalizeResumableFile,
  verifyResumableFile,
  downloadDriveFile
};