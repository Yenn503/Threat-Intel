// ANSI utilities extracted from monolithic main.jsx
export function escapeHtml(str){
  return String(str).replace(/[&<>"']|'/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c]));
}

// Supports: reset(0), bold(1), 30-37 / 90-97 fg colors, 39 reset fg
export function ansiToHtml(text){
  if(!text) return '';
  const spans = [];
  let open = null;
  const flush = () => { if(open){ spans.push(open.prefix + open.content + '</span>'); open=null; } };
  const pushPlain = (s) => { if(!s) return; if(open) open.content += escapeHtml(s); else spans.push(escapeHtml(s)); };
  const regex = /\x1b\[([0-9;]+)m/g;
  let lastIndex = 0; let m;
  while((m = regex.exec(text))){
    pushPlain(text.slice(lastIndex, m.index));
    const codes = m[1].split(';').filter(Boolean).map(Number);
    lastIndex = regex.lastIndex;
    if(!codes.length || codes.includes(0)){ flush(); continue; }
    let cls = [];
    for(const code of codes){
      if(code === 1) cls.push('ansi-bold');
      else if(code>=30 && code<=37) cls.push('ansi-fg-'+(code-30));
      else if(code>=90 && code<=97) cls.push('ansi-fg-bright-'+(code-90));
      else if(code===39) { /* reset fg */ }
    }
    flush();
    open = { prefix: '<span class="'+cls.join(' ')+'">', content:'' };
  }
  pushPlain(text.slice(lastIndex));
  flush();
  return spans.join('');
}
