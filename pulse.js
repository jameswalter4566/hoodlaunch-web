// Pulse: chain-wide live new-pairs board fed by /api/pulse.
(function () {
  const API = window.HOODLAUNCH_API || 'https://hoodlaunchbackend-production.up.railway.app';
  const BUCKETS = ['newPairs', 'finalStretch', 'migrated'];

  let data = { newPairs: [], finalStretch: [], migrated: [], updatedAt: 0 };
  let filters = JSON.parse(localStorage.getItem('pl-filters') || '{}');

  const $ = function (id) { return document.getElementById(id); };

  function usd(n) {
    if (!n) return '$0';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + n.toFixed(n < 10 ? 2 : 0);
  }

  function fmtAge(iso) {
    const s = Math.max(1, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
    if (s < 60) return s + 's';
    if (s < 3600) return Math.floor(s / 60) + 'm';
    if (s < 86400) return Math.floor(s / 3600) + 'h';
    return Math.floor(s / 86400) + 'd';
  }

  function esc(s) {
    return String(s || '').replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function chip(label, v) {
    const cls = v > 0 ? 'up' : v < 0 ? 'down' : '';
    return '<span class="pl-chg ' + cls + '">' + label + ' ' + (v > 0 ? '+' : '') + v.toFixed(0) + '%</span>';
  }

  function socialLinks(t) {
    const s = t.socials || {};
    const out = [];
    const fix = function (u, base) {
      u = String(u);
      return u.startsWith('http') ? u : base + u.replace(/^@/, '');
    };
    if (s.twitter) out.push('<span class="pl-soc" data-url="' + esc(fix(s.twitter, 'https://x.com/')) + '">𝕏</span>');
    if (s.telegram) out.push('<span class="pl-soc" data-url="' + esc(fix(s.telegram, 'https://t.me/')) + '">✈</span>');
    if (s.website) out.push('<span class="pl-soc" data-url="' + esc(fix(s.website, 'https://')) + '">🌐</span>');
    return out.join('');
  }

  function row(t) {
    const letter = esc((t.symbol || '?')[0].toUpperCase());
    const img = t.imageUrl
      ? '<span>' + letter + '</span><img src="' + esc(t.imageUrl) + '" loading="lazy" onerror="this.remove()"/>'
      : '<span>' + letter + '</span>';
    const total = t.buys24h + t.sells24h;
    const buyPct = total ? Math.round((t.buys24h / total) * 100) : 50;
    const padCls = t.launchpad === 'bullish.run' ? 'ours' : t.launchpad === 'Noxa.Fun' ? 'noxa' : '';
    return (
      '<a class="pl-row" href="/coin/' + t.token + '">' +
        '<div class="pl-img">' + img + '</div>' +
        '<div class="pl-main">' +
          '<div class="pl-l1"><b>' + esc(t.symbol) + '</b><span class="pl-pairlbl">/' + t.pair + '</span>' +
            (t.feeTier ? '<span class="pl-fee">' + t.feeTier + '%</span>' : '') +
            '<button class="pl-copy" data-ca="' + t.token + '" title="Copy CA">⧉</button>' +
            socialLinks(t) +
          '</div>' +
          '<div class="pl-l2"><span class="pl-age">' + fmtAge(t.createdAt) + '</span>' +
            '<span class="pl-pad ' + padCls + '">' + esc(t.launchpad) + '</span>' +
            '<span class="pl-mini">TX ' + total + '</span>' +
            '<span class="pl-mini pl-bs"><i style="width:' + buyPct + '%"></i></span>' +
          '</div>' +
          '<div class="pl-l3">' + chip('5m', t.change5m) + chip('1h', t.change1h) + chip('24h', t.change24h) +
            '<span class="pl-mini">💧 ' + usd(t.liquidityUsd) + '</span>' +
          '</div>' +
        '</div>' +
        '<div class="pl-right">' +
          '<div class="pl-metr"><span>V</span><b>' + usd(t.volume24hUsd) + '</b></div>' +
          '<div class="pl-metr"><span>MC</span><b class="mc">' + usd(t.fdvUsd) + '</b></div>' +
          '<span class="pl-buy">⚡ Buy</span>' +
        '</div>' +
      '</a>'
    );
  }

  function passes(t) {
    if (filters.pads && filters.pads.length && !filters.pads.includes(t.launchpad)) return false;
    if (filters.ageMin && (Date.now() - new Date(t.createdAt).getTime()) / 60000 > filters.ageMin) return false;
    if (filters.liqMin && t.liquidityUsd < filters.liqMin) return false;
    if (filters.volMin && t.volume24hUsd < filters.volMin) return false;
    if (filters.mcMin && t.fdvUsd < filters.mcMin) return false;
    if (filters.mcMax && t.fdvUsd > filters.mcMax) return false;
    return true;
  }

  function activeFilterCount() {
    let n = 0;
    if (filters.pads && filters.pads.length) n++;
    ['ageMin', 'liqMin', 'volMin', 'mcMin', 'mcMax'].forEach(function (k) { if (filters[k]) n++; });
    return n;
  }

  function render() {
    const solana = localStorage.getItem('pl-market') === 'solana';
    BUCKETS.forEach(function (b) {
      const list = solana ? [] : data[b].filter(passes);
      $('pl-count-' + b).textContent = list.length;
      $('pl-col-' + b).innerHTML = list.length
        ? list.map(row).join('')
        : '<div class="pl-empty">🪧<br/>' + (solana ? 'Solana markets — coming soon' : 'No Data') + '</div>';
    });
    const n = activeFilterCount();
    $('pl-filter-count').textContent = n ? '(' + n + ')' : '';
    if (data.updatedAt) $('pl-updated').textContent = 'chain-wide · updated ' + fmtAge(new Date(data.updatedAt).toISOString()) + ' ago';
  }

  async function refresh() {
    const res = await fetch(API + '/api/pulse');
    data = await res.json();
    render();
  }

  // live stream: server pushes a fresh payload the moment the chain changes
  function connect() {
    const sock = new WebSocket(API.replace(/^http/, 'ws') + '/ws');
    sock.onmessage = function (e) {
      data = JSON.parse(e.data);
      render();
    };
    sock.onclose = function () { setTimeout(connect, 3000); };
  }
  connect();

  // ---------- filters modal ----------

  function openModal() {
    const pads = [...new Set([].concat(data.newPairs, data.finalStretch, data.migrated).map(function (t) { return t.launchpad; }))];
    $('pl-pads').innerHTML = pads.map(function (p) {
      const on = !filters.pads || !filters.pads.length || filters.pads.includes(p);
      return '<button class="pl-padchip' + (on ? ' on' : '') + '" data-pad="' + esc(p) + '">' + esc(p) + '</button>';
    }).join('');
    $('pl-age').value = filters.ageMin || '';
    $('pl-liq').value = filters.liqMin || '';
    $('pl-vol').value = filters.volMin || '';
    $('pl-mc-min').value = filters.mcMin || '';
    $('pl-mc-max').value = filters.mcMax || '';
    $('pl-filter-note').textContent = activeFilterCount() ? activeFilterCount() + ' filter(s) active' : 'No filters';
    $('pl-modal').hidden = false;
  }

  $('pl-filters-btn').addEventListener('click', openModal);
  $('pl-close').addEventListener('click', function () { $('pl-modal').hidden = true; });
  $('pl-cancel').addEventListener('click', function () { $('pl-modal').hidden = true; });
  $('pl-modal').addEventListener('click', function (e) { if (e.target === $('pl-modal')) $('pl-modal').hidden = true; });

  $('pl-pads').addEventListener('click', function (e) {
    const b = e.target.closest('.pl-padchip');
    if (b) b.classList.toggle('on');
  });

  document.querySelectorAll('.pl-presets').forEach(function (rowEl) {
    rowEl.addEventListener('click', function (e) {
      const b = e.target.closest('button');
      if (b) $(rowEl.dataset.for).value = b.dataset.v;
    });
  });

  $('pl-reset').addEventListener('click', function () {
    filters = {};
    localStorage.setItem('pl-filters', '{}');
    $('pl-modal').hidden = true;
    render();
  });

  $('pl-apply').addEventListener('click', function () {
    const pads = [...document.querySelectorAll('.pl-padchip.on')].map(function (b) { return b.dataset.pad; });
    const all = document.querySelectorAll('.pl-padchip').length;
    filters = {
      pads: pads.length === all ? [] : pads,
      ageMin: Number($('pl-age').value) || 0,
      liqMin: Number($('pl-liq').value) || 0,
      volMin: Number($('pl-vol').value) || 0,
      mcMin: Number($('pl-mc-min').value) || 0,
      mcMax: Number($('pl-mc-max').value) || 0,
    };
    localStorage.setItem('pl-filters', JSON.stringify(filters));
    $('pl-modal').hidden = true;
    render();
  });

  document.addEventListener('click', function (e) {
    const btn = e.target.closest && e.target.closest('.pl-copy');
    if (btn) {
      e.preventDefault();
      e.stopPropagation();
      navigator.clipboard.writeText(btn.dataset.ca);
      btn.textContent = '✓';
      setTimeout(function () { btn.textContent = '⧉'; }, 900);
    }
    const soc = e.target.closest && e.target.closest('.pl-soc');
    if (soc) {
      e.preventDefault();
      e.stopPropagation();
      window.open(soc.dataset.url, '_blank', 'noopener');
    }
  });

  document.getElementById('mkt-toggle').addEventListener('click', function (e) {
    const b = e.target.closest('button');
    if (!b) return;
    document.querySelectorAll('#mkt-toggle button').forEach(function (el) { el.classList.remove('on'); });
    b.classList.add('on');
    localStorage.setItem('pl-market', b.dataset.mkt);
    render();
  });
  (function () {
    const saved = localStorage.getItem('pl-market') || 'robinhood';
    document.querySelectorAll('#mkt-toggle button').forEach(function (el) {
      el.classList.toggle('on', el.dataset.mkt === saved);
    });
  })();

  refresh();
  setInterval(render, 5000); // keep ages ticking between pushes
})();
