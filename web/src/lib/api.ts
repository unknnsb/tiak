import { API_BASE } from './config';

export interface DownloadJob {
  id: string;
  url: string;
  status: "queued" | "downloading" | "done" | "failed" | "imported" | "missing";
  filename: string | null;
  createdAt: number;
  startedAt: number | null;
  completedAt: number | null;
  retries: number;
  error: string | null;
  progress: number;
  eta: number | null;
}

export interface HistoryResponse {
  items: DownloadJob[];
  total: number;
  page: number;
  limit: number;
}

export interface DiskUsage {
  totalSize: number;
  fileCount: number;
}

export interface AddJobResponse {
  added: DownloadJob[];
  skipped: { url: string; reason: string; jobId?: string; finishedAt?: number }[];
}

export async function getHistory(page: number = 1, limit: number = 50): Promise<HistoryResponse> {
  const res = await fetch(`${API_BASE}/queue/history?page=${page}&limit=${limit}`);
  if (!res.ok) {
    throw new Error('Failed to fetch history');
  }
  return res.json();
}

export async function retryJob(id: string): Promise<DownloadJob> {
  const res = await fetch(`${API_BASE}/queue/retry/${id}`, {
    method: 'POST'
  });
  if (!res.ok) {
    throw new Error('Failed to retry job');
  }
  return res.json();
}

export async function redownloadJob(id: string): Promise<DownloadJob> {
  const res = await fetch(`${API_BASE}/queue/redownload/${id}`, {
    method: 'POST'
  });
  if (!res.ok) {
    throw new Error('Failed to redownload job');
  }
  return res.json();
}

export async function deleteJob(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/queue/${id}`, {
    method: 'DELETE'
  });
  if (!res.ok) {
    throw new Error('Failed to delete job');
  }
}

export async function importHistory(file: File): Promise<{ imported: number; skipped: number }> {
  const formData = new FormData();
  formData.append('file', file);

  const res = await fetch(`${API_BASE}/queue/import`, {
    method: 'POST',
    body: formData,
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.error || 'Failed to import history');
  }

  return res.json();
}

export async function getSystemUsage(): Promise<DiskUsage> {
  const res = await fetch(`${API_BASE}/system/usage`);
  if (!res.ok) {
    throw new Error('Failed to fetch system usage');
  }
  return res.json();
}

export function getExportUrl(): string {
  return `${API_BASE}/queue/export`;
}

export function getStreamUrl(path: string): string {
  return `${API_BASE}/files/stream?path=${encodeURIComponent(path)}`;
}

export function getDownloadUrl(path: string): string {
  return `${API_BASE}/files/download?path=${encodeURIComponent(path)}`;
}

export function getPreviewUrl(dateFolder: string, filename: string): string {
  return getStreamUrl(`data/${dateFolder}/${filename}`);
}
