#!/bin/bash
# Build the complete-source markdown file
set -e
cd /mnt/d/Prism/prism-file-hero

OUT="COMPLETE-SOURCE.md"
: > "$OUT"

echo "# Prism File Hero - Complete Source Code" >> "$OUT"
echo "" >> "$OUT"
echo "Generated: $(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$OUT"
echo "" >> "$OUT"

# Collect files (exclude node_modules, dist, generated artifacts)
mapfile -t FILES < <(
  find . -type f \
    \( -name "*.ts" -o -name "*.tsx" -o -name "*.rs" -o -name "*.py" \
       -o -name "*.sql" -o -name "*.css" -o -name "*.html" -o -name "*.md" \
       -o -name "*.wxs" -o -name "*.yml" -o -name "*.yaml" -o -name "Dockerfile" \) \
    -not -path "*/node_modules/*" \
    -not -path "./dist-desktop/*" \
    -not -path "*/dist-desktop/*" \
    -not -path "./playwright-report/*" \
    -not -path "./test-results/*" \
    -not -path "./.git/*" \
    -not -path "./src-tauri/target/*" \
    -not -path "./src-tauri/gen/*" \
    -not -path "*/.git/*" \
    -not -name "package-lock.json" \
    -not -name "*.tsbuildinfo" \
    -not -name "*.xlsx" -not -name "*.pdf" -not -name "*.zip" \
    2>/dev/null | sort
)

COUNT=0
for f in "${FILES[@]}"; do
  ext="${f##*.}"
  echo "" >> "$OUT"
  echo "## \`$f\`" >> "$OUT"
  echo "" >> "$OUT"
  echo '```'"$ext" >> "$OUT"
  cat "$f" >> "$OUT"
  echo '```' >> "$OUT"
  COUNT=$((COUNT+1))
done

echo "" >> "$OUT"
echo "" >> "$OUT"
echo "---" >> "$OUT"
echo "" >> "$OUT"
echo "_Total files embedded: $COUNT_" >> "$OUT"
echo "_Total size: $(wc -c < "$OUT") bytes / $(wc -l < "$OUT") lines_" >> "$OUT"

echo "BUILT: $COUNT files, $(wc -c < "$OUT") bytes, $(wc -l < "$OUT") lines"
