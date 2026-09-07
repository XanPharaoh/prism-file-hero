import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * Extracts bounding-box structured text from a PDF page using pdftotext -tsv.
 * Groups words into lines and returns a JSON string representation.
 */
export async function extractPageBBoxes(pdfPath, pageNum) {
  try {
    const { stdout } = await execFileAsync('pdftotext', [
      '-tsv', 
      '-f', String(pageNum), 
      '-l', String(pageNum), 
      pdfPath, 
      '-'
    ]);
    
    const lines = stdout.trim().split('\n').slice(1);
    const words = [];
    
    for (const line of lines) {
      const parts = line.split('\t');
      if (parts.length < 12) continue;
      if (parseInt(parts[0], 10) !== 5) continue; // word level
      
      words.push({
        top: Math.round(parseFloat(parts[7])),
        left: Math.round(parseFloat(parts[6])),
        right: Math.round(parseFloat(parts[6]) + parseFloat(parts[8])),
        bottom: Math.round(parseFloat(parts[7]) + parseFloat(parts[9])),
        text: parts[11]
      });
    }
    
    // Group by line (top +/- 3 pixels)
    const groupedLines = [];
    for (const word of words) {
      let found = false;
      for (const line of groupedLines) {
        if (Math.abs(line.top - word.top) <= 3) {
          line.words.push(word);
          line.left = Math.min(line.left, word.left);
          line.right = Math.max(line.right, word.right);
          line.top = Math.min(line.top, word.top);
          line.bottom = Math.max(line.bottom, word.bottom);
          found = true;
          break;
        }
      }
      if (!found) {
        groupedLines.push({
          top: word.top,
          bottom: word.bottom,
          left: word.left,
          right: word.right,
          words: [word]
        });
      }
    }
    
    groupedLines.sort((a, b) => a.top - b.top);
    
    // Format into clean structured text
    const structuredLines = groupedLines.map(line => {
      line.words.sort((a, b) => a.left - b.left);
      const text = line.words.map(w => w.text).join(' ');
      return `[${line.left}, ${line.top}, ${line.right}, ${line.bottom}] ${text}`;
    });
    
    return structuredLines.join('\n');
  } catch (err) {
    console.warn(`[pdfBboxExtractor] Failed to extract bounding boxes for page ${pageNum}:`, err.message);
    return "";
  }
}
