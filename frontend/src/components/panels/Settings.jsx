import React, { useState, useEffect } from 'react';

export default function Settings({ token, setToken, logout, theme, setTheme }){
  const [users,setUsers] = useState([]);
  const [me,setMe] = useState(null);
  useEffect(()=>{ if(token){ fetch('http://localhost:4000/api/auth/me',{ headers:{ Authorization:'Bearer '+token }}).then(r=>r.json()).then(setMe).catch(()=>{}); } },[token]);
  function loadUsers(){ if(!token) return; fetch('http://localhost:4000/api/admin/users',{ headers:{ Authorization:'Bearer '+token }}).then(r=>r.json()).then(d=>setUsers(d.users||[])).catch(()=>{}); }
  useEffect(()=>{ if(token) loadUsers(); },[token]);
  async function changeRole(id, role){ await fetch(`http://localhost:4000/api/admin/users/${id}/role`, { method:'PUT', headers:{'Content-Type':'application/json', Authorization:'Bearer '+token}, body: JSON.stringify({ role }) }); loadUsers(); }
  return <div className="card" style={{maxWidth:980}}>
    <h3 style={{marginTop:0}}>Settings</h3>
    {token ? <div style={{display:'flex', gap:10, flexWrap:'wrap'}}>
      <button className="btn" onClick={logout}>Logout</button>
      {me?.role==='admin' && <button className="btn" onClick={loadUsers}>Refresh Users</button>}
      <button className="btn" onClick={()=> setTheme(theme==='dark'?'light':'dark')}>Theme: {theme}</button>
    </div> : <div style={{fontSize:'.8rem'}}>Login required for features.</div>}
    {me?.role==='admin' && <div style={{marginTop:24}}>
      <div className="section-label" style={{marginBottom:8}}>USERS</div>
      <div className="table-scroll" style={{maxHeight:320}}>
        <table><thead><tr><th>Email</th><th>Role</th><th>Created</th><th style={{width:160}}></th></tr></thead><tbody>
          {users.map(u=> <tr key={u.id}><td>{u.email}</td><td>{u.role}</td><td>{u.created_at? new Date(u.created_at).toLocaleDateString():''}</td><td style={{display:'flex', gap:6}}>{u.role!=='admin' && <button className="btn" style={{padding:'4px 8px', fontSize:'.55rem'}} onClick={()=>changeRole(u.id,'admin')}>Make Admin</button>}{u.role!=='user' && <button className="btn" style={{padding:'4px 8px', fontSize:'.55rem'}} onClick={()=>changeRole(u.id,'user')}>Make User</button>}</td></tr>) }
        </tbody></table>
      </div>
    </div>}
    <p style={{marginTop:28}}>Planned: API key management, persistence selection, export/import technique library, password resets.</p>
  </div>;
}
