import { useEffect, useRef, useState } from "react";

declare global {
  interface Window {
    YT: any;
    onYouTubeIframeAPIReady: () => void;
  }
}

let apiPromise: Promise<void> | null = null;
function loadYouTubeAPI(): Promise<void> {
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve) => {
    if (window.YT && window.YT.Player) return resolve();
    const tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(tag);
    window.onYouTubeIframeAPIReady = () => resolve();
  });
  return apiPromise;
}

export interface PlayerHandle {
  play: () => void;
  pause: () => void;
  seek: (s: number) => void;
  load: (videoId: string, startSeconds?: number) => void;
  getCurrentTime: () => number;
  getState: () => number;
}

interface Props {
  videoId: string | null;
  isOwner: boolean;
  onReady?: (handle: PlayerHandle) => void;
  onStateChange?: (state: number, currentTime: number) => void;
  onEnded?: () => void;
}

export const YouTubePlayer = ({ videoId, isOwner, onReady, onStateChange, onEnded }: Props) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<any>(null);
  const [ready, setReady] = useState(false);

  // Keep callbacks fresh to avoid stale closures
  const callbacksRef = useRef({ onReady, onStateChange, onEnded });
  useEffect(() => {
    callbacksRef.current = { onReady, onStateChange, onEnded };
  }, [onReady, onStateChange, onEnded]);

  useEffect(() => {
    let cancelled = false;
    loadYouTubeAPI().then(() => {
      if (cancelled || !containerRef.current) return;
      playerRef.current = new window.YT.Player(containerRef.current, {
        height: "100%",
        width: "100%",
        videoId: videoId || undefined,
        playerVars: {
          controls: isOwner ? 1 : 0,
          disablekb: isOwner ? 0 : 1,
          modestbranding: 1,
          rel: 0,
          playsinline: 1,
        },
        events: {
          onReady: () => {
            setReady(true);
            const handle: PlayerHandle = {
              play: () => playerRef.current?.playVideo(),
              pause: () => playerRef.current?.pauseVideo(),
              seek: (s) => playerRef.current?.seekTo(s, true),
              load: (id, start = 0) => playerRef.current?.loadVideoById({ videoId: id, startSeconds: start }),
              getCurrentTime: () => playerRef.current?.getCurrentTime() ?? 0,
              getState: () => playerRef.current?.getPlayerState() ?? -1,
            };
            callbacksRef.current.onReady?.(handle);
          },
          onStateChange: (e: any) => {
            const t = playerRef.current?.getCurrentTime() ?? 0;
            callbacksRef.current.onStateChange?.(e.data, t);
            if (e.data === window.YT.PlayerState.ENDED) {
              callbacksRef.current.onEnded?.();
            }
          },
        },
      });
    });
    return () => {
      cancelled = true;
      try { playerRef.current?.destroy(); } catch {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="relative w-full aspect-video bg-black rounded-lg overflow-hidden">
      <div ref={containerRef} className="absolute inset-0" />
      {!isOwner && ready && (
        <div className="absolute inset-0 z-10" style={{ pointerEvents: "auto" }} />
      )}
    </div>
  );
};
