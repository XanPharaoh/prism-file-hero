"""
Verification script: test extractors against actual PDF data
Uses pymupdf to simulate what pdfjs-dist extracts, and walks through our parsing logic
"""
import pymupdf as fitz
import re
import os
import sys

TEST_DIR = r"C:\Users\Philander\Downloads\Test accounts"

# ======== Capitec Extractor Logic (Python port) ========

DATE_RE = re.compile(r'\d{2}/\d{2}/\d{2,4}')
DATE_PREFIX_RE = re.compile(r'^(\d{2}/\d{2}/\d{2,4})\s+(\d{2}/\d{2}/\d{2,4})\s*(.*)')
SINGLE_DATE_RE = re.compile(r'^(\d{2}/\d{2}/\d{2,4})\s+(.*)')
MONEY_RE = re.compile(r'^[+-]?[\d\s]+\.\d{2}$')

CAPITEC_NOISE = [
    re.compile(p, re.I) for p in [
        r'^capitec bank', r'^business account statement', r'^account no',
        r'^account type', r'^branch', r'^telephone', r'^business reg',
        r'^client vat', r'^statement no', r'^page:', r'^fee total',
        r'^vat @', r'^vat total', r'all fees charged', r'prime lending rate',
        r'statements are accepted', r'banking client care',
        r'capitec bank is an authorised', r'vat reg', r'neutron road',
        r'interest rate @', r'no limit.*rate', r'overdraft', r'stamp placeholder',
        r'^date\s*$', r'^post\s*$', r'^trans\.\s*$', r'^capitec bank$',
        r'^\d{2}/\d{2}/\d{4}$', r'^branch:\s', r'^device:\s', r'^tel:\s',
    ]
]

def is_capitec_noise(text):
    t = text.strip()
    if not t or len(t) < 3:
        return True
    return any(p.search(t) for p in CAPITEC_NOISE)

def is_money(s):
    return bool(MONEY_RE.match(s.strip()))

def parse_date_desc(text):
    t = text.strip()
    m = DATE_PREFIX_RE.match(t)
    if m:
        return m.group(1), m.group(2), m.group(3).strip()
    m = SINGLE_DATE_RE.match(t)
    if m:
        return m.group(1), '', m.group(2).strip()
    return None, None, None

def extract_capitec(filepath):
    doc = fitz.open(filepath)
    transactions = []
    opening_bal = ''
    
    for page_num in range(doc.page_count):
        page = doc[page_num]
        blocks = page.get_text('dict')
        
        # Build items
        items_by_y = {}
        for block in blocks['blocks']:
            if 'lines' not in block:
                continue
            for line in block['lines']:
                for span in line['spans']:
                    t = span['text'].strip()
                    if not t:
                        continue
                    x = round(span['bbox'][0])
                    y = round(span['bbox'][1] / 3) * 3
                    if y not in items_by_y:
                        items_by_y[y] = []
                    items_by_y[y].append({'str': t, 'x': x})
        
        sorted_ys = sorted(items_by_y.keys())
        found_data = False
        
        for y in sorted_ys:
            line_items = sorted(items_by_y[y], key=lambda it: it['x'])
            line_text = ' '.join(it['str'] for it in line_items).strip()
            
            if is_capitec_noise(line_text):
                continue
            
            if not found_data:
                lower = line_text.lower()
                if 'post' in lower and ('description' in lower or 'trans' in lower):
                    found_data = True
                    continue
                if lower == 'date' or (len(lower) < 20 and 'date' in lower):
                    found_data = True
                    continue
                continue
            
            if re.search(r'balance brought forward', line_text, re.I):
                for it in reversed(line_items):
                    if is_money(it['str']):
                        opening_bal = it['str'].replace('+', '').replace(' ', '')
                        break
                continue
            
            if re.search(r'fee total', line_text, re.I):
                continue
            if re.search(r'vat\s*@|vat\s*total', line_text, re.I):
                continue
            if re.search(r'all fees charged', line_text, re.I):
                continue
            
            # Split by zones
            left_items = []
            ref_items = []
            money_items = []
            for it in line_items:
                if it['x'] < 200:
                    left_items.append(it['str'])
                elif it['x'] < 370:
                    ref_items.append(it['str'])
                else:
                    money_items.append(it)
            
            left_text = ' '.join(left_items).strip()
            ref_text = ' '.join(ref_items).strip()
            
            post_date, trans_date, desc = parse_date_desc(left_text)
            has_date = post_date is not None
            
            # Sort money items rightmost first
            money_items.sort(key=lambda it: it['x'], reverse=True)
            balance = money_items[0]['str'].strip() if len(money_items) >= 1 else ''
            amount = money_items[1]['str'].strip() if len(money_items) >= 2 else ''
            fees = money_items[2]['str'].strip() if len(money_items) >= 3 else ''
            
            # Assign correctly: rightmost is balance if x >= 480, else it's amount
            if len(money_items) == 1:
                if money_items[0]['x'] >= 480:
                    balance = money_items[0]['str'].strip()
                    amount = ''
                else:
                    amount = money_items[0]['str'].strip()
                    balance = ''
            
            has_numeric = bool(balance or amount)
            
            if has_date and has_numeric:
                transactions.append({
                    'PostDate': post_date or '',
                    'TransDate': trans_date or '',
                    'Description': desc or (left_text if not has_date else ''),
                    'Reference': ref_text,
                    'Fees': fees,
                    'Amount': amount,
                    'Balance': balance,
                })
            elif has_date and not has_numeric and desc:
                transactions.append({
                    'PostDate': post_date or '',
                    'TransDate': trans_date or '',
                    'Description': desc,
                    'Reference': ref_text,
                    'Fees': '',
                    'Amount': '',
                    'Balance': '',
                })
            elif not has_date and transactions:
                last = transactions[-1]
                if ref_text:
                    last['Reference'] = (last['Reference'] + ' ' + ref_text).strip()
                if left_text and not is_money(left_text):
                    last['Reference'] = (last['Reference'] + ' ' + left_text).strip()
    
    doc.close()
    return transactions, opening_bal


# ======== Nedbank Extractor Logic (Python port) ========

NEDBANK_DATE_RE = re.compile(r'^\d{2}/\d{2}/\d{4}$')
NEDBANK_MONEY_RE = re.compile(r'^\s*([\d\s,]+\.\d{2})\s*\*?\s*$')
TRAN_LIST_RE = re.compile(r'^\d{6}$')

NEDBANK_NOISE = [
    re.compile(p, re.I) for p in [
        r'^see money differently', r'^we subscribe', r'^nedbank ltd',
        r'^page \d', r'^total$', r'^other debits', r'^other credits',
        r'^total charges', r'^electronic transfers', r'^electronic payments',
        r'^narrative description', r'^item cost', r'^vat \(', r'^total \(',
        r'^service fees$', r'^other charges$', r'charges for the period',
        r'bank charges summary', r'^cashflow$', r'account summary',
        r'account type', r'statement date', r'statement period',
        r'statement frequency', r'total pages', r'envelope:',
        r'client vat', r'bank vat', r'annual credit', r'please examine',
        r'no error is reported', r'% of utilisation', r'% of funds',
        r'^R[\d,]+\.\d{2}$', r'^\d+$', r'^tran list no$',
        r'^date$', r'^description$', r'^fees\s*\(r\)', r'^debits\s*\(r\)',
        r'^credits\s*\(r\)', r'^balance\s*\(r\)', r'nedbank\.co\.za',
        r'lost cards', r'client care', r'^135 rivonia', r'^p o box',
        r'vat inclusive', r'vat calculated', r'funds received', r'funds used',
        r'^tax invoice', r'authorised financial', r'registered credit provider',
    ]
]

def is_nedbank_noise(text):
    t = text.strip()
    if not t or len(t) < 2:
        return True
    return any(p.search(t) for p in NEDBANK_NOISE)

def extract_nedbank(filepath):
    doc = fitz.open(filepath)
    transactions = []
    opening_bal = ''
    closing_bal = ''
    DATE_PAT = re.compile(r'^\d{2}/\d{2}/\d{4}$')
    
    for page_num in range(doc.page_count):
        page = doc[page_num]
        blocks = page.get_text('dict')
        
        items_by_y = {}
        for block in blocks['blocks']:
            if 'lines' not in block:
                continue
            for line in block['lines']:
                for span in line['spans']:
                    t = span['text'].strip()
                    if not t:
                        continue
                    x = round(span['bbox'][0])
                    y = round(span['bbox'][1] / 3) * 3
                    if y not in items_by_y:
                        items_by_y[y] = []
                    items_by_y[y].append({'str': t, 'x': x})
        
        sorted_ys = sorted(items_by_y.keys())
        found_data = False
        
        for y in sorted_ys:
            items = sorted(items_by_y[y], key=lambda it: it['x'])
            line_text = ' '.join(it['str'] for it in items).strip()
            
            if is_nedbank_noise(line_text):
                continue
            
            if not found_data:
                lower = line_text.lower()
                if ('date' in lower or 'datum' in lower) and \
                   ('description' in lower or 'beskrywing' in lower) and \
                   ('balance' in lower or 'saldo' in lower):
                    found_data = True
                    continue
                continue
            
            # Parse by x-position zones
            date = ''
            description = ''
            debit_amount = ''
            credit_amount = ''
            balance = ''
            has_fee = False
            
            for it in items:
                s = it['str']
                if it['x'] < 90:
                    if re.match(r'^\d{6}$', s):
                        pass  # tran list no
                    elif re.search(r'opening balance|beginsaldo|closing balance|eindsaldo', s, re.I):
                        description = s
                elif it['x'] < 140:
                    if DATE_PAT.match(s):
                        date = s
                elif it['x'] < 360:
                    description = (description + ' ' + s).strip() if description else s
                elif it['x'] < 430:
                    debit_amount = s.replace('*', '').strip()
                    if '*' in s:
                        has_fee = True
                elif it['x'] < 520:
                    credit_amount = s.strip()
                else:
                    balance = s.strip()
            
            if re.search(r'opening balance|beginsaldo', description, re.I):
                if balance and not opening_bal:
                    opening_bal = balance.replace(',', '').replace(' ', '')
                continue
            
            if re.search(r'closing balance|eindsaldo', description, re.I) or \
               re.search(r'closing balance|eindsaldo', line_text, re.I):
                if balance:
                    closing_bal = balance.replace(',', '').replace(' ', '')
                continue
            
            if not date:
                continue
            
            amount = ''
            direction = ''
            if credit_amount:
                amount = credit_amount
                direction = 'In'
            elif debit_amount:
                amount = '-' + debit_amount
                direction = 'Out'
            
            if date and (amount or balance):
                transactions.append({
                    'Date': date,
                    'Description': description,
                    'Amount': amount,
                    'Balance': balance,
                    'IsFee': has_fee,
                    'Direction': direction,
                })
    
    doc.close()
    return transactions, opening_bal, closing_bal


# ======== Main test ========

def test_capitec():
    print("=" * 60)
    print("CAPITEC TESTS")
    print("=" * 60)
    
    capitec_files = [
        "Account Statement_5121_2026-02-02.pdf",
        "Account Statement_8699_2026-02-02.pdf",
        "Account Statement_8892_2026-02-02.pdf",
    ]
    
    for fname in capitec_files:
        fpath = os.path.join(TEST_DIR, fname)
        if not os.path.exists(fpath):
            print(f"\n  SKIP: {fname} not found")
            continue
        
        txns, opening = extract_capitec(fpath)
        print(f"\n  {fname}")
        print(f"    Opening Balance: {opening}")
        print(f"    Transactions: {len(txns)}")
        
        if txns:
            print(f"    Closing Balance: {txns[-1].get('Balance', 'N/A')}")
            print(f"    First 3:")
            for t in txns[:3]:
                print(f"      {t['PostDate']} | {t['Description'][:40]:40s} | {t['Amount']:>15s} | {t['Balance']:>15s}")
            if len(txns) > 3:
                print(f"    Last 3:")
                for t in txns[-3:]:
                    print(f"      {t['PostDate']} | {t['Description'][:40]:40s} | {t['Amount']:>15s} | {t['Balance']:>15s}")

def test_nedbank():
    print("\n" + "=" * 60)
    print("NEDBANK TESTS")
    print("=" * 60)
    
    nedbank_files = [
        "10. January 2026.pdf",
        "January 2026.pdf",
    ]
    
    for fname in nedbank_files:
        fpath = os.path.join(TEST_DIR, fname)
        if not os.path.exists(fpath):
            print(f"\n  SKIP: {fname} not found")
            continue
        
        txns, opening, closing = extract_nedbank(fpath)
        print(f"\n  {fname}")
        print(f"    Opening Balance: {opening}")
        print(f"    Closing Balance: {closing}")
        print(f"    Transactions: {len(txns)}")
        
        if txns:
            print(f"    First 3:")
            for t in txns[:3]:
                print(f"      {t['Date']} | {t['Description'][:40]:40s} | {t['Amount']:>10s} | {t['Balance']:>10s} | Dir={t['Direction']} Fee={t['IsFee']}")
            if len(txns) > 3:
                print(f"    Last 3:")
                for t in txns[-3:]:
                    print(f"      {t['Date']} | {t['Description'][:40]:40s} | {t['Amount']:>10s} | {t['Balance']:>10s} | Dir={t['Direction']} Fee={t['IsFee']}")

if __name__ == '__main__':
    test_capitec()
    test_nedbank()
