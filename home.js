// Home: pump-style coin grid fed by /api/board.
(function () {
  const API = window.HOODLAUNCH_API || 'https://hoodlaunchbackend-production.up.railway.app';
  const EXPLORER = 'https://robinhoodchain.blockscout.com';

  let ethUsd = 0;
  let board = { new: [], graduating: [], graduated: [] };
  let bucket = 'all';
  let keyword = '';

  function fmtUsd(eth) {
    if (!ethUsd) return eth < 0.001 ? eth.toExponential(1) + ' ETH' : eth.toFixed(3) + ' ETH';
    const n = eth * ethUsd;
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + n.toFixed(2);
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

  // deterministic little sparkline from the token address (placeholder until candles wire in)
  function spark(t) {
    const up = t.priceChange24h >= 0;
    let seed = 0;
    for (let i = 2; i < 10; i++) seed = (seed * 31 + t.address.charCodeAt(i)) % 997;
    const pts = [];
    let y = 26;
    for (let x = 0; x <= 100; x += 10) {
      seed = (seed * 73 + 11) % 997;
      y = Math.min(30, Math.max(4, y + ((seed % 11) - (up ? 6 : 4))));
      pts.push(x + ',' + y);
    }
    const color = up ? '#00e33d' : '#ff5470';
    return '<svg viewBox="0 0 100 32" preserveAspectRatio="none"><polyline points="' + pts.join(' ') +
      '" fill="none" stroke="' + color + '" stroke-width="1.6" opacity="0.9"/></svg>';
  }

  function card(t) {
    const img = t.image_url
      ? '<img src="' + esc(t.image_url) + '" alt=""/>'
      : '<span class="letter">' + esc((t.symbol || '?')[0].toUpperCase()) + '</span>';
    return (
      '<a class="pcard" href="' + EXPLORER + '/token/' + t.address + '" target="_blank" rel="noopener">' +
        '<div class="pcard-img">' + img + '<div class="pcard-spark">' + spark(t) + '</div></div>' +
        '<div class="pcard-name">' + esc(t.name) + '</div>' +
        '<div class="pcard-tick">$' + esc(t.symbol) + '</div>' +
        '<div class="pcard-mc"><b>' + fmtUsd(t.marketCapEth) + '</b><span>MC</span></div>' +
        '<div class="pcard-meta"><span>🌱 ' + t.creator.slice(0, 4) + '…' + t.creator.slice(-4) + '</span>' +
        '<span class="age">' + fmtAge(t.created_at) + '</span></div>' +
      '</a>'
    );
  }

  function render() {
    const list = (bucket === 'all'
      ? board.graduated.concat(board.graduating, board.new)
      : board[bucket]
    ).filter(function (t) {
      return !keyword || (t.symbol + ' ' + t.name + ' ' + t.address).toLowerCase().includes(keyword);
    });
    document.getElementById('home-grid').innerHTML = list.length
      ? list.map(card).join('')
      : '<div class="grid-empty">No coins here yet — be the first to <a href="/launch" style="color:var(--green)">launch one</a>.</div>';
  }

  async function refresh() {
    const res = await fetch(API + '/api/board');
    board = await res.json();
    try {
      const p = await fetch('https://api.coinbase.com/v2/prices/ETH-USD/spot').then(function (r) { return r.json(); });
      ethUsd = Number(p.data.amount);
    } catch (e) {}
    render();
  }

  document.getElementById('home-tabs').addEventListener('click', function (e) {
    const tab = e.target.closest('.tab');
    if (!tab) return;
    document.querySelectorAll('#home-tabs .tab').forEach(function (el) { el.classList.remove('on'); });
    tab.classList.add('on');
    bucket = tab.dataset.bucket;
    render();
  });

  document.getElementById('home-search').addEventListener('input', function () {
    keyword = this.value.trim().toLowerCase();
    render();
  });

  refresh();
  setInterval(refresh, 5000);
})();
