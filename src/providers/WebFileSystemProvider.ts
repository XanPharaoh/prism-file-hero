import type { FileSystemProvider } from './FileSystemProvider';
import type { ToolID } from '../types';

export class WebFileSystemProvider implements FileSystemProvider {
  async pickFiles(_toolId: ToolID, allowedTypes: string[], maxFiles: number): Promise<File[]> {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = allowedTypes.join(',');
      input.multiple = maxFiles === 0 || maxFiles > 1;
      input.onchange = () => {
        const files = Array.from(input.files ?? []);
        resolve(maxFiles > 0 ? files.slice(0, maxFiles) : files);
      };
      input.click();
    });
  }

  async saveBlob(blob: Blob, filename: string): Promise<void> {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    requestAnimationFrame(() => {
      setTimeout(() => {
        if (a.parentNode) document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, 1000);
    });
  }

  async readFileAsArrayBuffer(file: File): Promise<ArrayBuffer> {
    return file.arrayBuffer();
  }
}