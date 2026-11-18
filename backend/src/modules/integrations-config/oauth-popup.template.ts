/**
 * Self-contained HTML rendered INSIDE the OAuth popup window after Facebook
 * redirects back. No SPA boot — the popup talks to the API directly, then
 * postMessages the opener (the app) and closes itself.
 *
 * Three states:
 *   - success : one Page connected (or auto-connected when only one exists)
 *   - select  : account manages 2+ Pages → user picks one, we POST select-page
 *   - error   : no pages / denied / token failure
 *
 * The opener listens for `{ type: 'genxcrm-oauth', provider, status, ... }`
 * (see frontend/src/hooks/useIntegrations.ts) and shows a toast + refreshes.
 */

export type FacebookOAuthResult =
  | { kind: 'success'; accountName: string }
  | { kind: 'select'; selectionToken: string; pages: { id: string; name: string }[] }
  | { kind: 'error'; message: string };

const esc = (s: string): string =>
  s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
  );

const STYLE = `
  :root{
    --bg:224 30% 7%;--fg:220 15% 92%;--border:224 20% 18%;--card:224 28% 10%;
    --card-border:224 20% 16%;--muted:224 20% 14%;--mfg:220 12% 58%;
    --primary:176 72% 44%;--green:152 60% 45%;--red:0 70% 60%;--fb:#1877F2;
  }
  *{box-sizing:border-box}html,body{margin:0;height:100%}
  body{background:radial-gradient(900px 500px at 20% -10%,hsl(176 72% 44%/.07),transparent 60%),hsl(var(--bg));
    color:hsl(var(--fg));font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
    -webkit-font-smoothing:antialiased;display:flex;align-items:flex-start;justify-content:center;padding:30px 22px}
  .pop{width:100%;max-width:380px;display:flex;flex-direction:column;min-height:420px}
  .head{display:flex;align-items:center;gap:10px;margin-bottom:20px}
  .mark{width:30px;height:30px;border-radius:8px;background:hsl(var(--primary));display:flex;align-items:center;justify-content:center;flex-shrink:0}
  .brand{font-size:13px;font-weight:700;letter-spacing:-.01em;line-height:1.25}
  .brand span{display:block;font-size:10.5px;font-weight:500;color:hsl(var(--mfg))}
  h3{font-size:17px;margin:0 0 5px;letter-spacing:-.01em;font-weight:660}
  .sub{font-size:12.5px;color:hsl(var(--mfg));margin:0 0 18px;line-height:1.5}
  .pages{display:flex;flex-direction:column;gap:8px}
  .opt{display:flex;align-items:center;gap:11px;border:1px solid hsl(var(--card-border));background:hsl(var(--card));
    border-radius:11px;padding:11px 13px;cursor:pointer;transition:border-color .12s,background .12s;text-align:left;width:100%;color:inherit;font:inherit}
  .opt:hover{border-color:hsl(var(--primary)/.5)}
  .opt.sel{border-color:hsl(var(--primary));background:hsl(var(--primary)/.08)}
  .av{width:34px;height:34px;border-radius:9px;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:14px;color:#fff;background:linear-gradient(135deg,#1877F2,#0a52c0)}
  .meta{min-width:0;flex:1}.nm{font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .id{font-size:11px;color:hsl(var(--mfg));font-family:ui-monospace,monospace}
  .radio{width:18px;height:18px;border-radius:50%;border:2px solid hsl(var(--border));flex-shrink:0;position:relative;transition:border-color .12s}
  .opt.sel .radio{border-color:hsl(var(--primary))}
  .opt.sel .radio::after{content:"";position:absolute;inset:3px;border-radius:50%;background:hsl(var(--primary))}
  .foot{margin-top:auto;padding-top:18px;display:flex;flex-direction:column;gap:10px}
  .note{font-size:11px;color:hsl(var(--mfg));line-height:1.45}
  .btn{width:100%;background:hsl(var(--primary));color:#06201d;border:0;border-radius:10px;padding:12px;font-size:13.5px;font-weight:700;cursor:pointer;transition:filter .15s,opacity .15s}
  .btn:hover{filter:brightness(1.06)}.btn:disabled{opacity:.45;cursor:not-allowed}
  .btn.ghost{background:hsl(var(--muted));color:hsl(var(--fg));width:auto;align-self:center;padding:11px 22px}
  .result{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;gap:14px;padding:10px 6px 26px}
  .ic{width:62px;height:62px;border-radius:50%;display:flex;align-items:center;justify-content:center}
  .ic.ok{background:hsl(var(--green)/.14);color:hsl(var(--green))}
  .ic.err{background:hsl(var(--red)/.14);color:hsl(var(--red))}
  .result h3{font-size:18px}.result p{font-size:13px;color:hsl(var(--mfg));margin:0;line-height:1.55;max-width:270px}
  .acct{color:hsl(var(--fg));font-weight:600}
  .closing{font-size:11px;color:hsl(var(--mfg));display:inline-flex;align-items:center;gap:7px;margin-top:4px}
  .spin{width:13px;height:13px;border-radius:50%;border:2px solid hsl(var(--border));border-top-color:hsl(var(--primary));animation:sp .8s linear infinite}
  @keyframes sp{to{transform:rotate(360deg)}}
`;

const MARK = `<svg viewBox="0 0 24 24" fill="none" stroke="#06201d" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" width="17" height="17"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1"/></svg>`;
const CHECK = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" width="30" height="30"><polyline points="20 6 9 17 4 12"/></svg>`;
const XMARK = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" width="30" height="30"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;

function successView(name: string): string {
  return `<div class="result">
    <div class="ic ok">${CHECK}</div>
    <h3>Page connected</h3>
    <p><span class="acct">${esc(name)}</span> is now linked. New leads will flow into GenX&nbsp;CRM automatically.</p>
    <span class="closing"><span class="spin"></span>Closing this window…</span>
  </div>`;
}

function errorView(message: string): string {
  return `<div class="result">
    <div class="ic err">${XMARK}</div>
    <h3>Couldn’t connect</h3>
    <p>${esc(message)}</p>
    <button class="btn ghost" onclick="window.close()">Close</button>
  </div>`;
}

function selectView(pages: { id: string; name: string }[]): string {
  const opts = pages
    .map(
      (p) => `<button type="button" class="opt" data-id="${esc(p.id)}" data-name="${esc(p.name)}">
        <div class="av">${esc((p.name.trim()[0] ?? 'F').toUpperCase())}</div>
        <div class="meta"><div class="nm">${esc(p.name)}</div><div class="id">Page ID ····${esc(p.id.slice(-4))}</div></div>
        <div class="radio"></div>
      </button>`,
    )
    .join('');
  return `<h3>Choose a Page to connect</h3>
    <p class="sub">Your Facebook account manages ${pages.length} Pages. Pick the one that runs your lead ads.</p>
    <div class="pages">${opts}</div>
    <div class="foot">
      <p class="note">Only one Page can be connected per workspace. You can switch Pages later from Integrations.</p>
      <button class="btn" id="connectBtn" disabled>Connect Page</button>
    </div>`;
}

/**
 * @param result        outcome of the OAuth callback
 * @param frontendOrigin origin of the app (postMessage target), e.g. https://app.genxcrm.com
 */
export function renderFacebookOAuthPopup(result: FacebookOAuthResult, frontendOrigin: string): string {
  const inner =
    result.kind === 'success'
      ? successView(result.accountName)
      : result.kind === 'error'
        ? errorView(result.message)
        : selectView(result.pages);

  // Data the inline script needs. Stringified safely for embedding in <script>.
  const bootstrap = JSON.stringify({
    kind: result.kind,
    origin: frontendOrigin,
    account: result.kind === 'success' ? result.accountName : null,
    message: result.kind === 'error' ? result.message : null,
    token: result.kind === 'select' ? result.selectionToken : null,
  }).replace(/</g, '\\u003c');

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Connect Facebook · GenX CRM</title><style>${STYLE}</style></head>
<body><div class="pop">
  <div class="head"><div class="mark">${MARK}</div><div class="brand">GenX CRM<span>Connecting Facebook</span></div></div>
  <div id="body">${inner}</div>
</div>
<script>
(function(){
  var boot = ${bootstrap};
  function notify(status, extra){
    try{ if(window.opener) window.opener.postMessage(Object.assign({type:'genxcrm-oauth',provider:'facebook',status:status},extra||{}), boot.origin); }catch(e){}
  }
  function showSuccess(name){
    document.getElementById('body').innerHTML =
      '<div class="result"><div class="ic ok">${CHECK.replace(/'/g, "\\'")}</div>'
      + '<h3>Page connected</h3><p><span class="acct">'+ (name||'') +'</span> is now linked. New leads will flow into GenX&nbsp;CRM automatically.</p>'
      + '<span class="closing"><span class="spin"></span>Closing this window…</span></div>';
  }
  function showError(msg){
    document.getElementById('body').innerHTML =
      '<div class="result"><div class="ic err">${XMARK.replace(/'/g, "\\'")}</div>'
      + '<h3>Couldn’t connect</h3><p>'+ (msg||'Something went wrong.') +'</p>'
      + '<button class="btn ghost" onclick="window.close()">Close</button></div>';
  }

  if(boot.kind === 'success'){
    notify('success', {account: boot.account});
    setTimeout(function(){ window.close(); }, 1400);
    return;
  }
  if(boot.kind === 'error'){
    notify('error', {message: boot.message});
    return;
  }

  // ── select ──
  var selected = null;
  var opts = document.querySelectorAll('.opt');
  var connectBtn = document.getElementById('connectBtn');
  opts.forEach(function(el){
    el.addEventListener('click', function(){
      opts.forEach(function(x){ x.classList.remove('sel'); });
      el.classList.add('sel');
      selected = { id: el.getAttribute('data-id'), name: el.getAttribute('data-name') };
      connectBtn.disabled = false;
      connectBtn.textContent = 'Connect “' + selected.name + '”';
    });
  });
  connectBtn.addEventListener('click', function(){
    if(!selected) return;
    connectBtn.disabled = true;
    connectBtn.textContent = 'Connecting…';
    // 'select-page' is relative to this callback URL → /…/facebook/oauth/select-page
    fetch('select-page', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ token: boot.token, pageId: selected.id })
    }).then(function(r){ return r.json().then(function(j){ return {ok:r.ok, j:j}; }); })
      .then(function(res){
        if(res.ok && res.j.status === 'success'){
          showSuccess(res.j.account || selected.name);
          notify('success', {account: res.j.account || selected.name});
          setTimeout(function(){ window.close(); }, 1400);
        } else {
          showError(res.j.message || 'Could not connect that Page.');
          notify('error', {message: res.j.message || 'Could not connect that Page.'});
        }
      })
      .catch(function(){
        showError('Network error — please try again.');
        notify('error', {message:'Network error while connecting.'});
      });
  });
})();
</script>
</body></html>`;
}
