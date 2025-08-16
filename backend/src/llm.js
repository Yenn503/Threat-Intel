// Unified LLM client (canonical simplified)
import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';
dotenv.config();

let key = process.env.GEMINI_API_KEY || '';
if(process.env.NODE_ENV === 'test' && process.env.ENABLE_LLM_TESTS !== '1'){
  if(key) console.warn('[LLM] Test mode: disabling live LLM calls.');
  key='';
}
let genAI = null;
if(key){
  try { genAI = new GoogleGenerativeAI(key); console.log('[LLM] Initialized Gemini model'); }
  catch(e){ console.error('[LLM] init error', e.message); }
} else {
  console.warn('[LLM] GEMINI_API_KEY not set; LLM disabled');
}
const DEFAULT_MODEL = process.env.GEMINI_MODEL || 'gemini-1.5-flash';

export async function llmChat({ system, messages, maxOutputTokens = 800 }){
  if(!genAI) return { content:'[LLM disabled: set GEMINI_API_KEY]' };
  try {
    const model = genAI.getGenerativeModel({ model: DEFAULT_MODEL, systemInstruction: system });
    const contents = (messages||[]).map(m=> ({ role: m.role === 'assistant' ? 'model' : m.role, parts:[{ text: m.content }] }));
    const result = await model.generateContent({ contents, generationConfig:{ maxOutputTokens, temperature:0.4 } });
    const resp = await result.response;
    return { content: resp.text() };
  } catch(e){
    return { content: '[LLM error] ' + e.message.slice(0,200) };
  }
}
export function llmEnabled(){ return !!genAI; }
export default { llmChat, llmEnabled };
