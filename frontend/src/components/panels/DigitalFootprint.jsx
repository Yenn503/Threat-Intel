import React from 'react';

export default function DigitalFootprint({ token, active }){
  if(active === false) return <div style={{display:'none'}} aria-hidden="true" />;
  return (
    <div className="card" style={{minHeight:'calc(100vh - 170px)', width:'100%', display:'flex', flexDirection:'column'}}>
      <h3 style={{marginTop:0}}>Digital Footprint</h3>
      <p style={{fontSize:'.7rem', color:'var(--text-dim)'}}>Placeholder panel. Plan: domain & subdomain inventory, exposed assets, certificate transparency, leaked creds indicators.</p>
    </div>
  );
}
