/**
 * Picture for each quest: a small illustrated scene so children who can't read yet
 * still know what the quest is. Routine habits have hand-drawn scenes; bonus quests from
 * the library get their emoji on a soft scene coloured by category. Pure SVG, no image files.
 */
import { QUEST_BY_ID, isHabitId, type Category, type HabitId } from "../lib/habits";

export default function HabitArt({ habit, className = "" }: { habit: string; className?: string }) {
  if (!isHabitId(habit)) return <BonusArt quest={habit} className={className} />;
  return (
    <svg viewBox="0 0 160 120" preserveAspectRatio="xMidYMid slice" className={`habit-art ${className}`} role="img" aria-label={LABELS[habit]}>
      {SCENES[habit]}
    </svg>
  );
}

const CATEGORY_COLORS: Record<Category, [string, string]> = {
  routine: ["#EFE9FF", "#D9CCFF"], sleep: ["#3C2F8F", "#6A55D6"], health: ["#E3F4EA", "#B9E4C7"],
  learning: ["#FFF4D6", "#FFDD8A"], home: ["#FFE6D6", "#FFC7A3"], kindness: ["#FFE1EA", "#FFB8CB"],
  feelings: ["#E6F0FF", "#BFD6FF"], active: ["#DFF6F2", "#A8E6DA"], screen: ["#EDEBFA", "#C9C3F0"],
};

function BonusArt({ quest, className }: { quest: string; className: string }) {
  const q = QUEST_BY_ID[quest];
  const [a, b] = CATEGORY_COLORS[q?.category ?? "routine"];
  const id = `ba-${quest}`;
  return (
    <svg viewBox="0 0 160 120" preserveAspectRatio="xMidYMid slice" className={`habit-art ${className}`} role="img" aria-label={q?.kidTitle ?? quest}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={a} />
          <stop offset="1" stopColor={b} />
        </linearGradient>
      </defs>
      <rect width="160" height="120" fill={`url(#${id})`} />
      <circle cx="26" cy="24" r="10" fill="#fff" opacity="0.35" />
      <circle cx="136" cy="96" r="16" fill="#fff" opacity="0.25" />
      <circle cx="80" cy="62" r="38" fill="#fff" opacity="0.55" />
      <text x="80" y="64" textAnchor="middle" dominantBaseline="central" fontSize="46">{q?.emoji ?? "⭐"}</text>
    </svg>
  );
}

const LABELS: Record<HabitId, string> = {
  wake: "Sun rising over the hills with an alarm clock",
  lunch: "A lunch plate with rice, vegetables and fruit",
  homework: "An open notebook with a pencil",
  screen: "A tablet resting while a ball waits to be played with",
  dinner: "A warm dinner bowl in the evening",
  bedtime: "A cosy bed under the moon and stars",
};

const SCENES: Record<HabitId, JSX.Element> = {
  wake: (
    <>
      <defs>
        <linearGradient id="ha-wake-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#FFB990" />
          <stop offset="1" stopColor="#FFE9C2" />
        </linearGradient>
      </defs>
      <rect width="160" height="120" fill="url(#ha-wake-sky)" />
      <g stroke="#FFC23D" strokeWidth="4" strokeLinecap="round">
        <line x1="70" y1="30" x2="70" y2="20" />
        <line x1="44" y1="42" x2="37" y2="35" />
        <line x1="96" y1="42" x2="103" y2="35" />
        <line x1="34" y1="66" x2="24" y2="66" />
        <line x1="106" y1="66" x2="116" y2="66" />
      </g>
      <circle cx="70" cy="72" r="30" fill="#FFB627" />
      <circle cx="70" cy="72" r="22" fill="#FFCE52" />
      <path d="M0 86 Q40 66 82 84 T160 78 V120 H0Z" fill="#7CCB7E" />
      <path d="M0 98 Q50 84 100 100 T160 96 V120 H0Z" fill="#5DB467" />
      <g transform="translate(126 38)">
        <circle r="17" fill="#fff" stroke="#7B5CF0" strokeWidth="4" />
        <circle cx="-12" cy="-15" r="5" fill="#7B5CF0" />
        <circle cx="12" cy="-15" r="5" fill="#7B5CF0" />
        <line x1="0" y1="0" x2="0" y2="-10" stroke="#2B2350" strokeWidth="3" strokeLinecap="round" />
        <line x1="0" y1="0" x2="7" y2="3" stroke="#2B2350" strokeWidth="3" strokeLinecap="round" />
      </g>
    </>
  ),
  lunch: (
    <>
      <rect width="160" height="120" fill="#FFF3D9" />
      <circle cx="140" cy="18" r="10" fill="#FFC23D" />
      <rect x="0" y="86" width="160" height="34" fill="#F6D9A8" />
      <ellipse cx="80" cy="78" rx="52" ry="30" fill="#E9E4F7" />
      <ellipse cx="80" cy="74" rx="44" ry="24" fill="#fff" />
      <ellipse cx="66" cy="72" rx="16" ry="10" fill="#FFF8EC" stroke="#F0E2C8" strokeWidth="1.5" />
      <circle cx="94" cy="68" r="5" fill="#5DB467" />
      <circle cx="101" cy="74" r="5" fill="#4CA65A" />
      <circle cx="90" cy="77" r="5" fill="#6CC277" />
      <path d="M76 84 q10 -14 22 0 z" fill="#FF8A4C" />
      <rect x="22" y="58" width="5" height="38" rx="2.5" fill="#B9A8EF" />
      <rect x="133" y="58" width="5" height="38" rx="2.5" fill="#B9A8EF" />
    </>
  ),
  homework: (
    <>
      <rect width="160" height="120" fill="#E3F4EA" />
      <circle cx="24" cy="22" r="6" fill="#BDE6CB" />
      <circle cx="138" cy="98" r="9" fill="#BDE6CB" />
      <g transform="rotate(-6 80 62)">
        <rect x="34" y="30" width="92" height="64" rx="6" fill="#7B5CF0" />
        <rect x="38" y="33" width="41" height="58" rx="3" fill="#fff" />
        <rect x="81" y="33" width="41" height="58" rx="3" fill="#fff" />
        <g stroke="#CFC6F5" strokeWidth="2">
          <line x1="44" y1="46" x2="73" y2="46" />
          <line x1="44" y1="56" x2="73" y2="56" />
          <line x1="44" y1="66" x2="68" y2="66" />
          <line x1="87" y1="46" x2="116" y2="46" />
          <line x1="87" y1="56" x2="110" y2="56" />
        </g>
        <path d="M89 70 l6 6 l12 -14" stroke="#4CA65A" strokeWidth="4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </g>
      <g transform="translate(112 74) rotate(35)">
        <rect x="0" y="-5" width="36" height="10" rx="2" fill="#FFC23D" />
        <rect x="30" y="-5" width="8" height="10" fill="#FF9AA2" />
        <path d="M0 -5 L-10 0 L0 5Z" fill="#F6D9A8" />
        <path d="M-6 -2 L-10 0 L-6 2Z" fill="#2B2350" />
      </g>
    </>
  ),
  screen: (
    <>
      <rect width="160" height="120" fill="#DDEFFF" />
      <circle cx="22" cy="20" r="7" fill="#BFE0FF" />
      <rect x="0" y="94" width="160" height="26" fill="#C8E6C9" />
      <rect x="40" y="22" width="56" height="76" rx="9" fill="#2B2350" />
      <rect x="45" y="29" width="46" height="60" rx="4" fill="#9CC9FF" />
      <g transform="translate(68 59)">
        <path d="M-10 -16 h20 l-8 14 l8 14 h-20 l8 -14z" fill="#fff" />
        <path d="M-5 -10 h10 l-5 8z" fill="#FFC23D" />
        <path d="M-6 13 h12 l-6 -6z" fill="#FFC23D" />
      </g>
      <circle cx="68" cy="93" r="2" fill="#5A4E9C" />
      <g transform="translate(124 84)">
        <circle r="17" fill="#FF6F61" />
        <path d="M-17 0 a17 17 0 0 0 34 0" fill="#FF8C7F" />
        <path d="M-12 -12 q12 10 0 24 M12 -12 q-12 10 0 24" stroke="#fff" strokeWidth="2.5" fill="none" />
      </g>
    </>
  ),
  dinner: (
    <>
      <defs>
        <linearGradient id="ha-dinner-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#B9A2F5" />
          <stop offset="1" stopColor="#FFC9A3" />
        </linearGradient>
      </defs>
      <rect width="160" height="120" fill="url(#ha-dinner-sky)" />
      <circle cx="132" cy="24" r="9" fill="#FFF4CF" />
      <rect x="0" y="84" width="160" height="36" fill="#E8C49A" />
      <g stroke="#fff" strokeWidth="3" strokeLinecap="round" fill="none" opacity=".85">
        <path d="M66 30 q-6 -8 0 -16" />
        <path d="M80 28 q-6 -8 0 -16" />
        <path d="M94 30 q-6 -8 0 -16" />
      </g>
      <ellipse cx="80" cy="84" rx="50" ry="12" fill="#D9CFF6" />
      <path d="M38 52 h84 a42 34 0 0 1 -84 0z" fill="#7B5CF0" />
      <ellipse cx="80" cy="52" rx="42" ry="9" fill="#FFB65C" />
      <circle cx="66" cy="50" r="5" fill="#5DB467" />
      <circle cx="88" cy="51" r="4" fill="#FF7A59" />
      <circle cx="98" cy="49" r="4" fill="#5DB467" />
    </>
  ),
  bedtime: (
    <>
      <defs>
        <linearGradient id="ha-bed-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2E2A6B" />
          <stop offset="1" stopColor="#5D4FB8" />
        </linearGradient>
      </defs>
      <rect width="160" height="120" fill="url(#ha-bed-sky)" />
      <path d="M128 14 a16 16 0 1 0 14 24 a13 13 0 1 1 -14 -24z" fill="#FFE58A" />
      <g fill="#FFF4CF">
        <circle cx="26" cy="18" r="2" />
        <circle cx="62" cy="12" r="1.6" />
        <circle cx="96" cy="26" r="2.2" />
        <circle cx="46" cy="38" r="1.4" />
        <circle cx="112" cy="50" r="1.5" />
      </g>
      <rect x="18" y="62" width="10" height="44" rx="4" fill="#C49A6C" />
      <rect x="132" y="74" width="10" height="32" rx="4" fill="#C49A6C" />
      <rect x="22" y="80" width="116" height="20" rx="6" fill="#E9DFFF" />
      <ellipse cx="44" cy="76" rx="16" ry="9" fill="#fff" />
      <path d="M50 70 h84 a6 6 0 0 1 6 6 v14 h-90z" fill="#FF9AA2" />
      <circle cx="46" cy="68" r="10" fill="#FFD7B5" />
      <path d="M38 64 a10 10 0 0 1 16 -2" stroke="#6B4A2F" strokeWidth="4" fill="none" strokeLinecap="round" />
      <path d="M42 69 q2 2 4 0 M48 69 q2 2 4 0" stroke="#2B2350" strokeWidth="1.5" fill="none" strokeLinecap="round" />
      <text x="62" y="58" fill="#FFF4CF" fontSize="12" fontWeight="700" fontFamily="Fredoka, sans-serif">z</text>
      <text x="72" y="48" fill="#FFF4CF" fontSize="15" fontWeight="700" fontFamily="Fredoka, sans-serif">z</text>
    </>
  ),
};
