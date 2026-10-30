/**
 * Animal buddy avatars a child picks for themselves: fox, owl, bear or bunny. Buddies can wear
 * an accessory the child has collected from treasure chests (see ACCESSORIES in rewards.ts).
 */
import type { BuddyId } from "../lib/family";

export const BUDDIES: { id: BuddyId; name: string }[] = [
  { id: "fox", name: "Fox" },
  { id: "owl", name: "Owl" },
  { id: "bear", name: "Bear" },
  { id: "bunny", name: "Bunny" },
];

const BG: Record<BuddyId, string> = { fox: "#FFE3CC", owl: "#E6DEFF", bear: "#F3E2CF", bunny: "#FFE1EA" };

export default function Buddy({ buddy, size = 56, accessory }: { buddy: BuddyId; size?: number; accessory?: string | null }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className="buddy" role="img" aria-label={buddy} overflow="visible">
      <circle cx="32" cy="32" r="32" fill={BG[buddy]} />
      {FACES[buddy]}
      {accessory && ACCESSORY_ART[accessory]?.(EYE_Y[buddy])}
    </svg>
  );
}

/** Where each buddy's eyes sit, so glasses and headphones line up. */
const EYE_Y: Record<BuddyId, number> = { fox: 33, owl: 32, bear: 31, bunny: 35 };

const ACCESSORY_ART: Record<string, (eyeY: number) => JSX.Element> = {
  "party-hat": () => (
    <g>
      <path d="M32 -4 L22 14 L42 14Z" fill="#FF6FA5" stroke="#E04B85" strokeWidth="1" />
      <path d="M27 5 L37 5 M24.5 10 L39.5 10" stroke="#FFE07A" strokeWidth="2.4" />
      <circle cx="32" cy="-5" r="3" fill="#FFC23D" />
    </g>
  ),
  crown: () => (
    <g>
      <path d="M20 14 L20 3 L26 9 L32 1 L38 9 L44 3 L44 14Z" fill="#FFC23D" stroke="#E58A12" strokeWidth="1.2" strokeLinejoin="round" />
      <circle cx="32" cy="9" r="1.8" fill="#FF6FA5" />
      <circle cx="25" cy="11" r="1.3" fill="#7B5CF0" />
      <circle cx="39" cy="11" r="1.3" fill="#7B5CF0" />
    </g>
  ),
  shades: (y) => (
    <g>
      <rect x="17" y={y - 4.5} width="12" height="8" rx="3" fill="#241D4F" />
      <rect x="35" y={y - 4.5} width="12" height="8" rx="3" fill="#241D4F" />
      <path d={`M29 ${y - 1} h6`} stroke="#241D4F" strokeWidth="2" />
      <path d={`M19 ${y - 2.5} l4 0`} stroke="#fff" strokeWidth="1.2" opacity=".7" />
    </g>
  ),
  bow: () => (
    <g transform="translate(46 12)">
      <path d="M0 0 L-9 -6 L-9 6Z M0 0 L9 -6 L9 6Z" fill="#FF6FA5" stroke="#E04B85" strokeWidth="1" strokeLinejoin="round" />
      <circle r="2.6" fill="#E04B85" />
    </g>
  ),
  wizard: () => (
    <g>
      <path d="M33 -10 L19 15 L45 15Z" fill="#5A3FC6" stroke="#3F2A9B" strokeWidth="1" />
      <ellipse cx="32" cy="15" rx="16" ry="3" fill="#3F2A9B" />
      <path d="M31 2 l1.2 2.4 2.6.4-1.9 1.8.5 2.6-2.4-1.3-2.3 1.3.4-2.6-1.9-1.8 2.6-.4Z" fill="#FFC23D" />
    </g>
  ),
  flower: () => (
    <g transform="translate(47 13)">
      {[0, 72, 144, 216, 288].map((a) => <ellipse key={a} cx="0" cy="-4.5" rx="3" ry="4.5" fill="#FFB3C6" transform={`rotate(${a})`} />)}
      <circle r="3" fill="#FFC23D" />
    </g>
  ),
  headphones: (y) => (
    <g>
      <path d={`M12 ${y} Q12 6 32 6 Q52 6 52 ${y}`} fill="none" stroke="#241D4F" strokeWidth="3.5" strokeLinecap="round" />
      <rect x="7" y={y - 6} width="9" height="13" rx="4" fill="#7B5CF0" />
      <rect x="48" y={y - 6} width="9" height="13" rx="4" fill="#7B5CF0" />
    </g>
  ),
  halo: () => (
    <g>
      <ellipse cx="32" cy="3" rx="13" ry="4" fill="none" stroke="#FFC23D" strokeWidth="3" />
      <path d="M45 -3 l1 2 2 .3-1.5 1.4.4 2-1.9-1-1.9 1 .4-2-1.5-1.4 2-.3Z" fill="#FFE07A" />
    </g>
  ),
};

const eyes = (y: number, color = "#2B2350") => (
  <>
    <circle cx="25" cy={y} r="3" fill={color} />
    <circle cx="39" cy={y} r="3" fill={color} />
    <circle cx="26" cy={y - 1} r="1" fill="#fff" />
    <circle cx="40" cy={y - 1} r="1" fill="#fff" />
  </>
);

const FACES: Record<BuddyId, JSX.Element> = {
  fox: (
    <>
      <path d="M14 14 L26 26 L16 32Z" fill="#F07A2E" />
      <path d="M50 14 L38 26 L48 32Z" fill="#F07A2E" />
      <path d="M12 30 Q32 10 52 30 Q50 50 32 54 Q14 50 12 30Z" fill="#F58A3C" />
      <path d="M18 38 Q32 34 46 38 Q42 52 32 54 Q22 52 18 38Z" fill="#fff" />
      {eyes(33)}
      <circle cx="32" cy="42" r="3" fill="#2B2350" />
    </>
  ),
  owl: (
    <>
      <path d="M16 16 L24 24 M48 16 L40 24" stroke="#5A3FC6" strokeWidth="5" strokeLinecap="round" />
      <ellipse cx="32" cy="36" rx="20" ry="20" fill="#7B5CF0" />
      <circle cx="25" cy="32" r="8" fill="#fff" />
      <circle cx="39" cy="32" r="8" fill="#fff" />
      {eyes(32)}
      <path d="M29 40 L35 40 L32 45Z" fill="#FFC23D" />
      <path d="M22 48 q10 6 20 0" stroke="#B9A8EF" strokeWidth="2" fill="none" />
    </>
  ),
  bear: (
    <>
      <circle cx="17" cy="18" r="7" fill="#A0703F" />
      <circle cx="47" cy="18" r="7" fill="#A0703F" />
      <circle cx="32" cy="35" r="20" fill="#B9834D" />
      <ellipse cx="32" cy="42" rx="9" ry="7" fill="#E8C49A" />
      {eyes(31)}
      <ellipse cx="32" cy="39" rx="3" ry="2.2" fill="#2B2350" />
    </>
  ),
  bunny: (
    <>
      <ellipse cx="24" cy="14" rx="5" ry="13" fill="#fff" stroke="#F5B8C8" strokeWidth="2" />
      <ellipse cx="40" cy="14" rx="5" ry="13" fill="#fff" stroke="#F5B8C8" strokeWidth="2" />
      <circle cx="32" cy="38" r="18" fill="#fff" />
      {eyes(35)}
      <circle cx="22" cy="42" r="3" fill="#FFB3C6" />
      <circle cx="42" cy="42" r="3" fill="#FFB3C6" />
      <path d="M30 41 h4 l-2 2z" fill="#FF8FAB" />
    </>
  ),
};
