/**
 * CardView tests — covers the shared card surface: metadata strip at INDEX
 * (no prose body), markdown body at SUMMARY/STANDARD/DEEP, the embedded LoD
 * switcher when onLodChange is supplied, sessionStorage persistence, and the
 * 'Copy as markdown' button writing to the clipboard.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, act } from '@testing-library/react';
import type { CardResponse } from '@/lib/schemas';
import { CardView } from '@/components/card-view';
import { HomeCard } from '@/components/home-card';
import { LOD_STORAGE_KEY } from '@/lib/use-lod-persistence';

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
});

function fixtureCard(overrides: Partial<CardResponse> = {}): CardResponse {
  return {
    conceptPath: '.',
    kind: 'repository',
    lod: 'standard',
    content: '# Title\n\nBody paragraph with `code` inline.',
    metadata: { generated_at: '2026-05-25T12:00:00Z', commit: 'abc1234' },
    ...overrides,
  };
}

describe('CardView', () => {
  it('renders metadata strip without prose body at INDEX', () => {
    render(<CardView card={fixtureCard({ lod: 'index' })} />);
    expect(screen.getByTestId('card-metadata')).toHaveTextContent('abc1234');
    expect(screen.queryByTestId('card-body')).not.toBeInTheDocument();
  });

  it('renders markdown body at STANDARD', () => {
    render(<CardView card={fixtureCard({ lod: 'standard' })} />);
    expect(screen.getByTestId('card-body')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Title' })).toBeInTheDocument();
  });

  it('renders the LoD switcher only when onLodChange is provided', () => {
    const { rerender } = render(<CardView card={fixtureCard()} />);
    expect(screen.queryByTestId('lod-switcher')).not.toBeInTheDocument();
    rerender(<CardView card={fixtureCard()} lod="standard" onLodChange={() => undefined} />);
    expect(screen.getByTestId('lod-switcher')).toBeInTheDocument();
  });

  it('copy button writes the raw markdown to the clipboard and shows a toast', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    render(<CardView card={fixtureCard()} />);
    fireEvent.click(screen.getByTestId('card-copy'));

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(writeText).toHaveBeenCalledWith(fixtureCard().content);
    expect(await screen.findByTestId('card-toast')).toHaveTextContent('Copied');
  });

  it('shows a failure toast when the clipboard rejects', async () => {
    const writeText = vi.fn(async () => {
      throw new Error('denied');
    });
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    render(<CardView card={fixtureCard()} />);
    fireEvent.click(screen.getByTestId('card-copy'));

    expect(await screen.findByTestId('card-toast')).toHaveTextContent('Copy failed');
  });
});

describe('LoD persistence', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it('restores the LoD from sessionStorage when HomeCard remounts', async () => {
    const client = {
      getCard: vi.fn(async (_path: string, lod?: string) =>
        fixtureCard({ lod: (lod ?? 'standard') as CardResponse['lod'] }),
      ),
    };

    const first = render(<HomeCard client={client} />);
    await screen.findByTestId('card-view');

    await act(async () => {
      fireEvent.click(screen.getByTestId('lod-deep'));
    });
    await waitFor(() =>
      expect(client.getCard).toHaveBeenLastCalledWith('repository', 'deep', undefined),
    );

    expect(window.sessionStorage.getItem(LOD_STORAGE_KEY)).toBe('deep');

    first.unmount();
    client.getCard.mockClear();

    render(<HomeCard client={client} />);
    await waitFor(() =>
      expect(client.getCard).toHaveBeenLastCalledWith('repository', 'deep', undefined),
    );
  });

  it('ignores garbage values in sessionStorage', async () => {
    window.sessionStorage.setItem(LOD_STORAGE_KEY, 'not-a-real-level');
    const client = {
      getCard: vi.fn(async (_path: string, lod?: string) =>
        fixtureCard({ lod: (lod ?? 'standard') as CardResponse['lod'] }),
      ),
    };
    render(<HomeCard client={client} />);
    await waitFor(() =>
      expect(client.getCard).toHaveBeenLastCalledWith('repository', 'standard', undefined),
    );
  });
});
