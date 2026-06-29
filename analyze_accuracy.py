"""
Compare PDF bank statements against tool-extracted Excel output.
Extracts text from PDFs, parses transactions, and compares with Excel output.
"""
import pymupdf as fitz  # PyMuPDF
import openpyxl
import os
import re
import glob
import json

PDF_DIR = r"C:\Users\Philander\Downloads\Test accounts"
OUT_DIR = r"C:\Users\Philander\Downloads\Test account output"

def extract_pdf_text(path):
    """Extract all text from PDF, page by page."""
    doc = fitz.open(path)
    pages = []
    for i, page in enumerate(doc):
        text = page.get_text()
        pages.append(text)
    doc.close()
    return pages

def read_excel_rows(path):
    """Read all rows from Transactions sheet of Excel file."""
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    ws = wb.active  # First sheet = Transactions
    rows = []
    headers = None
    for i, row in enumerate(ws.iter_rows(values_only=True)):
        if i == 0:
            headers = [str(h) if h else f"Col{j}" for j, h in enumerate(row)]
        else:
            rows.append(dict(zip(headers, row)))
    wb.close()
    return headers, rows

def detect_bank_from_text(text):
    """Detect bank from PDF text."""
    text_upper = text.upper()
    if "FNB" in text_upper or "FIRST NATIONAL" in text_upper:
        return "FNB"
    if "CAPITEC" in text_upper:
        return "CAPITEC"
    if "NEDBANK" in text_upper:
        return "NEDBANK"
    if "ABSA" in text_upper:
        return "ABSA"
    if "STANDARD BANK" in text_upper:
        return "STANDARD_BANK"
    if "TYMEBANK" in text_upper or "TYME BANK" in text_upper:
        return "TYMEBANK"
    if "INVESTEC" in text_upper:
        return "INVESTEC"
    if "DISCOVERY" in text_upper:
        return "DISCOVERY"
    if "AFRICAN BANK" in text_upper:
        return "AFRICAN_BANK"
    return "UNKNOWN"

def parse_money(s):
    """Parse a money string to float."""
    if s is None:
        return None
    if isinstance(s, (int, float)):
        return float(s)
    s = str(s).strip()
    if not s:
        return None
    # Remove currency symbols, spaces
    s = re.sub(r'[R$£€\s*]', '', s)
    neg = False
    if s.startswith('(') and s.endswith(')'):
        neg = True
        s = s[1:-1]
    if s.lower().endswith('dr'):
        neg = True
        s = s[:-2]
    elif s.lower().endswith('cr'):
        s = s[:-2]
    if s.startswith('-'):
        neg = True
        s = s[1:]
    if s.endswith('-'):
        neg = True
        s = s[:-1]
    s = s.replace(',', '')
    try:
        val = float(s)
        return -val if neg else val
    except:
        return None

def extract_transactions_from_pdf_text(pages, bank):
    """Parse actual transactions from PDF text lines."""
    all_lines = []
    for pnum, page_text in enumerate(pages):
        for line in page_text.split('\n'):
            stripped = line.strip()
            if stripped:
                all_lines.append((pnum + 1, stripped))
    return all_lines

def find_matching_excel(pdf_name, excel_files):
    """Find the Excel output for a given PDF."""
    base = os.path.splitext(pdf_name)[0]
    candidates = []
    for ef in excel_files:
        ef_name = os.path.basename(ef)
        if base in ef_name or ef_name.startswith(base):
            candidates.append(ef)
    # Also try the _Extracted suffix
    for ef in excel_files:
        ef_name = os.path.basename(ef)
        if f"{base}_Extracted" in ef_name:
            candidates.append(ef)
    return list(set(candidates))

def analyze_pair(pdf_path, excel_path):
    """Deep comparison of PDF source vs Excel output."""
    pdf_name = os.path.basename(pdf_path)
    excel_name = os.path.basename(excel_path)
    
    print(f"\n{'='*80}")
    print(f"PDF:   {pdf_name}")
    print(f"EXCEL: {excel_name}")
    print(f"{'='*80}")
    
    # Extract PDF text
    pages = extract_pdf_text(pdf_path)
    full_text = '\n'.join(pages)
    bank = detect_bank_from_text(full_text)
    print(f"Bank detected: {bank}")
    print(f"PDF pages: {len(pages)}")
    
    # Read Excel
    headers, rows = read_excel_rows(excel_path)
    print(f"Excel columns: {headers}")
    print(f"Excel rows: {len(rows)}")
    
    if len(rows) == 0:
        print("⚠ NO ROWS IN EXCEL OUTPUT!")
        return
    
    # Show first 3 and last 2 rows
    print(f"\nFirst 3 Excel rows:")
    for i, r in enumerate(rows[:3]):
        print(f"  Row {i+1}: {dict((k,v) for k,v in r.items() if v is not None and v != '' and v != 0)}")
    
    if len(rows) > 3:
        print(f"\nLast 2 Excel rows:")
        for i, r in enumerate(rows[-2:]):
            print(f"  Row {len(rows)-1+i}: {dict((k,v) for k,v in r.items() if v is not None and v != '' and v != 0)}")
    
    # Analyze column quality
    print(f"\n--- COLUMN ANALYSIS ---")
    
    # Check for key columns
    has_date = any('date' in h.lower() for h in headers)
    has_desc = any(k in [h.lower() for h in headers] for k in ['description', 'description 1', 'description text'])
    has_amount = any('amount' in h.lower() for h in headers)
    has_balance = any('balance' in h.lower() for h in headers)
    has_debit = any('debit' in h.lower() or 'withdrawal' in h.lower() for h in headers)
    has_credit = any('credit' in h.lower() or 'deposit' in h.lower() for h in headers)
    has_direction = any('direction' in h.lower() for h in headers)
    
    print(f"  Has Date:      {has_date}")
    print(f"  Has Description: {has_desc}")
    print(f"  Has Amount:    {has_amount}")
    print(f"  Has Balance:   {has_balance}")
    print(f"  Has Debit:     {has_debit}")
    print(f"  Has Credit:    {has_credit}")
    print(f"  Has Direction: {has_direction}")
    
    # Check balance reconciliation
    bal_key = None
    for h in headers:
        if 'balance' in h.lower():
            bal_key = h
            break
    
    amt_key = None
    for h in headers:
        if 'amount' in h.lower():
            amt_key = h
            break
    
    debit_key = None
    credit_key = None
    for h in headers:
        if 'debit' in h.lower() or 'withdrawal' in h.lower():
            debit_key = h
        if 'credit' in h.lower() or 'deposit' in h.lower():
            credit_key = h
    
    if bal_key:
        print(f"\n--- BALANCE RECONCILIATION (column: {bal_key}) ---")
        balances = []
        mismatches = 0
        for i, r in enumerate(rows):
            bal = parse_money(r.get(bal_key))
            if bal is not None:
                balances.append((i, bal, r))
        
        if len(balances) >= 2:
            prev_bal = balances[0][1]
            for idx in range(1, len(balances)):
                row_idx, bal, r = balances[idx]
                
                # Try to compute expected change
                if amt_key:
                    amt = parse_money(r.get(amt_key))
                    if amt is not None:
                        expected = round(prev_bal + amt, 2)
                        actual = round(bal, 2)
                        if abs(expected - actual) > 0.02:
                            mismatches += 1
                            if mismatches <= 10:
                                desc = r.get('Description', r.get('Description 1', r.get('description', '???')))
                                print(f"  MISMATCH Row {row_idx+1}: prev={prev_bal:.2f} + amt={amt:.2f} = {expected:.2f}, but balance={actual:.2f} (diff={actual-expected:.2f}) [{desc}]")
                elif debit_key or credit_key:
                    debit = parse_money(r.get(debit_key, 0)) or 0
                    credit = parse_money(r.get(credit_key, 0)) or 0
                    change = credit - debit
                    expected = round(prev_bal + change, 2)
                    actual = round(bal, 2)
                    if abs(expected - actual) > 0.02:
                        mismatches += 1
                        if mismatches <= 10:
                            desc = r.get('Description', r.get('Description 1', r.get('description', '???')))
                            print(f"  MISMATCH Row {row_idx+1}: prev={prev_bal:.2f} + ({credit:.2f}-{debit:.2f})={expected:.2f}, but balance={actual:.2f} [{desc}]")
                
                prev_bal = bal
            
            print(f"\n  Total balance rows: {len(balances)}")
            print(f"  Balance mismatches: {mismatches}")
            print(f"  First balance: {balances[0][1]:.2f}")
            print(f"  Last balance:  {balances[-1][1]:.2f}")
    
    # Count PDF transaction lines (lines starting with date patterns)
    date_patterns = [
        r'^\d{1,2}\s+[A-Za-z]{3}',  # "01 Jan", "1 Feb"
        r'^\d{1,2}[/\-]\d{1,2}[/\-]\d{2,4}',  # "01/01/2026"
        r'^\d{4}[/\-]\d{1,2}[/\-]\d{1,2}',  # "2026-01-01"
    ]
    pdf_transaction_lines = []
    for pnum, line in extract_transactions_from_pdf_text(pages, bank):
        for dp in date_patterns:
            if re.match(dp, line):
                pdf_transaction_lines.append((pnum, line))
                break
    
    print(f"\n--- ROW COUNT COMPARISON ---")
    print(f"  PDF lines starting with dates: {len(pdf_transaction_lines)}")
    print(f"  Excel transaction rows: {len(rows)}")
    diff = len(pdf_transaction_lines) - len(rows)
    if diff > 0:
        print(f"  ⚠ MISSING {diff} transaction rows in Excel output!")
    elif diff < 0:
        print(f"  ⚠ Excel has {abs(diff)} MORE rows than PDF (possible extras or wrapped rows counted)")
    else:
        print(f"  ✓ Row count matches")
    
    # Show PDF transaction lines for comparison
    if len(pdf_transaction_lines) <= 30:
        print(f"\n--- ALL PDF TRANSACTION LINES ---")
        for pnum, line in pdf_transaction_lines:
            print(f"  [p{pnum}] {line[:120]}")
    else:
        print(f"\n--- FIRST 10 PDF TRANSACTION LINES ---")
        for pnum, line in pdf_transaction_lines[:10]:
            print(f"  [p{pnum}] {line[:120]}")
        print(f"  ... ({len(pdf_transaction_lines) - 20} more)")
        print(f"--- LAST 10 PDF TRANSACTION LINES ---")
        for pnum, line in pdf_transaction_lines[-10:]:
            print(f"  [p{pnum}] {line[:120]}")
    
    # Check for obvious data issues
    print(f"\n--- DATA QUALITY CHECKS ---")
    
    # Check for zero amounts (might indicate parsing failure)
    zero_amounts = 0
    for r in rows:
        if amt_key:
            val = r.get(amt_key)
            if val is not None and parse_money(val) == 0:
                zero_amounts += 1
    if zero_amounts > 0:
        print(f"  ⚠ {zero_amounts} rows with zero Amount")
    
    # Check for missing dates
    date_key = None
    for h in headers:
        if 'date' in h.lower():
            date_key = h
            break
    
    if date_key:
        missing_dates = sum(1 for r in rows if not r.get(date_key))
        if missing_dates > 0:
            print(f"  ⚠ {missing_dates} rows with missing Date")
    
    # Check for missing descriptions
    desc_key = None
    for h in headers:
        if 'description' in h.lower():
            desc_key = h
            break
    
    if desc_key:
        missing_desc = sum(1 for r in rows if not r.get(desc_key) or str(r.get(desc_key, '')).strip() == '')
        if missing_desc > 0:
            print(f"  ⚠ {missing_desc} rows with missing Description")
    
    # Check for wrong column assignments (amounts in description, etc.)
    if desc_key:
        nums_in_desc = 0
        for r in rows:
            d = str(r.get(desc_key, ''))
            # If description is purely numeric or looks like a money amount
            if re.match(r'^[\d,.\-\s\(\)RCrDr]+$', d.strip()) and len(d.strip()) > 0:
                nums_in_desc += 1
        if nums_in_desc > 0:
            print(f"  ⚠ {nums_in_desc} rows with numeric data in Description column (possible column misalignment)")
    
    print()


def main():
    pdf_files = glob.glob(os.path.join(PDF_DIR, "*.pdf"))
    excel_files = glob.glob(os.path.join(OUT_DIR, "*.xlsx"))
    
    print(f"Found {len(pdf_files)} PDFs and {len(excel_files)} Excel outputs\n")
    
    # Match PDFs to Excel outputs
    matched = []
    for pf in pdf_files:
        pdf_name = os.path.basename(pf)
        pdf_base = os.path.splitext(pdf_name)[0]
        
        # Look for matching Excel
        for ef in excel_files:
            ef_name = os.path.basename(ef)
            # Check if PDF base name appears in Excel filename
            if pdf_base in ef_name or f"{pdf_base}_Extracted" in ef_name:
                matched.append((pf, ef))
                break
    
    print(f"Matched {len(matched)} PDF-Excel pairs\n")
    
    for pdf_path, excel_path in matched:
        try:
            analyze_pair(pdf_path, excel_path)
        except Exception as e:
            print(f"\nERROR analyzing {os.path.basename(pdf_path)}: {e}")
    
    # Also check unmatched PDFs
    matched_pdfs = set(m[0] for m in matched)
    unmatched = [pf for pf in pdf_files if pf not in matched_pdfs]
    if unmatched:
        print(f"\n{'='*80}")
        print(f"UNMATCHED PDFs (no Excel output found):")
        for pf in unmatched:
            print(f"  {os.path.basename(pf)}")

if __name__ == '__main__':
    main()
