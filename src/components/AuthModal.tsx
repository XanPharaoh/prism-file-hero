import React, { useEffect } from 'react';
import { SignIn, useAuth } from '@clerk/react';

interface Props {
  onClose: () => void;
}

export default function AuthModal({ onClose }: Props) {
  const { isSignedIn } = useAuth();

  // Auto-close the modal once the user has successfully signed in.
  // A short delay gives Clerk time to finalise the session before
  // the parent re-renders with the authenticated UI.
  useEffect(() => {
    if (isSignedIn) {
      const timer = setTimeout(onClose, 400);
      return () => clearTimeout(timer);
    }
  }, [isSignedIn, onClose]);

  return (
    <div className="fixed inset-0 backdrop-blur-xl bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="w-full max-w-md relative">
        <button
          onClick={onClose}
          className="absolute -top-2 -right-2 z-10 w-8 h-8 flex items-center justify-center rounded-full bg-white/80 backdrop-blur text-gray-500 hover:text-gray-800 hover:bg-white text-lg shadow-md transition-colors"
          aria-label="Close sign-in modal"
        >
          &times;
        </button>
        <SignIn
          routing="hash"
          appearance={{
            elements: {
              rootBox: 'w-full',
              card: 'shadow-2xl rounded-[32px] border border-white/40 bg-white/90 backdrop-blur-2xl',
              cardBox: 'w-full',
              headerTitle: 'text-2xl font-black text-slate-900 text-center pt-8',
              headerSubtitle: 'text-sm text-slate-500 text-center mt-1 mb-6',
              formButtonPrimary: 'prism-gradient font-black rounded-2xl text-base py-3',
              formFieldInput: 'rounded-2xl border-slate-200 focus:ring-indigo-500 focus:border-indigo-500',
              formFieldLabel: 'font-bold text-slate-700 text-sm',
              socialButtonsBlockButton: 'rounded-2xl border-slate-200 hover:bg-slate-50 transition-colors',
              socialButtonsBlockButtonText: 'font-medium text-slate-700',
              dividerLine: 'bg-slate-200',
              dividerText: 'text-slate-400 text-sm',
              footer: 'bg-slate-50/50 rounded-b-[32px]',
              footerActionText: 'text-slate-500 text-sm',
              footerActionLink: 'text-indigo-600 font-bold text-sm',
              identityPreviewText: 'text-slate-700',
              formResendCodeLink: 'text-indigo-600',
            },
          }}
        />
      </div>
    </div>
  );
}
