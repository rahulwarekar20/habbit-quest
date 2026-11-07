/** Real provider regression: delayed list responses must preserve the newest adopted buddy. */
import '../test/renderApp';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { defaultState, startFakeServer } from '../test/fakeServer';
import type { ApiChild } from './api';
import { addChild, newChild } from './family';
import { loadSaved, persist, saveCaregiverToken } from './storage';
import { StoreProvider, useStore } from './store';
import { emptyFamily } from './testing';

const catalogFields = (id: string, revision: number) => ({
  buddy: 'fox' as const, buddy_selection_mode: 'catalog' as const,
  catalog_buddy_id: id, buddy_catalog_version: '0.1.0', buddy_selection_revision: revision,
});

describe('buddy revisions in the live store provider', () => {
  it('keeps an adopted revision 5 through a delayed revision 4 response and browser refresh', async () => {
    const state = defaultState();
    Object.assign(state.children[0], catalogFields('ember-fox', 3));
    startFakeServer(state);
    saveCaregiverToken('parent-token', 3600);
    const savedChild = { ...newChild('Alex', 8, 'fox'), id: 'c1', buddySelectionMode: 'catalog' as const,
      catalogBuddyId: 'ember-fox', buddyCatalogVersion: '0.1.0', buddySelectionRevision: 3 };
    persist({ families: { f1: addChild(emptyFamily(), savedChild) },
      snapshot: { me: state.me, server: state.family!, children: state.children } });

    // Other routes still use the ordinary fake API. Only the two concurrent child lists wait.
    const fakeFetch = globalThis.fetch;
    let delayChildren = false;
    const pending: ((children: ApiChild[]) => void)[] = [];
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (delayChildren && (init?.method ?? 'GET') === 'GET'
        && new URL(url, 'http://api.test').pathname === '/v1/families/f1/children') {
        return new Promise<Response>(resolve => pending.push(children => resolve(new Response(JSON.stringify(children), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        }))));
      }
      return fakeFetch(input, init);
    });

    const reloads: Promise<void>[] = [];
    function Probe() {
      const { family, phase, reload } = useStore();
      const child = family?.children[0];
      return <>
        <output aria-label="Current buddy">{phase}:{child?.catalogBuddyId}:{child?.buddySelectionRevision}</output>
        <button type="button" onClick={() => { reloads.push(reload()); }}>Reload family</button>
      </>;
    }
    const first = render(<StoreProvider><Probe /></StoreProvider>);
    await waitFor(() => expect(screen.getByLabelText('Current buddy')).toHaveTextContent('ready:ember-fox:3'));

    delayChildren = true;
    fireEvent.click(screen.getByRole('button', { name: 'Reload family' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reload family' }));
    await waitFor(() => expect(pending).toHaveLength(2));

    await act(async () => {
      pending[0]([{ ...state.children[0], ...catalogFields('dot-bot', 5) }]);
      await reloads[0];
    });
    expect(screen.getByLabelText('Current buddy')).toHaveTextContent('ready:dot-bot:5');
    expect(loadSaved().families.f1.children[0]).toMatchObject({ catalogBuddyId: 'dot-bot', buddySelectionRevision: 5 });

    await act(async () => {
      pending[1]([{ ...state.children[0], ...catalogFields('pippin-bear', 4) }]);
      await reloads[1];
    });
    expect(screen.getByLabelText('Current buddy')).toHaveTextContent('ready:dot-bot:5');
    expect(loadSaved().families.f1.children[0]).toMatchObject({ catalogBuddyId: 'dot-bot', buddySelectionRevision: 5 });

    // A fresh provider reads browser storage; even another stale list cannot undo the saved choice.
    first.unmount();
    delayChildren = false;
    Object.assign(state.children[0], catalogFields('pippin-bear', 4));
    render(<StoreProvider><Probe /></StoreProvider>);
    await waitFor(() => expect(screen.getByLabelText('Current buddy')).toHaveTextContent('ready:dot-bot:5'));
    expect(loadSaved().families.f1.children[0]).toMatchObject({ catalogBuddyId: 'dot-bot', buddySelectionRevision: 5 });
  });
});
