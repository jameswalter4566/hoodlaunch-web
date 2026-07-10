// Landing: live sample markets + a real candlestick chart inside the app frame.
(function () {
  const API = window.HOODLAUNCH_API || 'https://hoodlaunchbackend-production.up.railway.app';

  function usd(n) {
    if (!n) return '$0';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + n.toFixed(2);
  }

  function esc(s) {
    return String(s || '').replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  async function boot() {
    const data = await fetch(API + '/api/pulse').then(function (r) { return r.json(); });
    const all = [].concat(data.migrated, data.finalStretch, data.newPairs)
      .sort(function (a, b) { return b.volume24hUsd - a.volume24hUsd; });
    const top = all.slice(0, 7);

    document.getElementById('ld-mkts').innerHTML = top.map(function (t) {
      const chg = t.change24h;
      const letter = esc((t.symbol || '?')[0].toUpperCase());
      const img = t.imageUrl
        ? '<span>' + letter + '</span><img src="' + esc(t.imageUrl) + '" loading="lazy" onerror="this.remove()"/>'
        : '<span>' + letter + '</span>';
      return (
        '<a class="ld-mkt" href="/coin/' + t.token + '">' +
          '<div class="ld-mkt-img">' + img + '</div>' +
          '<div class="ld-mkt-main"><b>' + esc(t.symbol) + '</b><span>' + usd(t.fdvUsd) + ' MC</span></div>' +
          '<div class="ld-mkt-right"><b>' + usd(t.volume24hUsd) + '</b>' +
            '<span class="' + (chg > 0 ? 'up' : chg < 0 ? 'down' : '') + '">' + (chg > 0 ? '+' : '') + chg.toFixed(0) + '%</span></div>' +
        '</a>'
      );
    }).join('');

    const star = top[0];
    if (!star) return;
    document.getElementById('ld-chart-head').innerHTML =
      '<b>' + esc(star.symbol) + '</b> /WETH · ' + usd(star.fdvUsd) + ' MC · ' + usd(star.volume24hUsd) + ' 24h vol';

    const rows = await fetch(API + '/api/tokens/' + star.token + '/candles?interval=300&limit=200')
      .then(function (r) { return r.json(); });
    if (!rows.length) return;
    const chart = LightweightCharts.createChart(document.getElementById('ld-chart'), {
      layout: { background: { color: 'transparent' }, textColor: '#9899a3', fontFamily: 'Manrope' },
      grid: { vertLines: { color: '#15141f' }, horzLines: { color: '#15141f' } },
      timeScale: { timeVisible: true, borderColor: '#1f1e2c' },
      rightPriceScale: { borderColor: '#1f1e2c' },
      autoSize: true,
    });
    const series = chart.addCandlestickSeries({
      upColor: '#21c95e', downColor: '#f6465d',
      wickUpColor: '#21c95e', wickDownColor: '#f6465d',
      borderVisible: false,
      priceFormat: { type: 'price', precision: 8, minMove: 0.00000001 },
    });
    series.setData(rows.reverse().map(function (r) {
      return { time: Number(r.t), open: Number(r.o), high: Number(r.h), low: Number(r.l), close: Number(r.c) };
    }));
  }

  boot();
})();
