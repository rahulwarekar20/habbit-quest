/** Analog clock face for a quest time ("07:30"), so children can match it to a real clock. */

export default function Clock({ time, size = 52 }: { time: string; size?: number }) {
  const [h, m] = time.split(":").map(Number);
  const minuteAngle = m * 6;
  const hourAngle = (h % 12) * 30 + m * 0.5;
  const night = h >= 19 || h < 6;
  return (
    <svg width={size} height={size} viewBox="0 0 60 60" className="clock" aria-hidden="true">
      <circle cx="30" cy="30" r="27" fill={night ? "#2E2A6B" : "#fff"} stroke="#7B5CF0" strokeWidth="4" />
      {Array.from({ length: 12 }, (_, i) => (
        <circle
          key={i}
          cx={30 + 20 * Math.sin((i * Math.PI) / 6)}
          cy={30 - 20 * Math.cos((i * Math.PI) / 6)}
          r={i % 3 === 0 ? 2 : 1.1}
          fill={night ? "#FFE58A" : "#B9A8EF"}
        />
      ))}
      <line x1="30" y1="30" x2="30" y2="17" stroke={night ? "#fff" : "#2B2350"} strokeWidth="4" strokeLinecap="round"
        transform={`rotate(${hourAngle} 30 30)`} />
      <line x1="30" y1="30" x2="30" y2="11" stroke="#FF8A4C" strokeWidth="2.6" strokeLinecap="round"
        transform={`rotate(${minuteAngle} 30 30)`} />
      <circle cx="30" cy="30" r="3" fill="#FFC23D" />
    </svg>
  );
}
