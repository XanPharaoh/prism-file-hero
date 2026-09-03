import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { App as CapApp } from '@capacitor/app';
import { StatusBar, Style } from '@capacitor/status-bar';
import { DocumentScanner } from '@capacitor-mlkit/document-scanner';

export type NativeBridgeErrorCode =
  | 'DOCUMENT_SCANNER_MODULE_INSTALLING'
  | 'DOCUMENT_SCANNER_UNAVAILABLE'
  | 'DOCUMENT_SCANNER_FAILED'
  | 'NATIVE_FILE_WRITE_FAILED'
  | 'NATIVE_SHARE_FAILED';

/** A stable error shape that native UI code can safely branch on. */
export class NativeBridgeError extends Error {
  constructor(
    public readonly code: NativeBridgeErrorCode,
    message: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = 'NativeBridgeError';
  }
}

export type DocumentScannerStatus =
  | { state: 'unavailable' }
  | { state: 'ready' }
  | { state: 'installing'; progress?: number }
  | { state: 'failed'; message: string };

let documentScannerStatus: DocumentScannerStatus = { state: 'unavailable' };
let documentScannerInstallPromise: Promise<DocumentScannerStatus> | null = null;

/**
 * Native Bridge for Android Mobile & Web Cross-Platform Operations
 */

export function isNativePlatform(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

export function isAndroid(): boolean {
  try {
    return Capacitor.getPlatform() === 'android';
  } catch {
    return false;
  }
}

/** Returns the most recently known ML Kit module status for native UI. */
export function getDocumentScannerStatus(): DocumentScannerStatus {
  return documentScannerStatus;
}

function isCancellation(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /cancel(?:led|ed)?|user\s+cancel/i.test(message);
}

/**
 * Checks the Google Play services scanner module and starts its download when
 * required. The download is asynchronous, so callers can render its status and
 * retry scanning once the module reports ready.
 */
export async function prepareDocumentScanner(): Promise<DocumentScannerStatus> {
  if (!isAndroid()) {
    documentScannerStatus = { state: 'unavailable' };
    return documentScannerStatus;
  }

  try {
    const { available } = await DocumentScanner.isGoogleDocumentScannerModuleAvailable();
    if (available) {
      documentScannerStatus = { state: 'ready' };
      return documentScannerStatus;
    }
  } catch (error) {
    const message = 'Google Play services could not check document-scanner availability.';
    documentScannerStatus = { state: 'failed', message };
    throw new NativeBridgeError('DOCUMENT_SCANNER_UNAVAILABLE', message, error);
  }

  if (documentScannerInstallPromise) return documentScannerInstallPromise;
  documentScannerStatus = { state: 'installing', progress: 0 };
  documentScannerInstallPromise = (async () => {
    let listener: Awaited<ReturnType<typeof DocumentScanner.addListener>> | undefined;
    try {
      listener = await DocumentScanner.addListener(
        'googleDocumentScannerModuleInstallProgress',
        async event => {
          if (event.state === 4) {
            documentScannerStatus = { state: 'ready' };
            await listener?.remove().catch(() => undefined);
          } else if (event.state === 3 || event.state === 5) {
            documentScannerStatus = {
              state: 'failed',
              message: 'The document-scanner download did not finish. Check your connection and try again.',
            };
            await listener?.remove().catch(() => undefined);
          } else {
            documentScannerStatus = { state: 'installing', progress: event.progress };
          }
        }
      );
      await DocumentScanner.installGoogleDocumentScannerModule();
      return documentScannerStatus;
    } catch (error) {
      const message = 'Could not start the document-scanner download. Check Google Play services and try again.';
      documentScannerStatus = { state: 'failed', message };
      await listener?.remove().catch(() => undefined);
      throw new NativeBridgeError('DOCUMENT_SCANNER_UNAVAILABLE', message, error);
    } finally {
      documentScannerInstallPromise = null;
    }
  })();
  return documentScannerInstallPromise;
}

/**
 * Converts a Blob to a base64 data string (without header)
 */
async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const dataUrl = reader.result as string;
      const base64 = dataUrl.split(',')[1] || '';
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * Universal File Saver:
 * - On Native Android: writes to device storage and opens native Share / Open With dialog
 * - On Web: triggers browser download
 */
export async function saveAndShareFile(
  blob: Blob,
  fileName: string,
  options?: { dialogTitle?: string; sharePrompt?: boolean }
): Promise<{ success: boolean; uri?: string }> {
  if (isNativePlatform()) {
    let savedFile: Awaited<ReturnType<typeof Filesystem.writeFile>>;
    try {
      // One shareable cache copy is enough: Android share targets include
      // Save/Open actions, while a Documents copy doubled I/O and storage.
      savedFile = await Filesystem.writeFile({
        path: fileName,
        data: await blobToBase64(blob),
        directory: Directory.Cache,
      });
    } catch (error) {
      throw new NativeBridgeError(
        'NATIVE_FILE_WRITE_FAILED',
        'Could not save the exported file on this device.',
        error
      );
    }

    if (options?.sharePrompt !== false) {
      try {
        await Share.share({
          title: options?.dialogTitle || `Prism: ${fileName}`,
          text: `Processed with Prism File Hero: ${fileName}`,
          files: [savedFile.uri],
          dialogTitle: options?.dialogTitle || 'Open or Save Document',
        });
      } catch (error) {
        // The file is already saved. A native cancellation must not fall
        // through to a WebView download and masquerade as another success.
        if (isCancellation(error)) return { success: true, uri: savedFile.uri };
        throw new NativeBridgeError(
          'NATIVE_SHARE_FAILED',
          'The file was saved, but Android could not open the share sheet.',
          error
        );
      }
    }

    return { success: true, uri: savedFile.uri };
  }

  // Web Fallback
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 1000);

  return { success: true };
}

/**
 * Capture high-resolution scanned documents via Google ML Kit Document Scanner
 * Supports automatic edge detection, perspective correction, shadow removal,
 * stain/finger erasing, and multi-page batch scanning.
 */
export async function scanDocuments(): Promise<File[]> {
  if (isAndroid()) {
    const scannerState = await prepareDocumentScanner();
    if (scannerState.state !== 'ready') {
      throw new NativeBridgeError(
        'DOCUMENT_SCANNER_MODULE_INSTALLING',
        'Preparing the document scanner. Keep Prism open and try again when the download finishes.'
      );
    }

    try {
      const scanResult = await DocumentScanner.scanDocument({
        galleryImportAllowed: true,
        pageLimit: 50,
        // Prism consumes one PDF. Avoid generating every JPEG page as a
        // second in-memory native result for a multi-page scan.
        resultFormats: 'PDF',
        scannerMode: 'FULL',
      });

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      if (!scanResult.pdf?.uri) {
        throw new NativeBridgeError(
          'DOCUMENT_SCANNER_FAILED',
          'The document scanner finished without producing a PDF.'
        );
      }

      const response = await fetch(Capacitor.convertFileSrc(scanResult.pdf.uri));
      const blob = await response.blob();
      if (blob.size > 0) {
        return [
          new File([blob], `Scanned_Document_${timestamp}.pdf`, {
            type: 'application/pdf',
          }),
        ];
      }
      throw new NativeBridgeError(
        'DOCUMENT_SCANNER_FAILED',
        'The scanned PDF could not be read from this device.'
      );
    } catch (error) {
      if (isCancellation(error)) return [];
      if (error instanceof NativeBridgeError) throw error;
      throw new NativeBridgeError(
        'DOCUMENT_SCANNER_FAILED',
        'Document scanning failed. Check Google Play services and try again.',
        error
      );
    }
  }

  // Fallback to standard Camera photo capture
  const photoFile = await captureDocumentPhoto();
  return photoFile ? [photoFile] : [];
}

/**
 * Capture high-resolution document photo via mobile camera (Fallback)
 */
export async function captureDocumentPhoto(): Promise<File | null> {
  if (!isNativePlatform()) {
    return null;
  }

  try {
    const photo = await Camera.getPhoto({
      quality: 95,
      allowEditing: true,
      resultType: CameraResultType.Uri,
      source: CameraSource.Prompt, // Allows choosing Camera or Gallery
    });

    if (photo.webPath) {
      const res = await fetch(photo.webPath);
      const blob = await res.blob();
      return new File([blob], `Scanned_Doc_${Date.now()}.${photo.format || 'jpg'}`, {
        type: `image/${photo.format || 'jpeg'}`,
      });
    }
  } catch (err) {
    console.warn('Camera capture cancelled or failed:', err);
  }

  return null;
}

/**
 * Initialize Mobile Status Bar & Navigation
 */
export async function initializeMobilePlatform(): Promise<void> {
  if (!isNativePlatform()) return;

  try {
    await StatusBar.setStyle({ style: Style.Dark });
    await StatusBar.setBackgroundColor({ color: '#0B0F19' });
  } catch (err) {
    console.warn('Could not initialize status bar styling:', err);
  }
}

/**
 * Register Android Hardware Back Button listener
 * @param handler Function returning true if handled internally, false to allow default (app exit)
 */
export function registerHardwareBackButton(handler: () => boolean): () => void {
  if (!isNativePlatform()) {
    return () => {};
  }

  const listenerPromise = CapApp.addListener('backButton', ({ canGoBack }) => {
    const handled = handler();
    if (!handled && canGoBack) {
      window.history.back();
    } else if (!handled && !canGoBack) {
      CapApp.exitApp();
    }
  });

  return () => {
    listenerPromise.then(l => l.remove()).catch(() => {});
  };
}
