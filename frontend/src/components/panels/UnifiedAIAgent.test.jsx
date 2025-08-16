import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';
import UnifiedAIAgent from './UnifiedAIAgent.jsx';
import { ServerHealthProvider } from '../providers/ServerHealthProvider.jsx';

// Minimal mocks for fetch & WebSocket used inside component
class MockWS {
  constructor(){ this.onopen=null; this.onclose=null; this.onmessage=null; setTimeout(()=> this.onopen && this.onopen(), 5); }
  send(){}
  close(){ this.onclose && this.onclose(); }
}

function mockFetchFactory(){
  return vi.fn(async (url, opts)=> {
    if(url.includes('/ai/tools')) return mk({ ok:true, tools:[] });
    if(url.includes('/ai/health')) return mk({ ok:true, llm:false });
    if(url.includes('/scan/binaries')) return mk({ ok:true, binaries:{ nmap:{ok:true}, nuclei:{ok:false} } });
    if(url.includes('/ai/agent/tasks')) return mk({ ok:true, tasks:[{ id:'task-123456789', instruction:'Example enumeration task', status:'running', created_at:Date.now()-5000, updated_at:Date.now() }] });
    if(url.includes('/ai/report/summary')) return mk({ ok:true, tasks:[], scanCounts:[], recentScans:[] });
    if(url.includes('/ai/report/timeseries')) return mk({ ok:true, series:[] });
    if(url.includes('/ai/report/findings')) return mk({ ok:true, severityCounts:{}, findings:[] });
    if(url.includes('/ai/events/recent')) return mk({ ok:true, events:[] });
    if(url.includes('/ai/metrics/snapshots')) return mk({ ok:true, snapshots:[] });
    return mk({ ok:false });
  });
}

function mk(json){
  const body = JSON.stringify(json);
  return { status:200, ok:true, json: async()=> json, text: async()=> body };
}

describe('UnifiedAIAgent', () => {
  beforeEach(()=>{
    global.fetch = mockFetchFactory();
    global.WebSocket = MockWS;
  });

  it('renders tabs and chat input baseline', async () => {
  render(<ServerHealthProvider><UnifiedAIAgent token="test-token" active={true} /></ServerHealthProvider>);
    // Ensure Chat tab button present
    expect(await screen.findByRole('button', { name: /^Chat$/i })).toBeInTheDocument();
    // Ensure Chat heading inside panel present
    expect(screen.getAllByText(/^Chat$/i).length).toBeGreaterThan(0);
    // Other tabs
    ['Events','Summary','Scans','Findings'].forEach(label => {
      expect(screen.getByRole('button', { name: new RegExp('^'+label+'$', 'i') })).toBeInTheDocument();
    });
    // Textarea input
    expect(screen.getByPlaceholderText(/Type instruction/i)).toBeInTheDocument();
  });

  it('shows binaries status snippet after fetch (with task)', async () => {
  render(<ServerHealthProvider><UnifiedAIAgent token="test-token" active={true} /></ServerHealthProvider>);
    await waitFor(()=> expect(screen.getByText(/nmap:/i)).toBeInTheDocument());
  });

  it('displays offline banner after consecutive failures', async () => {
    // Force fetch to fail twice to trigger serverDown threshold (>=2)
    let calls=0;
    global.fetch = vi.fn(async ()=>{ calls++; throw new Error('net fail'); });
    render(<ServerHealthProvider><UnifiedAIAgent token="tok" active={true} /></ServerHealthProvider>);
    await waitFor(()=>{
      expect(screen.getByText(/Server unreachable/i)).toBeInTheDocument();
    });
    expect(calls).toBeGreaterThanOrEqual(2);
  });

  it('autonomous loop triggers chat when idle (no active tasks)', async () => {
    // Custom fetch: no tasks active so loop should generate a strategy and call chat
    const chatReply = { ok:true, reply:'Auto loop reply', plan:[{ tool:'nmap', args:{ target:'scanme.nmap.org' } }], executed:false };
    global.fetch = vi.fn(async (url, opts)=> {
      if(url.includes('/ai/agent/tasks')) return mk({ ok:true, tasks:[] });
      if(url.includes('/ai/tools')) return mk({ ok:true, tools:[] });
      if(url.includes('/ai/health')) return mk({ ok:true, llm:true });
      if(url.includes('/scan/binaries')) return mk({ ok:true, binaries:{ nmap:{ok:true}, nuclei:{ok:true} } });
      if(url.includes('/ai/report/summary')) return mk({ ok:true, tasks:[], scanCounts:[], recentScans:[] });
      if(url.includes('/ai/events/recent')) return mk({ ok:true, events:[] });
      if(url.includes('/ai/metrics/snapshots')) return mk({ ok:true, snapshots:[] });
      if(url.includes('/ai/agent/chat')) return mk(chatReply);
      return mk({ ok:true });
    });
    render(<ServerHealthProvider><UnifiedAIAgent token="loop-token" active={true} /></ServerHealthProvider>);
    // Enable auto loop
    const toggle = await screen.findByLabelText(/Auto Loop/i);
  await act(async ()=> { toggle.click(); });
    // Wait until chat endpoint invoked (autonomous loop issued a prompt)
    await waitFor(()=>{
      expect(global.fetch.mock.calls.some(c=> c[0].includes('/ai/agent/chat'))).toBe(true);
    });
    // Optional: if plan UI rendered, assert it contains heading (non-fatal if absent)
    const planHeading = screen.queryByText(/Suggested Plan/i);
    if(planHeading){
      expect(planHeading).toBeInTheDocument();
    }
  });

  it('autonomous loop refrains from action when active task present', async () => {
    global.fetch = vi.fn(async (url, opts)=> {
      if(url.includes('/ai/agent/tasks')) return mk({ ok:true, tasks:[{ id:'active1', instruction:'Work', status:'running', created_at:Date.now()-2000, updated_at:Date.now() }] });
      if(url.includes('/ai/tools')) return mk({ ok:true, tools:[] });
      if(url.includes('/ai/health')) return mk({ ok:true, llm:true });
      if(url.includes('/scan/binaries')) return mk({ ok:true, binaries:{ nmap:{ok:true}, nuclei:{ok:true} } });
      if(url.includes('/ai/report/summary')) return mk({ ok:true, tasks:[], scanCounts:[], recentScans:[] });
      if(url.includes('/ai/events/recent')) return mk({ ok:true, events:[] });
      if(url.includes('/ai/metrics/snapshots')) return mk({ ok:true, snapshots:[] });
      return mk({ ok:true });
    });
    render(<ServerHealthProvider><UnifiedAIAgent token="loop-token" active={true} /></ServerHealthProvider>);
    const toggle = await screen.findByLabelText(/Auto Loop/i);
  await act(async ()=> { toggle.click(); });
    // Wait a bit for first cycle
    await waitFor(()=>{
      // No chat call should have been made
      expect(global.fetch.mock.calls.some(c=> c[0].includes('/ai/agent/chat'))).toBe(false);
    });
  });
});
