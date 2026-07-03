/**
 * Component tests for SubsystemGrid — covers the empty state and the
 * N-cards-for-N-subsystems acceptance criterion from EC-30c.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { SubsystemGrid } from '@/components/subsystem-grid';
import type { Subsystem } from '@/lib/schemas';

afterEach(cleanup);

function fixture(slug: string, overrides: Partial<Subsystem> = {}): Subsystem {
  return {
    slug,
    name: slug.charAt(0).toUpperCase() + slug.slice(1),
    memberCount: 3,
    description: `${slug} subsystem`,
    ...overrides,
  };
}

describe('SubsystemGrid', () => {
  it('renders an empty state when there are no subsystems', () => {
    render(<SubsystemGrid subsystems={[]} />);
    expect(screen.getByTestId('subsystems-empty')).toHaveTextContent(
      'No subsystems synthesized yet',
    );
    expect(screen.queryByTestId('subsystem-grid')).not.toBeInTheDocument();
  });

  it('renders N cards for N subsystems', () => {
    const subs = [
      fixture('ingestion', { memberCount: 7 }),
      fixture('synthesis', { memberCount: 4 }),
      fixture('api', { memberCount: 12 }),
    ];
    render(<SubsystemGrid subsystems={subs} />);
    const grid = screen.getByTestId('subsystem-grid');
    const cards = within(grid).getAllByRole('link');
    expect(cards).toHaveLength(subs.length);
  });

  it('links each card to /subsystems/<slug> and shows the file count badge', () => {
    const subs = [
      fixture('ingestion', { memberCount: 7 }),
      fixture('synthesis', { memberCount: 1 }),
    ];
    render(<SubsystemGrid subsystems={subs} />);

    const ingestion = screen.getByTestId('subsystem-card-ingestion');
    expect(ingestion).toHaveAttribute('href', '/subsystems/ingestion');
    expect(screen.getByTestId('subsystem-count-ingestion')).toHaveTextContent(
      '7 files',
    );

    expect(screen.getByTestId('subsystem-count-synthesis')).toHaveTextContent(
      '1 file',
    );
  });

  it('shows the subsystem name and one-line description', () => {
    const subs = [
      fixture('ingestion', {
        name: 'Ingestion Pipeline',
        description: 'Parses repos and emits structural facts.',
      }),
    ];
    render(<SubsystemGrid subsystems={subs} />);
    expect(
      screen.getByRole('heading', { level: 2, name: /ingestion pipeline/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Parses repos and emits structural facts.'),
    ).toBeInTheDocument();
  });
});
