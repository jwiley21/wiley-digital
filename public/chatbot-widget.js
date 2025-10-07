(() => {
  function mount() {
  // ====== CONFIG (UI only) ======
  const isLocalHost = ["localhost", "127.0.0.1", "0.0.0.0", "::1"].includes(location.hostname);
  const CONFIG = {
    apiUrl: isLocalHost
      ? "http://localhost:54321/functions/v1/chat"
      : "https://yivecykpaykggtxlsvit.supabase.co/functions/v1/chat",
    title: "Ask Jackson's AI",
    subtitle: "Websites, Apps & AI",
    welcome: "Hey! I'm your friendly AI assistant. Ask me about services, pricing, or tech stack.",
    brandColor: "#7C3AED",
    bubbleBg: "#7C3AED",
    cornerRadius: 16,
    position: { bottom: 20, right: 20 }
  };

  // ====== Session memory (persists across pages in same tab) ======
  const STORAGE_KEY = "wd_chat_history_v1";
  const storage = window.sessionStorage;
  const readSavedHistory = () => {
    try { const raw = storage.getItem(STORAGE_KEY); const arr = raw ? JSON.parse(raw) : []; return Array.isArray(arr) ? arr.filter(m => m && m.role && m.content) : []; } catch { return []; }
  };
  const historyFromDOM = (bodyEl) => Array.from(bodyEl.querySelectorAll('.jw-msg')).map(el => ({ role: el.classList.contains('jw-user') ? 'user' : 'assistant', content: el.textContent || '' }));
  const saveHistoryFromDOM = (bodyEl) => storage.setItem(STORAGE_KEY, JSON.stringify(historyFromDOM(bodyEl).slice(-50)));

  // ====== Styles ======
  const styles = `
  .jw-chat-root { position: fixed; right: 20px; bottom: 20px; font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; z-index: 2147483647; overflow: visible; pointer-events: none; }
  .jw-chat-button { border: none; cursor: pointer; box-shadow: 0 10px 20px rgba(0,0,0,0.15); width: 56px; height: 56px; display:flex; align-items:center; justify-content:center; color: #fff; box-sizing: border-box; }
  .jw-chat-panel { position: fixed; right: 20px; bottom: 84px; width: 360px; max-height: 70vh; display: none; flex-direction: column; overflow: hidden; background: #111827; color: #fff; box-shadow: 0 20px 50px rgba(0,0,0,0.35); box-sizing: border-box; }
  .jw-chat-button, .jw-chat-panel { pointer-events: auto; }
  .jw-chat-header { padding: 14px 16px; display:flex; align-items: center; justify-content: space-between; border-bottom: 1px solid rgba(255,255,255,0.08); }
  .jw-chat-title { font-weight: 700; font-size: 14px; }
  .jw-chat-subtitle { font-size: 12px; opacity: 0.7; }
  .jw-chat-body { padding: 12px; overflow-y: auto; display: flex; flex-direction: column; gap: 10px; }
  .jw-msg { border-radius: 12px; padding: 10px 12px; max-width: 80%; line-height: 1.35; font-size: 14px; }
  .jw-user { background: rgba(255,255,255,0.08); align-self: flex-end; }
  .jw-bot { background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.06); }
  .jw-chat-footer { display:flex; gap: 8px; padding: 10px; border-top: 1px solid rgba(255,255,255,0.08); }
  .jw-input { flex:1; background: #0B1220; color: #fff; border: 1px solid rgba(255,255,255,0.08); border-radius: 10px; padding: 10px 12px; font-size: 14px; outline: none; }
  .jw-send { border: none; padding: 10px 12px; color: #fff; cursor: pointer; }
  .jw-close, .jw-clear { background: transparent; border: none; color: #fff; opacity: 0.9; cursor: pointer; }
  .jw-typing { font-size: 12px; opacity: 0.7; padding: 0 12px 8px; }
  @media (max-width: 480px) {
    .jw-chat-panel { width: 92vw; right: 4vw; bottom: 88px; max-height: 76vh; }
  }
  `;
  const styleTag = document.createElement('style'); styleTag.textContent = styles; document.head.appendChild(styleTag);

  // ====== DOM ======
  const root = document.createElement('div'); root.className = 'jw-chat-root';
  const btn = document.createElement('button'); btn.className = 'jw-chat-button'; btn.style.background = CONFIG.bubbleBg; btn.style.borderRadius = CONFIG.cornerRadius + 'px';
  btn.innerHTML = '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M4 5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H9l-5 5V5z" fill="currentColor" /></svg>';
  const panel = document.createElement('div'); panel.className = 'jw-chat-panel'; panel.style.borderRadius = CONFIG.cornerRadius + 'px';
  panel.innerHTML = (
    '<div class="jw-chat-header" style="background:'+CONFIG.brandColor+'">'
    + '<div>'
    +   '<div class="jw-chat-title">'+CONFIG.title+'</div>'
    +   '<div class="jw-chat-subtitle">'+CONFIG.subtitle+'</div>'
    + '</div>'
    + '<div>'
    +   '<button class="jw-clear" title="Clear chat">🗑️</button>'
    +   '<button class="jw-close" title="Close">×</button>'
    + '</div>'
    + '</div>'
    + '<div class="jw-chat-body"></div>'
    + '<div class="jw-typing" style="display:none">Assistant is typing…</div>'
    + '<div class="jw-chat-footer">'
    +   '<input class="jw-input" placeholder="Ask anything..." />'
    +   '<button class="jw-send" style="background:'+CONFIG.brandColor+'; border-radius:'+(CONFIG.cornerRadius/2)+'px">Send</button>'
    + '</div>'
  );
  root.appendChild(panel); root.appendChild(btn); document.body.appendChild(root);

  const body = panel.querySelector('.jw-chat-body');
  const input = panel.querySelector('.jw-input');
  const send = panel.querySelector('.jw-send');
  const closeBtn = panel.querySelector('.jw-close');
  const clearBtn = panel.querySelector('.jw-clear');
  const typing = panel.querySelector('.jw-typing');

  // Restore session history
  const saved = readSavedHistory();
  if (saved.length) { saved.forEach(m => pushMsg(m.content, m.role === 'user' ? 'user' : 'bot')); body.dataset.welcomed = '1'; }

  function pushMsg(text, who){ const div = document.createElement('div'); div.className = 'jw-msg ' + (who === 'user' ? 'jw-user' : 'jw-bot'); div.textContent = text; body.appendChild(div); body.scrollTop = body.scrollHeight; saveHistoryFromDOM(body); }
  function toggle(open){ panel.style.display = open ? 'flex' : 'none'; btn.style.display = open ? 'none' : 'flex'; }

  btn.addEventListener('click', () => { toggle(true); if (!body.dataset.welcomed) { pushMsg(CONFIG.welcome, 'bot'); body.dataset.welcomed = '1'; } input && input.focus(); });
  closeBtn.addEventListener('click', () => toggle(false));
  clearBtn.addEventListener('click', () => { storage.removeItem(STORAGE_KEY); body.innerHTML=''; delete body.dataset.welcomed; pushMsg(CONFIG.welcome, 'bot'); });

  async function sendMsg(){
    const text = (input.value || '').trim(); if (!text) return; pushMsg(text, 'user'); input.value = '';
    typing.style.display = 'block';
    try{
      const history = historyFromDOM(body);
      const res = await fetch(CONFIG.apiUrl, { method:'POST', headers:{ 'Content-Type':'application/json', "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlpdmVjeWtwYXlrZ2d0eGxzdml0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTkzNzYyMTEsImV4cCI6MjA3NDk1MjIxMX0.qtRZW_XBH__G2R712U1t_MXX4bRCiAuw4DrVYCc_Kg0" }, body: JSON.stringify({ messages: history.slice(-14) }) });
      if (!res.ok) throw new Error('Request failed: '+res.status);
      const data = await res.json(); pushMsg(data.reply || 'Hmm, I did not catch that.', 'bot');
    }catch(err){ pushMsg('Sorry — something went wrong. Try again in a moment.', 'bot'); }
    finally{ typing.style.display = 'none'; }
  }
  send.addEventListener('click', sendMsg);
  input.addEventListener('keydown', (e)=>{ if (e.key === 'Enter') sendMsg(); });
  }
  if (document.readyState === 'complete' || document.readyState === 'interactive') mount();
  else document.addEventListener('DOMContentLoaded', mount, { once: true });
})();
