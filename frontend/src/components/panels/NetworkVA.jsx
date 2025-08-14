import React from 'react';

export default function NetworkVA({ token, active }){
  if(active === false) return <div style={{display:'none'}} aria-hidden="true" />;
  return (
    <div className="card" style={{minHeight:'calc(100vh - 170px)', width:'100%', display:'flex', flexDirection:'column'}}>
      <h3 style={{marginTop:0}}>Network Vulnerability Assessment</h3>
      <p style={{fontSize:'.7rem', color:'var(--text-dim)'}}>Placeholder panel. Plan: host discovery, port/service enumeration, vulnerability scan summary.</p>
    </div>
  );
}
