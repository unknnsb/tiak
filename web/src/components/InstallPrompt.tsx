import { useState, useEffect } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

export default function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showPrompt, setShowPrompt] = useState(false);

  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setShowPrompt(true);
    };

    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const handleInstallClick = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setDeferredPrompt(null);
    }
    setShowPrompt(false);
  };

  if (!showPrompt) return null;

  return (
    <div className="fixed bottom-24 left-4 right-4 z-50 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="mx-auto max-w-sm bg-surface/90 backdrop-blur-md p-4 rounded-2xl shadow-2xl border border-border-subtle flex items-center justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Install App</h3>
          <p className="text-xs text-content-muted">Add to Home Screen for the best experience.</p>
        </div>
        <div className="flex gap-2">
          <button 
            onClick={() => setShowPrompt(false)}
            className="text-xs font-medium text-content-muted hover:text-foreground px-2 py-1.5 transition-colors"
          >
            Dismiss
          </button>
          <button
            onClick={handleInstallClick}
            className="text-xs font-medium bg-foreground text-background px-3 py-1.5 rounded-full hover:opacity-90 transition-opacity"
          >
            Install
          </button>
        </div>
      </div>
    </div>
  );
}