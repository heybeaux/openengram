/**
 * Component tests for the home card.
 *
 * The home card owns the loading/empty/error/success state machine. We mock
 * the EngramCodeApi client (via the `client` prop) so each test can drive a
 * specific state without hitting the network.
 */

import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';
import { ApiError } from '@/lib/api';
import type { CardResponse, LodLevel } from '@/lib/schemas';
import { HomeCard } from '@/components/home-card';

afterEach(cleanup);

function fixtureCard(overrides: Partial<CardResponse> = {}): CardResponse {
  return {
    conceptPath: '.',
    kind: 'repository',
    lod: 'standard',
    content:
      '# engram-code\n\nA type-aware, time-aware code memory faculty.\n\n## What it does\n\n- Synthesises repository cards\n- Answers concept queries',
    metadata: { generated_at: '2026-05-25T12:00:00Z', commit: 'abc1234' },
    ...overrides,
  };
}

function makeClient(impl: (lod: LodLevel | undefined) => Promise<CardResponse>) {
  return {
    getCard: vi.fn(async (_path: string, lod?: LodLevel) => impl(lod)),
  };
}

describe('HomeCard', () => {
  it('shows the loading skeleton before the card resolves', () => {
    const client = makeClient(() => new Promise<CardResponse>(() => undefined));
    render(<HomeCard client={client} />);
    expect(screen.getByTestId('card-skeleton')).toBeInTheDocument();
  });

  it('renders the empty state on a 404 from the API', async () => {
    const client = makeClient(async () => {
      throw new ApiError(404, '/v1/cards/.', 'not found');
    });
    render(<HomeCard client={client} />);
    const empty = await screen.findByTestId('card-empty');
    expect(empty).toHaveTextContent('No repository card yet');
    expect(empty).toHaveTextContent('engram-code synth repo');
  });

  it('renders the error state on other failures and supports retry', async () => {
    let attempts = 0;
    const client = {
      getCard: vi.fn(async () => {
        attempts += 1;
        if (attempts === 1) throw new Error('network down');
        return fixtureCard();
      }),
    };
    render(<HomeCard client={client} />);
    const error = await screen.findByTestId('card-error');
    expect(error).toHaveTextContent('network down');

    fireEvent.click(screen.getByTestId('card-retry'));
    await waitFor(() => expect(screen.getByTestId('card-view')).toBeInTheDocument());
    expect(client.getCard).toHaveBeenCalledTimes(2);
  });

  it('renders the card body and metadata at STANDARD by default', async () => {
    const client = makeClient(async () => fixtureCard({ lod: 'standard' }));
    render(<HomeCard client={client} />);
    await screen.findByTestId('card-view');
    expect(screen.getByRole('heading', { level: 1, name: /engram-code/i })).toBeInTheDocument();
    expect(screen.getByTestId('card-metadata')).toHaveTextContent('generated at');
    expect(screen.getByTestId('card-metadata')).toHaveTextContent('abc1234');
    expect(client.getCard).toHaveBeenCalledWith('repository', 'standard', undefined);
  });

  it('refetches at the new LoD when the switcher is clicked', async () => {
    const client = makeClient(async (lod) =>
      fixtureCard({
        lod: lod ?? 'standard',
        content:
          lod === 'deep'
            ? '# engram-code (deep)\n\nFull architecture rundown.'
            : '# engram-code\n\nShort version.',
      }),
    );
    render(<HomeCard client={client} />);
    await screen.findByTestId('card-view');

    fireEvent.click(screen.getByTestId('lod-deep'));

    await waitFor(() =>
      expect(client.getCard).toHaveBeenLastCalledWith('repository', 'deep', undefined),
    );
    await screen.findByText('engram-code (deep)');
  });
});
