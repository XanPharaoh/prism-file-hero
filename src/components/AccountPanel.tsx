import React from 'react';
import { signOut } from '../../services/authService';
import type { User } from '@supabase/supabase-js';

interface Props {
  user: User;
  onSignOut: () => void;
}

// Removed internal fetch. Usage is now handled globally by UsageBadge.
export default function AccountPanel({ user, onSignOut }: Props) {
  return (
    <div className="bg-white border rounded-xl p-4 shadow-sm text-sm">
      <p className="text-gray-500 truncate font-semibold">
        {(user.user_metadata as any)?.full_name || (user.user_metadata as any)?.name || user.email}
      </p>
      <button 
        onClick={async () => { await signOut(); onSignOut(); }} 
        className="mt-3 text-red-500 hover:underline text-xs font-bold"
      >
        Sign Out
      </button>
    </div>
  );
}