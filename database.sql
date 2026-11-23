-- ========================================================
-- SKEMA TABEL SUPABASE UNTUK APLIKASI WEB GARANSI VANCARE ADVAN
-- Jalankan query ini di Supabase SQL Editor (https://supabase.com)
-- ========================================================

CREATE TABLE IF NOT EXISTS vancare_claims (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_number VARCHAR(50) UNIQUE NOT NULL,
    customer_name VARCHAR(150) NOT NULL,
    customer_email VARCHAR(150) NOT NULL,
    customer_phone VARCHAR(50) NOT NULL,
    customer_address TEXT,
    product_category VARCHAR(100),
    product_name VARCHAR(150) NOT NULL,
    serial_number VARCHAR(100) NOT NULL,
    purchase_date DATE,
    issue_description TEXT NOT NULL,
    drive_file_id VARCHAR(255),
    drive_file_url TEXT,
    drive_file_name VARCHAR(255),
    photo_file_id VARCHAR(255),
    photo_url TEXT,
    photo_file_name VARCHAR(255),
    video_file_id VARCHAR(255),
    video_url TEXT,
    video_file_name VARCHAR(255),
    uploaded_files JSONB NOT NULL DEFAULT '[]'::jsonb,
    is_google_drive BOOLEAN DEFAULT FALSE,
    status VARCHAR(20) DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
    admin_notes TEXT,
    rejected_reason TEXT,
    approved_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE vancare_claims ADD COLUMN IF NOT EXISTS product_category VARCHAR(100);
ALTER TABLE vancare_claims ADD COLUMN IF NOT EXISTS photo_file_id VARCHAR(255);
ALTER TABLE vancare_claims ADD COLUMN IF NOT EXISTS photo_url TEXT;
ALTER TABLE vancare_claims ADD COLUMN IF NOT EXISTS photo_file_name VARCHAR(255);
ALTER TABLE vancare_claims ADD COLUMN IF NOT EXISTS video_file_id VARCHAR(255);
ALTER TABLE vancare_claims ADD COLUMN IF NOT EXISTS video_url TEXT;
ALTER TABLE vancare_claims ADD COLUMN IF NOT EXISTS video_file_name VARCHAR(255);
ALTER TABLE vancare_claims ADD COLUMN IF NOT EXISTS uploaded_files JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Indeks untuk pencarian cepat
CREATE INDEX IF NOT EXISTS idx_vancare_ticket ON vancare_claims(ticket_number);
CREATE INDEX IF NOT EXISTS idx_vancare_status ON vancare_claims(status);
CREATE INDEX IF NOT EXISTS idx_vancare_email ON vancare_claims(customer_email);
CREATE INDEX IF NOT EXISTS idx_vancare_sn ON vancare_claims(serial_number);

-- Aktifkan Row Level Security (RLS) jika dibutuhkan
ALTER TABLE vancare_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.claims ENABLE ROW LEVEL SECURITY;

-- Policy insert publik (Service Account / Anon Key)
CREATE POLICY "Public insert claims" ON vancare_claims FOR INSERT WITH CHECK (true);
