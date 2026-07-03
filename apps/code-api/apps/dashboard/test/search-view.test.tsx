/**
 * Component tests for the `/search` concept-search view.
 *
 * The view owns query state, level filter, results list, keyboard
 * shortcuts, and URL-state sync. Tests inject a stub `searchConcept` /
 * `getCard` client and a stub `next/navigation` to drive each behaviour
 * without spinning up Next's router.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import type {
  CardKind,
  CardResponse,
  LodLevel,
  SearchConceptHit,
  SearchConceptResponse,
} from '@/lib/schemas';
import { SearchView, highlightSnippet } from '@/components/search-view';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const mockReplace = vi.fn();
let mockParams = new URLSearchParams();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: (url: string) => mockReplace(url) }),
  useSearchParams: () => mockParams,
}));

interface SearchClient {
  searchConcept: ReturnType<typeof vi.fn>;
  getCard: ReturnType<typeof vi.fn>;
}

function hit(overrides: Partial<SearchConceptHit> = {}): SearchConceptHit {
  return {
    conceptPath: 'engram/api/payments',
    level: 'module',
    lod: 'standard',
    score: 0.9,
    snippet: 'Payment provider extension point lives here.',
    ...overrides,
  };
}

function makeClient(
  results: SearchConceptHit[],
  card?: CardResponse,
): SearchClient {
  const searchConcept = vi.fn(
    async (query: string, _opts?: { level?: CardKind; lod?: LodLevel }) => {
      return {
        query,
        results,
        totalFound: results.length,
        searchTimeMs: 3,
      } satisfies SearchConceptResponse;
    },
  );
  const getCard = vi.fn(async (path: string, lod?: LodLevel) => {
    return (
      card ?? {
        conceptPath: path,
        kind: 'module' as const,
        lod: lod ?? 'standard',
        content: `# ${path}\n\nDetail body.`,
        metadata: {},
      }
    );
  });
  return { searchConcept, getCard };
}

describe('SearchView submit', () => {
  it('submits the query, calls /v1/search/concept with lod=standard, and renders results', async () => {
    mockParams = new URLSearchParams();
    const client = makeClient([hit()]);
    render(<SearchView client={client} />);

    const input = screen.getByTestId('search-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'payment provider' } });
    fireEvent.submit(screen.getByTestId('search-form'));

    await waitFor(() => expect(client.searchConcept).toHaveBeenCalled());
    expect(client.searchConcept).toHaveBeenCalledWith('payment provider', {
      lod: 'standard',
    });

    const results = await screen.findAllByTestId('search-result');
    expect(results).toHaveLength(1);
    expect(results[0]).toHaveTextContent('engram/api/payments');
  });

  it('renders the snippet with <mark> highlights for query terms', async () => {
    mockParams = new URLSearchParams();
    const client = makeClient([
      hit({ snippet: 'The payment provider plugs in here.' }),
    ]);
    render(<SearchView client={client} />);

    fireEvent.change(screen.getByTestId('search-input'), {
      target: { value: 'payment provider' },
    });
    fireEvent.submit(screen.getByTestId('search-form'));

    const snippet = await screen.findByTestId('search-snippet');
    expect(snippet.innerHTML).toMatch(/<mark>payment<\/mark>/i);
    expect(snippet.innerHTML).toMatch(/<mark>provider<\/mark>/i);
  });

  it('updates the URL with q and level for shareable searches', async () => {
    mockParams = new URLSearchParams();
    mockReplace.mockClear();
    const client = makeClient([hit()]);
    render(<SearchView client={client} />);

    fireEvent.change(screen.getByTestId('search-input'), {
      target: { value: 'payment' },
    });
    fireEvent.submit(screen.getByTestId('search-form'));

    await waitFor(() =>
      expect(mockReplace).toHaveBeenCalledWith('/search?q=payment'),
    );
  });
});

describe('SearchView filter chips', () => {
  it('toggles the level filter on click and passes it to searchConcept', async () => {
    mockParams = new URLSearchParams();
    const client = makeClient([hit()]);
    render(<SearchView client={client} />);

    fireEvent.change(screen.getByTestId('search-input'), {
      target: { value: 'pay' },
    });
    fireEvent.submit(screen.getByTestId('search-form'));
    await waitFor(() => expect(client.searchConcept).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByTestId('filter-module'));

    await waitFor(() =>
      expect(client.searchConcept).toHaveBeenLastCalledWith('pay', {
        lod: 'standard',
        level: 'module',
      }),
    );
    expect(screen.getByTestId('filter-module')).toHaveAttribute(
      'aria-checked',
      'true',
    );

    fireEvent.click(screen.getByTestId('filter-module'));
    expect(screen.getByTestId('filter-module')).toHaveAttribute(
      'aria-checked',
      'false',
    );
  });
});

describe('SearchView keyboard', () => {
  it("focuses the input when '/' is pressed anywhere on the page", () => {
    mockParams = new URLSearchParams();
    render(<SearchView client={makeClient([])} />);
    const input = screen.getByTestId('search-input') as HTMLInputElement;
    expect(document.activeElement).not.toBe(input);

    fireEvent.keyDown(document.body, { key: '/' });
    expect(document.activeElement).toBe(input);
  });

  it('ignores / when the focus is already in an input', () => {
    mockParams = new URLSearchParams();
    render(<SearchView client={makeClient([])} />);
    const input = screen.getByTestId('search-input') as HTMLInputElement;
    input.focus();
    fireEvent.keyDown(input, { key: '/' });
    expect(document.activeElement).toBe(input);
  });
});

describe('SearchView empty state', () => {
  it('renders 3 example queries when there is no query', () => {
    mockParams = new URLSearchParams();
    render(<SearchView client={makeClient([])} />);
    expect(screen.getAllByTestId('example-query')).toHaveLength(3);
  });
});

describe('highlightSnippet', () => {
  it('wraps matching terms in <mark> and escapes HTML', () => {
    const result = highlightSnippet('Adds <Payment> provider', [
      'payment',
      'provider',
    ]);
    expect(result).toContain('&lt;<mark>Payment</mark>&gt;');
    expect(result).toContain('<mark>provider</mark>');
  });

  it('returns escaped snippet unchanged when there are no terms', () => {
    expect(highlightSnippet('a & b', [])).toBe('a &amp; b');
  });
});
