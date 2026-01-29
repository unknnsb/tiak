import React from 'react';

interface StatusBadgeProps {
  status: 'queued' | 'downloading' | 'done' | 'completed' | 'failed' | 'missing' | 'imported';
}

export default function StatusBadge({ status }: StatusBadgeProps) {
  const styles = {
    queued: 'bg-zinc-100 text-zinc-600 ring-zinc-200',
    downloading: 'bg-blue-50 text-blue-700 ring-blue-200',
    done: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
    completed: 'bg-emerald-50 text-emerald-700 ring-emerald-200', 
    failed: 'bg-red-50 text-red-700 ring-red-200',
    missing: 'bg-orange-50 text-orange-700 ring-orange-200',
    imported: 'bg-indigo-50 text-indigo-700 ring-indigo-200',
  };

  const labels = {
    queued: 'Queued',
    downloading: 'Downloading',
    done: 'Completed',
    completed: 'Completed',
    failed: 'Failed',
    missing: 'Missing',
    imported: 'Imported',
  };

  const styleClass = styles[status] || styles.queued;
  const label = labels[status] || status;

  return (
    <span className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-medium ring-1 ring-inset ${styleClass}`}>
      {label}
    </span>
  );
}