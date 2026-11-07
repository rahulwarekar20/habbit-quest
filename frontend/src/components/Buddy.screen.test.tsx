import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { renderToStaticMarkup } from 'react-dom/server';
import Buddy from './Buddy';
import { BUDDY_CATALOG } from '../lib/buddyCatalog';
import type { BuddyId } from '../lib/family';
import legacyHashes from '../test/fixtures/legacyBuddyHashes.json';

afterEach(cleanup);

describe('shared buddy rendering', () => {
  it('preserves the exact four original SVGs and all eight original outfit vectors', () => {
    for (const entry of legacyHashes) {
      const markup=renderToStaticMarkup(<Buddy buddy={entry.buddy as BuddyId} accessory={entry.accessory} size={56}/>);
      expect(createHash('sha256').update(markup).digest('hex')).toBe(entry.sha256);
    }
  });
  it('loads the small portrait inline and only requests the full PNG when asked', () => {
    const {container,rerender}=render(<Buddy buddy="owl" selectionMode="catalog" catalogBuddyId="dot-bot" catalogVersion="0.1.0"/>);
    expect(screen.getByRole('img').getAttribute('aria-label')).toBe('Dot');
    expect(container.querySelector('img')?.getAttribute('src')).toMatch(/\/dot-bot\/icon.png$/);
    expect(container.querySelector('img')?.getAttribute('decoding')).toBe('async');
    rerender(<Buddy buddy="owl" selectionMode="catalog" catalogBuddyId="dot-bot" catalogVersion="0.1.0" representation="full"/>);
    expect(container.querySelector('img')?.getAttribute('src')).toMatch(/\/dot-bot\/image.png$/);
  });
  it('retains catalog identity and the equipped legacy fallback on a failed image, and recovers on a changed source', () => {
    const {container,rerender}=render(<Buddy buddy="bear" accessory="crown" selectionMode="catalog" catalogBuddyId="pippin-bear" catalogVersion="0.1.0"/>);
    fireEvent.error(container.querySelector('img')!);
    expect(screen.getByRole('img').getAttribute('aria-label')).toBe('Pippin (art unavailable)');
    expect(container.querySelector('[data-catalog-buddy-id]')?.getAttribute('data-catalog-buddy-id')).toBe('pippin-bear');
    expect(container.querySelector('svg path[fill="#FFC23D"]')).not.toBeNull();
    expect(container.querySelector('img')).toBeNull();
    rerender(<Buddy buddy="bear" accessory="crown" selectionMode="catalog" catalogBuddyId="nori-bunny" catalogVersion="0.1.0"/>);
    expect(screen.getByRole('img').getAttribute('aria-label')).toBe('Nori');
    expect(container.querySelector('img')).not.toBeNull();
    rerender(<Buddy buddy="bear" accessory="crown" selectionMode="catalog" catalogBuddyId="pippin-bear" catalogVersion="0.1.0"/>);
    expect(screen.getByRole('img').getAttribute('aria-label')).toBe('Pippin');
    expect(container.querySelector('img')).not.toBeNull();
    fireEvent.error(container.querySelector('img')!);
    rerender(<Buddy buddy="bear" accessory="crown" selectionMode="catalog" catalogBuddyId="pippin-bear" catalogVersion="9.0.0"/>);
    expect(container.querySelector('img')).toBeNull();
    rerender(<Buddy buddy="bear" accessory="crown" selectionMode="catalog" catalogBuddyId="pippin-bear" catalogVersion="0.1.0"/>);
    expect(container.querySelector('img')).not.toBeNull();
    rerender(<Buddy buddy="bear" accessory="crown" selectionMode="legacy" catalogBuddyId="nori-bunny"/>);
    expect(screen.getByRole('img').getAttribute('aria-label')).toBe('bear');
  });
  it('clears the previous artwork while a different character or representation loads', () => {
    const {container,rerender}=render(<Buddy buddy="fox" selectionMode="catalog" catalogBuddyId="nori-bunny" catalogVersion="0.1.0" representation="full"/>);
    const noriImage=container.querySelector('img');
    rerender(<Buddy buddy="fox" selectionMode="catalog" catalogBuddyId="nova-fox" catalogVersion="0.1.0" representation="full"/>);
    const novaImage=container.querySelector('img');
    expect(novaImage).not.toBe(noriImage);
    expect(noriImage?.isConnected).toBe(false);
    expect(novaImage?.getAttribute('src')).toMatch(/\/nova-fox\/image.png$/);
    expect(screen.getByRole('img').getAttribute('aria-label')).toBe('Nova');
    rerender(<Buddy buddy="fox" accessory="crown" selectionMode="catalog" catalogBuddyId="nova-fox" catalogVersion="0.1.0" representation="full"/>);
    expect(container.querySelector('img')).toBe(novaImage);
    rerender(<Buddy buddy="fox" selectionMode="catalog" catalogBuddyId="nova-fox" catalogVersion="0.1.0" representation="portrait"/>);
    expect(container.querySelector('img')).not.toBe(novaImage);
    expect(novaImage?.isConnected).toBe(false);
  });
  it('falls back safely for unknown metadata without rewriting the saved ID', () => {
    const {container}=render(<Buddy buddy="bunny" accessory="flower" selectionMode="catalog" catalogBuddyId="future-buddy" catalogVersion="9.0.0"/>);
    expect(container.querySelector('[data-catalog-buddy-id]')?.getAttribute('data-catalog-buddy-id')).toBe('future-buddy');
    expect(container.querySelector('svg')).not.toBeNull();
    expect(container.querySelector('img')).toBeNull();
  });
  it('composes every catalog/view/accessory and adapts robot hardware pads', () => {
    for (const record of BUDDY_CATALOG) for (const representation of ['portrait','full'] as const) for (const accessory of ['party-hat','crown','shades','bow','wizard','flower','headphones','halo']) {
      const markup=renderToStaticMarkup(<Buddy buddy="fox" selectionMode="catalog" catalogBuddyId={record.id} catalogVersion="0.1.0" representation={representation} accessory={accessory}/>);
      expect(markup).toContain(`data-accessory="${accessory}"`);
      expect(markup).not.toContain('NaN');
      expect(markup).toContain(record[representation].url);
      if (accessory==='headphones' && record.kind==='robot') expect(markup).toContain('data-fit="hardware-pads"');
    }
  });
});
