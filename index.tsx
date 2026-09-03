
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
      {isInternalDesktopDistribution || !clerkKey ? (
        <App />
      ) : (
        <ClerkProvider publishableKey={clerkKey}>
          <App />
        </ClerkProvider>
      )}
    </ErrorBoundary>
  </React.StrictMode>
);
