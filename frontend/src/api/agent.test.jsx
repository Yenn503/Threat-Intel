import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getAgentTools, agentChat } from './agent';

function mk(json){
  return { status:200, ok:true, json: async()=> json, text: async()=> JSON.stringify(json) };
}

describe('agent api', () => {
  beforeEach(()=>{
    global.fetch = vi.fn(async (url, opts)=>{
      if(url.endsWith('/api/ai/tools')) return mk({ ok:true, tools:[{id:'nmap'}] });
      if(url.endsWith('/api/ai/agent/chat')) return mk({ ok:true, reply:'hi', plan:[] });
      return mk({ ok:false });
    });
  });

  it('gets tools', async () => {
    const res = await getAgentTools('tok');
    expect(res.ok).toBe(true);
    expect(res.data.tools[0].id).toBe('nmap');
  });

  it('agent chat', async () => {
    const res = await agentChat('tok', { prompt:'hello', autoplan:false });
    expect(res.ok).toBe(true);
    expect(res.data.reply).toBe('hi');
  });
});
