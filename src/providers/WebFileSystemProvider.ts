import type { FileSystemProvider } from './FileSystemProvider';
import type { ToolID } from '../types';

export class WebFileSystemProvider implements FileSystemProvider {
  async pickFiles(_toolId: ToolID, allowedTypes: string[], maxFiles: number): Promise<File[]> {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      let settled = false;
      let cancelTimer: number | undefined;
      const finish = (files: File[] = []) => {
        if (settled) return;
        settled = true;
        if (cancelTimer !== undefined) window.clearTimeout(cancelTimer);
        window.removeEventListener('focus', onWindowFocus);
        resolve(maxFiles > 0 ? files.slice(0, maxFiles) : files);
      };
      const onWindowFocus = () => {
        // Android browsers often emit no `cancel` event. Once the chooser closes,
        // a short delay lets a genuine `change` event win before resolving empty.
        cancelTimer = window.setTimeout(() => {
          if (!input.files?.length) finish();
        }, 250);
      };
      input.type = 'file';
      input.accept = allowedTypes.join(',');
      input.multiple = maxFiles === 0 || maxFiles > 1;
      input.onchange = () => {
        finish(Array.from(input.files ?? []));
      };
      input.addEventListener('cancel', () => finish());
      window.addEventListener('focus', onWindowFocus, { once: true });
      input.click();
    });
  }

  async saveBlob(blob: Blob, filename: string): Promise<void> {
    const { saveAndShareFile } = await import('../../services/nativeBridge');
    await saveAndShareFile(blob, filename);
  }

  async readFileAsArrayBuffer(file: File): Promise<ArrayBuffer> {
    return file.arrayBuffer();
  }
}
