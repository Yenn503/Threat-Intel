import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';
dotenv.config();

let GEMINI_KEY = process.env.GEMINI_API_KEY;
// For test runs, allow forcing LLM disabled unless explicitly enabled
if(process.env.NODE_ENV === 'test' && process.env.ENABLE_LLM_TESTS !== '1'){
  GEMINI_KEY = '';
  if(process.env.GEMINI_API_KEY){ console.warn('[LLM] Test mode: overriding GEMINI_API_KEY to disable live LLM calls.'); }
}
if(!GEMINI_KEY){
  console.warn('[LLM] GEMINI_API_KEY not set (or disabled for tests); Gemini disabled.');
}
let genAI = null;
if (GEMINI_KEY) {
  try { genAI = new GoogleGenerativeAI(GEMINI_KEY); console.log('[LLM] Gemini key detected; initializing model'); }
  catch(e){ console.error('[LLM] init error', e.message); }
}

const DEFAULT_MODEL = process.env.GEMINI_MODEL || 'gemini-1.5-flash';

export async function llmChat({ system, messages, maxOutputTokens = 800 }) {
  if (!genAI) return { content: '[LLM disabled: set GEMINI_API_KEY]' };
  try {
    const model = genAI.getGenerativeModel({ model: DEFAULT_MODEL, systemInstruction: system });
    const contents = messages.map(m => ({ role: m.role === 'assistant' ? 'model' : m.role, parts: [{ text: m.content }] }));
    const result = await model.generateContent({ contents, generationConfig: { maxOutputTokens, temperature: 0.4 } });
    const resp = await result.response;
    return { content: resp.text() };
  } catch (e) {
    return { content: '[LLM error] ' + e.message.slice(0,200) };
  }
}

export function llmEnabled(){ return !!genAI; }
