/** Tiny animated level bars used for download rows and the mini widget. */

export function Waveform({ bars = 5, active = true, height = 16 }: { bars?: number; active?: boolean; height?: number }) {
  return (
    <span
      className="amp-waveform"
      style={{ height, gap: 2, color: "currentColor" }}
      aria-hidden
      role="presentation"
    >
      {Array.from({ length: bars }).map((_, index) => (
        <i
          key={index}
          style={{
            height: `${Math.max(18, Math.round((active ? 45 + ((index * 37) % 55) : 22) ))}%`,
            animation: active ? `amp-equalize ${700 + index * 90}ms ease-in-out ${index * 60}ms infinite` : "none",
            transformOrigin: "bottom center",
            background: "currentColor",
            width: 3,
            borderRadius: 1,
            display: "block",
          }}
        />
      ))}
    </span>
  );
}
