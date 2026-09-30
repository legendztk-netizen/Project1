import { Play } from "lucide-react";
import { useRef, useState } from "react";

interface ClickToPlayVideoProps {
  /** Accessible name for the video and play button. */
  label: string;
  poster: string;
  src: string;
  /** Optional short caption shown next to the play icon. */
  caption?: string;
  /** Start muted; the visitor can still unmute from the player controls. */
  muted?: boolean;
}

/** Shows a poster and only loads and plays the video after the visitor clicks. */
export function ClickToPlayVideo({
  caption,
  label,
  muted = false,
  poster,
  src,
}: ClickToPlayVideoProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [started, setStarted] = useState(false);

  function start() {
    setStarted(true);
    // React does not always reflect the `muted` prop onto the element, so set it explicitly.
    if (videoRef.current) videoRef.current.muted = muted;
    void videoRef.current?.play();
  }

  return (
    <div className="click-video">
      <video
        aria-label={label}
        controls
        muted={muted}
        playsInline
        poster={poster}
        preload="none"
        ref={videoRef}
      >
        <source src={src} type="video/mp4" />
      </video>
      {started ? null : (
        <button
          aria-label={`Play video: ${label}`}
          className="click-video-play"
          onClick={start}
          type="button"
        >
          <span className="click-video-icon">
            <Play aria-hidden="true" fill="currentColor" size={34} />
          </span>
          {caption ? (
            <span className="click-video-caption">{caption}</span>
          ) : null}
        </button>
      )}
    </div>
  );
}
