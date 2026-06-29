import type { ToolID } from '../types';

export interface FileSystemProvider {
  pickFiles(toolId: ToolID, allowedTypes: string[], maxFiles: number): Promise<File[]>;
  saveBlob(blob: Blob, filename: string): Promise<void>;
  readFileAsArrayBuffer(file: File): Promise<ArrayBuffer>;
}

export function isTauriEnvironment(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}