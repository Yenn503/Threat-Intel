// Sprint A refactor: delegate to new registry & builtin tools side-effect registration
import { manifest as registryManifest, executeRegisteredTool, listTools } from './tools/toolRegistry.js';
import './tools/builtinTools.js';

export function toolManifest(){ return registryManifest(); }
export async function executeToolStep(step, userId, enqueueScan){ return executeRegisteredTool(step, userId, enqueueScan); }
export const tools = Object.fromEntries(listTools().map(t=> [t.id, { description:t.description, schema:t.inputSchema }]));
export { buildScan } from './tools/builtinTools.js';
