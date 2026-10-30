/**
 * Layered 2D scenes for the three worlds: Starter Camp, Mosswood Forest and Sky Islands.
 * Used on the home page, the kid screen and the explore page.
 */
import type { WorldId } from "../lib/family";

export default function WorldArt({ world, className = "" }: { world: WorldId; className?: string }) {
  return (
    <svg viewBox="0 0 320 180" preserveAspectRatio="xMidYMid slice" className={`world-art ${className}`} aria-hidden="true">
      {SCENES[world]}
    </svg>
  );
}

const pine = (x: number, y: number, s: number, c: string) => (
  <path key={`${x}-${y}`} d={`M${x} ${y - 46 * s} L${x + 18 * s} ${y} H${x - 18 * s}Z`} fill={c} />
);

const SCENES: Record<WorldId, JSX.Element> = {
  camp: (
    <>
      <defs>
        <linearGradient id="wa-camp" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#3B2F7A" />
          <stop offset=".65" stopColor="#B06AB3" />
          <stop offset="1" stopColor="#FFB38A" />
        </linearGradient>
        <radialGradient id="wa-fire" cx=".5" cy=".5" r=".5">
          <stop offset="0" stopColor="#FFE58A" stopOpacity=".9" />
          <stop offset="1" stopColor="#FF8A4C" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="320" height="180" fill="url(#wa-camp)" />
      <g fill="#FFF4CF">
        <circle cx="40" cy="22" r="1.6" /><circle cx="110" cy="14" r="1.2" /><circle cx="210" cy="26" r="1.8" />
        <circle cx="270" cy="12" r="1.3" /><circle cx="160" cy="36" r="1" />
      </g>
      <circle cx="262" cy="40" r="14" fill="#FFF4CF" />
      <path d="M0 120 Q80 96 160 116 T320 108 V180 H0Z" fill="#4E3E8F" />
      {[20, 52, 280, 306].map((x, i) => pine(x, 132, 1.1 + (i % 2) * 0.2, "#2F2766"))}
      <path d="M0 140 Q90 124 180 140 T320 136 V180 H0Z" fill="#3A6E4F" />
      <path d="M92 142 L122 98 L152 142Z" fill="#FF8A4C" />
      <path d="M122 98 L132 142 H112Z" fill="#E86A33" />
      <circle cx="196" cy="140" r="34" fill="url(#wa-fire)" />
      <path d="M186 146 q10 -30 10 -30 q8 18 10 30z" fill="#FFC23D" />
      <path d="M191 146 q5 -16 5 -16 q4 10 5 16z" fill="#FFF4CF" />
      <rect x="180" y="146" width="32" height="5" rx="2.5" fill="#7A4E2D" />
    </>
  ),
  mosswood: (
    <>
      <defs>
        <linearGradient id="wa-moss" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#BDEBC4" />
          <stop offset="1" stopColor="#4FA36A" />
        </linearGradient>
        <radialGradient id="wa-portal" cx=".5" cy=".5" r=".5">
          <stop offset="0" stopColor="#F3E8FF" />
          <stop offset=".5" stopColor="#B57CFF" />
          <stop offset="1" stopColor="#6B3FD6" />
        </radialGradient>
      </defs>
      <rect width="320" height="180" fill="url(#wa-moss)" />
      <g fill="#FFFBE0" opacity=".55">
        <path d="M70 0 L110 0 L170 180 L120 180Z" />
        <path d="M200 0 L226 0 L262 180 L228 180Z" />
      </g>
      <rect x="20" y="10" width="34" height="170" rx="10" fill="#6B4A2F" />
      <circle cx="37" cy="20" r="46" fill="#2F7D4C" />
      <rect x="262" y="0" width="38" height="180" rx="10" fill="#5A3E28" />
      <circle cx="282" cy="16" r="52" fill="#2A6E43" />
      <ellipse cx="160" cy="92" rx="26" ry="36" fill="#6B4A2F" />
      <ellipse cx="160" cy="92" rx="20" ry="30" fill="url(#wa-portal)" />
      <path d="M0 150 Q80 132 160 148 T320 142 V180 H0Z" fill="#3E8A57" />
      <g>
        <rect x="56" y="140" width="6" height="14" rx="3" fill="#FFF4CF" />
        <ellipse cx="59" cy="140" rx="13" ry="8" fill="#9B7CFF" />
        <circle cx="54" cy="138" r="2" fill="#fff" /><circle cx="63" cy="137" r="1.6" fill="#fff" />
      </g>
      <g transform="translate(222 138)">
        <ellipse cx="0" cy="8" rx="14" ry="9" fill="#F58A3C" />
        <circle cx="12" cy="-2" r="8" fill="#F58A3C" />
        <path d="M7 -9 L9 -16 L13 -9Z M14 -9 L17 -16 L19 -8Z" fill="#E86A33" />
        <path d="M-14 6 q-12 -2 -14 -10 q8 4 14 2z" fill="#F58A3C" />
        <circle cx="15" cy="-3" r="1.4" fill="#2B2350" />
      </g>
    </>
  ),
  sky: (
    <>
      <defs>
        <linearGradient id="wa-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#A9C8FF" />
          <stop offset=".6" stopColor="#F3D6FF" />
          <stop offset="1" stopColor="#FFE3C7" />
        </linearGradient>
      </defs>
      <rect width="320" height="180" fill="url(#wa-sky)" />
      <g fill="#fff" opacity=".9">
        <ellipse cx="60" cy="150" rx="70" ry="22" /><ellipse cx="260" cy="160" rx="80" ry="24" />
        <ellipse cx="160" cy="170" rx="90" ry="20" />
      </g>
      <path d="M110 92 h100 l-20 34 q-30 16 -60 0z" fill="#9C7A5B" />
      <path d="M108 86 h104 v10 h-104z" fill="#6CC277" />
      <rect x="146" y="50" width="28" height="38" fill="#F3E8FF" />
      <path d="M142 52 L160 34 L178 52Z" fill="#7B5CF0" />
      <rect x="128" y="62" width="14" height="26" fill="#E9DFFF" />
      <path d="M126 64 L135 52 L144 64Z" fill="#9B7CFF" />
      <rect x="156" y="70" width="8" height="18" rx="4" fill="#7B5CF0" />
      <path d="M126 126 q4 20 0 40" stroke="#8FD3FF" strokeWidth="6" fill="none" opacity=".8" />
      <path d="M30 70 h48 l-10 18 q-14 8 -28 0z" fill="#9C7A5B" />
      <path d="M28 66 h52 v7 h-52z" fill="#6CC277" />
      <g transform="translate(258 44)">
        <ellipse cx="0" cy="0" rx="22" ry="25" fill="#FF8A8A" />
        <path d="M-8 -24 q-6 24 0 48 M8 -24 q6 24 0 48" stroke="#FFC23D" strokeWidth="3" fill="none" />
        <line x1="-10" y1="22" x2="-8" y2="34" stroke="#6B4A2F" strokeWidth="1.5" />
        <line x1="10" y1="22" x2="8" y2="34" stroke="#6B4A2F" strokeWidth="1.5" />
        <rect x="-10" y="34" width="20" height="10" rx="3" fill="#9C6B3F" />
      </g>
      <g transform="translate(48 30) rotate(-12)">
        <path d="M0 -14 L12 0 L0 14 L-12 0Z" fill="#FF8FAB" />
        <path d="M0 -14 L0 14 M-12 0 L12 0" stroke="#fff" strokeWidth="1.2" />
        <path d="M0 14 q4 10 -2 18 q6 6 0 14" stroke="#7B5CF0" strokeWidth="1.5" fill="none" />
      </g>
    </>
  ),
};
