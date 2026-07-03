/**
 * Tests for the `/map` repository-map view.
 *
 * The view loads a nested tree via `getMap`, lets the user expand/collapse
 * nodes inline, and renders the selected node's detail card via `getCard`.
 * Tests inject stub clients and a stub `next/navigation` so we don't need
 * Next's router.
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
  CardResponse,
  LodLevel,
  MapNode,
  MapResponse,
} from '@/lib/schemas';
import { MapView, flattenVisible } from '@/components/map-view';

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

function node(
  conceptPath: string,
  summary: string,
  children: MapNode[] = [],
  level: MapNode['level'] = 'module',
): MapNode {
  return { conceptPath, level, summary, children };
}

function makeResponse(nodes: MapNode[]): MapResponse {
  return { root: null, depth: 3, nodes };
}

function makeClient(response: MapResponse, card?: CardResponse) {
  const getMap = vi.fn(async (_root?: string, _depth?: number) => response);
  const getCard = vi.fn(async (path: string, lod?: LodLevel) => {
    return (
      card ?? {
        conceptPath: path,
        kind: 'module' as const,
        lod: lod ?? 'standard',
        content: `# ${path}\n\nBody.`,
        metadata: {},
      }
    );
  });
  return { getMap, getCard };
}

describe('flattenVisible', () => {
  it('returns only top-level rows when nothing is expanded', () => {
    const tree = [
      node('a', 'a', [node('a/x', 'ax')]),
      node('b', 'b'),
    ];
    const flat = flattenVisible(tree, new Set());
    expect(flat.map((f) => f.node.conceptPath)).toEqual(['a', 'b']);
    expect(flat[0].hasChildren).toBe(true);
    expect(flat[1].hasChildren).toBe(false);
  });

  it('includes children of expanded nodes only', () => {
    const tree = [
      node('a', 'a', [node('a/x', 'ax', [node('a/x/y', 'axy')])]),
      node('b', 'b'),
    ];
    const flat = flattenVisible(tree, new Set(['a']));
    expect(flat.map((f) => f.node.conceptPath)).toEqual(['a', 'a/x', 'b']);
    expect(flat[1].depth).toBe(1);
  });
});

describe('MapView load', () => {
  it('calls getMap with depth=3 by default and renders top-level rows', async () => {
    mockParams = new URLSearchParams();
    const client = makeClient(
      makeResponse([node('engram', 'top-level package', [node('engram/api', 'api layer')])]),
    );
    render(<MapView client={client} />);

    await waitFor(() => expect(client.getMap).toHaveBeenCalled());
    expect(client.getMap).toHaveBeenCalledWith(undefined, 3);

    const rows = await screen.findAllByTestId('map-row');
    // First-level nodes are auto-expanded after load, so engram/api shows too.
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('engram')).toBeInTheDocument();
    expect(screen.getByText('api')).toBeInTheDocument();
  });

  it('uses ?root and ?depth from the URL', async () => {
    mockParams = new URLSearchParams('root=engram/api&depth=2');
    const client = makeClient(makeResponse([node('engram/api', 'api')]));
    render(<MapView client={client} />);
    await waitFor(() => expect(client.getMap).toHaveBeenCalledWith('engram/api', 2));
    expect(screen.getByTestId('map-root')).toHaveTextContent('engram/api');
  });

  it('renders an error when getMap rejects', async () => {
    mockParams = new URLSearchParams();
    const getMap = vi.fn(async () => {
      throw new Error('boom');
    });
    const getCard = vi.fn();
    render(<MapView client={{ getMap, getCard }} />);
    const err = await screen.findByTestId('map-error');
    expect(err).toHaveTextContent('boom');
  });
});

describe('MapView expand/collapse', () => {
  it('collapsing a top-level node hides its children', async () => {
    mockParams = new URLSearchParams();
    const client = makeClient(
      makeResponse([
        node('engram', 'top-pkg', [node('engram/api', 'api-layer')]),
      ]),
    );
    render(<MapView client={client} />);

    await screen.findByText('api');
    const toggle = screen.getAllByTestId('map-row-toggle')[0];
    fireEvent.click(toggle);
    await waitFor(() =>
      expect(screen.queryByText('api')).not.toBeInTheDocument(),
    );

    fireEvent.click(toggle);
    await waitFor(() => expect(screen.getByText('api')).toBeInTheDocument());
  });

  it('expanding a deep node reveals its grandchildren', async () => {
    mockParams = new URLSearchParams();
    const client = makeClient(
      makeResponse([
        node('a', 'a', [
          node('a/b', 'ab', [node('a/b/c', 'abc')]),
        ]),
      ]),
    );
    render(<MapView client={client} />);

    await screen.findByText('b');
    expect(screen.queryByText('c')).not.toBeInTheDocument();

    const toggles = screen.getAllByTestId('map-row-toggle');
    // toggles[0] is for 'a' (already expanded), toggles[1] is for 'a/b'.
    fireEvent.click(toggles[1]);
    expect(screen.getByText('c')).toBeInTheDocument();
  });
});

describe('MapView selection + detail', () => {
  it('clicking a row selects it and loads its card into the detail pane', async () => {
    mockParams = new URLSearchParams();
    const client = makeClient(
      makeResponse([node('engram', 'top')]),
      {
        conceptPath: 'engram',
        kind: 'module',
        lod: 'standard',
        content: '# engram\n\nHello.',
        metadata: {},
      },
    );
    render(<MapView client={client} />);

    const selectButton = await screen.findByTestId('map-row-select');
    fireEvent.click(selectButton);

    await waitFor(() =>
      expect(client.getCard).toHaveBeenCalledWith('engram', 'standard'),
    );

    const row = await screen.findByTestId('map-row');
    expect(row).toHaveAttribute('data-selected', 'true');

    expect(await screen.findByTestId('card-view')).toBeInTheDocument();
    expect(screen.queryByTestId('map-detail-empty')).not.toBeInTheDocument();
  });

  it('shows an empty state until something is selected', async () => {
    mockParams = new URLSearchParams();
    const client = makeClient(makeResponse([node('a', 'a')]));
    render(<MapView client={client} />);
    expect(await screen.findByTestId('map-detail-empty')).toBeInTheDocument();
  });
});

describe('MapView keyboard', () => {
  it('j/k move selection through the visible rows', async () => {
    mockParams = new URLSearchParams();
    const client = makeClient(
      makeResponse([
        node('a', 'a', [node('a/x', 'ax')]),
        node('b', 'b'),
      ]),
    );
    render(<MapView client={client} />);

    const tree = await screen.findByTestId('map-tree');
    fireEvent.keyDown(tree, { key: 'j' });

    await waitFor(() => expect(client.getCard).toHaveBeenCalled());

    fireEvent.keyDown(tree, { key: 'j' });
    fireEvent.keyDown(tree, { key: 'j' });

    await waitFor(() =>
      expect(client.getCard).toHaveBeenLastCalledWith('b', 'standard'),
    );
  });

  it('ArrowLeft collapses an expanded node with children', async () => {
    mockParams = new URLSearchParams();
    const client = makeClient(
      makeResponse([node('a', 'a', [node('a/x', 'ax')])]),
    );
    render(<MapView client={client} />);
    const tree = await screen.findByTestId('map-tree');
    await screen.findByText('x');

    fireEvent.keyDown(tree, { key: 'j' });
    fireEvent.keyDown(tree, { key: 'ArrowLeft' });
    await waitFor(() =>
      expect(screen.queryByText('x')).not.toBeInTheDocument(),
    );
  });
});

describe('MapView depth selector', () => {
  it('changing depth reloads the map and updates the URL', async () => {
    mockParams = new URLSearchParams();
    mockReplace.mockClear();
    const client = makeClient(makeResponse([node('a', 'a')]));
    render(<MapView client={client} />);

    await waitFor(() => expect(client.getMap).toHaveBeenCalledWith(undefined, 3));

    fireEvent.click(screen.getByTestId('depth-5'));

    await waitFor(() => expect(client.getMap).toHaveBeenLastCalledWith(undefined, 5));
    expect(mockReplace).toHaveBeenLastCalledWith('/map?depth=5');
  });
});
