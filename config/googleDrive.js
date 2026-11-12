const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');
const { google } = require('googleapis');

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

      // Berikan akses view publik per-file agar admin/teknisi bisa langsung membuka bukti foto/video
      try {
        await drive.permissions.create({
          fileId: fileId,
          requestBody: {
            role: 'reader',
            type: 'anyone'
          }
        });
      } catch (permErr) {
        console.warn('[Google Drive] Catatan: Permission reader publik:', permErr.message);
      }

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
  const uploadDir = path.join(__dirname, '..', 'public', 'uploads');
  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
  }

  const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
  const ext = path.extname(file.originalname) || '';
  const localFileName = `proof-${uniqueSuffix}${ext}`;
  const localFilePath = path.join(uploadDir, localFileName);

  fs.writeFileSync(localFilePath, file.buffer);
  console.log(`[Penyimpanan Lokal] Bukti disimpan di ${localFilePath}`);

  return {
    fileId: `local-${uniqueSuffix}`,
    webViewLink: `/uploads/${localFileName}`,
    webContentLink: `/uploads/${localFileName}`,
    fileName: file.originalname,
    isGoogleDrive: false
  };
}

module.exports = {
  uploadFileToDrive,
  getDriveClient
};