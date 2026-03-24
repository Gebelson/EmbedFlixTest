import React, {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// Suppress opaque cross-origin "Script error." from crashing the app or showing in overlays
window.onerror = function(message) {
  if (typeof message === 'string' && message.includes('Script error.')) {
    return true;
  }
};

window.addEventListener('error', (event) => {
  if (event instanceof ErrorEvent && event.message === 'Script error.') {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    console.warn('Ignored opaque "Script error."');
    // Remove Vite's error overlay if it was triggered
    setTimeout(() => {
      const errorOverlay = document.querySelector('vite-error-overlay');
      if (errorOverlay) {
        errorOverlay.remove();
      }
    }, 100);
  }
}, true);

window.addEventListener('unhandledrejection', (event) => {
  if (event.reason && typeof event.reason.message === 'string' && event.reason.message.includes('Script error.')) {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    console.warn('Ignored opaque "Script error." in promise');
  }
}, true);

class ErrorBoundary extends React.Component<{children: React.ReactNode}, {hasError: boolean, error: Error | null}> {
  state = { hasError: false, error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("Uncaught error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return <h1>Something went wrong: {this.state.error?.message}</h1>;
    }
    return this.props.children;
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
