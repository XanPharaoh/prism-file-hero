import { supabase } from './authService';

export interface ExtractionHistoryRecord {
  id: string;
  user_id: string;
  filename: string;
  tool_id: string;
  extracted_data: {
    rows: Record<string, any>[];
    metadata: Record<string, any>;
  };
  page_count: number;
  confidence: number;
  bank_code?: string;
  created_at: string;
}

/**
 * Save an extraction result to the document_history table.
 * Called automatically after a successful extraction.
 */
export async function saveExtractionHistory(record: {
  filename: string;
  toolId: string;
  extractedData: { rows: Record<string, any>[]; metadata: Record<string, any> };
  pageCount?: number;
  confidence?: number;
  bankCode?: string;
}): Promise<ExtractionHistoryRecord | null> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;

    const { data, error } = await supabase
      .from('document_history')
      .insert({
        user_id: user.id,
        filename: record.filename,
        tool_id: record.toolId,
        extracted_data: record.extractedData,
        page_count: record.pageCount ?? 1,
        confidence: record.confidence ?? 0,
        bank_code: record.bankCode ?? null,
      })
      .select()
      .single();

    if (error) {
      console.error('[History] Failed to save extraction:', error);
      return null;
    }

    console.log(`[History] Saved extraction ${data.id} for ${record.filename}`);
    return data as ExtractionHistoryRecord;
  } catch (err) {
    console.error('[History] Save failed:', err);
    return null;
  }
}

/**
 * Fetch all extraction history records for the current user.
 * Returns records ordered by most recent first.
 */
export async function fetchExtractionHistory(
  limit: number = 50,
  offset: number = 0
): Promise<ExtractionHistoryRecord[]> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return [];

    const { data, error } = await supabase
      .from('document_history')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      console.error('[History] Failed to fetch history:', error);
      return [];
    }

    return (data ?? []) as ExtractionHistoryRecord[];
  } catch (err) {
    console.error('[History] Fetch failed:', err);
    return [];
  }
}

/**
 * Fetch a single extraction record by ID.
 */
export async function fetchExtractionRecord(
  id: string
): Promise<ExtractionHistoryRecord | null> {
  try {
    const { data, error } = await supabase
      .from('document_history')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      console.error('[History] Failed to fetch record:', error);
      return null;
    }

    return data as ExtractionHistoryRecord;
  } catch (err) {
    console.error('[History] Fetch record failed:', err);
    return null;
  }
}

/**
 * Delete an extraction record by ID.
 */
export async function deleteExtractionRecord(id: string): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('document_history')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('[History] Failed to delete record:', error);
      return false;
    }

    return true;
  } catch (err) {
    console.error('[History] Delete failed:', err);
    return false;
  }
}

/**
 * Get total count of extractions for the current user.
 */
export async function getExtractionCount(): Promise<number> {
  try {
    const { count, error } = await supabase
      .from('document_history')
      .select('*', { count: 'exact', head: true });

    if (error) return 0;
    return count ?? 0;
  } catch {
    return 0;
  }
}