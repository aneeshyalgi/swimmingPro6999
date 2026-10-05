import type { CSSProperties } from "react"

// Deterministic values (no Math.random) so server and client markup match.
const bubbles = Array.from({ length: 26 }, (_, i) => {
  const duration = 10 + ((i * 7) % 11)
  return {
    left: (i * 37 + 11) % 100,
    size: 4 + ((i * 7) % 15),
    duration,
    delay: -((i * 2.3) % duration),
    sway: 2.5 + ((i * 3) % 4),
    drift: ((i % 5) - 2) * 10,
    opacity: 0.3 + ((i * 13) % 35) / 100,
  }
})

export function WaterBubbles() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="water-caustics" />
      <div className="water-rays" />
      {bubbles.map((bubble, idx) => (
        <span
          key={idx}
          className="water-bubble"
          style={
            {
              left: `${bubble.left}%`,
              "--bubble-size": `${bubble.size}px`,
              "--bubble-duration": `${bubble.duration}s`,
              "--bubble-delay": `${bubble.delay}s`,
              "--bubble-opacity": bubble.opacity,
            } as CSSProperties
          }
        >
          <span
            className="water-bubble-inner"
            style={
              {
                "--bubble-sway": `${bubble.sway}s`,
                "--bubble-drift": `${bubble.drift}px`,
              } as CSSProperties
            }
          />
        </span>
      ))}
    </div>
  )
}
