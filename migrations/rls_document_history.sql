-- Enable RLS on the document_history table
ALTER TABLE document_history ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only SELECT their own records
CREATE POLICY "Users can view own extractions" ON document_history
  FOR SELECT
  USING (auth.uid() = user_id);

-- Policy: Users can only INSERT records with their own user_id
CREATE POLICY "Users can create own extractions" ON document_history
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Policy: Users can only DELETE their own records
CREATE POLICY "Users can delete own extractions" ON document_history
  FOR DELETE
  USING (auth.uid() = user_id);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_document_history_user_id ON document_history(user_id);
CREATE INDEX IF NOT EXISTS idx_document_history_created_at ON document_history(created_at DESC);

-- Table creation (idempotent)
CREATE TABLE IF NOT EXISTS document_history (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  tool_id TEXT NOT NULL,
  extracted_data JSONB NOT NULL,
  page_count INTEGER DEFAULT 1,
  confidence REAL DEFAULT 0,
  bank_code TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);