import { beforeEach, describe, it, expect, vi } from 'vitest';
import { isTauriEnvironment } from '../src/providers/FileSystemProvider';
import { WebFileSystemProvider } from '../src/providers/WebFileSystemProvider';
import { TauriFileSystemProvider } from '../src/providers/TauriFileSystemProvider';
import { open } from '@tauri-apps/plugin-dialog';
import { readFile } from '@tauri-apps/plugin-fs';
import type { ToolID } from '../src/types';

vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(), save: vi.fn() }));
vi.mock('@tauri-apps/plugin-fs', () => ({ readFile: vi.fn(), writeFile: vi.fn() }));


describe('FileSystemProvider', () => {
  describe('isTauriEnvironment', () => {
    it('should return false in browser environment', () => {
      // JSDOM doesn't have __TAURI_INTERNALS__
      expect(isTauriEnvironment()).toBe(false);
    });

    it('should return true when __TAURI_INTERNALS__ is present', () => {
      (window as any).__TAURI_INTERNALS__ = {};
      expect(isTauriEnvironment()).toBe(true);
      delete (window as any).__TAURI_INTERNALS__;
    });
  });

  describe('WebFileSystemProvider', () => {
    let provider: WebFileSystemProvider;

    beforeEach(() => {
      provider = new WebFileSystemProvider();
    });

    describe('pickFiles', () => {
      it('should create a file input element and return files', async () => {
        const mockFile = new File(['test content'], 'test.pdf', { type: 'application/pdf' });
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        const createElement = document.createElement.bind(document);

        // Mock document.createElement to return our controlled input
        const createElementSpy = vi.spyOn(document, 'createElement');
        createElementSpy.mockImplementation((tagName: string) => {
          if (tagName === 'input') {
            return fileInput;
          }
          return createElement(tagName);
        });

        // Trigger the file selection
        const promise = provider.pickFiles('merge' as ToolID, ['application/pdf'], 1);

        // Simulate user selecting a file
        Object.defineProperty(fileInput, 'files', { configurable: true, value: [mockFile] });
        fileInput.dispatchEvent(new Event('change'));

        const files = await promise;
        expect(files.length).toBe(1);
        expect(files[0].name).toBe('test.pdf');
        expect(files[0].type).toBe('application/pdf');

        createElementSpy.mockRestore();
      });

      it('should enforce maxFiles limit', async () => {
        const provider = new WebFileSystemProvider();
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        const createElement = document.createElement.bind(document);

        const createElementSpy = vi.spyOn(document, 'createElement');
        createElementSpy.mockImplementation((tagName: string) => {
          if (tagName === 'input') return fileInput;
          return createElement(tagName);
        });

        const files = [
          new File(['a'], 'a.pdf', { type: 'application/pdf' }),
          new File(['b'], 'b.pdf', { type: 'application/pdf' }),
          new File(['c'], 'c.pdf', { type: 'application/pdf' }),
        ];

        const promise = provider.pickFiles('merge' as ToolID, ['application/pdf'], 2);

        Object.defineProperty(fileInput, 'files', { configurable: true, value: files });
        fileInput.dispatchEvent(new Event('change'));

        const result = await promise;
        expect(result.length).toBe(2);

        createElementSpy.mockRestore();
      });
    });

    describe('saveBlob', () => {
      it('should create a download link and trigger click', async () => {
        const blob = new Blob(['test'], { type: 'application/pdf' });
        const anchor = document.createElement('a');
        const createElement = document.createElement.bind(document);

        const createElementSpy = vi.spyOn(document, 'createElement');
        createElementSpy.mockImplementation((tagName: string) => {
          if (tagName === 'a') return anchor;
          return createElement(tagName);
        });

        const clickSpy = vi.spyOn(anchor, 'click');

        await provider.saveBlob(blob, 'test.pdf');

        expect(anchor.download).toBe('test.pdf');
        expect(anchor.href).toBeTruthy();
        expect(clickSpy).toHaveBeenCalled();

        createElementSpy.mockRestore();
      });
    });

    describe('readFileAsArrayBuffer', () => {
      it('should return array buffer from file', async () => {
        const content = 'Hello, World!';
        const file = new File([content], 'test.txt', { type: 'text/plain' });
        const buffer = await provider.readFileAsArrayBuffer(file);
        const decoder = new TextDecoder();
        const text = decoder.decode(buffer);
        expect(text).toBe(content);
      });
    });
  });

  describe('TauriFileSystemProvider', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('includes jpg, jpeg, and png extensions and infers their MIME types', async () => {
      vi.mocked(open).mockResolvedValue([
        '/files/photo.JPG',
        '/files/portrait.jpeg',
        '/files/graphic.PNG',
      ]);
      vi.mocked(readFile).mockResolvedValue(new Uint8Array([1, 2, 3]));

      const files = await new TauriFileSystemProvider().pickFiles(
        'jpg-to-pdf' as ToolID,
        ['image/jpeg', 'image/png'],
        0,
      );

      expect(open).toHaveBeenCalledWith({
        multiple: true,
        filters: [{ name: 'Files', extensions: ['jpg', 'jpeg', 'png'] }],
      });
      expect(files.map((file) => [file.name, file.type])).toEqual([
        ['photo.JPG', 'image/jpeg'],
        ['portrait.jpeg', 'image/jpeg'],
        ['graphic.PNG', 'image/png'],
      ]);
    });
  });

  describe('Provider selection', () => {
    it('should use WebFileSystemProvider in non-Tauri environments', () => {
      expect(isTauriEnvironment()).toBe(false);
      // This mirrors the logic in App.tsx
      const provider = isTauriEnvironment()
        ? null // would be TauriFileSystemProvider
        : new WebFileSystemProvider();
      expect(provider).toBeInstanceOf(WebFileSystemProvider);
    });

    it('provider should implement FileSystemProvider interface', () => {
      const provider = new WebFileSystemProvider();
      expect(typeof provider.pickFiles).toBe('function');
      expect(typeof provider.saveBlob).toBe('function');
      expect(typeof provider.readFileAsArrayBuffer).toBe('function');
    });
  });
});
