import { AgentConfig } from '../db.js';

export function getAgentConfig(){
  const row = AgentConfig.get();
  return { diffBasedNuclei: !!row?.diffBasedNuclei, updated_at: row?.updated_at };
}

export function updateAgentConfig(patch={}){
  const updated = AgentConfig.update(patch);
  return { diffBasedNuclei: !!updated.diffBasedNuclei, updated_at: updated.updated_at };
}

export default { getAgentConfig, updateAgentConfig };
