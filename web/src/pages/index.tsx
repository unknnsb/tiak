import { useState, useEffect } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { deleteJob, DownloadJob, AddJobResponse } from '../lib/api';
import { API_BASE } from '../lib/config';

export default function Queue() {
  const router = useRouter();
  const [urls, setUrls] = useState('');
  const [jobs, setJobs] = useState<DownloadJob[]>([]);
  const [loading, setLoading] = useState(false);
  const [skipped, setSkipped] = useState<{ url: string; reason: string }[]>([]);

  useEffect(() => {
    if (router.isReady && router.query.share_url) {
        const sharedUrl = router.query.share_url as string;
        setUrls(sharedUrl); 
        
        resolveUrl(sharedUrl).then(resolved => {
            if (resolved && resolved !== sharedUrl) {
                setUrls(resolved);
            }
        });
        
        router.replace('/', undefined, { shallow: true });
    }
  }, [router.isReady, router.query]);

  const resolveUrl = async (url: string): Promise<string | null> => {
    try {
        const res = await fetch(`${API_BASE}/files/resolve`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url })
        });
        if (res.ok) {
            const data = await res.json();
            return data.url;
        }
    } catch (e) {
        console.error("Resolve failed", e);
    }
    return null;
  };

  const fetchJobs = async () => {
    try {
      const res = await fetch(`${API_BASE}/queue/list`);
      if (res.ok) {
        const data = await res.json();
        setJobs(data);
      }
    } catch (error) {
      console.error('Failed to fetch jobs:', error);
    }
  };

  useEffect(() => {
    fetchJobs();
    const interval = setInterval(fetchJobs, 1000);
    return () => clearInterval(interval);
  }, []);

  const handleSubmit = async () => {
    if (!urls.trim()) return;
    setLoading(true);
    setSkipped([]);
    try {
      const res = await fetch(`${API_BASE}/queue/add`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ urls }),
      });
      
      if (res.ok) {
        const data: AddJobResponse = await res.json();
        if (data.added.length > 0) {
            setUrls('');
            fetchJobs();
        } else {
            setUrls('');
        }
        
        if (data.skipped.length > 0) {
            setSkipped(data.skipped);
        }
      } else {
         alert('Failed to add jobs');
      }
    } catch (error) {
      console.error('Failed to add jobs:', error);
      alert('Failed to add jobs');
    } finally {
      setLoading(false);
    }
  };

  const handleRetry = async (id: string) => {
    try {
      await fetch(`${API_BASE}/queue/retry/${id}`, {
        method: 'POST'
      });
      fetchJobs();
    } catch (error) {
      console.error('Failed to retry job:', error);
    }
  };

  const handleCancel = async (id: string) => {
    if (!confirm('Cancel this download?')) return;
    try {
      await deleteJob(id);
      fetchJobs();
    } catch (error) {
      console.error('Failed to cancel job:', error);
      alert('Failed to cancel job');
    }
  };

  return (
    <>
      <Head>
        <title>Queue - Tiak</title>
      </Head>

      <div className="space-y-8 animate-in fade-in duration-500">
        <header className="flex items-center justify-between">
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">Queue</h1>
            <div className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" title="Live updates active"></div>
        </header>

        <div className="space-y-4">
            <div className="group relative rounded-xl border border-border bg-surface p-1 shadow-sm focus-within:ring-2 focus-within:ring-foreground/5 transition-all">
                <textarea
                className="block w-full rounded-lg border-0 bg-transparent p-4 text-foreground placeholder:text-content-muted focus:ring-0 sm:text-sm resize-none"
                placeholder="Paste URLs here (one per line)..."
                rows={3}
                value={urls}
                onChange={(e) => setUrls(e.target.value)}
                />
                <div className="flex justify-end border-t border-border-subtle p-2 bg-surface-subtle/30 rounded-b-lg">
                    <button
                        onClick={handleSubmit}
                        disabled={loading || !urls.trim()}
                        className="inline-flex items-center justify-center rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background shadow-sm hover:bg-foreground/90 disabled:opacity-50 disabled:cursor-not-allowed transition-all active:scale-95"
                    >
                        {loading ? 'Adding...' : 'Add to Queue'}
                    </button>
                </div>
            </div>

            {skipped.length > 0 && (
                <div className="rounded-lg border border-orange-200 bg-orange-50 p-4 text-sm text-orange-800 animate-in slide-in-from-top-2">
                    <div className="font-semibold mb-2">Skipped {skipped.length} duplicate(s):</div>
                    <ul className="list-disc list-inside space-y-1 opacity-80">
                        {skipped.map((s, i) => (
                            <li key={i} className="truncate">
                                <span className="font-mono text-xs">{s.url}</span> — {s.reason}
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </div>

        <div className="space-y-4">
            <h2 className="text-sm font-medium text-content-muted uppercase tracking-wider">Active Downloads</h2>
            
            {jobs.length === 0 ? (
                <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border-subtle bg-surface-subtle/30 py-12 text-center">
                    <p className="text-sm text-content-muted">Queue is empty</p>
                </div>
            ) : (
                <div className="space-y-3">
                    {jobs.map((job) => (
                        <div key={job.id} className="relative overflow-hidden rounded-xl border border-border-subtle bg-surface p-4 shadow-sm transition-all hover:shadow-md">
                            {job.status === 'downloading' && (
                                <div 
                                    className="absolute bottom-0 left-0 top-0 bg-blue-50/50 transition-all duration-300 ease-linear"
                                    style={{ width: `${job.progress || 0}%` }}
                                ></div>
                            )}
                            
                            <div className="relative z-10 flex items-start justify-between gap-4">
                                <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-2 mb-1">
                                        <span className={`inline-flex h-2 w-2 rounded-full ${
                                            job.status === 'done' ? 'bg-emerald-500' :
                                            job.status === 'downloading' ? 'bg-blue-500' :
                                            job.status === 'failed' ? 'bg-red-500' : 'bg-zinc-300'
                                        }`} />
                                        <p className="truncate text-sm font-medium text-foreground" title={job.url}>{job.url}</p>
                                    </div>
                                    
                                    <div className="flex items-center gap-3 text-xs text-content-muted">
                                        <span className="capitalize">{job.status}</span>
                                        {job.status === 'downloading' && (
                                            <>
                                                <span>•</span>
                                                <span>{job.progress?.toFixed(1)}%</span>
                                                <span>•</span>
                                                <span>{job.eta || '--:--'}</span>
                                            </>
                                        )}
                                        {job.filename && (
                                            <>
                                                <span>•</span>
                                                <span className="truncate max-w-[200px]">{job.filename}</span>
                                            </>
                                        )}
                                        {job.error && (
                                            <span className="text-red-500 truncate max-w-[200px]">{job.error}</span>
                                        )}
                                    </div>
                                </div>

                                <div className="flex items-center gap-2">
                                  {(job.status === 'queued' || job.status === 'downloading') && (
                                    <button
                                      onClick={() => handleCancel(job.id)}
                                      className="shrink-0 rounded-md bg-surface-subtle px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 hover:text-red-700 transition-colors"
                                    >
                                      Cancel
                                    </button>
                                  )}
                                  {job.status === 'failed' && (
                                    <button
                                        onClick={() => handleRetry(job.id)}
                                        className="shrink-0 rounded-md bg-surface-subtle px-2 py-1 text-xs font-medium text-foreground hover:bg-surface-strong transition-colors"
                                    >
                                        Retry
                                    </button>
                                  )}
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
      </div>
    </>
  );
}
