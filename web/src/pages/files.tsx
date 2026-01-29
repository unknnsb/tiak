import React, { useState, useEffect, useMemo } from 'react';
import Head from 'next/head';
import dynamic from 'next/dynamic';
import { getSystemUsage, DiskUsage, getPreviewUrl, getDownloadUrl } from '../lib/api';
import { API_BASE } from '../lib/config';
import LazyThumbnail from '../components/LazyThumbnail';

const CustomVideoPlayer = dynamic(() => import('../components/CustomVideoPlayer'), { ssr: false });


interface FileItem {
  path: string;
  name: string;
  size: number;
  createdAt: number;
  dateFolder: string;
}

interface FileResponse {
  byDate: Record<string, FileItem[]>;
  lastScan: number;
}

type SortOption = 'name' | 'size' | 'time';
type SortDirection = 'asc' | 'desc';

function formatBytes(bytes: number, decimals = 2) {
  if (!+bytes) return '0 B';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

function formatDateHeader(dateStr: string) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' });
}

let cachedResponse: { allFiles: FileItem[], usage: DiskUsage | null, timestamp: number } | null = null;

export default function Files() {
  const [allFiles, setAllFiles] = useState<FileItem[]>(cachedResponse?.allFiles || []);
  const [loading, setLoading] = useState(!cachedResponse);
  const [usage, setUsage] = useState<DiskUsage | null>(cachedResponse?.usage || null);

  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [sortBy, setSortBy] = useState<SortOption>('time'); 
  const [sortDir, setSortDir] = useState<SortDirection>('desc'); 
  const [searchQuery, setSearchQuery] = useState('');
  
  const [previewFile, setPreviewFile] = useState<FileItem | null>(null);
  const [previewSrc, setPreviewSrc] = useState('');
  const [playerType, setPlayerType] = useState<'native' | 'custom'>('custom');

  const fetchFiles = async (force: boolean = false) => {
    const now = Date.now();
    if (!force && cachedResponse && (now - cachedResponse.timestamp) < 30000) {
      setAllFiles(cachedResponse.allFiles);
      setUsage(cachedResponse.usage);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      const [filesRes, usageData] = await Promise.all([
        fetch(`${API_BASE}/files`),
        getSystemUsage().catch(err => { console.error(err); return null; })
      ]);

      if (filesRes.ok) {
        const data: FileResponse = await filesRes.json();
        const flat = Object.values(data.byDate).flat();
        
        const unique = Array.from(new Map(flat.map(item => [item.path, item])).values());
        
        setAllFiles(unique);
        setUsage(usageData);
        
        cachedResponse = {
          allFiles: unique,
          usage: usageData,
          timestamp: now
        };
      }
    } catch (error) {
      console.error('Failed to fetch files:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchFiles();
    const storedPlayer = localStorage.getItem('player_preference');
    if (storedPlayer === 'native' || storedPlayer === 'custom') {
      setPlayerType(storedPlayer);
    }
  }, []);

  const toggleSelect = (path: string, e: React.ChangeEvent<HTMLInputElement>) => {
    e.stopPropagation();
    const next = new Set(selectedPaths);
    if (e.target.checked) {
      next.add(path);
    } else {
      next.delete(path);
    }
    setSelectedPaths(next);
  };

  const handleDownload = (path: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const link = document.createElement('a');
    link.href = getDownloadUrl(path);
    link.download = path.split('/').pop() || 'file';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleBulkZip = async () => {
    if (selectedPaths.size === 0) return;
    try {
      const res = await fetch(`${API_BASE}/files/zip`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ paths: Array.from(selectedPaths) })
      });
      
      if (res.ok) {
        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `archive-${Date.now()}.zip`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        a.remove();
        setSelectedPaths(new Set());
      }
    } catch (err) {
      console.error('Zip failed', err);
    }
  };

  const handleDelete = async (paths: string[]) => {
    if (!confirm(`Delete ${paths.length} files?`)) return;
    
    try {
      const res = await fetch(`${API_BASE}/files`, {
        method: 'DELETE',
        headers: { 
           'Content-Type': 'application/json'
        },
        body: JSON.stringify({ paths })
      });
      
      if (res.ok) {
        const deletedSet = new Set(paths);
        setAllFiles(prev => prev.filter(f => !deletedSet.has(f.path)));
        setSelectedPaths(prev => {
          const next = new Set(prev);
          paths.forEach(p => next.delete(p));
          return next;
        });
        getSystemUsage().then(setUsage).catch(console.error);
      }
    } catch (err) {
      console.error('Delete failed', err);
    }
  };

  const sortedFilesList = useMemo(() => {
    let filtered = allFiles;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(f => f.name.toLowerCase().includes(q));
    }
    
    return [...filtered].sort((a, b) => {
        if (a.dateFolder !== b.dateFolder) {
            if (a.dateFolder < b.dateFolder) return sortDir === 'asc' ? -1 : 1;
            return sortDir === 'asc' ? 1 : -1;
        }
        
        let valA: string | number = a[sortBy === 'time' ? 'createdAt' : sortBy];
        let valB: string | number = b[sortBy === 'time' ? 'createdAt' : sortBy];

        if (sortBy === 'time') {
          valA = new Date(valA).getTime();
          valB = new Date(valB).getTime();
        } else if (sortBy === 'name') {
          valA = (valA as string).toLowerCase();
          valB = (valB as string).toLowerCase();
        }

        if (valA < valB) return sortDir === 'asc' ? -1 : 1;
        if (valA > valB) return sortDir === 'asc' ? 1 : -1;
        return 0;
    });
  }, [allFiles, searchQuery, sortBy, sortDir]);

  const openPreview = (file: FileItem) => {
    const url = getPreviewUrl(file.dateFolder, file.name);
    setPreviewSrc(url);
    setPreviewFile(file);
  };

  const closePreview = () => {
    setPreviewFile(null);
    setPreviewSrc('');
  };

  const navigatePreview = (direction: 'next' | 'prev') => {
    if (!previewFile) return;
    const currentIndex = sortedFilesList.findIndex(f => f.path === previewFile.path);
    if (currentIndex === -1) return;

    const nextIndex = direction === 'next' ? currentIndex + 1 : currentIndex - 1;
    if (nextIndex >= 0 && nextIndex < sortedFilesList.length) {
        openPreview(sortedFilesList[nextIndex]);
    }
  };

  const hasNext = useMemo(() => {
    if (!previewFile) return false;
    const index = sortedFilesList.findIndex(f => f.path === previewFile.path);
    return index !== -1 && index < sortedFilesList.length - 1;
  }, [previewFile, sortedFilesList]);

  const hasPrev = useMemo(() => {
    if (!previewFile) return false;
    const index = sortedFilesList.findIndex(f => f.path === previewFile.path);
    return index > 0;
  }, [previewFile, sortedFilesList]);


  const groupedFiles = useMemo(() => {
    let filtered = allFiles;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(f => f.name.toLowerCase().includes(q));
    }

    const groups: Record<string, FileItem[]> = {};
    for (const file of filtered) {
      if (!groups[file.dateFolder]) {
        groups[file.dateFolder] = [];
      }
      groups[file.dateFolder].push(file);
    }

    const sortedDates = Object.keys(groups).sort((a, b) => {
      if (a < b) return sortDir === 'asc' ? -1 : 1;
      if (a > b) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });

    for (const date of sortedDates) {
      groups[date].sort((a, b) => {
        let valA: string | number = a[sortBy === 'time' ? 'createdAt' : sortBy];
        let valB: string | number = b[sortBy === 'time' ? 'createdAt' : sortBy];

        if (sortBy === 'time') {
          valA = new Date(valA).getTime();
          valB = new Date(valB).getTime();
        } else if (sortBy === 'name') {
          valA = (valA as string).toLowerCase();
          valB = (valB as string).toLowerCase();
        }

        if (valA < valB) return sortDir === 'asc' ? -1 : 1;
        if (valA > valB) return sortDir === 'asc' ? 1 : -1;
        return 0;
      });
    }

    return { sortedDates, groups };
  }, [allFiles, searchQuery, sortBy, sortDir]);

  return (
    <>
      <Head>
        <title>Gallery - Tiak</title>
      </Head>

      <div className="animate-in fade-in duration-500 pb-24">
        <header className="sticky top-0 z-30 bg-background/80 backdrop-blur-xl border-b border-border-subtle -mx-6 px-6 py-4 space-y-4">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                    <h1 className="text-2xl font-semibold tracking-tight text-foreground">Gallery</h1>
                    {usage && (
                        <span className="inline-flex items-center rounded-full bg-surface-strong px-2.5 py-0.5 text-xs font-medium text-content-muted">
                            {formatBytes(usage.totalSize)} • {usage.fileCount} files
                        </span>
                    )}
                </div>
                
                <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2 mr-2">
                        <input 
                            type="checkbox"
                            checked={sortedFilesList.length > 0 && selectedPaths.size === sortedFilesList.length}
                            onChange={(e) => {
                                if (e.target.checked) {
                                    setSelectedPaths(new Set(sortedFilesList.map(f => f.path)));
                                } else {
                                    setSelectedPaths(new Set());
                                }
                            }}
                            className="h-4 w-4 rounded border-border-subtle bg-surface text-blue-500 focus:ring-blue-500 cursor-pointer"
                            title="Select All"
                        />
                        <span className="text-sm text-content-muted hidden md:inline">Select All</span>
                    </div>

                    <div className="relative group">
                        <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-content-muted group-focus-within:text-foreground transition-colors">
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                        </div>
                        <input
                            type="text"
                            placeholder="Search..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="block w-full md:w-48 rounded-lg border-border-subtle bg-surface pl-9 pr-3 py-1.5 text-sm text-foreground placeholder:text-content-subtle focus:border-foreground focus:ring-1 focus:ring-foreground transition-all"
                        />
                    </div>

                    <select
                        value={sortBy}
                        onChange={(e) => setSortBy(e.target.value as SortOption)}
                        className="block rounded-lg border-border-subtle bg-surface py-1.5 pl-3 pr-8 text-sm text-foreground focus:border-foreground focus:ring-1 focus:ring-foreground transition-all cursor-pointer hover:bg-surface-subtle"
                    >
                        <option value="time">Time</option>
                        <option value="name">Name</option>
                        <option value="size">Size</option>
                    </select>

                    <button
                        onClick={() => setSortDir(sortDir === 'asc' ? 'desc' : 'asc')}
                        className="p-1.5 rounded-lg border border-border-subtle bg-surface text-foreground hover:bg-surface-subtle transition-colors"
                        title={sortDir === 'asc' ? 'Oldest First' : 'Newest First'}
                    >
                        {sortDir === 'asc' ? (
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m3 16 4 4 4-4"/><path d="M7 20V4"/><path d="M11 4h4"/><path d="M11 8h7"/><path d="M11 12h10"/></svg>
                        ) : (
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 8 7 4 11 8"/><path d="M7 4v16"/><path d="M11 12h10"/><path d="M11 8h7"/><path d="M11 4h4"/></svg>
                        )}
                    </button>

                    <button
                        onClick={() => fetchFiles(true)}
                        className="p-1.5 rounded-lg border border-border-subtle bg-surface text-foreground hover:bg-surface-subtle transition-colors"
                        title="Refresh"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.5 2v6h-6M21.34 5.5A10 10 0 1 1 11.26 2.75"/></svg>
                    </button>
                </div>
            </div>
        </header>

        {loading ? (
            <div className="flex justify-center py-24">
                <div className="h-6 w-6 border-2 border-foreground border-t-transparent rounded-full animate-spin"></div>
            </div>
        ) : groupedFiles.sortedDates.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 text-content-muted border border-dashed border-border-subtle rounded-xl bg-surface-subtle/30 mx-auto max-w-lg mt-8">
                <p>No files found</p>
            </div>
        ) : (
            <div className="space-y-12 mt-6">
                {groupedFiles.sortedDates.map((dateKey) => (
                    <div key={dateKey}>
                        <div className="sticky top-20 z-20 bg-background/95 backdrop-blur-sm py-2 px-2 -mx-2 mb-4 border-b border-border-subtle/50 flex items-baseline gap-3">
                            <h2 className="text-lg font-semibold text-foreground tracking-tight">
                                {formatDateHeader(dateKey)}
                            </h2>
                            <span className="text-xs text-content-muted font-medium">
                                {groupedFiles.groups[dateKey].length} items
                            </span>
                        </div>
                        
                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
                            {groupedFiles.groups[dateKey].map((file) => {
                                const isSelected = selectedPaths.has(file.path);
                                const thumbUrl = getPreviewUrl(file.dateFolder, file.name);
                                
                                return (
                                    <div 
                                        key={file.path} 
                                        className={`group relative aspect-[3/4] rounded-xl overflow-hidden border transition-all duration-200 ${
                                            isSelected 
                                            ? 'border-blue-500 ring-1 ring-blue-500 shadow-md' 
                                            : 'border-border-subtle hover:border-border hover:shadow-sm'
                                        } bg-surface`}
                                    >
                                        <div className={`absolute top-0 left-0 right-0 z-20 p-2 flex justify-between items-start transition-opacity duration-200 ${isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
                                            <div className="bg-black/20 backdrop-blur-md rounded-lg p-1">
                                                <input
                                                    type="checkbox"
                                                    checked={isSelected}
                                                    onChange={(e) => toggleSelect(file.path, e)}
                                                    className="h-4 w-4 rounded border-white/50 bg-white/20 text-blue-500 focus:ring-blue-500 cursor-pointer"
                                                />
                                            </div>
                                            <button 
                                                onClick={(e) => handleDownload(file.path, e)}
                                                className="p-1.5 bg-black/40 backdrop-blur-md text-white rounded-lg hover:bg-black/60 transition-colors"
                                                title="Download"
                                            >
                                                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                                            </button>
                                        </div>

                                        <div 
                                            className="absolute inset-0 bg-surface-strong cursor-pointer"
                                            onClick={() => openPreview(file)}
                                        >
                                            <LazyThumbnail 
                                                src={thumbUrl}
                                                className="w-full h-full opacity-90 group-hover:opacity-100"
                                                onError={() => {
                                                    console.warn(`Failed to load thumbnail: ${thumbUrl}`);
                                                }}
                                            />
                                            
                                            <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-200 bg-black/10">
                                                <div className="h-10 w-10 rounded-full bg-white/20 backdrop-blur-md flex items-center justify-center shadow-lg border border-white/30">
                                                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="white" stroke="none"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                                                </div>
                                            </div>

                                            <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent p-3 pt-8">
                                                <h3 className="text-white text-xs font-medium truncate drop-shadow-sm" title={file.name}>{file.name}</h3>
                                                <div className="flex justify-between items-center mt-1">
                                                    <span className="text-[10px] text-white/70 font-medium">{formatBytes(file.size)}</span>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                ))}
            </div>
        )}

        {selectedPaths.size > 0 && (
            <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-40 bg-foreground text-background px-4 py-2 rounded-full shadow-2xl flex items-center gap-4 animate-in slide-in-from-bottom-4 duration-300 ring-1 ring-white/10">
                <span className="text-sm font-medium whitespace-nowrap">{selectedPaths.size} selected</span>
                <div className="h-4 w-px bg-background/20"></div>
                <button onClick={handleBulkZip} className="text-sm font-medium hover:text-white/80 transition-colors whitespace-nowrap">Download Zip</button>
                <button onClick={() => handleDelete(Array.from(selectedPaths))} className="text-sm font-medium text-red-300 hover:text-red-200 transition-colors">Delete</button>
                <button onClick={() => setSelectedPaths(new Set())} className="ml-2 text-background/50 hover:text-background transition-colors">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
                        </div>
                    )}
            
                    {previewFile && (
                      <CustomVideoPlayer 
                        src={previewSrc}
                        onClose={closePreview}
                        onNext={() => navigatePreview('next')}
                        onPrev={() => navigatePreview('prev')}
                        hasNext={hasNext}
                        hasPrev={hasPrev}
                        mode={playerType}
                        filename={previewFile.name}
                      />
                    )}
                  </div>
                </>
              );
            }