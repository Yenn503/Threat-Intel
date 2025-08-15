import { GoogleGenerativeAI } from '@google/generative-ai';
// Ensure env vars loaded even if server imported this before calling dotenv.config()
import dotenv from 'dotenv';
dotenv.config();

const GEMINI_KEY = process.env.GEMINI_API_KEY;
if(!GEMINI_KEY){
  console.warn('[LLM] GEMINI_API_KEY not set at module load; Gemini disabled.');
} else {
  console.log('[LLM] Gemini key detected; initializing model');
}
let genAI = null;
if (GEMINI_KEY) {
  genAI = new GoogleGenerativeAI(GEMINI_KEY);
}

const DEFAULT_MODEL = process.env.GEMINI_MODEL || 'gemini-1.5-flash';

export async function llmChat({ system, messages, maxOutputTokens = 800 }) {
  if (!genAI) return { content: '[LLM disabled: set GEMINI_API_KEY]' };
  const model = genAI.getGenerativeModel({ model: DEFAULT_MODEL, systemInstruction: system });
  const contents = messages.map(m => ({ role: m.role === 'assistant' ? 'model' : m.role, parts: [{ text: m.content }] }));
  try {
    const result = await model.generateContent({ contents, generationConfig: { maxOutputTokens, temperature: 0.4 } });
    const resp = await result.response;
    return { content: resp.text() };
  } catch (e) {
    return { content: '[LLM error] ' + e.message.slice(0,200) };
  }
}

export function llmEnabled(){ return !!genAI; }
