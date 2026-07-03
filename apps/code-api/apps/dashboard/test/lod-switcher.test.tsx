/**
 * LodSwitcher tests — covers click + keyboard shortcuts (1/2/3/4) and the
 * input-focus guard that prevents accidental switching while typing.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { LodSwitcher } from '@/components/lod-switcher';

afterEach(cleanup);

describe('LodSwitcher', () => {
  it('marks the active level with aria-checked=true', () => {
    render(<LodSwitcher value="standard" onChange={() => undefined} />);
    expect(screen.getByTestId('lod-standard')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByTestId('lod-deep')).toHaveAttribute('aria-checked', 'false');
  });

  it('invokes onChange when a button is clicked', () => {
    const onChange = vi.fn();
    render(<LodSwitcher value="standard" onChange={onChange} />);
    fireEvent.click(screen.getByTestId('lod-index'));
    expect(onChange).toHaveBeenCalledWith('index');
  });

  it('responds to number-key shortcuts 1..4', () => {
    const onChange = vi.fn();
    render(<LodSwitcher value="standard" onChange={onChange} />);
    fireEvent.keyDown(window, { key: '1' });
    fireEvent.keyDown(window, { key: '4' });
    expect(onChange).toHaveBeenNthCalledWith(1, 'index');
    expect(onChange).toHaveBeenNthCalledWith(2, 'deep');
  });

  it('ignores number keys when focus is in an input', () => {
    const onChange = vi.fn();
    render(
      <div>
        <input data-testid="text-field" />
        <LodSwitcher value="standard" onChange={onChange} />
      </div>,
    );
    const input = screen.getByTestId('text-field');
    input.focus();
    fireEvent.keyDown(input, { key: '2' });
    expect(onChange).not.toHaveBeenCalled();
  });
});
