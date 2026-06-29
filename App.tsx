import React, { useEffect, useCallback } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';
import {
  Layers, Search, X, Menu, History, UploadCloud, Icon,
} from './src/components/ui/Icon';
import { BrandHeader } from './src/components/ui/Brand';
import { ProcessStatus, type ToolID } from './types';
import { getToolById } from './src/registry/toolRegistry';
import { useAppStore } from './src/store/appStore';
import { SidebarContent } from './src/components/ToolSidebar';
import { isTauriEnvironment } from './src/providers/FileSystemProvider';
import { TauriFileSystemProvider } from './src/providers/TauriFileSystemProvider';
import { WebFileSystemProvider } from './src/providers/WebFileSystemProvider';
import HistoryDashboard from './src/components/HistoryDashboard';
import AuthModal from './src/components/AuthModal';
import AccountPanel from './src/components/AccountPanel';
import { checkExecutionAuthorization } from './services/edgeEnforcement';
import { saveExtractionHistory } from './services/historyService';
import { onAuthChange } from './services/authService';
import { getCachedFile, clearCachedFile } from './services/fileCache';
import { fetchUsageFromServer, formatUsage, type UsageData } from './services/usageTrackingService';
import { isFreeTool } from './services/usageConfig';
import UsageBadge from './src/components/UsageBadge';
import ToolDashboard from './src/components/views/ToolDashboard';
import ProcessingView from './src/components/views/ProcessingView';
import { ToolLandingView } from './src/components/views/ToolLandingView';
import { analytics } from './src/services/analyticsService';

const MAX_FILE_SIZE = 50 * 1024 * 1024;
const fsProvider = isTauriEnvironment() ? new TauriFileSystemProvider() : new WebFileSystemProvider();
const renderToolIcon = (name: string, className?: string) => {
  return <Icon name={name} className={className} size={24} />;
};

const AppShell: React.FC = () => {
  const s = useAppStore();

  useEffect(() => {
    const { data: { subscription } } = onAuthChange((u) => {
      s.setUser(u);
      if (u) {
        const plan = s.isPremium ? 'pro' : 'free';
        analytics.identifyUser(u, plan);
      } else {
        analytics.resetUser();
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
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
  }, [s.user]);

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

    s.addFiles(valid);
  }, [s.selectedTool]);

  const downloadBlob = useCallback(async (blob: Blob, name: string) => {
    await fsProvider.saveBlob(blob, name);
  }, []);

  const runHero = useCallback(async () => {
    if (!s.selectedTool || !s.batch.length || s.isProcessing) return;
    const tool = getToolById(s.selectedTool);
    if (!tool) return;

    if (!isFreeTool(s.selectedTool)) {
      if (!s.user) { s.setShowAuthModal(true); return; }
      try {
        const check = await checkExecutionAuthorization(s.selectedTool);
        if (!check.allowed) {
          analytics.trackPaywallHit(s.selectedTool, check.reason || 'Usage limit reached.');
          s.setShowUpgradeCTA(true);
          s.addToast({ type: 'warning', message: check.reason || 'Usage limit reached.' });
          return;
        }
      } catch {
        s.addToast({ type: 'error', message: 'Failed to verify usage limits.' });
        return;
      }
    } else if (tool.requiresAuth && !s.user) {
      s.setShowAuthModal(true);
      return;
    }

    analytics.trackExecutionStarted(s.selectedTool, s.isPremium);
    s.setIsProcessing(true);
    try {
      const files = s.batch.map(i => {
        const file = getCachedFile(i.id);
        if (!file) throw new Error(`File not in cache: ${i.fileName}`);
        return file;
      });
      s.batch.forEach(i => s.updateItemStatus(i.id, ProcessStatus.PROCESSING));
      const result = await tool.handler({ files, options: s.toolOptions, onProgress: () => {} });
      if (result.blob) {
        analytics.trackExecutionCompleted(s.selectedTool, true);
        s.batch.forEach(i => s.updateItemStatus(i.id, ProcessStatus.COMPLETED, null, result.blob));
        const fn = result.filename ?? `${files[0]?.name.replace(/\.pdf$/i, '')}_Processed.pdf`;
        await downloadBlob(result.blob, fn);
        if (result.data && s.selectedTool === 'pdf-to-excel') {
          const d = result.data as { rows: Record<string, unknown>[]; metadata?: Record<string, unknown> };
          s.setExtractedTransactions(d.rows, URL.createObjectURL(files[0]));
          void saveExtractionHistory({ filename: files[0].name, toolId: 'pdf-to-excel', extractedData: { rows: d.rows, metadata: d.metadata ?? {} }, pageCount: (d.metadata?.pageCount as number) ?? 0, confidence: Math.round(((d.metadata?.confidence as number) ?? 0.9) * 100), bankCode: d.metadata?.bankCode as string | undefined });
        }
        s.addToast({ type: 'success', message: `${tool.name} completed.` });
      }
    } catch (err: any) {
      analytics.trackExecutionCompleted(s.selectedTool, false, err.message || 'Operation failed.');
      s.batch.forEach(i => s.updateItemStatus(i.id, ProcessStatus.ERROR, err.message));
      s.addToast({ type: 'error', message: err.message || 'Operation failed.' });
    } finally {
      s.batch.forEach(i => clearCachedFile(i.id));
      s.setIsProcessing(false);
    }
  }, [s.selectedTool, s.batch, s.isProcessing, s.toolOptions, s.user]);

  const goBack = useCallback(() => {
    s.setSelectedTool(null);
    s.clearBatch();
  }, []);

  const selectToolAndHideModals = useCallback((toolId: string) => {
    s.setSelectedTool(toolId as ToolID);
    s.setShowUpgradeCTA(false);
    s.setShowHistory(false);
    analytics.trackToolSelected(toolId as ToolID);
  }, []);

  const ct = s.selectedTool ? getToolById(s.selectedTool) : undefined;

  return (
    <div className="min-h-screen flex bg-slate-50 font-sans">
      {s.showAuthModal && <AuthModal onClose={() => s.setShowAuthModal(false)} />}
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
            {s.user && (
              <button onClick={() => { s.setShowHistory(true); s.setSelectedTool(null); }}
                className={`w-10 h-10 lg:w-12 lg:h-12 rounded-xl lg:rounded-2xl border flex items-center justify-center ${s.showHistory ? 'bg-indigo-600 border-indigo-600 text-white' : 'bg-indigo-50 border-indigo-100 text-indigo-500'}`}>
                <History className="w-5 h-5 lg:w-6 lg:h-6" />
              </button>
            )}
            {s.user ? (
              <div className="flex items-center gap-4">
                <UsageBadge user={s.user} compact={true} />
                <div className="w-48">
                  <AccountPanel user={s.user} onSignOut={() => s.setUser(null)} />
                </div>
              </div>
            ) : (
              <button onClick={() => { s.setShowAuthModal(true); analytics.trackUpgradeClicked('header'); }} className="px-4 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700">Sign In</button>
            )}
          </div>
        </header>
        <div className="flex-1 overflow-y-auto p-6 lg:p-14">
          {s.showHistory && s.user ? (
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
            />
          ) : (
            <ToolDashboard onSelectTool={selectToolAndHideModals} />
          )}
        </div>
      </main>
      <div className="fixed bottom-6 right-6 z-[200] flex flex-col gap-3 max-w-sm">
        {s.toasts.map(t => (
          <div key={t.id} className={`flex items-center gap-3 px-5 py-4 rounded-2xl shadow-2xl border ${t.type === 'success' ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200'}`}>
            <div className="flex-1"><p className="text-xs font-black">{t.message}</p></div>
            <button onClick={() => s.removeToast(t.id)}><X className="w-3 h-3" /></button>
          </div>
        ))}
      </div>
      {s.isDragging && (
        <div className="fixed inset-0 z-50 bg-indigo-600/10 backdrop-blur-sm border-4 border-dashed border-indigo-500 m-4 rounded-[32px] flex items-center justify-center"
          onDragOver={e => e.preventDefault()} onDragLeave={() => s.setIsDragging(false)}
          onDrop={e => { e.preventDefault(); s.setIsDragging(false); }}>
          <UploadCloud className="w-20 h-20 text-indigo-600 animate-bounce" />
        </div>
      )}
    </div>
  );
};

const App: React.FC = () => {
  return (
    <HelmetProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Navigate to="/app" replace />} />
          <Route path="/app" element={<AppShell />} />
          <Route path="/tools/:toolId" element={<ToolLandingView />} />
        </Routes>
      </BrowserRouter>
    </HelmetProvider>
  );
};

export default App;