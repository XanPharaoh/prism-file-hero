import pypdf
from pathlib import Path

root = Path(r'c:\Users\Philander\Downloads\Test accounts')
results = []

for f in root.glob('*.pdf'):
    try:
        r = pypdf.PdfReader(str(f))
        results.append(f"{f.name}: encrypted={r.is_encrypted}")
    except Exception as e:
        results.append(f"{f.name}: error={e}")

with open('encryption_report.txt', 'w', encoding='utf-8') as out:
    out.write("\n".join(results))

print("Scan complete.")
