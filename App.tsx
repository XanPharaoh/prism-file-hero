import React, { useEffect, useCallback, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';
import { useAuth, useUser, useClerk } from '@clerk/react';
import {
  Layers, Search, X, Menu, History, UploadCloud, Icon,
  CheckCircle, XCircle, AlertTriangle, Info,
} from './src/components/ui/Icon';
import { BrandHeader } from './src/components/ui/Brand';
import { ProcessStatus, type ToolID } from './src/types';
import { getToolById } from './src/registry/toolRegistry';
import { useAppStore } from './src/store/appStore';
import { SidebarContent } from './src/components/ToolSidebar';
import { isTauriEnvironment } from './src/providers/FileSystemProvider';
import { TauriFileSystemProvider } from './src/providers/TauriFileSystemProvider';
import { WebFileSystemProvider } from './src/providers/WebFileSystemProvider';
import HistoryDashboard from './src/components/HistoryDashboard';
import AuthModal from './src/components/AuthModal';
import AccountPanel from './src/components/AccountPanel';
import QuotaExceededModal from './src/components/QuotaExceededModal';
import { checkExecutionAuthorization } from './services/edgeEnforcement';
import { saveExtractionHistory } from './services/historyService';
import { setClerkInstance, setClerkUserId } from './services/authService';
import { getCachedFile, clearCachedFile } from './services/fileCache';
import { checkLimit, reportUsage, getUsageSummary, getToolButtonLabel, type UsageSummary, type LimitCheckResult } from './services/usageTrackingService';
import { isFreeTool, getFeatureType } from './services/usageConfig';
import UsageBadge from './src/components/UsageBadge';
import ToolDashboard from './src/components/views/ToolDashboard';
import ProcessingView from './src/components/views/ProcessingView';
import { ToolLandingView } from './src/components/views/ToolLandingView';
import { analytics } from './src/services/analyticsService';
import { isInternalDesktopDistribution } from './src/config/distribution';
import BugReportForm from './src/components/BugReportForm';
import PublicAdNotice from './src/components/PublicAdNotice';
import InternalActivationGate from './src/components/InternalActivationGate';

const MAX_FILE_SIZE = 50 * 1024 * 1024;
const fsProvider = isTauriEnvironment() ? new TauriFileSystemProvider() : new WebFileSystemProvider();
const renderToolIcon = (name: string, className?: string) => {
  return <Icon name={name} className={className} size={24} />;
};

/**
 * Count the total pages in a PDF file using pdfjs-dist.
 * Returns 0 if the file is not a PDF or if counting fails.
 */
async function countPdfPages(file: File): Promise<number> {
  if (file.type !== 'application/pdf') return 0;
  try {
    const pdfjsLib = await import('pdfjs-dist');
    const arrayBuf = await file.arrayBuffer();
    const pdfDoc = await pdfjsLib.getDocument({ data: arrayBuf }).promise;
    return pdfDoc.numPages;
  } catch {
    return 0;
  }
}

/**
 * Count total pages across all files in a batch.
 */
async function countTotalPages(files: File[]): Promise<number> {
  let total = 0;
  for (const file of files) {
    total += await countPdfPages(file);
  }
  return total;
}

async function applyPageBudget(files: File[], pageBudget: number): Promise<{ files: File[]; processedPages: number }> {
  let remainingPages = Math.max(0, pageBudget);
  let processedPages = 0;
  const boundedFiles: File[] = [];

  for (const file of files) {
    if (file.type !== 'application/pdf') {
      boundedFiles.push(file);
      continue;
    }

    if (remainingPages <= 0) break;

    const pageCount = await countPdfPages(file);
    const pagesForFile = Math.min(pageCount || 1, remainingPages);
    if (pagesForFile <= 0) break;

    // Do not re-save a page subset: pdf-lib cannot preserve every encrypted or
    // non-standard stream, and the derivative may be unreadable in Chromium.
    boundedFiles.push(file);
    processedPages += pagesForFile;
    remainingPages -= pagesForFile;
  }

  return { files: boundedFiles, processedPages };
}

type PublicAuth = { isLoaded: boolean; isSignedIn: boolean | undefined; clerkUser: any; clerk: any };

const AppShell: React.FC<{ auth: PublicAuth | null; internalDesktop: boolean }> = ({ auth, internalDesktop }) => {
  const s = useAppStore();
  const isLoaded = internalDesktop || Boolean(auth?.isLoaded);
  const isSignedIn = auth?.isSignedIn;
  const clerkUser = auth?.clerkUser;
  const clerk = auth?.clerk;

  // Keep the Clerk instance reference in the token bridge so that
  // services outside React can request fresh tokens on every call.
  useEffect(() => {
    if (!internalDesktop) setClerkInstance(clerk);
  }, [clerk, internalDesktop]);

  // Sync Clerk auth state to the Zustand store + user-id bridge
  useEffect(() => {
    if (internalDesktop) return;
    if (isSignedIn && clerkUser) {
      setClerkUserId(clerkUser.id);
      s.setUser({
        id: clerkUser.id,
        email: clerkUser.primaryEmailAddress?.emailAddress || '',
        name: clerkUser.fullName || clerkUser.username || '',
      });
      const plan = s.isPremium ? 'pro' : 'free';
      analytics.identifyUser({
        id: clerkUser.id,
        email: clerkUser.primaryEmailAddress?.emailAddress || '',
        name: clerkUser.fullName || clerkUser.username || '',
      }, plan);
    } else {
      setClerkUserId(null);
      s.setUser(null);
      analytics.resetUser();
    }
  }, [isSignedIn, clerkUser, internalDesktop]);

  useEffect(() => {
    if (internalDesktop) { s.setIsPremium(true); return; }
    if (!s.user) { s.setIsPremium(false); return; }
    (async () => {
      try {
        const check = await checkExecutionAuthorization('pdf-to-excel');
        const isPremium = check.plan === 'pro' || check.plan === 'business';
        s.setIsPremium(isPremium);
        if (s.user) {
          analytics.identifyUser(s.user, isPremium ? 'pro' : 'free');
        }
      }
      catch { s.setIsPremium(false); }
    })();
  }, [s.user, internalDesktop]);

  const [progress, setProgress] = useState(0);

  const handleSelectFiles = useCallback(async () => {
    if (!s.selectedTool) return;
    const tool = getToolById(s.selectedTool);
    if (!tool) return;
    const files = await fsProvider.pickFiles(s.selectedTool, tool.allowedFileTypes, tool.maxFiles);
    if (!files.length) return;
    const valid = files.filter(f => f.size <= MAX_FILE_SIZE);
    if (valid.length !== files.length) s.addToast({ type: 'warning', message: 'Some files exceed 50MB limit.' });

    const totalSize = valid.reduce((sum, f) => sum + f.size, 0);
    analytics.trackFilesAdded(s.selectedTool, valid.length, totalSize);

    // Count total pages for quota enforcement
    const totalPages = await countTotalPages(valid);
    s.setTotalSelectedPages(totalPages);

    s.addFiles(valid);
  }, [s.selectedTool]);

  const downloadBlob = useCallback(async (blob: Blob, name: string) => {
    await fsProvider.saveBlob(blob, name);
  }, []);

  const runHero = useCallback(async () => {
    if (!s.selectedTool || !s.batch.length || s.isProcessing) return;
    const tool = getToolById(s.selectedTool);
    if (!tool) return;

    const missing: string[] = [];
    const files = s.batch
      .map(i => {
        const file = getCachedFile(i.id);
        if (!file) {
          missing.push(i.fileName);
          return null;
        }
        return file;
      })
      .filter((f): f is File => f != null);

    // Cache is cleared after successful runs; re-run without re-upload must not crash
    if (!files.length || missing.length > 0) {
      s.addToast({
        type: 'error',
        message:
          'Selected file is no longer available in memory. Please re-upload the PDF and try again.',
        duration: 7000,
      });
      return;
    }

    // ── PRE-FLIGHT: Auth check ─────────────────────────────────
    if (!internalDesktop && !isFreeTool(s.selectedTool) && !s.user) {
      s.setShowAuthModal(true);
      return;
    }

    // ── PRE-FLIGHT: Server authorization, then client quota display ──
    try {
      const requestedPages = s.totalSelectedPages || 1;
      if (!internalDesktop) {
        const authorization = await checkExecutionAuthorization(s.selectedTool, requestedPages);
        if (!authorization.allowed) {
          const featureType = getFeatureType(s.selectedTool);
          analytics.trackPaywallHit(s.selectedTool, authorization.reason || 'Usage limit reached.');
          s.setQuotaModalInfo({
            featureType,
            requestedPages,
            usedToday: authorization.pagesUsed,
            dailyLimit: authorization.limit,
            globalUsedToday: authorization.pagesUsed,
            globalCap: authorization.limit,
            limitReason: 'tool_limit',
            nextReset: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
          });
          s.setShowQuotaModal(true);
          return;
        }
      }

      const limitCheck = internalDesktop
        ? { allowed: true } as LimitCheckResult
        : await checkLimit(s.selectedTool, requestedPages, null); // session is fetched inside checkLimit

      let filesToProcess = files;
      let pagesToProcess = requestedPages;
      let partialProcessingNotice: string | null = null;

      if (limitCheck.partial) {
        const partialResult = await applyPageBudget(files, limitCheck.partial.allowedPages);
        filesToProcess = partialResult.files;
        pagesToProcess = partialResult.processedPages || limitCheck.partial.allowedPages;
        partialProcessingNotice = `Processed the first ${pagesToProcess} page${pagesToProcess === 1 ? '' : 's'} only. Upgrade to continue from page ${limitCheck.partial.blockedFromPage}.`;
      }

      if (!limitCheck.allowed) {
        analytics.trackPaywallHit(s.selectedTool, limitCheck.reason || 'Usage limit reached.');
// Show the quota exceed modal with matrix details
         if (limitCheck.matrix) {
           s.setQuotaModalInfo({
             featureType: limitCheck.matrix.featureType,
             requestedPages: limitCheck.matrix.requestedPages,
             usedToday: limitCheck.matrix.toolUsedToday,
             dailyLimit: limitCheck.matrix.toolLimit,
             globalUsedToday: limitCheck.matrix.globalUsedToday,
             globalCap: limitCheck.matrix.globalCap,
             limitReason: limitCheck.limitType ?? 'tool_limit',
             nextReset: limitCheck.matrix.nextReset,
           });
           s.setShowQuotaModal(true);
         } else {
          // No matrix info available — just show quota modal
          s.setShowQuotaModal(true);
        }
        return;
      }

      analytics.trackExecutionStarted(s.selectedTool, s.isPremium);
      s.setIsProcessing(true);
      let extractionSucceeded = false;
      let retainSourceForReview = false;
      try {
        s.batch.forEach(i => s.updateItemStatus(i.id, ProcessStatus.PROCESSING));

        // Optional UI feedback when client-side PDF compression repair may run
        if (s.selectedTool === 'pdf-to-excel' && filesToProcess[0]?.type === 'application/pdf') {
          try {
            const { hasCompressionIssues } = await import('./services/pdfValidator');
            if (await hasCompressionIssues(filesToProcess[0])) {
              s.addToast({ type: 'info', message: 'Repairing PDF compression...', duration: 3000 });
            }
          } catch {
            // non-blocking
          }
        }

        const result = await tool.handler({
          files: filesToProcess,
          options: { ...s.toolOptions, maxPages: pagesToProcess },
          onProgress: setProgress,
        });
        if (result.blob) {
          extractionSucceeded = true;
          analytics.trackExecutionCompleted(s.selectedTool, true);
          const extractionData = result.data && s.selectedTool === 'pdf-to-excel'
            ? result.data as { rows: Record<string, unknown>[]; metadata?: Record<string, unknown> }
            : null;
          const requiresReview = Boolean(extractionData?.metadata?.requiresReview);
          retainSourceForReview = requiresReview;

          // State must be populated before any export decision. Flagged results
          // deliberately retain their source PDF and omit the queue download blob.
          if (extractionData) {
            s.setExtractionReview(extractionData.rows, extractionData.metadata ?? {}, s.batch[0]?.id ?? null);
          }
          s.batch.forEach(i => s.updateItemStatus(i.id, ProcessStatus.COMPLETED, null, requiresReview ? null : result.blob));
          if (!requiresReview) {
            const fn = result.filename ?? `${filesToProcess[0]?.name.replace(/\.pdf$/i, '')}_Processed.pdf`;
            await downloadBlob(result.blob, fn);
          } else {
            s.addToast({ type: 'warning', message: 'Extraction needs review before it can be exported.', duration: 7000 });
          }

          // ── POST-FLIGHT: Report usage ──────────────────────────
          void reportUsage({
            toolId: s.selectedTool,
            pagesProcessed: pagesToProcess,
            fileSizeBytes: filesToProcess.reduce((sum, f) => sum + f.size, 0),
            fileName: filesToProcess[0]?.name ?? 'unknown',
            status: 'SUCCESS',
          }, null);

          if (extractionData && !internalDesktop) {
            void saveExtractionHistory({ filename: filesToProcess[0].name, toolId: 'pdf-to-excel', extractedData: { rows: extractionData.rows, metadata: extractionData.metadata ?? {} }, pageCount: pagesToProcess, confidence: Math.round(((extractionData.metadata?.confidence as number) ?? 0.9) * 100), bankCode: extractionData.metadata?.bankCode as string | undefined });
          }

          if (partialProcessingNotice) {
            s.addToast({ type: 'warning', message: partialProcessingNotice, duration: 7000 });
          }

          s.addToast({ type: 'success', message: `${tool.name} completed.` });
        }
      } catch (err: any) {
        console.error('[App] Extraction failed:', err);

        // Show user-friendly error message
        const errorMessage = err?.message || 'Extraction failed. Please try a different PDF format.';
        s.addToast({
          type: 'error',
          message: errorMessage,
          duration: 7000,
        });

        analytics.trackExecutionCompleted(s.selectedTool, false, err.message || 'Operation failed.');
        s.batch.forEach(i => s.updateItemStatus(i.id, ProcessStatus.ERROR, err.message));

        // Report error usage
        void reportUsage({
          toolId: s.selectedTool,
          pagesProcessed: s.totalSelectedPages || 1,
          fileSizeBytes: s.batch.reduce((sum, i) => sum + i.fileSize, 0),
          fileName: s.batch[0]?.fileName ?? 'unknown',
          status: 'ERROR',
          error: err.message,
        }, null);
      } finally {
        // Keep files cached on failure so the user can re-run without re-uploading
        if (extractionSucceeded && !retainSourceForReview) {
          s.batch.forEach(i => clearCachedFile(i.id));
        }
        s.setIsProcessing(false);
        // Only reset page counter on success; keep for quota display / retry on failure
        if (extractionSucceeded) {
          s.setTotalSelectedPages(0);
        }
      }
      return;
    } catch (err: any) {
      s.addToast({ type: 'error', message: err?.message || 'Failed to verify usage limits.' });
      return;
    }
  }, [s.selectedTool, s.batch, s.isProcessing, s.toolOptions, s.user, s.totalSelectedPages, internalDesktop]);

  const goBack = useCallback(() => {
    s.setSelectedTool(null);
    s.clearBatch();
    s.setTotalSelectedPages(0);
  }, []);

  const selectToolAndHideModals = useCallback((toolId: string) => {
    s.setSelectedTool(toolId as ToolID);
    s.setShowHistory(false);
    s.setTotalSelectedPages(0);
    analytics.trackToolSelected(toolId as ToolID);
  }, []);

  const ct = s.selectedTool ? getToolById(s.selectedTool) : undefined;

  // ── FOUC prevention: show loading until Clerk finishes initializing ──
  if (!isLoaded) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin" />
          <p className="text-sm font-semibold text-slate-400">Loading…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex bg-slate-50 font-sans">
      {!internalDesktop && s.showAuthModal && <AuthModal onClose={() => s.setShowAuthModal(false)} />}
      {!internalDesktop && s.showQuotaModal && s.quotaModalInfo && (
        <QuotaExceededModal
          featureType={s.quotaModalInfo.featureType}
          requestedPages={s.quotaModalInfo.requestedPages}
          usedToday={s.quotaModalInfo.usedToday}
          dailyLimit={s.quotaModalInfo.dailyLimit}
          globalUsedToday={s.quotaModalInfo.globalUsedToday}
          globalCap={s.quotaModalInfo.globalCap}
          limitReason={s.quotaModalInfo.limitReason}
          nextReset={s.quotaModalInfo.nextReset}
          onClose={() => { s.setShowQuotaModal(false); s.setQuotaModalInfo(null); }}
        />
      )}
      {s.isMobileMenuOpen && (
        <div className="fixed inset-0 z-[100] lg:hidden">
          <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={() => s.setIsMobileMenuOpen(false)} />
          <div className="absolute left-0 top-0 bottom-0 w-80 bg-white p-8 shadow-2xl">
            <button onClick={() => s.setIsMobileMenuOpen(false)} className="absolute right-6 top-8 p-2 rounded-xl bg-slate-100"><X className="w-5 h-5" /></button>
            <SidebarContent />
          </div>
        </div>
      )}
      <nav className="w-72 bg-white border-r border-slate-200 hidden lg:flex flex-col p-8 shadow-sm z-10 sticky top-0 h-screen">
        <SidebarContent />
      </nav>
      <main className="flex-1 flex flex-col min-w-0 h-screen overflow-hidden">
        <header className="h-20 lg:h-24 bg-white/80 backdrop-blur-md border-b border-slate-200 flex items-center justify-between px-6 lg:px-10 sticky top-0 z-20">
          <div className="flex items-center gap-4 lg:hidden">
            <button onClick={() => s.setIsMobileMenuOpen(true)} className="p-3 bg-slate-100 rounded-2xl"><Menu className="w-5 h-5" /></button>
            <BrandHeader />
          </div>
          <div className="flex-1 max-w-2xl relative group hidden sm:block">
            <Search className="absolute left-5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 group-focus-within:text-indigo-500" />
            <input type="text" placeholder="Search..." className="w-full bg-slate-100/50 border border-slate-200/50 rounded-2xl py-3 pl-14 pr-6 text-sm font-semibold focus:outline-none focus:ring-4 focus:ring-indigo-500/10 focus:bg-white focus:border-indigo-200" value={s.searchQuery} onChange={e => s.setSearchQuery(e.target.value)} />
          </div>
          <div className="flex items-center gap-4 lg:gap-6">
            {!internalDesktop && s.user && (
              <button onClick={() => { s.setShowHistory(true); s.setSelectedTool(null); }}
                className={`w-10 h-10 lg:w-12 lg:h-12 rounded-xl lg:rounded-2xl border flex items-center justify-center ${s.showHistory ? 'bg-indigo-600 border-indigo-600 text-white' : 'bg-indigo-50 border-indigo-100 text-indigo-500'}`}>
                <History className="w-5 h-5 lg:w-6 lg:h-6" />
              </button>
            )}
            {internalDesktop ? (
              <span className="text-xs font-bold text-slate-500">Pro [Prism Selected]</span>
            ) : s.user ? (
              <div className="flex items-center gap-4">
                <UsageBadge user={s.user} compact={true} />
                <div className="w-48">
                  <AccountPanel user={s.user} onSignOut={() => { s.setUser(null); setClerkUserId(null); }} />
                </div>
              </div>
            ) : (
              <button onClick={() => { s.setShowAuthModal(true); analytics.trackUpgradeClicked('header'); }} className="px-4 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700">Sign In</button>
            )}
          </div>
        </header>
        <div className="flex-1 overflow-y-auto p-6 lg:p-14">
          {!internalDesktop && s.showHistory && s.user ? (
            <div className="max-w-7xl mx-auto pb-20">
              <HistoryDashboard onBack={() => s.setShowHistory(false)} />
            </div>
          ) : ct ? (
            <ProcessingView
              tool={ct}
              onBack={goBack}
              onSelectFiles={handleSelectFiles}
              onDownloadBlob={downloadBlob}
              onRun={runHero}
              renderToolIcon={renderToolIcon}
              progress={progress}
            />
          ) : (
            <>
              <ToolDashboard onSelectTool={selectToolAndHideModals} />
              {internalDesktop ? <BugReportForm /> : <PublicAdNotice isPremium={s.isPremium} />}
            </>
          )}
        </div>
      </main>
      <div className="fixed bottom-6 right-6 z-[200] flex flex-col gap-3 max-w-sm">
        {s.toasts.map(t => {
          const iconMap = {
            success: <CheckCircle className="w-4 h-4 text-emerald-500 flex-shrink-0" />,
            error: <XCircle className="w-4 h-4 text-red-500 flex-shrink-0" />,
            warning: <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0" />,
            info: <Info className="w-4 h-4 text-blue-500 flex-shrink-0" />,
          };
          const styleMap = {
            success: 'bg-emerald-50 border-emerald-200',
            error: 'bg-red-50 border-red-200',
            warning: 'bg-amber-50 border-amber-200',
            info: 'bg-blue-50 border-blue-200',
          };
          return (
            <div key={t.id} className={`flex items-center gap-3 px-5 py-4 rounded-2xl shadow-2xl border animate-toast-in ${styleMap[t.type] || styleMap.info}`}>
              {iconMap[t.type] || iconMap.info}
              <div className="flex-1"><p className="text-xs font-black">{t.message}</p></div>
              <button onClick={() => s.removeToast(t.id)}><X className="w-3 h-3" /></button>
            </div>
          );
        })}
      </div>
      {s.isDragging && (
        <div className="fixed inset-0 z-50 bg-indigo-600/10 backdrop-blur-sm border-4 border-dashed border-indigo-500 m-4 rounded-[32px] flex items-center justify-center"
          onDragOver={e => e.preventDefault()} onDragLeave={() => s.setIsDragging(false)} onDrop={e => { e.preventDefault(); s.setIsDragging(false); }}>
          <UploadCloud className="w-20 h-20 text-indigo-600 animate-bounce" />
        </div>
      )}
    </div>
  );
};

const PublicAppShell: React.FC = () => {
  const { isSignedIn, user: clerkUser } = useUser();
  const { isLoaded } = useAuth();
  const clerk = useClerk();
  return <AppShell auth={{ isLoaded, isSignedIn, clerkUser, clerk }} internalDesktop={false} />;
};

const App: React.FC = () => {
  return (
    <HelmetProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Navigate to="/app" replace />} />
          <Route path="/app" element={isInternalDesktopDistribution ? <InternalActivationGate><AppShell auth={null} internalDesktop /></InternalActivationGate> : <PublicAppShell />} />
          <Route path="/tools/:toolId" element={<ToolLandingView />} />
        </Routes>
      </BrowserRouter>
    </HelmetProvider>
  );
};

export default App;
