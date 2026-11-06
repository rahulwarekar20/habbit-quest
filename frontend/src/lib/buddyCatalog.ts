import manifest from '../data/buddyCatalog.json';

export const BUDDY_CATALOG_VERSION = '0.1.0';
export type BuddyRepresentation = 'portrait' | 'full';
export interface BuddyAsset { url: string; width: number; height: number; alt: string }
export interface CatalogBuddy {
  id: string; name: string; kind: string; groupId: string; speciesOrForm: string;
  primaryAgeBand: string; supportedAgeMin: number; supportedAgeMax: number;
  tone: string; interestTags: string[]; description: string; visualComplexity: string;
  altText: string; available: boolean; portrait: BuddyAsset; full: BuddyAsset;
}
export const BUDDY_CATALOG: readonly CatalogBuddy[] = manifest.buddies;
export function getCatalogBuddy(id?: string | null, version?: string | null): CatalogBuddy | undefined {
  if (version != null && version !== BUDDY_CATALOG_VERSION) return undefined;
  return BUDDY_CATALOG.find(buddy => buddy.id === id && buddy.available);
}
export interface BuddyRecommendationOptions {
  interests?: readonly string[]; tones?: readonly string[]; excludeIds?: readonly string[];
  excludeKinds?: readonly string[]; excludeGroups?: readonly string[]; excludeInterests?: readonly string[];
  maxVisualComplexity?: 'low' | 'moderate'; limit?: number; diversifyGroups?: boolean; preferredId?: string;
}
export interface RankedBuddy extends CatalogBuddy { score: number | null }
const normalize = (value: string) => value.toLocaleLowerCase('en-US').replaceAll('-', ' ').trim().replace(/\s+/g, ' ');
/** Pure public-attribute ranking. Age bands add one point; every supported age keeps all characters. */
export function recommendBuddies(age: number, options: BuddyRecommendationOptions = {}): RankedBuddy[] {
  if (!Number.isInteger(age) || age < 3 || age > 13) return [];
  const limit = options.limit ?? 3;
  if (!Number.isInteger(limit) || limit < 1 || limit > 24) throw new Error('Buddy limit must be an integer from 1 to 24');
  const interests = new Set(options.interests?.map(normalize));
  const tones = new Set(options.tones?.map(normalize));
  const excludedInterests = new Set(options.excludeInterests?.map(normalize));
  const ranked = BUDDY_CATALOG.filter(r => r.available && r.supportedAgeMin <= age && age <= r.supportedAgeMax
    && !options.excludeIds?.includes(r.id) && !options.excludeKinds?.includes(r.kind) && !options.excludeGroups?.includes(r.groupId)
    && !r.interestTags.some(tag => excludedInterests.has(normalize(tag)))
    && !(options.maxVisualComplexity === 'low' && r.visualComplexity !== 'low'))
    .map(r => {
      const [low, high] = r.primaryAgeBand.split('-').map(Number);
      const matches = new Set(r.interestTags.map(normalize).filter(tag => interests.has(tag))).size;
      return { ...r, score: matches * 3 + (tones.has(normalize(r.tone)) ? 2 : 0) + (low <= age && age <= high ? 1 : 0) };
    }).sort((a,b) => b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  if (options.preferredId) {
    const preferred = ranked.find(r => r.id === options.preferredId);
    return preferred ? [{ ...preferred, score: null }] : [];
  }
  const chosen: RankedBuddy[] = [];
  if (options.diversifyGroups !== false) {
    const seen = new Set<string>();
    for (const buddy of ranked) if (!seen.has(buddy.groupId) && chosen.length < limit) { chosen.push(buddy); seen.add(buddy.groupId); }
  }
  for (const buddy of ranked) if (chosen.length < limit && !chosen.some(r => r.id === buddy.id)) chosen.push(buddy);
  return chosen;
}
/** New-child provisional default only; existing saved choices always take precedence. */
export function defaultCatalogBuddy(age: number): CatalogBuddy | undefined { return recommendBuddies(age, { limit: 1 })[0]; }
