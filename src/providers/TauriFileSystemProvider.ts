import { open, save } from '@tauri-apps/plugin-dialog';
import { readFile, writeFile } from '@tauri-apps/plugin-fs';
import type { FileSystemProvider } from './FileSystemProvider';
import type { ToolID } from '../types';

export class TauriFileSystemProvider implements FileSystemProvider {
  async pickFiles(_toolId: ToolID, allowedTypes: string[], maxFiles: number): Promise<File[]> {
    const extensions = allowedTypes.map((t) => t.split('/')[1] ?? t);
    const selected = await open({
      multiple: maxFiles === 0 || maxFiles > 1,
      filters: [{ name: 'Files', extensions }],
    });
    if (!selected) return [];
    const paths = Array.isArray(selected) ? selected : [selected];

    const results: File[] = await Promise.all(
      paths.map(async (path) => {
        const bytes = await readFile(path);
        const fileName = path.split('/').pop() ?? path.split('\\').pop() ?? 'file';
        const fileType = fileName.toLowerCase().endsWith('.pdf')
          ? 'application/pdf'
          : fileName.toLowerCase().match(/\.(jpg|jpeg)$/)
            ? 'image/jpeg'
            : fileName.toLowerCase().match(/\.png$/)
              ? 'image/png'
              : 'application/octet-stream';
        return new File([bytes], fileName, { type: fileType });
      })
    );

    return maxFiles > 0 ? results.slice(0, maxFiles) : results;
  }

  async saveBlob(blob: Blob, filename: string): Promise<void> {
    const path = await save({ defaultPath: filename });
    if (!path) return;
    const bytes = new Uint8Array(await blob.arrayBuffer());
    await writeFile(path, bytes);
  }

  async readFileAsArrayBuffer(file: File): Promise<ArrayBuffer> {
    // For files that came from Tauri (File objects created in pickFiles),
    // arrayBuffer() should work fine since they contain the actual byte data.
    return file.arrayBuffer();
  }
}