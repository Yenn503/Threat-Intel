// Tool Registry (Sprint A)
const _registry = new Map();
export function registerTool(def){
  if(!def || typeof def !== 'object') throw new Error('tool def object required');
  if(!def.id) throw new Error('tool id required');
  if(_registry.has(def.id)) throw new Error('tool already registered: '+def.id);
  const norm = { version:'1.0.0', kind:'utility', inputSchema:{}, ...def };
  _registry.set(norm.id, norm);
  return norm;
}
export function getTool(id){ return _registry.get(id); }
export function listTools(){ return [..._registry.values()]; }
export function manifest(){ return listTools().map(t=> ({ id:t.id, version:t.version, kind:t.kind, description:t.description, schema:t.inputSchema })); }
export function validateArgs(schema, args){
  args = args || {};
  const req = schema?.required || [];
  for(const r of req){ if(args[r] === undefined) throw new Error('missing required arg: '+r); }
  const props = schema?.properties || {};
  for(const [k,v] of Object.entries(props)){
    if(args[k] !== undefined && v.type && typeof args[k] !== v.type) throw new Error('arg '+k+' type mismatch');
  }
  return args;
}
export async function executeRegisteredTool(step, userId, enqueueScan){
  const t = getTool(step.tool); if(!t) throw new Error('unknown tool');
  const args = validateArgs(t.inputSchema, step.args);
  return await t.run({ args, userId, enqueueScan });
}
