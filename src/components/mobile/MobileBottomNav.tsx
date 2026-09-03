import React from 'react';
import { Layout, History, Camera, Wand2 } from '../ui/Icon';
import { useAppStore } from '../../store/appStore';
import { saveAndShareFile, scanDocuments } from '../../../services/nativeBridge';

export const MobileBottomNav: React.FC = () => {
  const s = useAppStore();
  const hasActiveProcessing = s.isProcessing && Boolean(s.selectedTool);

  const navigateAwayFromTool = (action: () => void) => {
    if (hasActiveProcessing) {
      s.addToast({ type: 'info', message: 'Processing is still running. Please wait for it to finish.' });
      return;
    }
    action();
  };

  const handleCameraScan = async () => {
    try {
      const scannedFiles = await scanDocuments();
      if (!scannedFiles.length) return;

      // The global Scan action is a standalone capture-and-save flow. It must
      // never populate a tool queue or select a processing workflow.
      for (const file of scannedFiles) {
        await saveAndShareFile(file, file.name, {
          dialogTitle: 'Save scanned document',
        });
      }

      s.addToast({
        type: 'success',
        message: 'Scan complete. Choose where to save or share your document.',
      });
    } catch (error) {
      console.error('Standalone document scan failed:', error);
      s.addToast({
        type: 'error',
        message: 'Could not save the scanned document. Please try again.',
      });
    }
  };

  const isHomeActive = !s.showHistory && !s.showAuthModal && !s.selectedTool;

  return (
    <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-50 bg-[#0B0F19]/95 backdrop-blur-2xl border-t border-slate-800/90 px-4 pt-2 pb-5 shadow-2xl">
      <div className="flex items-center justify-around max-w-md mx-auto">
        {/* Tab 1: Tools / Home */}
        <button
          type="button"
          onClick={() => navigateAwayFromTool(() => {
            s.setSelectedTool(null);
            s.setShowHistory(false);
          })}
          className={`flex flex-col items-center py-1 px-3 rounded-2xl transition-all duration-200 ${
            isHomeActive
              ? 'text-indigo-400 font-bold scale-105'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Layout className={`w-5 h-5 ${isHomeActive ? 'stroke-[2.5]' : 'stroke-2'}`} />
          <span className="text-[10px] mt-0.5 tracking-tight font-medium">Tools</span>
        </button>

        {/* Tab 2: AI Labs */}
        <button
          type="button"
          onClick={() => navigateAwayFromTool(() => {
            s.setActiveCategory('AI Labs');
            s.setSelectedTool(null);
            s.setShowHistory(false);
          })}
          className={`flex flex-col items-center py-1 px-3 rounded-2xl transition-all duration-200 ${
            s.activeCategory === 'AI Labs' && !s.selectedTool && !s.showHistory
              ? 'text-indigo-400 font-bold scale-105'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Wand2 className="w-5 h-5" />
          <span className="text-[10px] mt-0.5 tracking-tight font-medium">AI Labs</span>
        </button>

        {/* Center Floating Action: standalone capture-and-save scanner */}
        <button
          type="button"
          onClick={handleCameraScan}
          className="flex flex-col items-center -mt-6 group"
        >
          <div className="w-12 h-12 rounded-2xl prism-gradient flex items-center justify-center text-white shadow-lg shadow-indigo-500/40 group-active:scale-95 transition-transform border border-white/20">
            <Camera className="w-6 h-6" />
          </div>
          <span className="text-[9px] font-bold mt-1 text-indigo-400">Scan & Save</span>
        </button>

        {/* Tab 4: History / Files */}
        <button
          type="button"
          onClick={() => navigateAwayFromTool(() => {
            if (!s.user) {
              s.addToast({ type: 'info', message: 'Sign in to view your extraction history.' });
              s.setShowAuthModal(true);
              return;
            }
            s.setShowHistory(true);
            s.setSelectedTool(null);
          })}
          className={`flex flex-col items-center py-1 px-3 rounded-2xl transition-all duration-200 ${
            s.showHistory
              ? 'text-indigo-400 font-bold scale-105'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <History className={`w-5 h-5 ${s.showHistory ? 'stroke-[2.5]' : 'stroke-2'}`} />
          <span className="text-[10px] mt-0.5 tracking-tight font-medium">History</span>
        </button>

        {/* Tab 5: Account / Menu */}
        <button
          type="button"
          onClick={() => {
            s.setIsMobileMenuOpen(true);
          }}
          className="flex flex-col items-center py-1 px-3 rounded-2xl text-slate-400 hover:text-slate-200 transition-all duration-200"
        >
          <div className="w-5 h-5 rounded-full border-2 border-current flex items-center justify-center text-[10px] font-black">
            ≡
          </div>
          <span className="text-[10px] mt-0.5 tracking-tight font-medium">Menu</span>
        </button>
      </div>
    </nav>
  );
};
