import React from 'react';
export default class PanelErrorBoundary extends React.Component {
  constructor(p){ super(p); this.state={ error:null }; }
  static getDerivedStateFromError(e){ return { error:e }; }
  componentDidCatch(e,info){ console.error('Panel error', e, info); }
  render(){ if(this.state.error){ return <div className="card" style={{padding:24}}><h3 style={{marginTop:0}}>Panel Error</h3><div style={{fontSize:'.7rem', color:'var(--danger)'}}>{String(this.state.error?.message||this.state.error)}</div><button className="btn" style={{marginTop:12}} onClick={()=> this.setState({error:null})}>Retry Mount</button></div>; } return this.props.children; }
}
