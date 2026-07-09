// Discover board: three-column live token board fed by the hoodlaunch backend.
(function () {
  const API = window.HOODLAUNCH_API || 'https://hoodlaunchbackend-production.up.railway.app';
  const EXPLORER = 'https://robinhoodchain.blockscout.com';
  const BUCKETS = ['new', 'graduating', 'graduated'];

  let ethUsd = 0;
  let board = { new: [], graduating: [], graduated: [] };
  const filters = { new: '', graduating: '', graduated: '' };

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

  function pctChip(label, v) {
    const cls = v > 0 ? 'up' : v < 0 ? 'down' : '';
    const sign = v > 0 ? '+' : '';
    return '<span class="hl-chip2 ' + cls + '">' + label + ' ' + sign + v.toFixed(v && Math.abs(v) < 10 ? 1 : 0) + '%</span>';
  }

  function esc(s) {
    return String(s || '').replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function card(t) {
    const shortCa = t.address.slice(0, 4) + '…' + t.address.slice(-4);
    const avatar = t.image_url
      ? '<img src="' + esc(t.image_url) + '" alt=""/>'
      : '<span>' + esc((t.symbol || '?')[0].toUpperCase()) + '</span>';
    const socials = [];
    if (t.socials && t.socials.twitter) socials.push('<a class="hl-soc" href="https://x.com/' + esc(String(t.socials.twitter).replace(/^@|.*\//, '')) + '" target="_blank" rel="noopener">𝕏</a>');
    if (t.socials && t.socials.telegram) socials.push('<a class="hl-soc" href="https://t.me/' + esc(String(t.socials.telegram).replace(/^@|.*\//, '')) + '" target="_blank" rel="noopener">✈</a>');
    if (t.socials && t.socials.website) socials.push('<a class="hl-soc" href="' + esc(t.socials.website) + '" target="_blank" rel="noopener">🌐</a>');

    return (
      '<a class="hl-tcard" href="' + EXPLORER + '/token/' + t.address + '" target="_blank" rel="noopener">' +
        '<div class="hl-tcard-left">' +
          '<div class="hl-avatar" style="--pct:' + Math.round(t.graduationPct) + '%">' + '<div class="hl-avatar-in">' + avatar + '</div></div>' +
          '<div class="hl-tcard-ca">' + shortCa + '</div>' +
        '</div>' +
        '<div class="hl-tcard-main">' +
          '<div class="hl-tcard-line1">' +
            '<span class="hl-sym">' + esc(t.symbol) + '</span>' +
            '<span class="hl-tname">' + esc(t.name) + '</span>' +
            '<button class="hl-copy" data-ca="' + t.address + '" title="Copy CA">⧉</button>' +
            socials.join('') +
          '</div>' +
          '<div class="hl-tcard-line2">' +
            '<span class="hl-age">' + fmtAge(t.created_at) + '</span>' +
            '<span class="hl-mini">👤 ' + t.holders + '</span>' +
            '<span class="hl-mini">TX ' + t.txns24h + '</span>' +
          '</div>' +
          '<div class="hl-chips">' +
            pctChip('5m', t.priceChange5m) +
            pctChip('1h', t.priceChange1h) +
            pctChip('24h', t.priceChange24h) +
            '<span class="hl-chip2">🎓 ' + Math.round(t.graduationPct) + '%</span>' +
            '<span class="hl-buypill" title="Trading panel coming next">⚡ Buy</span>' +
          '</div>' +
        '</div>' +
        '<div class="hl-tcard-right">' +
          '<div class="hl-metr"><span>V</span><b>' + fmtUsd(t.volume24hEth) + '</b></div>' +
          '<div class="hl-metr"><span>MC</span><b class="mc">' + fmtUsd(t.marketCapEth) + '</b></div>' +
        '</div>' +
      '</a>'
    );
  }

  function render(bucket) {
    const kw = filters[bucket].toLowerCase();
    const list = board[bucket].filter(function (t) {
      return !kw || (t.symbol + ' ' + t.name + ' ' + t.address).toLowerCase().includes(kw);
    });
    document.getElementById('hl-count-' + bucket).textContent = list.length;
    document.getElementById('hl-col-' + bucket).innerHTML = list.length
      ? list.map(card).join('')
      : '<div class="hl-empty">🪧<br/>No Data</div>';
  }

  async function refresh() {
    const res = await fetch(API + '/api/board');
    board = await res.json();
    try {
      const p = await fetch('https://api.coinbase.com/v2/prices/ETH-USD/spot').then(function (r) { return r.json(); });
      ethUsd = Number(p.data.amount);
    } catch (e) {}
    BUCKETS.forEach(render);
  }

  document.addEventListener('click', function (e) {
    const btn = e.target.closest && e.target.closest('.hl-copy');
    if (btn) {
      e.preventDefault();
      e.stopPropagation();
      navigator.clipboard.writeText(btn.dataset.ca);
      btn.textContent = '✓';
      setTimeout(function () { btn.textContent = '⧉'; }, 900);
    }
  });

  BUCKETS.forEach(function (b) {
    document.getElementById('hl-search-' + b).addEventListener('input', function () {
      filters[b] = this.value.trim();
      render(b);
    });
  });

  refresh();
  setInterval(refresh, 5000);
})();
