import { GoogleGenerativeAI } from '@google/generative-ai';

const GEMINI_KEY = process.env.GEMINI_API_KEY;
let genAI = null;
if (GEMINI_KEY) {
  genAI = new GoogleGenerativeAI(GEMINI_KEY);
}

const DEFAULT_MODEL = process.env.GEMINI_MODEL || 'gemini-1.5-flash';

export async function llmChat({ system, messages, maxOutputTokens = 800 }) {
  if (!genAI) {
    return { content: '[LLM disabled: provide GEMINI_API_KEY]' };
  }
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
