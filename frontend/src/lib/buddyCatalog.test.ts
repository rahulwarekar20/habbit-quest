import { describe, expect, it } from 'vitest';
import parity from '../test/fixtures/buddySelectorParity.json';
import { BUDDY_CATALOG, BUDDY_CATALOG_VERSION, defaultCatalogBuddy, getCatalogBuddy, recommendBuddies, type BuddyRecommendationOptions } from './buddyCatalog';

describe('pinned public buddy catalog', () => {
  it('has 24 available cross-age characters and immutable portrait/full artwork', () => {
    expect(BUDDY_CATALOG_VERSION).toBe('0.1.0');
    expect(new Set(BUDDY_CATALOG.map(b => b.id)).size).toBe(24);
    for (const buddy of BUDDY_CATALOG) {
      expect(buddy.available).toBe(true);
      expect([buddy.supportedAgeMin, buddy.supportedAgeMax]).toEqual([3,13]);
      expect(buddy.portrait).toMatchObject({width:128,height:128});
      expect(buddy.full).toMatchObject({width:768,height:768});
      expect(buddy.portrait.url).toContain(`/catalog-0.1.0/art-0.1.0/9717ad52fb16/${buddy.id}/icon.png`);
      expect(buddy.full.url).toContain(`/catalog-0.1.0/art-0.1.0/9717ad52fb16/${buddy.id}/image.png`);
      expect(buddy).not.toHaveProperty('evidence');
      expect(buddy).not.toHaveProperty('choice_policy');
    }
  });
  it.each(parity)('matches the canonical selector for age $age with $options', ({age,options,expected}) => {
    expect(recommendBuddies(age,options as BuddyRecommendationOptions).map(({id,score})=>({id,score}))).toEqual(expected);
  });
  it('keeps a deterministic available default at every supported age', () => {
    for (let age=3;age<=13;age++) {
      expect(defaultCatalogBuddy(age)?.id).toBe(recommendBuddies(age)[0].id);
      expect(recommendBuddies(age,{limit:24})).toHaveLength(24);
    }
  });
  it('does not relax explicit exclusions or resolve unknown versions/IDs', () => {
    expect(recommendBuddies(8,{excludeIds:BUDDY_CATALOG.map(b=>b.id)})).toEqual([]);
    expect(getCatalogBuddy('dot-bot','0.2.0')).toBeUndefined();
    expect(getCatalogBuddy('unknown','0.1.0')).toBeUndefined();
    expect(()=>recommendBuddies(8,{limit:0})).toThrow();
  });
});
