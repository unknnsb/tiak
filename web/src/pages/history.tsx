import { useState, useEffect, useMemo, useCallback } from 'react';
import Head from 'next/head';
import dynamic from 'next/dynamic';
import HistoryTable from '../components/HistoryTable';
import HistoryToolbar from '../components/HistoryToolbar';
import { getHistory, retryJob, redownloadJob, deleteJob, DownloadJob, getPreviewUrl } from '../lib/api';

const CustomVideoPlayer = dynamic(() => import('../components/CustomVideoPlayer'), { ssr: false });

type StatusFilter = 'all' | 'queued' | 'downloading' | 'done' | 'failed' | 'imported' | 'missing';

export default function HistoryPage() {
  const [jobs, setJobs] = useState<DownloadJob[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const pageSize = 50;

  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [retryFilter, setRetryFilter] = useState(false);

  const [previewJob, setPreviewJob] = useState<DownloadJob | null>(null);
  const [previewSrc, setPreviewSrc] = useState('');

  const [toast, setToast] = useState<{ msg: string, type: 'success' | 'error' } | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getHistory(page, pageSize);
      setJobs(data.items);
      setTotal(data.total);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleRetry = async (id: string) => {
    try {
      await retryJob(id);
      fetchData();
    } catch {
      showToast('Failed to retry job', 'error');
    }
  };

  const handleRedownload = async (id: string) => {
    try {
      await redownloadJob(id);
      fetchData();
    } catch {
      showToast('Failed to redownload job', 'error');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this job history?')) return;
    try {
      await deleteJob(id);
      showToast('Job deleted', 'success');
      fetchData();
    } catch {
      showToast('Failed to delete job', 'error');
    }
  };

  const showToast = (msg: string, type: 'success' | 'error') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  const handleImportSuccess = (msg: string) => {
    showToast(msg, 'success');
    fetchData(); 
  };

  const handlePreview = (job: DownloadJob) => {
    if (!job.filename) return;
    
    const ts = job.completedAt || job.createdAt;
    const date = new Date(ts);
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    const dateFolder = `${yyyy}-${mm}-${dd}`;

    setPreviewSrc(getPreviewUrl(dateFolder, job.filename));
    setPreviewJob(job);
  };

  const closePreview = () => {
    setPreviewJob(null);
    setPreviewSrc('');
  };

  const filteredJobs = useMemo(() => {
    return jobs.filter((job) => {
      const query = searchQuery.toLowerCase();
      const matchesSearch = 
        job.url.toLowerCase().includes(query) || 
        (job.filename && job.filename.toLowerCase().includes(query));

      if (!matchesSearch) return false;
      if (statusFilter !== 'all' && job.status !== statusFilter) return false;
      if (retryFilter && job.retries < 1) return false;

      return true;
    });
  }, [jobs, searchQuery, statusFilter, retryFilter]);

  const totalPages = Math.ceil(total / pageSize);

  return (
    <>
      <Head>
        <title>History - Tiak</title>
      </Head>

      <div className="space-y-6 animate-in fade-in duration-500 relative">
        {toast && (
           <div className={`fixed top-4 right-4 z-50 px-4 py-2 rounded-lg shadow-lg text-sm font-medium animate-in slide-in-from-top-2 fade-in ${toast.type === 'success' ? 'bg-emerald-500 text-white' : 'bg-red-500 text-white'}`}>
             {toast.msg}
           </div>
        )}

        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">History</h1>
            <p className="mt-1 text-sm text-content-muted">View past download jobs.</p>
          </div>
          <HistoryToolbar onImportSuccess={handleImportSuccess} onImportError={(msg) => showToast(msg, 'error')} />
        </div>

        <div className="flex flex-col gap-4 md:flex-row md:items-center">
            <div className="flex-1">
                <div className="relative">
                    <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-content-muted">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                    </div>
                    <input
                        type="text"
                        placeholder="Search URL or filename..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="block w-full rounded-lg border-border-subtle bg-surface pl-10 pr-3 py-2 text-sm text-foreground shadow-sm placeholder:text-content-subtle focus:border-foreground focus:ring-1 focus:ring-foreground transition-all"
                    />
                </div>
            </div>
            
            <div className="flex gap-2">
                <select
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
                    className="block w-full rounded-lg border-border-subtle bg-surface py-2 pl-3 pr-8 text-sm text-foreground shadow-sm focus:border-foreground focus:ring-1 focus:ring-foreground transition-all"
                >
                    <option value="all">All Status</option>
                    <option value="done">Done</option>
                    <option value="failed">Failed</option>
                    <option value="downloading">Downloading</option>
                    <option value="queued">Queued</option>
                    <option value="missing">Missing</option>
                    <option value="imported">Imported</option>
                </select>
                
                <button
                    onClick={() => setRetryFilter(!retryFilter)}
                    className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium shadow-sm transition-all ${
                        retryFilter 
                        ? 'bg-surface-strong border-border text-foreground' 
                        : 'bg-surface border-border-subtle text-content-muted hover:bg-surface-subtle hover:text-foreground'
                    }`}
                >
                    <span>Retried</span>
                    {retryFilter && <span className="h-1.5 w-1.5 rounded-full bg-foreground"></span>}
                </button>
            </div>
        </div>

        {loading ? (
             <div className="flex justify-center py-20">
                <div className="h-6 w-6 border-2 border-foreground border-t-transparent rounded-full animate-spin"></div>
            </div>
        ) : (
            <>
                <HistoryTable 
                  jobs={filteredJobs} 
                  onRetry={handleRetry} 
                  onRedownload={handleRedownload} 
                  onPreview={handlePreview}
                  onDelete={handleDelete}
                />
                
                <div className="flex items-center justify-between border-t border-border-subtle pt-4">
                    <button
                        onClick={() => setPage(p => Math.max(1, p - 1))}
                        disabled={page === 1}
                        className="text-sm font-medium text-content-muted hover:text-foreground disabled:opacity-50 transition-colors"
                    >
                        Previous
                    </button>
                    <span className="text-sm text-content-muted">
                        Page <span className="font-medium text-foreground">{page}</span> of {totalPages || 1}
                    </span>
                    <button
                        onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                        disabled={page >= totalPages}
                        className="text-sm font-medium text-content-muted hover:text-foreground disabled:opacity-50 transition-colors"
                    >
                        Next
                    </button>
                </div>
                        </>
                    )}
            
                    {previewJob && (
                      <CustomVideoPlayer 
                        src={previewSrc}
                        onClose={closePreview}
                      />
                    )}
                  </div>
                </>
              );
            }