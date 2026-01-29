import React, { useRef, useState } from 'react';
import { getExportUrl, importHistory } from '../lib/api';

interface HistoryToolbarProps {
  onImportSuccess: (msg: string) => void;
  onImportError: (msg: string) => void;
}

export default function HistoryToolbar({ onImportSuccess, onImportError }: HistoryToolbarProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);

  const handleExport = () => {
    window.location.href = getExportUrl();
  };

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImporting(true);
    try {
      const result = await importHistory(file);
      onImportSuccess(`Imported: ${result.imported}, Skipped: ${result.skipped}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Import failed';
      onImportError(message);
    } finally {
      setImporting(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  return (
    <div className="flex gap-3">
      <input
        type="file"
        accept=".json"
        ref={fileInputRef}
        onChange={handleFileChange}
        className="hidden"
      />
      
      <button
        onClick={handleExport}
        className="inline-flex items-center justify-center gap-2 rounded-lg bg-surface border border-border-subtle px-3 py-2 text-sm font-medium text-foreground shadow-sm hover:bg-surface-subtle transition-all active:scale-95"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        <span>Export History</span>
      </button>

      <button
        onClick={handleImportClick}
        disabled={importing}
        className="inline-flex items-center justify-center gap-2 rounded-lg bg-surface border border-border-subtle px-3 py-2 text-sm font-medium text-foreground shadow-sm hover:bg-surface-subtle transition-all active:scale-95 disabled:opacity-50 disabled:pointer-events-none"
      >
        {importing ? (
             <div className="h-4 w-4 border-2 border-foreground border-t-transparent rounded-full animate-spin"></div>
        ) : (
             <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
        )}
        <span>{importing ? 'Importing...' : 'Import History'}</span>
      </button>
    </div>
  );
}