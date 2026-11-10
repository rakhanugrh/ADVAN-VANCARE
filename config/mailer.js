const nodemailer = require('nodemailer');

/**
 * Buat transporter Nodemailer untuk Gmail SMTP
 */
function createTransporter() {
  const user = process.env.EMAIL_USER;
  const pass = process.env.EMAIL_PASS;

  const isConfigured =
    user &&
    pass &&
    !user.includes('your_email') &&
    !pass.includes('your_16_digit');

  if (!isConfigured) {
    return null;
  }

  return nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: user,
      pass: pass
    }
  });
}

/**
 * Format tanggal ke format lokal Indonesia
 */
function formatDateIndo(dateStr) {
  try {
    const d = dateStr ? new Date(dateStr) : new Date();
    return d.toLocaleDateString('id-ID', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch (e) {
    return dateStr;
  }
}

/**
 * Kirim email konfirmasi tanda terima klaim ke pelanggan
 * @param {Object} claim - Data klaim
 */
async function sendClaimReceivedEmail(claim) {
  const transporter = createTransporter();
  const fromName = process.env.EMAIL_FROM_NAME || 'VANCARE Advan Customer Care';
  const fromAddress = process.env.EMAIL_USER || 'no-reply@vancare.advan.id';

  const htmlContent = `
  <!DOCTYPE html>
  <html>
  <head>
    <meta charset="utf-8">
    <style>
      body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f4f6f9; margin: 0; padding: 20px; color: #333; }
      .container { max-width: 600px; background: #ffffff; margin: 0 auto; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 15px rgba(0,0,0,0.06); }
      .header { background: linear-gradient(135deg, #070e24 0%, #0c1736 60%, #e6007e 100%); padding: 30px 25px; text-align: center; color: #fff; }
      .header h1 { margin: 0 0 8px 0; font-size: 26px; letter-spacing: 1px; }
      .header p { margin: 0; font-size: 14px; opacity: 0.9; }
      .badge-ticket { display: inline-block; background-color: #e6007e; color: white; padding: 6px 18px; border-radius: 20px; font-weight: bold; font-size: 14px; margin-top: 12px; box-shadow: 0 4px 12px rgba(230,0,126,0.3); }
      .content { padding: 30px 25px; line-height: 1.6; }
      .info-box { background-color: #fdf2f8; border-left: 4px solid #e6007e; padding: 15px; border-radius: 6px; margin: 20px 0; font-size: 14px; }
      .table-data { width: 100%; border-collapse: collapse; margin-top: 15px; font-size: 14px; }
      .table-data td { padding: 10px; border-bottom: 1px solid #edf2f7; }
      .table-data td.label { font-weight: 600; width: 38%; color: #475569; }
      .footer { background: #070e24; color: #94a3b8; text-align: center; padding: 20px; font-size: 12px; line-height: 1.5; }
      .footer a { color: #e6007e; text-decoration: none; }
    </style>
  </head>
  <body>
    <div class="container">
      <div class="header">
        <h1>VANCARE ADVAN</h1>
        <p>Pusat Layanan Garansi & Perbaikan Resmi</p>
        <div class="badge-ticket">No. Tiket: ${claim.ticket_number}</div>
      </div>
      <div class="content">
        <p>Halo <strong>${claim.customer_name}</strong>,</p>
        <p>Terima kasih telah mengajukan klaim garansi produk Advan Anda. Permohonan klaim Anda telah berhasil kami terima dan saat ini sedang dalam proses review oleh tim teknisi spesialis VANCARE.</p>
        
        <div class="info-box">
          <strong>Detail Tiket Klaim Garansi:</strong>
          <table class="table-data">
            <tr><td class="label">Nomor Tiket</td><td><strong>${claim.ticket_number}</strong></td></tr>
            <tr><td class="label">Produk Advan</td><td>${claim.product_name}</td></tr>
            <tr><td class="label">Nomor Seri (SN)</td><td><code>${claim.serial_number}</code></td></tr>
            <tr><td class="label">Tanggal Beli</td><td>${claim.purchase_date || '-'}</td></tr>
            <tr><td class="label">Kendala / Kerusakan</td><td>${claim.issue_description}</td></tr>
            <tr><td class="label">Status Saat Ini</td><td><span style="color:#d97706; font-weight:bold;">PENDING (Dalam Pemeriksaan)</span></td></tr>
          </table>
        </div>

        <p>Tim VANCARE akan melakukan verifikasi data dan kelengkapan bukti dalam waktu maksimal <strong>1 x 24 Jam Kerja</strong>. Anda akan menerima notifikasi email berikutnya setelah permohonan disetujui.</p>
      </div>
      <div class="footer">
        <p>Email ini dikirim secara otomatis oleh Sistem VANCARE Advan Indonesia.<br>
        Butuh bantuan darurat? Hubungi WhatsApp Care kami di <strong>0812-3456-7890</strong></p>
      </div>
    </div>
  </body>
  </html>
  `;

  if (!transporter) {
    console.log(`[Mailer Mock] Email penerimaan klaim dikirim ke: ${claim.customer_email} (Tiket: ${claim.ticket_number})`);
    return { success: true, mocked: true };
  }

  try {
    const info = await transporter.sendMail({
      from: `"${fromName}" <${fromAddress}>`,
      to: claim.customer_email,
      subject: `[VANCARE ADVAN] Penerimaan Tiket Klaim Garansi #${claim.ticket_number} - ${claim.product_name}`,
      html: htmlContent
    });
    console.log(`[Mailer] Email tanda terima berhasil terkirim: ${info.messageId}`);
    return { success: true, messageId: info.messageId };
  } catch (err) {
    console.error(`[Mailer] Gagal mengirim email tanda terima:`, err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Kirim email konfirmasi klaim garansi DISETUJUI (APPROVED) ke pelanggan
 * @param {Object} claim - Data klaim lengkap
 */
async function sendClaimApprovalEmail(claim) {
  const transporter = createTransporter();
  const fromName = process.env.EMAIL_FROM_NAME || 'VANCARE Advan Customer Care';
  const fromAddress = process.env.EMAIL_USER || 'no-reply@vancare.advan.id';

  const htmlContent = `
  <!DOCTYPE html>
  <html>
  <head>
    <meta charset="utf-8">
    <style>
      body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f1f5f9; margin: 0; padding: 20px; color: #1e293b; }
      .container { max-width: 620px; background: #ffffff; margin: 0 auto; border-radius: 14px; overflow: hidden; box-shadow: 0 10px 25px rgba(0,0,0,0.08); }
      .header { background: linear-gradient(135deg, #070e24 0%, #0c1736 50%, #e6007e 100%); padding: 35px 25px; text-align: center; color: #ffffff; }
      .header-icon { font-size: 40px; margin-bottom: 10px; }
      .header h1 { margin: 0 0 6px 0; font-size: 24px; font-weight: 700; letter-spacing: 0.5px; }
      .badge-approved { display: inline-block; background-color: #ffffff; color: #e6007e; padding: 8px 22px; border-radius: 30px; font-weight: 800; font-size: 15px; margin-top: 12px; box-shadow: 0 4px 15px rgba(230,0,126,0.3); }
      .content { padding: 30px 28px; line-height: 1.6; }
      .greeting { font-size: 16px; margin-bottom: 15px; }
      .card-ticket { background: #fdf2f8; border: 1px solid #fbcfe8; border-radius: 10px; padding: 18px; margin: 20px 0; }
      .card-ticket table { width: 100%; border-collapse: collapse; font-size: 14px; }
      .card-ticket td { padding: 8px 6px; }
      .card-ticket td.title { color: #64748b; font-weight: 600; width: 35%; }
      .card-ticket td.val { color: #0f172a; font-weight: 600; }
      .steps-box { background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 10px; padding: 20px; margin: 25px 0; }
      .steps-box h3 { margin: 0 0 12px 0; color: #166534; font-size: 16px; }
      .step-item { display: flex; margin-bottom: 12px; font-size: 14px; color: #1e293b; }
      .step-num { background: #e6007e; color: #fff; width: 24px; height: 24px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; font-size: 12px; font-weight: bold; margin-right: 12px; flex-shrink: 0; }
      .service-center { background: #fdf2f8; border-left: 4px solid #e6007e; padding: 15px; border-radius: 6px; margin-top: 20px; font-size: 13px; line-height: 1.6; color: #831843; }
      .footer { background: #070e24; color: #94a3b8; text-align: center; padding: 25px 20px; font-size: 12px; line-height: 1.6; }
      .footer strong { color: #f8fafc; }
    </style>
  </head>
  <body>
    <div class="container">
      <div class="header">
        <div class="header-icon">✅</div>
        <h1>KLAIM GARANSI DISETUJUI</h1>
        <p style="margin: 0; opacity: 0.95; font-size: 14px;">Layanan Purna Jual Resmi VANCARE Advan</p>
        <div class="badge-approved">STATUS: APPROVED</div>
      </div>
      
      <div class="content">
        <div class="greeting">
          Yth. Bpk/Ibu <strong>${claim.customer_name}</strong>,
        </div>
        <p>Kabar baik! Permohonan klaim garansi untuk produk Advan Anda telah diverifikasi dan <strong>RESMI DISETUJUI</strong> oleh Tim Manajemen Garansi VANCARE.</p>
        
        <div class="card-ticket">
          <table>
            <tr><td class="title">Nomor Tiket</td><td class="val"><span style="color:#047857; font-size:16px;">${claim.ticket_number}</span></td></tr>
            <tr><td class="title">Nama Produk</td><td class="val">${claim.product_name}</td></tr>
            <tr><td class="title">Serial Number (SN)</td><td class="val">${claim.serial_number}</td></tr>
            <tr><td class="title">Tanggal Disetujui</td><td class="val">${formatDateIndo(new Date())}</td></tr>
            <tr><td class="title">Kerusakan Dilaporkan</td><td class="val">${claim.issue_description}</td></tr>
          </table>
        </div>

        <div class="steps-box">
          <h3>Panduan Langkah Penanganan Unit:</h3>
          <div class="step-item">
            <span class="step-num">1</span>
            <div><strong>Cetak / Simpan Nomor Tiket:</strong> Tunjukkan email ini atau catat nomor tiket <strong>${claim.ticket_number}</strong> saat menyerahkan unit.</div>
          </div>
          <div class="step-item">
            <span class="step-num">2</span>
            <div><strong>Kelengkapan Unit:</strong> Sertakan unit perangkat beserta aksesoris bawaan (charger/kabel) dan kartu garansi/faktur pembelian (jika ada).</div>
          </div>
          <div class="step-item">
            <span class="step-num">3</span>
            <div><strong>Kunjungan atau Pengiriman:</strong> Anda dapat langsung datang ke Service Center VANCARE terdekat atau mengirimkan unit via kurir/ekspedisi yang aman.</div>
          </div>
        </div>

        <div class="service-center">
          <strong>Pusat Layanan Utama VANCARE Advan:</strong><br>
          Gedung VANCARE Service Center Advan Indonesia<br>
          Jl. Hayam Wuruk No. 127, Gambir, Jakarta Pusat 10180<br>
          Jam Operasional: Senin - Sabtu (08.30 - 17.00 WIB)<br>
          Hotline / WhatsApp Care: <strong>0812-3456-7890</strong>
        </div>
      </div>

      <div class="footer">
        <p>Terima kasih telah mempercayakan perangkat Anda kepada produk lokal bergaransi resmi Advan Indonesia.<br>
        <strong>Tim Layanan Garansi & Perbaikan VANCARE Advan</strong></p>
      </div>
    </div>
  </body>
  </html>
  `;

  if (!transporter) {
    console.log(`========================================================================`);
    console.log(`[Mailer Mock] NOTIFIKASI APPROVAL DIKIRIM KE: ${claim.customer_email}`);
    console.log(`Subjek: [KLAIM DISETUJUI] Tiket #${claim.ticket_number} - ${claim.product_name}`);
    console.log(`Pelanggan: ${claim.customer_name} | SN: ${claim.serial_number}`);
    console.log(`========================================================================`);
    return { success: true, mocked: true };
  }

  try {
    const info = await transporter.sendMail({
      from: `"${fromName}" <${fromAddress}>`,
      to: claim.customer_email,
      subject: `[KLAIM DISETUJUI] Permohonan Garansi VANCARE Advan #${claim.ticket_number}`,
      html: htmlContent
    });
    console.log(`[Mailer] Notifikasi Approval berhasil terkirim ke ${claim.customer_email}: ${info.messageId}`);
    return { success: true, messageId: info.messageId };
  } catch (err) {
    console.error(`[Mailer] Gagal mengirim email approval:`, err.message);
    return { success: false, error: err.message };
  }
}

module.exports = {
  sendClaimReceivedEmail,
  sendClaimApprovalEmail
};
