/**
 * Smoke test for the App Router 404 page — confirms the Basecamp-toned
 * copy lands and the calm-navigation links are present (EC-30g).
 */

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import NotFound from '@/app/not-found';

afterEach(cleanup);

describe('NotFound', () => {
  it('renders the 404 marker and Basecamp-toned copy', () => {
    render(<NotFound />);
    const card = screen.getByTestId('not-found');
    expect(card).toHaveTextContent('404');
    expect(card).toHaveTextContent(
      "That page doesn't live here. Maybe it never did.",
    );
  });

  it('links back to the three primary surfaces', () => {
    render(<NotFound />);
    const card = screen.getByTestId('not-found');
    const links = card.querySelectorAll('a');
    const hrefs = Array.from(links).map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual(
      expect.arrayContaining(['/', '/subsystems', '/search']),
    );
  });
});
