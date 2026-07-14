// Privy login layer, shared across all pages. Privy is identity only — it
// authenticates the user's existing Phantom/Solana wallet and never creates a
// wallet. On success we register the profile with our backend.
(function () {
  const API = window.HOODLAUNCH_API || 'https://hoodlaunchbackend-production.up.railway.app';
  const PRIVY_APP_ID = window.PRIVY_APP_ID || '';

  const state = { ready: false, user: null, solana: null, token: null };
  window.hlAuth = state;

  function injectButton() {
    if (document.getElementById('hl-auth')) return;
    // top-right floating auth control, present on every page
    const el = document.createElement('div');
    el.id = 'hl-auth';
    el.innerHTML = '<button id="hl-auth-btn" class="hl-authbtn">Log in</button>';
    document.body.appendChild(el);
    document.getElementById('hl-auth-btn').addEventListener('click', onClick);
    render();
  }

  function render() {
    const btn = document.getElementById('hl-auth-btn');
    if (!btn) return;
    if (state.solana) {
      btn.textContent = state.solana.slice(0, 4) + '…' + state.solana.slice(-4);
      btn.classList.add('on');
    } else {
      btn.textContent = 'Log in';
      btn.classList.remove('on');
    }
  }

  async function registerWithBackend() {
    if (!state.token || !state.solana) return;
    try {
      const res = await fetch(API + '/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + state.token,
          'x-solana-address': state.solana,
        },
      });
      if (res.ok) state.user = (await res.json()).profile;
    } catch (e) {}
    render();
    window.dispatchEvent(new CustomEvent('hl-auth-changed'));
  }

  async function onClick() {
    if (!window.Privy) { alert('Login is warming up — try again in a second.'); return; }
    if (state.solana) {
      // logged in → go to profile
      if (location.pathname !== '/profile') location.href = '/profile';
      return;
    }
    try {
      await window.__privy.login();
    } catch (e) {
      console.error('[auth] login failed', e);
    }
  }

  async function syncFromPrivy() {
    const p = window.__privy;
    if (!p) return;
    const authed = await p.isAuthenticated();
    if (!authed) { state.solana = null; state.token = null; state.user = null; render(); return; }
    const user = await p.getUser();
    const sol = (user.linkedAccounts || []).find(function (a) {
      return a.type === 'wallet' && a.chainType === 'solana';
    });
    state.solana = sol ? sol.address : null;
    state.token = await p.getAccessToken();
    if (state.solana) registerWithBackend();
    render();
  }

  function boot() {
    injectButton();
    if (!PRIVY_APP_ID) { console.warn('[auth] PRIVY_APP_ID not set — login disabled'); return; }
    const s = document.createElement('script');
    s.src = 'https://unpkg.com/@privy-io/js-sdk-core@latest/dist/index.umd.js';
    s.onload = async function () {
      // Privy core client, Solana external wallet login only (no embedded wallets)
      window.__privy = new window.Privy.PrivyClient({
        appId: PRIVY_APP_ID,
        config: { embeddedWallets: { createOnLogin: 'off' } },
      });
      window.__privy.on && window.__privy.on('auth', syncFromPrivy);
      await syncFromPrivy();
    };
    s.onerror = function () { console.warn('[auth] Privy SDK failed to load'); };
    document.head.appendChild(s);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
