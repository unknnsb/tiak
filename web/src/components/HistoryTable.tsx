import React from 'react';
import { DownloadJob, getDownloadUrl } from '../lib/api';
import StatusBadge from './StatusBadge';

interface HistoryTableProps {
  jobs: DownloadJob[];
  onRetry: (id: string) => void;
  onRedownload: (id: string) => void;
  onPreview: (job: DownloadJob) => void;
  onDelete: (id: string) => void;
}

export default function HistoryTable({ jobs, onRetry, onRedownload, onPreview, onDelete }: HistoryTableProps) {
  const formatDate = (ts: number | null | undefined) => {
    if (!ts) return '—';
    return new Date(ts).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const getFileDateFolder = (ts: number) => {
      const date = new Date(ts);
      const yyyy = date.getFullYear();
      const mm = String(date.getMonth() + 1).padStart(2, '0');
      const dd = String(date.getDate()).padStart(2, '0');
      return `${yyyy}-${mm}-${dd}`;
  };

  if (jobs.length === 0) {
    return (
      <div className="text-center py-12 border border-dashed border-border-subtle rounded-xl bg-surface-subtle/30">
        <p className="text-sm text-content-muted">No history available</p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border-subtle bg-surface shadow-sm">
      <div className="overflow-x-auto">
        <table className="min-w-full text-left text-sm whitespace-nowrap">
          <thead className="bg-surface-subtle border-b border-border-subtle text-xs uppercase tracking-wider text-content-muted font-medium">
            <tr>
              <th className="px-4 py-3">Date</th>
              <th className="px-4 py-3">URL</th>
              <th className="px-4 py-3">Filename</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Preview</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-subtle bg-surface">
            {jobs.map((job) => (
              <tr key={job.id} className="hover:bg-surface-subtle/50 transition-colors">
                <td className="px-4 py-3 text-content-muted font-mono text-xs">
                  {formatDate(job.createdAt)}
                </td>
                <td className="px-4 py-3 max-w-[200px] truncate" title={job.url}>
                  <span className="text-foreground">{job.url}</span>
                </td>
                <td className="px-4 py-3 max-w-[150px] truncate text-content-muted">
                  {job.filename || '—'}
                </td>
                <td className="px-4 py-3">
                  <StatusBadge status={job.status} />
                </td>
                <td className="px-4 py-3">
                  {job.status === 'done' && job.filename && (
                    <button
                      onClick={() => onPreview(job)}
                      className="text-xs font-medium text-foreground bg-surface-subtle hover:bg-surface-strong px-2.5 py-1.5 rounded-full border border-border-subtle transition-colors flex items-center gap-1.5"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="5 3 19 12 5 21 5 3" /></svg>
                      Preview
                    </button>
                  )}
                  {job.status === 'missing' && (
                     <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-1 text-xs font-medium text-red-700 ring-1 ring-inset ring-red-600/10">
                        Missing File
                     </span>
                  )}
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex justify-end gap-2">
                    {job.status === 'failed' && (
                      <button
                        onClick={() => onRetry(job.id)}
                        className="text-xs font-medium text-blue-600 hover:text-blue-700 hover:bg-blue-50 px-2 py-1 rounded transition-colors"
                      >
                        Retry
                      </button>
                    )}
                    {job.status === 'missing' && (
                      <button
                        onClick={() => onRedownload(job.id)}
                        className="text-xs font-medium text-orange-600 hover:text-orange-700 hover:bg-orange-50 px-2 py-1 rounded transition-colors"
                      >
                        Redownload
                      </button>
                    )}
                    {job.status === 'done' && job.filename && job.completedAt && (
                      <a
                        href={getDownloadUrl(`data/${getFileDateFolder(job.completedAt)}/${job.filename}`)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs font-medium text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 px-2 py-1 rounded transition-colors"
                      >
                        Open
                      </a>
                    )}
                    <button
                      onClick={() => onDelete(job.id)}
                      className="text-xs font-medium text-gray-500 hover:text-red-600 hover:bg-red-50 px-2 py-1 rounded transition-colors"
                      title="Delete from history"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                    </button>
                  </div>
                  {job.error && (
                     <div className="text-[10px] text-red-500 mt-1 max-w-[100px] truncate ml-auto" title={job.error}>
                       {job.error}
                     </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}