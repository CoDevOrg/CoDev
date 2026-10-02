/**
 * Simple geometric marks evoking each provider, not official brand assets —
 * this app has no network access to fetch Anthropic's/OpenAI's published SVG
 * logos, and hand-reproducing an exact trademark from memory risks getting
 * it visibly wrong. Swap these for the real files if/when available.
 */

export function ClaudeMark({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="currentColor"
      viewBox="0 0 24 24"
    >
      {Array.from({ length: 8 }).map((_, index) => (
        <rect
          height="10"
          key={index}
          rx="1.4"
          transform={`rotate(${index * 45} 12 12)`}
          width="2.8"
          x="10.6"
          y="2"
        />
      ))}
    </svg>
  );
}

export function OpenAIMark({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      viewBox="0 0 24 24"
    >
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="7.5" r="2.6" />
      <circle cx="16.4" cy="14.8" r="2.6" />
      <circle cx="7.6" cy="14.8" r="2.6" />
    </svg>
  );
}
