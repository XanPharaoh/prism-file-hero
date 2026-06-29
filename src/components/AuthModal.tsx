import React, { useState } from 'react';
import { signIn, signUp } from '../../services/authService';

interface Props {
  onClose: () => void;
}

export default function AuthModal({ onClose }: Props) {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (mode === 'signin') {
        const { error: err } = await signIn(email, password);
        if (err) setError(err.message); else onClose();
      } else {
        const { error: err } = await signUp(email, password);
        if (err) setError(err.message);
        else setSuccess('Check your email to confirm your account.');
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-white rounded-2xl shadow-xl p-8 w-full max-w-md">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-2xl font-bold">
            {mode === 'signin' ? 'Sign In' : 'Create Account'}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl">&times;</button>
        </div>
        {success ? (
          <p className="text-green-600 text-center">{success}</p>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <input
              type="email" value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="Email" required
              className="w-full border rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <input
              type="password" value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="Password" required minLength={6}
              className="w-full border rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            {error && <p className="text-red-500 text-sm">{error}</p>}
            <button type="submit" disabled={loading}
              className="w-full bg-blue-600 text-white py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50">
              {loading ? 'Please wait…' : mode === 'signin' ? 'Sign In' : 'Create Account'}
            </button>
          </form>
        )}
        <p className="text-center text-sm text-gray-500 mt-4">
          {mode === 'signin' ? (
            <span>No account?{' '}
              <button onClick={() => setMode('signup')} className="text-blue-600 hover:underline">Sign up</button>
            </span>
          ) : (
            <span>Already have an account?{' '}
              <button onClick={() => setMode('signin')} className="text-blue-600 hover:underline">Sign in</button>
            </span>
          )}
        </p>
      </div>
    </div>
  );
}
