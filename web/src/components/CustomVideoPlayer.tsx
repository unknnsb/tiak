import { useEffect, useRef } from "react";
import Plyr from "plyr";
import "plyr/dist/plyr.css";

type Props = {
  src: string;
  onClose: () => void;
  onNext?: () => void;
  onPrev?: () => void;
  hasNext?: boolean;
  hasPrev?: boolean;
  mode?: 'native' | 'custom';
  filename?: string;
};

export default function CustomVideoPlayer({ 
  src, 
  onClose, 
  onNext, 
  onPrev, 
  hasNext, 
  hasPrev, 
  mode = 'custom',
  filename 
}: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const playerRef = useRef<Plyr | null>(null);

  useEffect(() => {
    if (mode !== 'custom' || !videoRef.current) return;

    playerRef.current = new Plyr(videoRef.current, {
      controls: [
        "play-large",
        "play",
        "progress",
        "current-time",
        "mute",
        "volume",
        "fullscreen",
        "settings"
      ],
      seekTime: 5,
      keyboard: { focused: true, global: false },
      tooltips: { controls: true, seek: true },
      blankVideo: 'data:video/mp4;base64,AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDIAAABIdW1vbwAAAA5mcmVlAAAALm1kYXQAAAH5YXZjQwH0AAr/4AAZAWfAArYAsv8A6AAAPpAADqYAAAMAAAMA6B4Jyw==',
    });

    return () => {
      playerRef.current?.destroy();
      playerRef.current = null;
    };
  }, [mode]);

  useEffect(() => {
    if (mode === 'custom' && playerRef.current && src) {
      playerRef.current.source = {
        type: 'video',
        sources: [
          {
            src: src,
            type: 'video/mp4',
          },
        ],
      };
      playerRef.current.play();
    }
  }, [src, mode]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      
      if (e.key === 'ArrowRight' && hasNext && onNext) {
          onNext();
      }
      if (e.key === 'ArrowLeft' && hasPrev && onPrev) {
          onPrev();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, onNext, onPrev, hasNext, hasPrev]);

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/95 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div 
        className="relative w-full h-full p-4 md:p-8 flex flex-col justify-center items-center"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="absolute top-0 left-0 right-0 p-4 z-20 flex justify-between items-start pointer-events-none">
            <h3 className="text-white/80 font-medium text-sm md:text-base drop-shadow-md truncate max-w-md pointer-events-auto">{filename}</h3>
            <button 
                onClick={onClose}
                className="text-white/70 hover:text-white bg-white/10 hover:bg-white/20 rounded-full p-2 transition-colors backdrop-blur-md pointer-events-auto"
            >
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
        </div>

        <div className="relative group w-auto h-auto max-w-full max-h-full flex items-center justify-center rounded-lg shadow-2xl ring-1 ring-white/10 overflow-hidden">
            {hasPrev && (
                <button 
                    onClick={(e) => { e.stopPropagation(); onPrev?.(); }}
                    className="absolute left-4 top-1/2 -translate-y-1/2 z-20 p-3 bg-black/40 text-white/50 hover:text-white hover:bg-black/60 rounded-full transition-all opacity-0 group-hover:opacity-100 hover:scale-110"
                >
                     <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
                </button>
            )}

            {hasNext && (
                <button 
                    onClick={(e) => { e.stopPropagation(); onNext?.(); }}
                    className="absolute right-4 top-1/2 -translate-y-1/2 z-20 p-3 bg-black/40 text-white/50 hover:text-white hover:bg-black/60 rounded-full transition-all opacity-0 group-hover:opacity-100 hover:scale-110"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6"/></svg>
                </button>
            )}

            {mode === 'custom' ? (
                <div className="w-full h-full max-h-[85vh] [&>.plyr]:h-full [&>.plyr]:max-h-[85vh] [&>.plyr]:w-auto [&_video]:max-h-[85vh]">
                    <video
                        ref={videoRef}
                        className="plyr-react"
                        preload="metadata"
                        playsInline
                        crossOrigin="anonymous"
                    />
                </div>
            ) : (
                <video
                    src={src}
                    controls
                    autoPlay
                    className="w-auto h-auto max-w-full max-h-[85vh] object-contain"
                    preload="metadata"
                    playsInline
                    crossOrigin="anonymous"
                />
            )}
        </div>
      </div>
    </div>
  );
}