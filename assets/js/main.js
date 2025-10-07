
const isGhPages = location.hostname.endsWith('github.io');
const repo = isGhPages ? `/${location.pathname.split('/').filter(Boolean)[0] || ''}` : '';
const TEMPLATES_URL = `${repo}/assets/data/templates.json`;



// Load header/footer includes, then initialize interactions
async function loadIncludes() {
  const includeEls = document.querySelectorAll('[data-include]');
  await Promise.all(Array.from(includeEls).map(async el => {
    const src = el.getAttribute('data-include');
    const res = await fetch(src);
    el.innerHTML = await res.text();
  }));
}

function initNavAndDropdowns(){
  const y = document.getElementById('year'); if (y) y.textContent = new Date().getFullYear();

  // Desktop dropdown open/close
  document.querySelectorAll('.nav-dropdown').forEach(dd => {
    const trigger = dd.querySelector('.nav-link');
    const menu = dd.querySelector('.dropdown');
    if (!trigger || !menu) return;
    const close = ()=>{ dd.classList.remove('open'); trigger.setAttribute('aria-expanded','false'); };
    trigger.addEventListener('click', (e) => {
      e.preventDefault();
      dd.classList.toggle('open');
      trigger.setAttribute('aria-expanded', String(dd.classList.contains('open')));
    });
    document.addEventListener('click', (e) => { if (!dd.contains(e.target)) close(); });
    dd.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  });

  // Mobile drawer
  const toggle = document.querySelector('.nav-toggle');
  const drawer = document.querySelector('[data-drawer]');
  const backdrop = document.querySelector('[data-backdrop]');
  const closeBtn = document.querySelector('.drawer-close');

  const openDrawer = ()=>{
    if (!drawer) return;
    drawer.classList.add('open');
    drawer.setAttribute('aria-hidden','false');
    if (backdrop) backdrop.classList.add('show');
    document.body.style.overflow = 'hidden';
  };
  const closeDrawer = ()=>{
    if (!drawer) return;
    drawer.classList.remove('open');
    drawer.setAttribute('aria-hidden','true');
    if (backdrop) backdrop.classList.remove('show');
    document.body.style.overflow = '';
  };

  if (toggle) toggle.addEventListener('click', (e)=>{ e.preventDefault(); openDrawer(); });
  if (backdrop) backdrop.addEventListener('click', closeDrawer);
  if (closeBtn) closeBtn.addEventListener('click', closeDrawer);
  document.querySelectorAll('[data-drawer-close]').forEach(a=>{
    a.addEventListener('click', closeDrawer); // close on link tap
  });
  document.addEventListener('keydown', (e)=>{ if (e.key === 'Escape') closeDrawer(); });

  // Smooth scroll (in-page links)
  document.querySelectorAll('a[href^="#"]').forEach(a => {
    a.addEventListener('click', (e) => {
      const id = a.getAttribute('href').slice(1);
      const target = document.getElementById(id);
      if (target){ e.preventDefault(); target.scrollIntoView({behavior:'smooth', block:'start'}); }
    });
  });
}

function initReveal(){
  // One-time reveal (prevents flicker/jumping near viewport edges)
  const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const els = document.querySelectorAll('.reveal');
  if (prefersReduced){ els.forEach(el => el.classList.add('in-view')); }
  else {
    const io = new IntersectionObserver((entries, obs) => {
      entries.forEach(entry => {
        if (entry.isIntersecting){
          entry.target.classList.add('in-view');
          obs.unobserve(entry.target); // reveal once
        }
      });
    }, { threshold: 0.25, rootMargin: "-10% 0px -10% 0px" });
    els.forEach(el => io.observe(el));
  }
}

function ensureTopOnLoad(){
  try { history.scrollRestoration = 'manual'; } catch(e){}
  if (!location.hash){
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  }
}

/* ---------------- Template Showcase (no quick preview) ---------------- */
const tplState = { items: [], filter: 'All' };

async function initTemplateShowcase(){
  try{
    const res = await fetch(TEMPLATES_URL);
    tplState.items = await res.json();
    renderFilters();
    renderTemplates();
  }catch(e){ console.error('Templates load failed', e); }
}

function renderFilters(){
  const chips = document.querySelectorAll('#template-filters .filter-chip');
  chips.forEach(chip=>{
    chip.addEventListener('click', ()=>{
      chips.forEach(c=>c.classList.remove('active'));
      chip.classList.add('active');
      tplState.filter = chip.dataset.filter;
      renderTemplates();
    });
  });
}

function renderTemplates(){
  const grid = document.getElementById('templates-grid');
  if (!grid) return;
  const items = tplState.filter === 'All'
    ? tplState.items
    : tplState.items.filter(t => t.category === tplState.filter);

  grid.innerHTML = items.map(t => {
    const thumb = t.thumb ? `<img src="${t.thumb}" alt="${t.name}" loading="lazy">` : '';
    return `
      <article class="card template-card reveal" data-id="${t.id}">
        <div class="template-thumb">${thumb}</div>
        <h3>${t.name}</h3>
        <p class="muted">${t.description || ''}</p>
        <div class="btn-row">
          <a class="btn" href="${t.demo || '#'}" target="_blank" rel="noopener">View live</a>
        </div>
      </article>
    `;
  }).join('');

  // animate newly injected cards
  initReveal();
}
/* ---------------- /Template Showcase ---------------- */

(async function(){
  await loadIncludes();

  // Normalize absolute site links for GitHub Pages project sites
  (function normalizeLinksForGhPages(){
    // If we're on username.github.io, add the repo segment (e.g., /wiley-digital) to /-prefixed links
    const isGhPages = location.hostname.endsWith('github.io');
    const repoSegment = isGhPages ? `/${location.pathname.split('/').filter(Boolean)[0] || ''}` : '';
    document.querySelectorAll('a[href^="/"]').forEach(a => {
      const href = a.getAttribute('href'); // e.g., /index.html#contact
      if (isGhPages && repoSegment && !href.startsWith(repoSegment)) {
        a.setAttribute('href', repoSegment + href); // → /wiley-digital/index.html#contact
      }
    });
  })();



  // Active link highlight (sidebar)
  (function setActiveInDrawer(){
    const here = new URL(location.href);
    document.querySelectorAll('.drawer-link[href]').forEach(a=>{
      try{
        const url = new URL(a.getAttribute('href'), location.origin);
        const samePath = url.pathname === here.pathname;
        const hashOk = url.hash === '' || url.hash === here.hash;
        if (samePath && hashOk) a.classList.add('active');
      }catch(_){}
    });
  })();

  ensureTopOnLoad();
  initNavAndDropdowns();
  initReveal();

  if (document.getElementById('templates-grid')) {
    initTemplateShowcase();
  }
})();
