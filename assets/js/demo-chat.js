(() => {
  const isLocalHost = ["localhost", "127.0.0.1", "0.0.0.0", "::1"].includes(location.hostname);
  const API_URL = isLocalHost
    ? "http://localhost:54321/functions/v1/chat"
    : "https://yivecykpaykggtxlsvit.supabase.co/functions/v1/chat";

  const els = {
    file: document.getElementById('demo-file'),
    context: document.getElementById('demo-context'),
    name: document.getElementById('demo-name'),
    tone: document.getElementById('demo-tone'),
    temp: document.getElementById('demo-temp'),
    start: document.getElementById('demo-start'),
    clear: document.getElementById('demo-clear'),
    box: document.getElementById('demo-chat'),
    messages: document.getElementById('demo-messages'),
    inputWrap: document.getElementById('demo-input-wrap'),
    input: document.getElementById('demo-input'),
    send: document.getElementById('demo-send'),
    limit: document.getElementById('demo-limit'),
  };

  const state = {
    started: false,
    userQuestions: 0,
    userLimit: 5,
    history: [],
    systemPrompt: '',
  };

  function pushMsg(text, who){
    const div = document.createElement('div');
    div.className = 'demo-msg ' + (who === 'user' ? 'user' : 'bot');
    div.textContent = text;
    els.messages.appendChild(div);
    els.messages.scrollTop = els.messages.scrollHeight;
  }

  async function readFileAsText(file){
    if (!file) return '';
    const allowed = ['text/plain', 'text/markdown', 'text/csv', ''];
    if (!allowed.includes(file.type) && !/\.(txt|md|csv)$/i.test(file.name)){
      alert('Please upload a .txt, .md, or .csv file.');
      return '';
    }
    return new Promise((resolve, reject)=>{
      const r = new FileReader(); r.onload = () => resolve(String(r.result||'')); r.onerror = reject; r.readAsText(file);
    });
  }

  function buildSystemPrompt(){
    const name = (els.name.value || 'Demo Assistant').slice(0,80);
    const tone = els.tone.value || 'friendly';
    const raw = (els.context.value || '').replace(/\s+/g,' ').trim().slice(0, 2000);
    return [
      `You are a demo chatbot named "${name}" with a ${tone} tone.`,
      'Use ONLY the provided context below to answer questions. If the answer is not in context, say you are not sure and suggest contacting the business.',
      'Context:', raw || '(No context provided)'
    ].join('\n');
  }

  async function startDemo(){
    // Merge file + textarea content
    let fileText = '';
    if (els.file.files && els.file.files[0]){
      fileText = await readFileAsText(els.file.files[0]);
      els.context.value = (fileText + '\n\n' + (els.context.value || '')).trim();
    }
    state.systemPrompt = buildSystemPrompt();
    state.history = [ { role: 'system', content: state.systemPrompt } ];
    state.started = true;
    state.userQuestions = 0;
    els.messages.innerHTML = '';
    pushMsg('Demo started. Ask me about your content!', 'bot');
    els.input.focus();
  }

  async function send(){
    if (!state.started){ await startDemo(); }
    if (state.userQuestions >= state.userLimit){ return; }
    const text = (els.input.value || '').trim();
    if (!text) return;
    els.input.value = '';
    state.history.push({ role: 'user', content: text });
    pushMsg(text, 'user');
    state.userQuestions++;
    try{
      const res = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlpdmVjeWtwYXlrZ2d0eGxzdml0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTkzNzYyMTEsImV4cCI6MjA3NDk1MjIxMX0.qtRZW_XBH__G2R712U1t_MXX4bRCiAuw4DrVYCc_Kg0'
        },
        body: JSON.stringify({ messages: state.history.slice(-16) })
      });
      if (!res.ok) throw new Error('Request failed: ' + res.status);
      const data = await res.json();
      const reply = (data && data.reply) ? String(data.reply) : 'Hmm, I did not catch that.';
      state.history.push({ role: 'assistant', content: reply });
      pushMsg(reply, 'bot');
    }catch(err){
      pushMsg('Sorry — something went wrong. Please try again.', 'bot');
    }
    if (state.userQuestions >= state.userLimit){
      els.input.disabled = true;
      els.send.disabled = true;
      els.limit.style.display = 'block';
      els.limit.innerHTML = 'Demo limit reached. <a href="mailto:wileyjn@mail.uc.edu?subject=Custom%20Chatbot%20for%20my%20business">Email me to build your custom chatbot →</a>';
    }
  }

  // wire events
  els.start.addEventListener('click', (e)=>{ e.preventDefault(); startDemo(); });
  els.clear.addEventListener('click', (e)=>{
    e.preventDefault();
    Object.assign(state, { started:false, userQuestions:0, history:[], systemPrompt:'' });
    els.context.value=''; if (els.file) els.file.value='';
    els.input.disabled=false; els.send.disabled=false; els.limit.style.display='none';
    els.messages.innerHTML='';
  });
  els.send.addEventListener('click', (e)=>{ e.preventDefault(); send(); });
  els.input.addEventListener('keydown', (e)=>{ if (e.key === 'Enter') { e.preventDefault(); send(); } });
})();
