/** The Spark: a four-point gold star used for rewards, counters and celebrations. */

export function SparkIcon({ size = 24, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="spark-gold" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#FFE58A" />
          <stop offset="0.55" stopColor="#FFC23D" />
          <stop offset="1" stopColor="#F29A1F" />
        </linearGradient>
      </defs>
      <path
        d="M12 1.5c.9 5.6 3.9 8.6 9.5 10.5-5.6 1.9-8.6 4.9-9.5 10.5-.9-5.6-3.9-8.6-9.5-10.5C8.1 10.1 11.1 7.1 12 1.5Z"
        fill="url(#spark-gold)"
        stroke="#E58A12"
        strokeWidth=".6"
      />
      <path d="M12 6c.4 2.4 1.5 3.7 3.7 4.5" stroke="#fff" strokeOpacity=".8" strokeWidth="1.1" fill="none" strokeLinecap="round" />
    </svg>
  );
}

/** "12 Sparks" pill used in headers and child cards. */
export function SparkCount({ count, large = false }: { count: number; large?: boolean }) {
  return (
    <span className={`spark-count ${large ? "spark-count--lg" : ""}`}>
      <SparkIcon size={large ? 30 : 18} />
      <b>{count}</b> {count === 1 ? "Spark" : "Sparks"}
    </span>
  );
}
