import React, { useEffect, useCallback, useState } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';
import { useAuth, useUser, useClerk } from '@clerk/react';
import {
  Layers, Search, X, Menu, History, UploadCloud, Icon,
  CheckCircle, XCircle, AlertTriangle, Info,
} from './src/components/ui/Icon';
import { Sun, Moon } from 'lucide-react';
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
import CheckoutStatus from './src/components/CheckoutStatus';
import AccountPanel from './src/components/AccountPanel';
import QuotaExceededModal from './src/components/QuotaExceededModal';
import UpgradeModal from './src/components/UpgradeModal';
import { checkExecutionAuthorization } from './services/edgeEnforcement';
import { saveExtractionHistory } from './services/historyService';
import { setClerkInstance, setClerkUserId } from './services/authService';
import { getCachedFile, clearCachedFile } from './services/fileCache';
import { checkLimit, reportUsage, getUsageSummary, getToolButtonLabel, type UsageSummary, type LimitCheckResult } from './services/usageTrackingService';
import { isFreeTool, getFeatureType } from './services/usageConfig';
import UsageBadge from './src/components/UsageBadge';
import ToolDashboard from './src/components/views/ToolDashboard';
import HeaderMegaMenu from './src/components/navigation/HeaderMegaMenu';
import ProcessingView from './src/components/views/ProcessingView';
import { ToolLandingView } from './src/components/views/ToolLandingView';
import { analytics } from './src/services/analyticsService';
import { isInternalDesktopDistribution } from './src/config/distribution';
import BugReportForm from './src/components/BugReportForm';
import PublicAdNotice from './src/components/PublicAdNotice';
import InternalActivationGate from './src/components/InternalActivationGate';
import { initializeMobilePlatform, registerHardwareBackButton } from './services/nativeBridge';
import { MobileBottomNav } from './src/components/mobile/MobileBottomNav';

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
  const isLoaded = internalDesktop || auth === null || Boolean(auth?.isLoaded);
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

  // Mobile platform initialization & hardware back button handling
  useEffect(() => {
    void initializeMobilePlatform();

    const cleanup = registerHardwareBackButton(() => {
      if (s.showAuthModal) {
        s.setShowAuthModal(false);
        return true;
      }
      if (s.showHistory) {
        s.setShowHistory(false);
        return true;
      }
      if (s.isMobileMenuOpen) {
        s.setIsMobileMenuOpen(false);
        return true;
      }
      if (s.showQuotaModal) {
        s.setShowQuotaModal(false);
        s.setQuotaModalInfo(null);
        return true;
      }
      if (s.showUpgradeCTA) {
        s.setShowUpgradeCTA(false);
        return true;
      }
      if (s.selectedTool) {
        if (s.isProcessing) {
          s.addToast({ type: 'info', message: 'Processing is still running. Please wait for it to finish.' });
          return true;
        }
        s.setSelectedTool(null);
        s.clearBatch();
        s.setTotalSelectedPages(0);
        return true;
      }
      return false;
    });

    return cleanup;
  }, [s.showAuthModal, s.showHistory, s.isMobileMenuOpen, s.showQuotaModal, s.showUpgradeCTA, s.selectedTool, s.isProcessing]);

  const [progress, setProgress] = useState(0);

  const addFilesForSelectedTool = useCallback(async (files: File[]) => {
    if (!s.selectedTool) return;
    const tool = getToolById(s.selectedTool);
    if (!tool) return;
    if (!files.length) return;

    const allowed = files.filter((file) => tool.allowedFileTypes.includes(file.type));
    if (allowed.length !== files.length) {
      s.addToast({ type: 'warning', message: `Some files are not supported by ${tool.name}.` });
    }
    const sized = allowed.filter((file) => file.size <= MAX_FILE_SIZE);
    if (sized.length !== allowed.length) s.addToast({ type: 'warning', message: 'Some files exceed the 50MB limit.' });

    const remainingSlots = tool.maxFiles > 0 ? Math.max(0, tool.maxFiles - s.batch.length) : Infinity;
    const valid = sized.slice(0, remainingSlots);
    if (valid.length !== sized.length) {
      s.addToast({ type: 'warning', message: `${tool.name} accepts a maximum of ${tool.maxFiles} file${tool.maxFiles === 1 ? '' : 's'}.` });
    }
    if (!valid.length) return;

    const totalSize = valid.reduce((sum, f) => sum + f.size, 0);
    analytics.trackFilesAdded(s.selectedTool, valid.length, totalSize);

    // Count total pages for quota enforcement
    const totalPages = await countTotalPages(valid);
    s.setTotalSelectedPages(s.totalSelectedPages + totalPages);

    s.addFiles(valid);
  }, [s.selectedTool, s.batch.length, s.totalSelectedPages]);

  const handleSelectFiles = useCallback(async () => {
    if (!s.selectedTool) return;
    const tool = getToolById(s.selectedTool);
    if (!tool) return;
    const files = await fsProvider.pickFiles(s.selectedTool, tool.allowedFileTypes, tool.maxFiles);
    await addFilesForSelectedTool(files);
  }, [s.selectedTool, addFilesForSelectedTool]);

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
      s.addToast({
        type: 'info',
        message: 'Please sign in to use AI-powered document tools (includes free daily pages).',
      });
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

  const searchInputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        searchInputRef.current?.focus();
      } else if (e.key === '/' && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
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
    <div className="min-h-screen flex bg-slate-50 dark:bg-[#0B0F19] text-slate-900 dark:text-slate-100 font-sans transition-colors duration-150">
      {!internalDesktop && <CheckoutStatus />}
      {!internalDesktop && s.showAuthModal && <AuthModal onClose={() => s.setShowAuthModal(false)} />}
      {!internalDesktop && s.showUpgradeCTA && <UpgradeModal onClose={() => s.setShowUpgradeCTA(false)} />}
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
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => s.setIsMobileMenuOpen(false)} />
          <div className="absolute left-0 top-0 bottom-0 w-80 bg-white dark:bg-[#0B0F19] p-6 shadow-2xl border-r border-slate-200 dark:border-slate-800 overflow-y-auto">
            <button onClick={() => s.setIsMobileMenuOpen(false)} aria-label="Close navigation menu" className="absolute right-5 top-7 p-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-300 border border-slate-200 dark:border-slate-700"><X className="w-5 h-5" /></button>
            <SidebarContent />
          </div>
        </div>
      )}

      {/* ── STITCH FULL-WIDTH TOP-NAVBAR SAAS ARCHITECTURE ── */}
      <div className="flex-1 flex flex-col min-w-0 min-h-screen bg-slate-50/50 dark:bg-[#0B0F19]">
        {/* Skip to main content accessibility link */}
        <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[250] focus:px-4 focus:py-2 focus:bg-indigo-600 focus:text-white focus:rounded-lg focus:shadow-lg focus:text-xs focus:font-bold focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500">
          Skip to main content
        </a>

        <header className="sticky top-0 z-40 w-full bg-white/80 dark:bg-[#0B0F19]/80 backdrop-blur-2xl border-b border-slate-200/60 dark:border-white/10 shadow-2xs">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
            {/* Left: Brand Logo */}
            <div className="flex items-center gap-3">
              <button
                onClick={() => s.setIsMobileMenuOpen(true)}
                aria-label="Open navigation menu"
                className="p-2 lg:hidden bg-slate-100 dark:bg-slate-800 rounded-lg text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700"
              >
                <Menu className="w-5 h-5" />
              </button>
              <button
                type="button"
                onClick={() => { s.setSelectedTool(null); s.setShowHistory(false); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                className="flex items-center gap-2 text-left focus:outline-none"
              >
                <BrandHeader />
              </button>
            </div>

            {/* Center: Top Navigation Mega Menu (hidden on mobile, visible md+) */}
            <div className="hidden md:flex items-center">
              <HeaderMegaMenu
                onSelectTool={(toolId) => {
                  s.setSelectedTool(toolId as ToolID);
                  s.setShowHistory(false);
                }}
                onNavigatePricing={() => {
                  if (ct || s.showHistory) {
                    s.setSelectedTool(null);
                    s.setShowHistory(false);
                    setTimeout(() => {
                      document.getElementById('pricing')?.scrollIntoView({ behavior: 'smooth' });
                    }, 50);
                  } else {
                    document.getElementById('pricing')?.scrollIntoView({ behavior: 'smooth' });
                  }
                }}
                onNavigateBankStatement={() => {
                  s.setSelectedTool('pdf-to-excel');
                  s.setShowHistory(false);
                }}
              />
            </div>

            {/* Right: Actions & User */}
            <div className="flex items-center gap-3">
              {/* Theme Toggle Button */}
              <button
                onClick={s.toggleDarkMode}
                aria-label={s.isDarkMode ? "Switch to Light Mode" : "Switch to Dark Mode"}
                title={s.isDarkMode ? "Switch to Light Mode" : "Switch to Dark Mode"}
                className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 transition-colors"
              >
                {s.isDarkMode ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4 text-slate-700" />}
              </button>

              {!internalDesktop && s.user && (
                <button
                  onClick={() => { s.setShowHistory(true); s.setSelectedTool(null); }}
                  aria-label="View processing history"
                  title="History"
                  className={`p-2 rounded-xl border flex items-center justify-center transition-colors ${
                    s.showHistory
                      ? 'bg-indigo-600 border-indigo-600 text-white'
                      : 'bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
                  }`}
                >
                  <History className="w-4 h-4" />
                </button>
              )}

              {internalDesktop ? (
                <span className="text-xs font-bold text-slate-500 dark:text-slate-400">Pro</span>
              ) : s.user ? (
                <div className="flex items-center gap-3">
                  {!s.isPremium && (
                    <button
                      onClick={() => s.setShowUpgradeCTA(true)}
                      className="hidden sm:inline-block px-3 py-1.5 text-xs font-bold rounded-lg border border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                    >
                      Upgrade
                    </button>
                  )}
                  <UsageBadge user={s.user} compact={true} />
                  <div className="w-40">
                    <AccountPanel user={s.user} onSignOut={() => { s.setUser(null); setClerkUserId(null); }} />
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => { s.setAuthModal(true, 'sign-in'); analytics.trackUpgradeClicked('header'); }}
                    className="px-3.5 py-1.5 text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white text-xs font-semibold rounded-lg transition-colors"
                  >
                    Log In
                  </button>
                  <button
                    onClick={() => { s.setAuthModal(true, 'sign-up'); analytics.trackUpgradeClicked('header'); }}
                    className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-xl shadow-xs active:scale-[0.99] transition-all"
                  >
                    Sign Up Free
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        {/* Main Content Area */}
        <main id="main-content" className="flex-1 w-full">
          {!internalDesktop && s.showHistory && s.user ? (
            <div className="max-w-7xl mx-auto py-8 px-4 sm:px-6">
              <HistoryDashboard onBack={() => s.setShowHistory(false)} />
            </div>
          ) : ct ? (
            <div className="max-w-5xl mx-auto py-8 px-4 sm:px-6">
              <ProcessingView
                tool={ct}
                onBack={goBack}
                onSelectFiles={handleSelectFiles}
                onFilesSelected={addFilesForSelectedTool}
                onDownloadBlob={downloadBlob}
                onRun={runHero}
                renderToolIcon={renderToolIcon}
                progress={progress}
              />
            </div>
          ) : (
            <div className="w-full">
              <ToolDashboard
                onSelectTool={selectToolAndHideModals}
                onSelectFilesAndTool={async (toolId: string, files: File[]) => {
                  s.setSelectedTool(toolId as ToolID);
                  s.setShowHistory(false);
                  s.setShowAuthModal(false);
                  s.setIsMobileMenuOpen(false);
                  await addFilesForSelectedTool(files);
                }}
              />
              {internalDesktop ? <BugReportForm /> : null}
            </div>
          )}
        </main>
        <MobileBottomNav />
      </div>
      <div role="region" aria-live="polite" aria-label="Notifications" className="fixed bottom-6 right-6 z-[200] flex flex-col gap-3 max-w-sm">
        {s.toasts.map(t => {
          const iconMap = {
            success: <CheckCircle className="w-4 h-4 text-emerald-500 flex-shrink-0" />,
            error: <XCircle className="w-4 h-4 text-red-500 flex-shrink-0" />,
            warning: <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0" />,
            info: <Info className="w-4 h-4 text-blue-500 flex-shrink-0" />,
          };
          const styleMap = {
            success: 'bg-emerald-50 border-emerald-200 text-emerald-950',
            error: 'bg-red-50 border-red-200 text-red-950',
            warning: 'bg-amber-50 border-amber-200 text-amber-950',
            info: 'bg-blue-50 border-blue-200 text-blue-950',
          };
          return (
            <div key={t.id} className={`flex items-center gap-3 px-4 py-3 rounded-md shadow-lg border animate-toast-in ${styleMap[t.type] || styleMap.info}`}>
              {iconMap[t.type] || iconMap.info}
              <div className="flex-1"><p className="text-xs font-semibold">{t.message}</p></div>
              <button onClick={() => s.removeToast(t.id)} aria-label="Dismiss notification"><X className="w-3.5 h-3.5" /></button>
            </div>
          );
        })}
      </div>
      {s.isDragging && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 dark:bg-black/70 border-2 border-dashed border-slate-700 dark:border-slate-300 m-4 rounded-lg flex flex-col items-center justify-center space-y-3"
          onDragOver={e => e.preventDefault()} onDragLeave={() => s.setIsDragging(false)} onDrop={e => { e.preventDefault(); s.setIsDragging(false); }}>
          <UploadCloud className="w-12 h-12 text-white" />
          <p className="text-sm font-bold text-white tracking-wide">Drop files to process locally</p>
        </div>
      )}
    </div>
  );
};

const PublicAppShell: React.FC = () => {
  const [timedOut, setTimedOut] = React.useState(false);

  React.useEffect(() => {
    const timer = setTimeout(() => {
      setTimedOut(true);
    }, 400);
    return () => clearTimeout(timer);
  }, []);

  let isSignedIn = false;
  let clerkUser = null;
  let clerk: any = null;
  let clerkLoaded = false;

  try {
    const userHook = useUser();
    const authHook = useAuth();
    clerk = useClerk();
    isSignedIn = Boolean(userHook?.isSignedIn);
    clerkUser = userHook?.user ?? null;
    clerkLoaded = Boolean(authHook?.isLoaded);
  } catch {
    clerkLoaded = true;
  }

  const isLoaded = clerkLoaded || timedOut;

  return <AppShell auth={{ isLoaded, isSignedIn, clerkUser, clerk }} internalDesktop={false} />;
};

/**
 * The release artifact serves this bundle under /app (the static marketing site owns /), so the
 * router must be rooted at the build's BASE_URL. Dev builds keep base '/' and the /app alias route
 * below, which is what the local journey and checkout scripts navigate to.
 */
const ROUTER_BASENAME = (() => {
  const b = import.meta.env.BASE_URL || '/';
  return b.replace(/\/+$/, '') || '/';
})();

const App: React.FC = () => {
  const shell = isInternalDesktopDistribution
    ? <InternalActivationGate><AppShell auth={null} internalDesktop /></InternalActivationGate>
    : <PublicAppShell />;
  return (
    <HelmetProvider>
      <BrowserRouter basename={ROUTER_BASENAME}>
        <Routes>
          <Route path="/" element={shell} />
          <Route path="/app" element={shell} />
          <Route path="/merge-pdf" element={<ToolLandingView defaultTool="merge" />} />
          <Route path="/split-pdf" element={<ToolLandingView defaultTool="split" />} />
          <Route path="/compress-pdf" element={<ToolLandingView defaultTool="compress" />} />
          <Route path="/pdf-to-word" element={<ToolLandingView defaultTool="pdf-to-word" />} />
          <Route path="/pdf-to-excel" element={<ToolLandingView defaultTool="pdf-to-excel" />} />
          <Route path="/bank-statement-to-excel" element={<ToolLandingView defaultTool="pdf-to-excel" isBankStatement />} />
          <Route path="/jpg-to-pdf" element={<ToolLandingView defaultTool="jpg-to-pdf" />} />
          <Route path="/pdf-to-jpg" element={<ToolLandingView defaultTool="pdf-to-jpg" />} />
          <Route path="/redact-pdf" element={<ToolLandingView defaultTool="redact" />} />
          <Route path="/ocr-pdf" element={<ToolLandingView defaultTool="ocr" />} />
          <Route path="/tools/:toolId" element={<ToolLandingView />} />
        </Routes>
      </BrowserRouter>
    </HelmetProvider>
  );
};

export default App;
