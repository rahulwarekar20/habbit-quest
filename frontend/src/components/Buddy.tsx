/**
 * Animal buddy avatars a child picks for themselves: fox, owl, bear or bunny. Buddies can wear
 * an accessory the child has collected from treasure chests (see ACCESSORIES in rewards.ts).
 */
import { useEffect, useState } from "react";
import type { BuddyId } from "../lib/family";
import { BUDDY_CATALOG_VERSION, getCatalogBuddy, type BuddyRepresentation } from "../lib/buddyCatalog";
import outfitAnchors from "../data/buddyOutfitAnchors.json";

/** The four buddies a child can pick, with their display names. */
export const BUDDIES: { id: BuddyId; name: string }[] = [
  { id: "fox", name: "Fox" },
  { id: "owl", name: "Owl" },
  { id: "bear", name: "Bear" },
  { id: "bunny", name: "Bunny" },
];

const BG: Record<BuddyId, string> = { fox: "#FFE3CC", owl: "#E6DEFF", bear: "#F3E2CF", bunny: "#FFE1EA" };

/** A buddy's face, drawn in SVG at `size` pixels, wearing an accessory from the wardrobe if given. */
function LegacyBuddy({ buddy, size = 56, accessory }: { buddy: BuddyId; size?: number; accessory?: string | null }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className="buddy" role="img" aria-label={buddy} overflow="visible">
      <circle cx="32" cy="32" r="32" fill={BG[buddy]} />
      {FACES[buddy]}
      {accessory && ACCESSORY_ART[accessory]?.(EYE_Y[buddy])}
    </svg>
  );
}

export interface BuddyProps {
  buddy: BuddyId;
  size?: number;
  accessory?: string | null;
  selectionMode?: 'legacy' | 'catalog';
  catalogBuddyId?: string | null;
  catalogVersion?: string | null;
  representation?: BuddyRepresentation;
  loading?: 'eager' | 'lazy';
}

/** The saved catalog identity remains intact if its metadata or image is unavailable. */
export default function Buddy({ buddy, size = 56, accessory, selectionMode = 'legacy', catalogBuddyId, catalogVersion, representation = 'portrait', loading = 'eager' }: BuddyProps) {
  const record = selectionMode === 'catalog' && catalogVersion === BUDDY_CATALOG_VERSION ? getCatalogBuddy(catalogBuddyId, catalogVersion) : undefined;
  const source = record?.[representation];
  const [failedSource, setFailedSource] = useState<string | null>(null);
  useEffect(() => { setFailedSource(null); }, [source?.url, catalogVersion]);
  if (!record || !source || source.url === failedSource) {
    if (selectionMode === 'catalog') return <span role="img" aria-label={record ? record.name + ' (art unavailable)' : 'Buddy (art unavailable)'} data-catalog-buddy-id={catalogBuddyId ?? undefined} style={{ display: 'inline-flex', width: size, height: size }}><span aria-hidden="true"><LegacyBuddy buddy={buddy} size={size} accessory={accessory}/></span></span>;
    return <LegacyBuddy buddy={buddy} size={size} accessory={accessory}/>;
  }
  return <span className="buddy buddy-catalog" role="img" aria-label={record.name} data-catalog-buddy-id={record.id} data-representation={representation} style={{ display:'inline-block', position:'relative', width:size, height:size, flexShrink:0, verticalAlign:'middle' }}>
    <img key={source.url} src={source.url} alt="" width={source.width} height={source.height} loading={loading} decoding="async" onError={() => setFailedSource(source.url)} style={{ display:'block', width:'100%', height:'100%', objectFit:'contain' }}/>
    {accessory && <svg width={size} height={size} viewBox="0 0 128 128" aria-hidden="true" overflow="visible" style={{ position:'absolute', inset:0, pointerEvents:'none' }}><CatalogAccessory id={record.id} view={representation} accessory={accessory}/></svg>}
  </span>;
}

interface HeadAnchor { eyes: number[]; top: number[]; width: number; ears?: number[]; headwearOffset?: number[]; sideOffset?: number[] }
const ANCHORS = outfitAnchors.buddies as Record<string, Record<BuddyRepresentation, HeadAnchor>>;
/** All placements use independently measured portrait/full landmarks in a 128-unit canvas. */
function CatalogAccessory({ id, view, accessory }: { id: string; view: BuddyRepresentation; accessory: string }) {
  const a = ANCHORS[id]?.[view];
  const art = ACCESSORY_ART[accessory];
  if (!a || !art) return null;
  const [lx, ly, rx, ry] = a.eyes;
  const angle = Math.atan2(ry-ly, rx-lx)*180/Math.PI;
  const eyeX = (lx+rx)/2, eyeY = (ly+ry)/2;
  let x = a.top[0], y = a.top[1], sx = a.width/40, sy = sx, originX = 32, originY = 14, rotation = angle;
  if (accessory === 'shades') { x=eyeX; y=eyeY; sx=Math.hypot(rx-lx,ry-ly)/18; sy=sx; originY=32; }
  else if (accessory === 'headphones') {
    const [elx,ely,erx,ery] = a.ears ?? [eyeX-a.width/2,eyeY,eyeX+a.width/2,eyeY];
    x=(elx+erx)/2; y=(ely+ery)/2; sx=Math.hypot(erx-elx,ery-ely)/41; sy=Math.max(.6,(y-a.top[1])/26); originY=32; rotation=Math.atan2(ery-ely,erx-elx)*180/Math.PI;
    // Robot pads cover the existing ear hardware rather than adding a second pair beside it.
    if (a.ears) return <g data-accessory={accessory} data-fit="hardware-pads" transform={`translate(${x} ${y}) rotate(${rotation}) scale(${sx} ${sy}) translate(-32 -32)`}>
      <path d="M11.5 32 Q11.5 6 32 6 Q52.5 6 52.5 32" fill="none" stroke="#241D4F" strokeWidth="3.5" strokeLinecap="round"/>
      <rect x="5" y="21" width="13" height="23" rx="6" fill="#241D4F"/>
      <rect x="46" y="21" width="13" height="23" rx="6" fill="#241D4F"/>
      <rect x="7" y="23" width="9" height="19" rx="4" fill="#7B5CF0"/>
      <rect x="48" y="23" width="9" height="19" rx="4" fill="#7B5CF0"/>
    </g>;
  }
  else if (accessory === 'bow' || accessory === 'flower') { x=a.top[0]+a.width*.35+(a.sideOffset?.[0] ?? 0); y=a.top[1]+a.width*.12+(a.sideOffset?.[1] ?? 0); sx=a.width/65; sy=sx; originX=accessory === 'bow' ? 46:47; originY=accessory === 'bow' ? 12:13; }
  else if (accessory === 'halo') { y-=a.width*.10; sx=a.width/40; sy=sx; originY=3; }
  else { x+=a.headwearOffset?.[0] ?? 0; y+=a.headwearOffset?.[1] ?? 0; if (accessory === 'party-hat') sx=Math.min(a.width/42, (y+8)/22); else if (accessory === 'wizard') { sx=Math.min(a.width/38, (y+8)/25); originY=15; } else if (accessory === 'crown') sx=a.width/38; sy=sx; }
  const vector = accessory === 'shades' && id === 'flux-rover' ? <g>
    <rect x="17" y="27.5" width="12" height="8" rx="3" fill="#241D4F" stroke="#B9A8EF" strokeWidth=".9"/>
    <rect x="35" y="27.5" width="12" height="8" rx="3" fill="#241D4F" stroke="#B9A8EF" strokeWidth=".9"/>
    <path d="M29 31 h6" stroke="#B9A8EF" strokeWidth="2"/>
    <path d="M19 29.5 l4 0" stroke="#fff" strokeWidth="1.2" opacity=".7"/>
  </g> : art(32);
  return <g data-accessory={accessory} data-fit="landmarks" transform={`translate(${x} ${y}) rotate(${rotation}) scale(${sx} ${sy}) translate(-${originX} -${originY})`}>{vector}</g>;
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
