import { useState, useRef, useEffect } from 'react';

class ThumbnailLoadLimiter {
  private static instance: ThumbnailLoadLimiter;
  private loading = 0;
  private maxConcurrent = 4;
  private queue: Array<() => void> = [];

  static getInstance(): ThumbnailLoadLimiter {
    if (!ThumbnailLoadLimiter.instance) {
      ThumbnailLoadLimiter.instance = new ThumbnailLoadLimiter();
    }
    return ThumbnailLoadLimiter.instance;
  }

  load(startLoad: () => void) {
    if (this.loading < this.maxConcurrent) {
      this.loading++;
      startLoad();
    } else {
      this.queue.push(startLoad);
    }
  }

  release() {
    this.loading--;
    if (this.queue.length > 0 && this.loading < this.maxConcurrent) {
      const next = this.queue.shift();
      if (next) {
        this.loading++;
        next();
      }
    }
  }
}

interface LazyThumbnailProps {
  src: string;
  alt?: string;
  className?: string;
  onLoad?: () => void;
  onError?: () => void;
}

export default function LazyThumbnail({ src, className, onLoad, onError }: LazyThumbnailProps) {
  const [isLoaded, setIsLoaded] = useState(false);
  const [isInView, setIsInView] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [canLoad, setCanLoad] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const limiterRef = useRef(ThumbnailLoadLimiter.getInstance());

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsInView(true);
          observer.disconnect();
        }
      },
      {
        rootMargin: '50px',
      }
    );

    if (containerRef.current) {
      observer.observe(containerRef.current);
    }

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (isInView && !canLoad) {
      limiterRef.current.load(() => {
        setCanLoad(true);
      });
    }
  }, [isInView, canLoad]);

  const handleLoad = () => {
    setIsLoaded(true);
    onLoad?.();
    limiterRef.current.release();
  };

  const handleError = () => {
    setHasError(true);
    onError?.();
    limiterRef.current.release();
  };

  const handleLoadedData = () => {
    handleLoad();
  };

  return (
    <div ref={containerRef} className={`relative ${className || ''}`}>
      {hasError ? (
        <div className="w-full h-full bg-surface-strong flex items-center justify-center">
          <div className="text-center p-4">
            <svg 
              xmlns="http://www.w3.org/2000/svg" 
              width="24" 
              height="24" 
              viewBox="0 0 24 24" 
              fill="none" 
              stroke="currentColor" 
              strokeWidth="2" 
              strokeLinecap="round" 
              strokeLinejoin="round" 
              className="mx-auto mb-2 text-muted-foreground"
            >
              <rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"></rect>
              <line x1="7" y1="2" x2="7" y2="22"></line>
              <line x1="17" y1="2" x2="17" y2="22"></line>
              <line x1="2" y1="12" x2="22" y2="12"></line>
              <line x1="2" y1="7" x2="7" y2="7"></line>
              <line x1="2" y1="17" x2="7" y2="17"></line>
              <line x1="17" y1="17" x2="22" y2="17"></line>
              <line x1="17" y1="7" x2="22" y2="7"></line>
            </svg>
            <p className="text-xs text-muted-foreground">Failed to load</p>
          </div>
        </div>
      ) : canLoad ? (
        <video
          ref={videoRef}
          src={`${src}#t=1`}
          className={`w-full h-full object-cover transition-opacity duration-300 ${
            isLoaded ? 'opacity-90' : 'opacity-0'
          }`}
          preload="metadata"
          muted
          playsInline
          crossOrigin="anonymous"
          onLoadedData={handleLoadedData}
          onError={handleError}
          onLoadStart={() => setIsLoaded(false)}
        />
      ) : (
        <div className="w-full h-full bg-surface-strong animate-pulse" />
      )}
      
      {!isLoaded && canLoad && !hasError && (
        <div className="absolute inset-0 bg-surface-strong animate-pulse" />
      )}
    </div>
  );
}