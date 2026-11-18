// Ensures at most one call recording plays at a time across the whole app. Previously each
// CallWaveform owned its own independent <audio> element, so tapping play on a second
// recording while a first was still loading/playing let both fire — overlapping/interrupting
// audio that sounded like nothing was playing at all, and multiple playback-url requests in
// flight at once. Starting a new recording now always stops whatever was already playing.
let currentAudio: HTMLAudioElement | null = null;
let currentRecordingId: string | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  listeners.forEach((listener) => listener());
}

export function subscribeToPlayback(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getPlayingRecordingId(): string | null {
  return currentRecordingId;
}

// Lets a subscribed component attach its own listeners (timeupdate for playback progress,
// playbackRate for speed control) directly to the one shared <audio> element, without this
// module needing to know about progress/speed at all — it only owns "which recording, if
// any, is currently playing."
export function getCurrentAudio(): HTMLAudioElement | null {
  return currentAudio;
}

export function stopPlayback(): void {
  currentAudio?.pause();
  currentAudio = null;
  currentRecordingId = null;
  notify();
}

export async function playRecording(recordingId: string, url: string): Promise<void> {
  stopPlayback();
  const audio = new Audio(url);
  audio.onended = () => stopPlayback();
  currentAudio = audio;
  currentRecordingId = recordingId;
  notify();
  await audio.play();
}
