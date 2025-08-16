import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import usePolling from './usePolling';

describe('usePolling', () => {
  it('invokes fn initially when active', () => {
    vi.useFakeTimers();
    let calls=0; const fn = vi.fn(()=>{ calls++; return false; });
    renderHook(()=> usePolling(fn, { interval:1000 }));
    expect(calls).toBe(1);
    vi.useRealTimers();
  });
});
