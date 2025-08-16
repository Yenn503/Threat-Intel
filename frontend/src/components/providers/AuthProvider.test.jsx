import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { AuthProvider, useAuth } from './AuthProvider.jsx';
import { ServerHealthProvider } from './ServerHealthProvider.jsx';

function Consumer(){
  const { user, loading, error, refresh } = useAuth();
  return <div>
    <div data-testid="loading">{String(loading)}</div>
    <div data-testid="error">{error||''}</div>
    <div data-testid="user">{user? user.email:'none'}</div>
    <button onClick={refresh}>refresh</button>
  </div>;
}

describe('AuthProvider', () => {
  beforeEach(()=>{
    global.fetch = vi.fn(async (url)=>{
      if(url.includes('/api/auth/me')) return { ok:true, status:200, json: async()=> ({ email:'user@example.com', role:'user' }), text: async()=> JSON.stringify({ email:'user@example.com', role:'user' }) };
      return { ok:true, status:200, json: async()=> ({}), text: async()=> '{}' };
    });
  });
  it('loads user and exposes via context', async () => {
    render(<ServerHealthProvider><AuthProvider token="tok"><Consumer/></AuthProvider></ServerHealthProvider>);
    expect(screen.getByTestId('loading').textContent).toBe('true');
    await waitFor(()=> expect(screen.getByTestId('user').textContent).toBe('user@example.com'));
    expect(screen.getByTestId('loading').textContent).toBe('false');
  });
  it('handles failure and sets error', async () => {
    global.fetch = vi.fn(async (url)=> { throw new Error('net'); });
    render(<ServerHealthProvider><AuthProvider token="tok"><Consumer/></AuthProvider></ServerHealthProvider>);
  await waitFor(()=> expect(screen.getByTestId('error').textContent).toMatch(/auth/i));
  });
});
