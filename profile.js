// Profile page: the logged-in user's launches + fee claiming (fees bridge to
// their Phantom as SOL). Reads auth state from the shared auth.js (window.hlAuth).
(function () {
  const API = window.HOODLAUNCH_API || 'https://hoodlaunchbackend-production.up.railway.app';
  const EXPLORER = 'https://robinhoodchain.blockscout.com';
  let ethUsd = 0;

  const $ = function (id) { return document.getElementById(id); };

  function usd(eth) {
    if (!ethUsd) return (eth || 0).toFixed(4) + ' ETH';
    const n = eth * ethUsd;
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + n.toFixed(2);
  }

  function esc(s) {
    return String(s || '').replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  async function load() {
    const a = window.hlAuth;
    if (!a || !a.solana || !a.token) {
      $('pf-empty').hidden = false;
      $('pf-earn').hidden = true;
      $('pf-launches-h').hidden = true;
      $('pf-launches').innerHTML = '';
      return;
    }
    $('pf-empty').hidden = true;
    $('pf-name').textContent = a.solana.slice(0, 4) + '…' + a.solana.slice(-4);
    $('pf-sub').textContent = a.solana;
    $('pf-avatar').textContent = a.solana.slice(0, 2).toUpperCase();

    try {
      const p = await fetch('https://api.coinbase.com/v2/prices/ETH-USD/spot').then(function (r) { return r.json(); });
      ethUsd = Number(p.data.amount);
    } catch (e) {}

    const res = await fetch(API + '/api/me/launches', {
      headers: { Authorization: 'Bearer ' + a.token, 'x-solana-address': a.solana },
    });
    if (!res.ok) return;
    const data = await res.json();
    const launches = data.launches || [];

    $('pf-earn').hidden = false;
    $('pf-launches-h').hidden = launches.length === 0;
    $('pf-count').textContent = launches.length;

    let totalFees = 0;
    $('pf-launches').innerHTML = launches.map(function (t) {
      const img = t.image_url
        ? '<img src="' + esc(t.image_url) + '" onerror="this.remove()"/>'
        : esc((t.symbol || '?')[0].toUpperCase());
      return (
        '<div class="pf-row" data-pos="' + t.position_id + '" data-sym="' + esc(t.symbol) + '">' +
          '<div class="pf-row-img">' + img + '</div>' +
          '<div class="pf-row-main">' +
            '<a href="/coin/' + t.address + '"><b>' + esc(t.symbol) + '</b> <span>' + esc(t.name) + '</span></a>' +
            '<div class="pf-row-fee" id="fee-' + t.position_id + '">checking fees…</div>' +
          '</div>' +
          '<button class="pf-claim" data-pos="' + t.position_id + '">Claim</button>' +
        '</div>'
      );
    }).join('');

    // fetch accrued fees per position
    for (const t of launches) {
      try {
        const f = await fetch(API + '/api/fees/' + t.position_id).then(function (r) { return r.json(); });
        const feeEth = (f.creatorEth || 0);
        totalFees += feeEth;
        const el = $('fee-' + t.position_id);
        if (el) el.textContent = feeEth > 0 ? usd(feeEth) + ' claimable' : 'no fees yet';
      } catch (e) {}
    }
    $('pf-unclaimed').textContent = usd(totalFees);
  }

  document.addEventListener('click', async function (e) {
    const btn = e.target.closest && e.target.closest('.pf-claim');
    if (!btn) return;
    const a = window.hlAuth;
    if (!a || !a.token) return;
    const pos = btn.dataset.pos;
    btn.disabled = true;
    btn.textContent = 'Claiming…';
    try {
      const res = await fetch(API + '/api/claim', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + a.token,
          'x-solana-address': a.solana,
        },
        body: JSON.stringify({ positionId: pos }),
      });
      const out = await res.json();
      if (!res.ok) throw new Error(out.error || 'Claim failed');
      btn.textContent = '✓ Sent to Phantom';
      const fee = $('fee-' + pos);
      if (fee) fee.textContent = 'paid — ' + usd(out.solPaidEth || 0) + ' bridged to SOL';
    } catch (err) {
      btn.disabled = false;
      btn.textContent = 'Retry';
      const fee = $('fee-' + pos);
      if (fee) fee.textContent = err.message;
    }
  });

  $('pf-login').addEventListener('click', function () {
    document.getElementById('hl-auth-btn').click();
  });
  window.addEventListener('hl-auth-changed', load);
  // auth.js may have resolved before this script loaded
  if (window.hlAuth && window.hlAuth.solana) load();
  else load();
})();
