
import React from 'react';
import ReactDOM from 'react-dom/client';
import { ClerkProvider } from '@clerk/react';
import App from './App';
import ErrorBoundary from './src/components/ErrorBoundary';
import { isInternalDesktopDistribution } from './src/config/distribution';

const clerkKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <ErrorBoundary>
      {isInternalDesktopDistribution ? (
        <App />
      ) : clerkKey ? (
        <ClerkProvider publishableKey={clerkKey}>
          <App />
        </ClerkProvider>
      ) : (
        <div
          style={{
            minHeight: '100vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontFamily: 'system-ui, sans-serif',
            backgroundColor: '#f8fafc',
          }}
        >
          <div style={{ textAlign: 'center', maxWidth: 420, padding: 32 }}>
            <h1 style={{ fontSize: 20, fontWeight: 800, color: '#1e293b', marginBottom: 8 }}>
              Configuration Required
            </h1>
            <p style={{ fontSize: 14, color: '#64748b', lineHeight: 1.6 }}>
              The <code style={{ background: '#e2e8f0', padding: '2px 6px', borderRadius: 4 }}>VITE_CLERK_PUBLISHABLE_KEY</code> environment
              variable is not set. Please configure it and restart the dev server.
            </p>
          </div>
        </div>
      )}
    </ErrorBoundary>
  </React.StrictMode>
);
