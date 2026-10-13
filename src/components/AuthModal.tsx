import React, { useEffect, useState } from 'react';
import { SignIn, SignUp, useAuth } from '@clerk/react';
import { X, ShieldCheck } from 'lucide-react';
import { useAppStore } from '../store/appStore';

interface Props {
  onClose: () => void;
  initialMode?: 'sign-in' | 'sign-up';
}

export default function AuthModal({ onClose, initialMode }: Props) {
  const s = useAppStore();
  const [mode, setMode] = useState<'sign-in' | 'sign-up'>(initialMode || s.authModalMode || 'sign-in');
  const [hasError, setHasError] = useState(false);
  const { isSignedIn } = useAuth();

  // Auto-close modal once authenticated
  useEffect(() => {
    if (isSignedIn) {
      const timer = setTimeout(onClose, 300);
      return () => clearTimeout(timer);
    }
  }, [isSignedIn, onClose]);

  const clerkAppearance = {
    elements: {
      rootBox: 'w-full',
      card: 'shadow-none border border-slate-200 dark:border-slate-800 bg-surface rounded-md p-6',
      cardBox: 'w-full',
      headerTitle: 'text-xl font-bold text-slate-900 text-center pt-2',
      headerSubtitle: 'text-xs text-slate-500 text-center mt-1 mb-6',
      formButtonPrimary: 'bg-slate-900 hover:bg-slate-800 text-white dark:bg-surface dark:text-slate-950 dark:hover:bg-slate-200 font-bold rounded-md text-xs py-2.5 transition-colors duration-100',
      formFieldInput: 'rounded-md border-slate-200 dark:border-slate-700 bg-surface text-slate-900 text-xs focus:ring-1 focus:ring-slate-900 dark:focus:ring-white',
      formFieldLabel: 'font-semibold text-slate-700 text-xs',
      socialButtonsBlockButton: 'rounded-md border-slate-200 dark:border-slate-700 bg-surface dark:bg-slate-800/60 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs transition-colors',
      socialButtonsBlockButtonText: 'font-medium text-slate-700 dark:text-slate-200',
      dividerLine: 'bg-slate-200 dark:bg-slate-800',
      dividerText: 'text-slate-400 text-xs font-mono',
      footer: 'bg-transparent border-t border-slate-100 dark:border-slate-800/80 pt-3',
      footerActionText: 'text-slate-500 dark:text-slate-400 text-xs',
      footerActionLink: 'text-slate-900 dark:text-white font-bold text-xs hover:underline',
      identityPreviewText: 'text-slate-700 dark:text-slate-200',
      formResendCodeLink: 'text-slate-900 dark:text-white font-bold',
    },
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-[300] flex items-center justify-center p-4 overflow-y-auto">
      <div className="w-full max-w-md relative bg-surface border border-slate-200 dark:border-slate-800 rounded-lg shadow-xl overflow-hidden my-8 animate-in fade-in zoom-in-95 duration-150">
        {/* Modal Top Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50 ">
          <div className="flex items-center gap-2 text-xs font-bold text-slate-900 ">
            <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
            <span>Prism File Hero Account</span>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-md text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            aria-label="Close authentication modal"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tab Switcher: Sign In vs Create Account */}
        <div className="flex border-b border-slate-200 dark:border-slate-800 bg-slate-50/50 ">
          <button
            type="button"
            onClick={() => setMode('sign-in')}
            className={`flex-1 py-3 text-xs font-bold text-center border-b-2 transition-colors duration-100 ${
              mode === 'sign-in'
                ? 'border-slate-900 text-slate-900 dark:border-hairline bg-surface'
                : 'border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white'
            }`}
          >
            Sign In
          </button>
          <button
            type="button"
            onClick={() => setMode('sign-up')}
            className={`flex-1 py-3 text-xs font-bold text-center border-b-2 transition-colors duration-100 ${
              mode === 'sign-up'
                ? 'border-slate-900 text-slate-900 dark:border-hairline bg-surface'
                : 'border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white'
            }`}
          >
            Create Account
          </button>
        </div>

        {/* Auth Body */}
        <div className="p-4 sm:p-6">
          {!hasError ? (
            <div className="w-full">
              {mode === 'sign-in' ? (
                <SignIn
                  routing="hash"
                  signUpUrl="#/sign-up"
                  appearance={clerkAppearance}
                />
              ) : (
                <SignUp
                  routing="hash"
                  signInUrl="#/sign-in"
                  appearance={clerkAppearance}
                />
              )}
            </div>
          ) : (
            <div className="p-6 text-center space-y-4">
              <p className="text-sm font-semibold text-slate-900 dark:text-white">
                Authentication Service Connection
              </p>
              <p className="text-xs text-slate-500 leading-relaxed">
                Unable to load the authentication provider. If you are running in offline mode or behind a firewall, ensure connections to Clerk authentication services are permitted.
              </p>
              <button
                type="button"
                onClick={() => setHasError(false)}
                className="px-4 py-2 bg-slate-900 text-white dark:bg-surface dark:text-slate-900 text-xs font-bold rounded-md"
              >
                Retry Connection
              </button>
            </div>
          )}

          {/* Privacy Note */}
          <div className="mt-4 pt-4 border-t border-slate-100 dark:border-slate-800 text-center">
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Free accounts include 15 daily operations and bank statement parsing.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
