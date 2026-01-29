import { useState, useEffect } from 'react';
import Head from 'next/head';
import { API_BASE } from '../lib/config';

export default function Settings() {
  const [maxConcurrent, setMaxConcurrent] = useState<number>(2);
  const [syncDestination, setSyncDestination] = useState<string>('');
  const [syncStatus, setSyncStatus] = useState<{ status: string, lastRun: string | null, logs: string[], error: string | null, unsyncedCount: number }>({ status: 'idle', lastRun: null, logs: [], error: null, unsyncedCount: 0 });
  const [playerType, setPlayerType] = useState<'native' | 'custom'>('custom');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ type: 'success' | 'error', text: string } | null>(null);

  useEffect(() => {
    fetchSettings();
    const storedPlayer = localStorage.getItem('player_preference');
    if (storedPlayer === 'native' || storedPlayer === 'custom') {
      setPlayerType(storedPlayer);
    }
  }, []);
  
  useEffect(() => {
      const fetchStatus = async () => {
          try {
              const res = await fetch(`${API_BASE}/sync/status`);
              if (res.ok) {
                  const data = await res.json();
                  setSyncStatus(data);
              }
          } catch (e) {
              console.error("Failed to fetch sync status", e);
          }
      };
      
      fetchStatus();
      const interval = setInterval(fetchStatus, 3000);
      return () => clearInterval(interval);
  }, []);

  const fetchSettings = async () => {
    try {
      console.log('Fetching settings from:', `${API_BASE}/settings`);
      const res = await fetch(`${API_BASE}/settings`);
      if (res.ok) {
        const data = await res.json();
        setMaxConcurrent(data.maxConcurrent);
        if (data.syncDestination) setSyncDestination(data.syncDestination);
      }
    } catch (error) {
      console.error('Failed to fetch settings:', error);
      setMsg({ type: 'error', text: 'Failed to load settings' });
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setMsg(null);
    try {
      localStorage.setItem('player_preference', playerType);

      const res = await fetch(`${API_BASE}/settings`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ maxConcurrent, syncDestination }),
      });
      
      if (res.ok) {
        setMsg({ type: 'success', text: 'Saved' });
        setTimeout(() => setMsg(null), 3000);
      } else {
        setMsg({ type: 'error', text: 'Failed to save' });
      }
    } catch (error) {
      console.error('Failed to save settings:', error);
      setMsg({ type: 'error', text: 'Error saving settings' });
    } finally {
      setSaving(false);
    }
  };

  const handleSync = async () => {
    setMsg(null);
    try {
      await fetch(`${API_BASE}/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ maxConcurrent, syncDestination }),
      });

      const res = await fetch(`${API_BASE}/sync/run`, {
        method: 'POST'
      });
      
      if (res.ok) {
        setMsg({ type: 'success', text: 'Sync started' });
        setTimeout(() => setMsg(null), 3000);
      } else {
         const data = await res.json();
         setMsg({ type: 'error', text: data.error || 'Sync failed to start' });
      }
    } catch {
       setMsg({ type: 'error', text: 'Network error' });
    }
  };

  return (
    <>
      <Head>
        <title>Settings - Tiak</title>
      </Head>

      <div className="max-w-xl mx-auto py-8 animate-in fade-in duration-500">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground mb-8">Settings</h1>
        
        {loading ? (
            <div className="flex justify-center py-20">
                <div className="h-6 w-6 border-2 border-foreground border-t-transparent rounded-full animate-spin"></div>
            </div>
        ) : (
          <div className="rounded-xl border border-border-subtle bg-surface p-6 shadow-sm">
            <div className="space-y-8">
              <div>
                <h2 className="text-lg font-medium text-foreground mb-4">Download Settings</h2>
                <label htmlFor="maxConcurrent" className="block text-sm font-medium text-foreground mb-4">
                  Max Concurrent Downloads
                </label>
                <div className="flex items-center gap-6">
                  <div className="flex-1 relative">
                    <input
                        type="range"
                        id="maxConcurrentRange"
                        min="1"
                        max="10"
                        value={maxConcurrent}
                        onChange={(e) => setMaxConcurrent(parseInt(e.target.value))}
                        className="w-full h-2 bg-surface-strong rounded-lg appearance-none cursor-pointer accent-foreground"
                    />
                  </div>
                  <div className="w-12 text-right">
                    <span className="text-xl font-mono font-medium text-foreground">{maxConcurrent}</span>
                  </div>
                </div>
                <p className="mt-3 text-xs text-content-muted">
                  Limit the number of simultaneous downloads (1-10) to manage bandwidth.
                </p>
              </div>
              
              <div className="pt-6 border-t border-border-subtle">
                <div className="flex items-center justify-between mb-4">
                    <h2 className="text-lg font-medium text-foreground">Cloud Sync</h2>
                    <div className={`px-2 py-1 rounded-full text-xs font-medium border ${
                        syncStatus.status === 'running' ? 'bg-blue-50 text-blue-700 border-blue-200 animate-pulse' :
                        syncStatus.status === 'error' ? 'bg-red-50 text-red-700 border-red-200' :
                        'bg-zinc-50 text-zinc-600 border-zinc-200'
                    }`}>
                        {syncStatus.status === 'running' ? 'Syncing...' : syncStatus.status === 'idle' ? 'Idle' : 'Error'}
                    </div>
                </div>
                
                <div className="space-y-4">
                    {syncStatus.unsyncedCount > 0 && (
                        <div className="rounded-lg border border-orange-200 bg-orange-50 p-4 text-sm text-orange-800 flex items-center justify-between animate-in slide-in-from-top-2">
                             <span>
                                 <strong>{syncStatus.unsyncedCount} new file(s)</strong> waiting to sync.
                             </span>
                        </div>
                    )}
                    
                    <div>
                        <label htmlFor="syncDest" className="block text-sm font-medium text-foreground mb-2">
                            Destination (Rclone remote path)
                        </label>
                        <input
                            type="text"
                            id="syncDest"
                            value={syncDestination}
                            onChange={(e) => setSyncDestination(e.target.value)}
                            placeholder="e.g. onedrive:backup/videos"
                            className="block w-full rounded-lg border border-border-subtle bg-transparent p-2 text-foreground placeholder:text-content-muted focus:ring-1 focus:ring-foreground focus:border-foreground sm:text-sm"
                        />
                         <p className="mt-2 text-xs text-content-muted">
                            Syncs downloaded files to a configured cloud storage using rclone.
                            Uses &apos;copy --ignore-existing&apos; to only upload new files.
                        </p>
                    </div>

                    <div className="rounded-lg bg-surface-subtle p-3 text-xs space-y-2">
                        <div className="flex justify-between text-content-muted">
                            <span>Last Run:</span>
                            <span className="font-mono">{syncStatus.lastRun ? new Date(syncStatus.lastRun).toLocaleString() : 'Never'}</span>
                        </div>
                        {syncStatus.error && (
                            <div className="text-red-600 font-medium">Error: {syncStatus.error}</div>
                        )}
                        {syncStatus.logs.length > 0 && (
                            <details className="group">
                                <summary className="cursor-pointer text-foreground hover:underline select-none">
                                    Show Logs ({syncStatus.logs.length})
                                </summary>
                                <div className="mt-2 max-h-32 overflow-y-auto rounded bg-zinc-950 p-2 text-zinc-300 font-mono whitespace-pre-wrap leading-tight">
                                    {syncStatus.logs.slice().reverse().map((log, i) => (
                                        <div key={i}>{log}</div>
                                    ))}
                                </div>
                            </details>
                        )}
                    </div>

                    <div className="flex justify-end">
                        <button
                            onClick={handleSync}
                            disabled={syncStatus.status === 'running' || saving}
                            className="inline-flex items-center justify-center rounded-lg bg-surface-strong border border-border-subtle px-4 py-2 text-sm font-medium text-foreground hover:bg-surface-subtle disabled:opacity-50 transition-all"
                        >
                            {syncStatus.status === 'running' ? 'Syncing...' : 'Sync Now'}
                        </button>
                    </div>
                </div>
              </div>

              <div className="pt-6 border-t border-border-subtle">
                <h2 className="text-lg font-medium text-foreground mb-4">Player Preferences</h2>
                <div className="grid grid-cols-2 gap-4">
                  <button
                    onClick={() => setPlayerType('custom')}
                    className={`p-4 rounded-lg border text-left transition-all ${
                      playerType === 'custom' 
                        ? 'border-foreground bg-surface-strong ring-1 ring-foreground' 
                        : 'border-border-subtle hover:bg-surface-subtle'
                    }`}
                  >
                    <div className="font-medium text-foreground">Custom Player</div>
                    <div className="text-xs text-content-muted mt-1">Enhanced controls, keyboard shortcuts, modern UI.</div>
                  </button>
                  <button
                    onClick={() => setPlayerType('native')}
                    className={`p-4 rounded-lg border text-left transition-all ${
                      playerType === 'native' 
                        ? 'border-foreground bg-surface-strong ring-1 ring-foreground' 
                        : 'border-border-subtle hover:bg-surface-subtle'
                    }`}
                  >
                    <div className="font-medium text-foreground">Native Player</div>
                    <div className="text-xs text-content-muted mt-1">Standard browser player. Better for compatibility on some devices.</div>
                  </button>
                </div>
              </div>

              <div className="pt-6 border-t border-border-subtle flex items-center justify-between">
                <div className="h-6">
                    {msg && (
                    <span className={`text-sm font-medium ${msg.type === 'success' ? 'text-emerald-600' : 'text-red-600'} animate-in fade-in slide-in-from-left-2`}>
                        {msg.text}
                    </span>
                    )}
                </div>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="inline-flex items-center justify-center rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background shadow-sm hover:bg-foreground/90 disabled:opacity-50 disabled:cursor-not-allowed transition-all active:scale-95"
                >
                  {saving ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}