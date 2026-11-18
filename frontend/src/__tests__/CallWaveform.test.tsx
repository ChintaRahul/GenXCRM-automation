import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { CallWaveform } from "../components/leadDetail/CallWaveform";
import * as client from "../api/client";
import { getCurrentAudio, stopPlayback } from "../lib/callRecordingPlayer";

vi.mock("../api/client");

describe("CallWaveform", () => {
  it("renders the formatted duration", () => {
    render(<CallWaveform id="rec-1" durationSec={125} />);
    expect(screen.getByText("2:05")).toBeInTheDocument();
  });

  it("defaults to 0:00 when duration is missing", () => {
    render(<CallWaveform id="rec-1" />);
    expect(screen.getByText("0:00")).toBeInTheDocument();
  });

  it("omits the Play button when no recordingId is provided", () => {
    render(<CallWaveform id="rec-1" durationSec={60} />);
    expect(screen.queryByTitle("Play recording")).toBeNull();
  });

  it("shows the Play button when a recordingId is provided", () => {
    render(<CallWaveform id="rec-1" durationSec={60} recordingId="rec-1" />);
    expect(screen.getByTitle("Play recording")).toBeInTheDocument();
  });

  it("renders the same bar heights for the same id (deterministic, not random)", () => {
    const { container: c1 } = render(
      <CallWaveform id="stable-id" durationSec={30} />,
    );
    const { container: c2 } = render(
      <CallWaveform id="stable-id" durationSec={30} />,
    );
    const heights1 = Array.from(c1.querySelectorAll("div[style]")).map(
      (el) => (el as HTMLElement).style.height,
    );
    const heights2 = Array.from(c2.querySelectorAll("div[style]")).map(
      (el) => (el as HTMLElement).style.height,
    );
    expect(heights1).toEqual(heights2);
  });
});

describe("CallWaveform playback exclusivity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stopPlayback(); // reset the shared module-level singleton between tests
    window.HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
    window.HTMLMediaElement.prototype.pause = vi.fn();
  });

  it("stops a previously playing recording when a different one starts", async () => {
    const user = userEvent.setup();
    vi.mocked(client.getCallRecordingPlaybackUrl).mockImplementation((id: string) =>
      Promise.resolve({ url: `https://s3.example.com/${id}` }),
    );

    render(
      <>
        <CallWaveform id="a" recordingId="rec-a" />
        <CallWaveform id="b" recordingId="rec-b" />
      </>,
    );

    const [playA, playB] = screen.getAllByTitle("Play recording");

    await user.click(playA);
    await waitFor(() => expect(screen.getByTitle("Pause recording")).toBeInTheDocument());

    await user.click(playB);
    await waitFor(() => {
      const titles = screen.getAllByRole("button").map((b) => b.getAttribute("title"));
      // Only one button should show "Pause recording" at a time — the other reverts to idle.
      expect(titles.filter((t) => t === "Pause recording")).toHaveLength(1);
    });
    expect(screen.getByTitle("Pause recording")).not.toBe(playA);
  });

  it("ignores repeated clicks while a playback-url fetch is already in flight", async () => {
    const user = userEvent.setup();
    let resolveFetch: (v: { url: string }) => void = () => {};
    vi.mocked(client.getCallRecordingPlaybackUrl).mockReturnValue(
      new Promise((resolve) => {
        resolveFetch = resolve;
      }),
    );

    render(<CallWaveform id="a" recordingId="rec-a" />);
    const button = screen.getByTitle("Play recording");

    await user.click(button);
    await user.click(button);
    await user.click(button);

    resolveFetch({ url: "https://s3.example.com/rec-a" });
    await waitFor(() => expect(screen.getByTitle("Pause recording")).toBeInTheDocument());

    expect(client.getCallRecordingPlaybackUrl).toHaveBeenCalledTimes(1);
  });
});

describe("CallWaveform playback enhancements", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stopPlayback(); // reset the shared module-level singleton between tests
    window.HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
    window.HTMLMediaElement.prototype.pause = vi.fn();
  });

  it("shows speed and download/share controls once a recording exists", () => {
    render(<CallWaveform id="a" recordingId="rec-a" durationSec={60} />);
    expect(screen.getByText("1x")).toBeInTheDocument();
    expect(screen.getByText("2x")).toBeInTheDocument();
    expect(screen.getByTitle("Download recording")).toBeInTheDocument();
    expect(screen.getByTitle("Share recording")).toBeInTheDocument();
  });

  it("omits playback controls when there is no recording", () => {
    render(<CallWaveform id="a" durationSec={60} />);
    expect(screen.queryByText("1x")).toBeNull();
    expect(screen.queryByTitle("Download recording")).toBeNull();
  });

  it("sets playbackRate on the shared audio element when 2x is selected during playback", async () => {
    const user = userEvent.setup();
    vi.mocked(client.getCallRecordingPlaybackUrl).mockResolvedValue({ url: "https://s3.example.com/rec-a" });

    render(<CallWaveform id="a" recordingId="rec-a" durationSec={60} />);
    await user.click(screen.getByTitle("Play recording"));
    await waitFor(() => expect(screen.getByTitle("Pause recording")).toBeInTheDocument());

    await user.click(screen.getByText("2x"));

    const audio = getCurrentAudio();
    expect(audio).not.toBeNull();
    expect(audio!.playbackRate).toBe(2);
  });

  it("fetches a fresh URL and triggers a download on Download click", async () => {
    const user = userEvent.setup();
    vi.mocked(client.getCallRecordingPlaybackUrl).mockResolvedValue({ url: "https://s3.example.com/rec-a" });
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    render(<CallWaveform id="a" recordingId="rec-a" durationSec={60} />);
    await user.click(screen.getByTitle("Download recording"));

    await waitFor(() => expect(client.getCallRecordingPlaybackUrl).toHaveBeenCalledWith("rec-a"));
    expect(clickSpy).toHaveBeenCalled();
    clickSpy.mockRestore();
  });

  it("uses navigator.share when available, falling back to window.open otherwise", async () => {
    const user = userEvent.setup();
    vi.mocked(client.getCallRecordingPlaybackUrl).mockResolvedValue({ url: "https://s3.example.com/rec-a" });
    const shareMock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "share", { value: shareMock, configurable: true });

    render(<CallWaveform id="a" recordingId="rec-a" durationSec={60} />);
    await user.click(screen.getByTitle("Share recording"));

    await waitFor(() => expect(shareMock).toHaveBeenCalledWith({ url: "https://s3.example.com/rec-a" }));

    // @ts-expect-error — cleaning up the test-only property
    delete navigator.share;
  });
});
