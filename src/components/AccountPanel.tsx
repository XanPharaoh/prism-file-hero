import React from 'react';
import { useClerk } from '@clerk/react';
import type { AppUser } from '../store/appStore';

interface Props {
  user: AppUser;
  onSignOut: () => void;
}

function getInitials(name: string, email: string): string {
  if (name && name.length >= 2) return name.slice(0, 2).toUpperCase();
  const fromEmail = email.split('@')[0];
  if (fromEmail.length >= 2) return fromEmail.slice(0, 2).toUpperCase();
  return fromEmail.toUpperCase();
}

export default function AccountPanel({ user, onSignOut }: Props) {
  const clerk = useClerk();
  const initials = getInitials(user.name, user.email);

  return (
    <div className="glass-panel rounded-2xl p-4 text-sm">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-full prism-gradient flex items-center justify-center text-xs font-bold text-white shrink-0">
          {initials}
        </div>
        <div className="min-w-0">
          <p className="text-slate-900 font-bold truncate">
            {user.name || user.email}
          </p>
          {user.name && (
            <p className="text-slate-400 text-xs truncate">{user.email}</p>
          )}
        </div>
      </div>
      <button 
        onClick={async () => { await clerk.signOut(); onSignOut(); }} 
        className="mt-3 text-red-500 hover:underline text-xs font-bold"
      >
        Sign Out
      </button>
    </div>
  );
}
