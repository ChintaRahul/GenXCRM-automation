import { useEffect, useState, useSyncExternalStore } from "react";
import { Play, Pause, Loader2, Download, Share2 } from "lucide-react";
import { toast } from "sonner";
import { getCallRecordingPlaybackUrl } from "../../api/client";
import {
  getCurrentAudio,
  getPlayingRecordingId,
  playRecording,
  stopPlayback,
  subscribeToPlayback,
} from "../../lib/callRecordingPlayer";

const BAR_COUNT = 60;

// Deterministic per-recording "waveform" — purely decorative (no real audio
// analysis backs it), seeded by the recording id so it's stable across
// re-renders instead of reshuffling on every paint.
function hashSeed(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    h = (h * 31 + id.charCodeAt(i)) % 1000;
  }
  return h;
}

function barHeights(id: string): number[] {
  const seed = hashSeed(id);
  return Array.from({ length: BAR_COUNT }, (_, i) => {
    const v = Math.sin(i * 1.3 + seed) * 0.5 + Math.sin(i * 0.4 + seed) * 0.3;
    return 3 + Math.abs(v) * 13;
  });
}

function formatDuration(sec?: number): string {
  if (!sec) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec) % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

interface CallWaveformProps {
  id: string;
  durationSec?: number;
  recordingId?: string;
}

export function CallWaveform({
  id,
  durationSec,
  recordingId,
}: CallWaveformProps) {
  const heights = barHeights(id);
  const [loading, setLoading] = useState(false);
  const [speed, setSpeed] = useState<1 | 2>(1);
  const [progress, setProgress] = useState(0);
  const [currentSec, setCurrentSec] = useState(0);
  const playingRecordingId = useSyncExternalStore(
    subscribeToPlayback,
    getPlayingRecordingId,
  );
  const isPlaying = recordingId != null && playingRecordingId === recordingId;
  const status = loading ? "loading" : isPlaying ? "playing" : "idle";

  useEffect(() => {
    if (!isPlaying) {
      setProgress(0);
      setCurrentSec(0);
      return;
    }
    const audio = getCurrentAudio();
    if (!audio) return;
    audio.playbackRate = speed;
    const onTimeUpdate = () => {
      setCurrentSec(audio.currentTime);
      setProgress(audio.duration > 0 ? audio.currentTime / audio.duration : 0);
    };
    audio.addEventListener("timeupdate", onTimeUpdate);
    return () => audio.removeEventListener("timeupdate", onTimeUpdate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying]);

  async function togglePlayback() {
    if (!recordingId || loading) return;

    if (isPlaying) {
      stopPlayback();
      return;
    }

    setLoading(true);
    try {
      // Presigned URLs are short-lived (15 min) and never cached — fetch fresh on every play.
      const { url } = await getCallRecordingPlaybackUrl(recordingId);
      await playRecording(recordingId, url);
    } catch {
      toast.error("Couldn't load this recording.");
    } finally {
      setLoading(false);
    }
  }

  function selectSpeed(rate: 1 | 2) {
    setSpeed(rate);
    const audio = getCurrentAudio();
    if (isPlaying && audio) audio.playbackRate = rate;
  }

  async function handleDownload() {
    if (!recordingId) return;
    try {
      const { url } = await getCallRecordingPlaybackUrl(recordingId);
      const link = document.createElement("a");
      link.href = url;
      link.download = `recording-${recordingId}.aac`;
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch {
      toast.error("Couldn't download this recording.");
    }
  }

  async function handleShare() {
    if (!recordingId) return;
    try {
      const { url } = await getCallRecordingPlaybackUrl(recordingId);
      if (navigator.share) {
        await navigator.share({ url });
      } else {
        window.open(url, "_blank", "noopener,noreferrer");
      }
    } catch {
      toast.error("Couldn't share this recording.");
    }
  }

  const activeBars = Math.floor(progress * heights.length);

  return (
    <div
      className="mt-1.5 flex flex-col gap-1.5 pl-3 border-l-2 border-chart-4/30 py-1.5"
      title={recordingId ? "Recorded automatically per company policy" : undefined}
    >
      <div className="flex items-center gap-2.5">
        {recordingId ? (
          <button
            type="button"
            onClick={() => void togglePlayback()}
            disabled={loading}
            className="w-6 h-6 rounded-full bg-chart-4/15 text-chart-4 flex items-center justify-center flex-shrink-0 disabled:opacity-60"
            title={status === "playing" ? "Pause recording" : "Play recording"}
          >
            {status === "loading" ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : status === "playing" ? (
              <Pause className="w-3 h-3" fill="currentColor" />
            ) : (
              <Play className="w-3 h-3" fill="currentColor" />
            )}
          </button>
        ) : (
          <div className="w-6 h-6 rounded-full bg-muted flex items-center justify-center flex-shrink-0" />
        )}
        <div className="flex items-end gap-[1.5px] h-5 flex-1 min-w-0 overflow-hidden">
          {heights.map((h, i) => (
            <div
              key={i}
              className={`w-[2px] rounded-full flex-shrink-0 ${i < activeBars ? "bg-chart-4" : "bg-chart-4/50"}`}
              style={{ height: `${h}px` }}
            />
          ))}
        </div>
        <span className="text-[11px] font-mono text-muted-foreground flex-shrink-0">
          {isPlaying
            ? `${formatDuration(currentSec)} / ${formatDuration(durationSec)}`
            : formatDuration(durationSec)}
        </span>
      </div>
      {recordingId && (
        <div className="flex items-center gap-3 pl-8">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => selectSpeed(1)}
              className={`text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded ${speed === 1 ? "text-chart-4" : "text-muted-foreground"}`}
            >
              1x
            </button>
            <button
              type="button"
              onClick={() => selectSpeed(2)}
              className={`text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded ${speed === 2 ? "text-chart-4" : "text-muted-foreground"}`}
            >
              2x
            </button>
          </div>
          <button
            type="button"
            onClick={() => void handleDownload()}
            className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
            title="Download recording"
          >
            <Download className="w-3 h-3" />
            Download
          </button>
          <button
            type="button"
            onClick={() => void handleShare()}
            className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
            title="Share recording"
          >
            <Share2 className="w-3 h-3" />
            Share
          </button>
        </div>
      )}
    </div>
  );
}
