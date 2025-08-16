import assert from 'assert';
import { llmChat, llmEnabled } from '../llm.js';

// Basic harness validating disabled mode & structure. Avoids real API unless key present.
// Run with: npm test (Node --test framework)

async function run(){
  assert.strictEqual(typeof llmEnabled(), 'boolean');
  const out = await llmChat({ system: 'You are a noop test model', messages: [{ role:'user', content:'ping'}] });
  assert.ok(out && typeof out.content === 'string');
  if(!llmEnabled()){
    assert.match(out.content, /LLM disabled/i);
  }
}

await run();
