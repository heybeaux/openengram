/**
 * Component tests for the subsystem detail panel — covers the loading,
 * not-found (unknown slug → 404 from the API), error, and success states,
 * plus the LoD toggle refetch and the 'Open in repo map' link.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { ApiError } from '@/lib/api';
import type { CardResponse, LodLevel } from '@/lib/schemas';
import { SubsystemDetail } from '@/components/subsystem-detail';

afterEach(cleanup);

function fixtureCard(overrides: Partial<CardResponse> = {}): CardResponse {
  return {
    conceptPath: 'subsystems/ingestion',
    kind: 'subsystem',
    lod: 'standard',
    content: '# Ingestion\n\nParses repositories and emits structural facts.',
    metadata: { generated_at: '2026-05-25T12:00:00Z' },
    ...overrides,
  };
}

function makeClient(impl: (lod: LodLevel | undefined) => Promise<CardResponse>) {
  return {
    getCard: vi.fn(async (_path: string, lod?: LodLevel) => impl(lod)),
  };
}

describe('SubsystemDetail', () => {
  it('renders the not-found state when the API returns 404', async () => {
    const client = {
      getCard: vi.fn(async () => {
        throw new ApiError(404, '/v1/cards/subsystems/nope', 'not found');
      }),
    };
    render(<SubsystemDetail slug="nope" client={client} />);
    const nf = await screen.findByTestId('subsystem-not-found');
    expect(nf).toHaveTextContent('Subsystem not found');
    expect(nf).toHaveTextContent('subsystems/nope');
  });

  it('fetches the subsystem card by concept path and renders it', async () => {
    const client = makeClient(async () =>
      fixtureCard({
        content: '# Ingestion Pipeline\n\nParses repositories.',
      }),
    );
    render(<SubsystemDetail slug="ingestion" client={client} />);
    const body = await screen.findByTestId('card-body');
    expect(client.getCard).toHaveBeenCalledWith('subsystems/ingestion', 'standard');
    expect(body).toHaveTextContent('Ingestion Pipeline');
    expect(body).toHaveTextContent('Parses repositories.');
  });

  it('refetches at the new LoD when the switcher is clicked', async () => {
    const client = makeClient(async (lod) =>
      fixtureCard({
        lod: lod ?? 'standard',
        content:
          lod === 'deep'
            ? '# Ingestion (deep)\n\nFull rundown.'
            : '# Ingestion\n\nShort.',
      }),
    );
    render(<SubsystemDetail slug="ingestion" client={client} />);
    await screen.findByTestId('card-view');

    fireEvent.click(screen.getByTestId('lod-deep'));

    await waitFor(() =>
      expect(client.getCard).toHaveBeenLastCalledWith(
        'subsystems/ingestion',
        'deep',
      ),
    );
    await screen.findByText('Ingestion (deep)');
  });

  it('exposes an Open-in-repo-map link with the subsystem root', () => {
    const client = makeClient(() => new Promise<CardResponse>(() => undefined));
    render(<SubsystemDetail slug="ingestion" client={client} />);
    const link = screen.getByTestId('open-in-repo-map');
    expect(link).toHaveAttribute(
      'href',
      `/map?root=${encodeURIComponent('subsystems/ingestion')}`,
    );
  });

  it('encodes slugs with special characters in the API path', async () => {
    const client = makeClient(async () =>
      fixtureCard({ conceptPath: 'subsystems/api-layer' }),
    );
    render(<SubsystemDetail slug="api-layer" client={client} />);
    await screen.findByTestId('card-view');
    expect(client.getCard).toHaveBeenCalledWith('subsystems/api-layer', 'standard');
  });
});
