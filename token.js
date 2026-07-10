// Token page: fomo-style terminal layout, all data from the hoodlaunch backend.
(function () {
  const API = window.HOODLAUNCH_API || 'https://hoodlaunchbackend-production.up.railway.app';
  const SOLANA_RPC = window.HOODLAUNCH_SOLANA_RPC || (API + '/api/solana-rpc');
  const EXPLORER = 'https://robinhoodchain.blockscout.com';
  const address = (location.pathname.split('/').filter(Boolean).pop() || '').toLowerCase();

  let ethUsd = 0;
  let solUsd = 0;
  let token = null;
  let trades = [];
  let bucket = 'new';
  let keyword = '';
  let interval = 300;
  let side = 'buy';
  let pubkey = null;
  let evmAddr = null;
  let chart = null;
  let series = null;
  let web3Ready = null;

  function loadWeb3() {
    if (!web3Ready) {
      web3Ready = new Promise(function (resolve, reject) {
        const s = document.createElement('script');
        s.src = 'https://unpkg.com/@solana/web3.js@1.95.8/lib/index.iife.min.js';
        s.onload = function () { resolve(window.solanaWeb3); };
        s.onerror = function () { reject(new Error('Failed to load Solana web3 library')); };
        document.head.appendChild(s);
      });
    }
    return web3Ready;
  }

  function hexToBytes(hex) {
    const h = hex.replace(/^0x/, '');
    const out = new Uint8Array(h.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(h.substr(i * 2, 2), 16);
    return out;
  }

  const sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  const $ = function (id) { return document.getElementById(id); };

  function usd(eth, digits) {
    if (!ethUsd) return eth.toExponential(2) + ' ETH';
    const n = eth * ethUsd;
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + n.toFixed(digits == null ? 2 : digits);
  }

  function priceUsd(eth) {
    if (!ethUsd) return eth.toExponential(3) + ' ETH';
    const n = eth * ethUsd;
    if (n >= 0.01) return '$' + n.toFixed(4);
    return '$0.0' + '…' + n.toExponential(2).split('e')[0].replace('.', '').slice(0, 4);
  }

  function pct(v, el) {
    el.textContent = (v > 0 ? '+' : '') + v.toFixed(2) + '%';
    el.className = el.className.replace(/ ?(up|down)/g, '') + (v > 0 ? ' up' : v < 0 ? ' down' : '');
  }

  function ago(iso) {
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

  // ---------- left list ----------

  let board = { new: [], graduating: [], graduated: [] };

  function renderList() {
    const list = board[bucket].filter(function (t) {
      return !keyword || (t.symbol + ' ' + t.name + ' ' + t.address).toLowerCase().includes(keyword);
    });
    $('tk-list-body').innerHTML = list.map(function (t) {
      const img = tokenImg(t.image_url, t.address, t.symbol);
      const chg = t.priceChange24h;
      return (
        '<a class="tk-row' + (t.address === address ? ' on' : '') + '" href="/coin/' + t.address + '">' +
          '<div class="tk-row-img">' + img + '</div>' +
          '<div class="tk-row-main">' +
            '<div class="tk-row-sym">' + esc(t.symbol) + '</div>' +
            '<div class="tk-row-price">' + priceUsd(t.priceEth) + '</div>' +
          '</div>' +
          '<div class="tk-row-right">' +
            '<div class="tk-row-mc">' + usd(t.marketCapEth) + ' <span style="color:var(--txt3);font-weight:500;font-size:10.5px">MC</span></div>' +
            '<div class="tk-row-chg ' + (chg > 0 ? 'up' : chg < 0 ? 'down' : '') + '">' + (chg > 0 ? '▲' : chg < 0 ? '▼' : '') + ' ' + Math.abs(chg).toFixed(2) + '%</div>' +
          '</div>' +
        '</a>'
      );
    }).join('') || '<div class="tk-chart-empty" style="position:static;padding:40px 0">No tokens</div>';
  }

  // ---------- center ----------

  function tokenImg(imageUrl, addr, symbol) {
    const letter = esc((symbol || '?')[0].toUpperCase());
    const src = imageUrl || 'https://metadata.mobula.io/assets/logos/evm_4663_' + addr + '.webp';
    return '<span>' + letter + '</span><img src="' + esc(src) + '" loading="lazy" onerror="this.remove()"/>';
  }

  function renderHead(t) {
    $('tk-img').innerHTML = tokenImg(t.image_url, t.address, t.symbol);
    $('tk-sym').textContent = t.symbol;
    $('tk-name').textContent = t.name;
    $('tk-ca').textContent = t.address.slice(0, 6) + '…' + t.address.slice(-4) + ' ⧉';
    $('tk-mc').textContent = usd(t.marketCapEth);
    $('tk-price').textContent = priceUsd(t.priceEth);
    pct(t.priceChange24h, $('tk-chg'));
    $('tk-vol').textContent = usd(t.volume24hEth);
    $('tk-holders').textContent = t.holders;
    $('tk-grad').textContent = Math.round(t.graduationPct) + '%';
    $('tk-about-title').textContent = 'About ' + t.symbol;
    $('tk-about-desc').textContent = t.description || 'No description.';
    const soc = [];
    const s = t.socials || {};
    if (s.twitter) soc.push('<a href="https://x.com/' + esc(String(s.twitter).replace(/^@|.*\//, '')) + '" target="_blank" rel="noopener">𝕏 Twitter</a>');
    if (s.telegram) soc.push('<a href="https://t.me/' + esc(String(s.telegram).replace(/^@|.*\//, '')) + '" target="_blank" rel="noopener">✈ Telegram</a>');
    if (s.website) soc.push('<a href="' + esc(s.website) + '" target="_blank" rel="noopener">🌐 Website</a>');
    soc.push('<a href="' + EXPLORER + '/token/' + t.address + '" target="_blank" rel="noopener">⛓ Explorer</a>');
    $('tk-socials').innerHTML = soc.join('');
    pct(t.priceChange5m, $('tk-chip-5m'));
    pct(t.priceChange1h, $('tk-chip-1h'));
    pct(t.priceChange24h, $('tk-chip-1d'));
    $('tk-chip-grad').textContent = Math.round(t.graduationPct) + '%';
    document.title = usd(t.marketCapEth) + ' MC | ' + t.symbol + ' | bullish.run';
  }

  function renderSwaps() {
    $('tk-swaps').innerHTML = trades.slice(0, 60).map(function (tr) {
      return (
        '<tr>' +
          '<td>' + ago(tr.ts) + '</td>' +
          '<td class="side-' + tr.side + '">' + tr.side.toUpperCase() + '</td>' +
          '<td><b>' + usd(Number(tr.eth_amount)) + '</b></td>' +
          '<td>' + Number(tr.token_amount).toLocaleString(undefined, { maximumFractionDigits: 0 }) + '</td>' +
          '<td>' + tr.trader.slice(0, 6) + '…' + tr.trader.slice(-4) + '</td>' +
          '<td><a href="' + EXPLORER + '/tx/' + tr.tx_hash + '" target="_blank" rel="noopener">↗</a></td>' +
        '</tr>'
      );
    }).join('');

    const dayAgo = Date.now() - 86400e3;
    const day = trades.filter(function (t) { return new Date(t.ts).getTime() > dayAgo; });
    const buys = day.filter(function (t) { return t.side === 'buy'; });
    const sells = day.filter(function (t) { return t.side === 'sell'; });
    const bvol = buys.reduce(function (a, t) { return a + Number(t.eth_amount); }, 0);
    const svol = sells.reduce(function (a, t) { return a + Number(t.eth_amount); }, 0);
    $('tk-buys').textContent = buys.length + ' buys';
    $('tk-sells').textContent = sells.length + ' sells';
    $('tk-bvol').textContent = usd(bvol) + ' vol.';
    $('tk-svol').textContent = usd(svol) + ' vol.';
    $('tk-bar-tx').style.width = (day.length ? (buys.length / day.length) * 100 : 50) + '%';
    $('tk-bar-vol').style.width = (bvol + svol ? (bvol / (bvol + svol)) * 100 : 50) + '%';
  }

  async function renderChart() {
    const rows = await fetch(API + '/api/tokens/' + address + '/candles?interval=' + interval + '&limit=500')
      .then(function (r) { return r.json(); });
    if (!rows.length) return;
    $('tk-chart-empty').style.display = 'none';
    if (!chart) {
      chart = LightweightCharts.createChart($('tk-chart'), {
        layout: { background: { color: 'transparent' }, textColor: '#9899a3', fontFamily: 'Manrope' },
        grid: { vertLines: { color: '#12111a' }, horzLines: { color: '#12111a' } },
        timeScale: { timeVisible: true, borderColor: '#1f1e2c' },
        rightPriceScale: { borderColor: '#1f1e2c' },
        autoSize: true,
      });
      series = chart.addCandlestickSeries({
        upColor: '#21c95e', downColor: '#f6465d',
        wickUpColor: '#21c95e', wickDownColor: '#f6465d',
        borderVisible: false,
        priceFormat: { type: 'price', precision: 8, minMove: 0.00000001 },
      });
    }
    series.setData(rows.reverse().map(function (r) {
      const k = ethUsd || 1;
      return { time: Number(r.t), open: r.o * k, high: r.h * k, low: r.l * k, close: r.c * k };
    }));
  }

  // ---------- trade panel ----------

  function setStatus(msg, cls) {
    const el = $('tk-status');
    el.className = 'tk-status' + (cls ? ' ' + cls : '');
    el.innerHTML = msg;
  }

  function updateCta() {
    const cta = $('tk-cta');
    cta.className = 'tk-cta' + (side === 'sell' ? ' sellmode' : '');
    cta.textContent = !pubkey ? 'Connect Phantom' : (side === 'buy' ? 'Buy ' + (token ? token.symbol : '') : 'Sell ' + (token ? token.symbol : ''));
    $('tk-amt-note').textContent = side === 'buy' ? 'USD in SOL' : 'Tokens to sell';
    $('tk-amt').placeholder = side === 'buy' ? '$0' : '0';
    $('tk-presets').style.display = side === 'buy' ? 'flex' : 'none';
  }

  async function connect() {
    const provider = window.phantom && window.phantom.solana;
    if (!provider) { setStatus('Phantom not found — install at phantom.app', 'err'); return; }
    const res = await provider.connect();
    pubkey = res.publicKey.toString();
    try {
      const accounts = await window.phantom.ethereum.request({ method: 'eth_requestAccounts' });
      evmAddr = accounts[0];
    } catch (e) {}
    $('tk-avail').textContent = 'Connected: ' + pubkey.slice(0, 4) + '…' + pubkey.slice(-4) +
      (evmAddr ? ' · receiving to ' + evmAddr.slice(0, 6) + '…' + evmAddr.slice(-4) : '');
    updateCta();
  }

  async function executeBuy() {
    const usdAmt = parseFloat($('tk-amt').value) || 0;
    if (usdAmt <= 0) throw new Error('Enter an amount');
    if (!evmAddr) throw new Error('Phantom did not expose an Ethereum address to receive tokens');
    if (!solUsd) throw new Error('SOL price unavailable — retry in a second');
    const lamports = Math.floor((usdAmt / solUsd) * 1e9);

    setStatus('Getting quote…');
    const q = await fetch(API + '/api/quote/buy?token=' + address + '&lamports=' + lamports +
      '&solanaAddress=' + pubkey + '&evmRecipient=' + evmAddr).then(function (r) { return r.json(); });
    if (!q.steps) throw new Error(q.message || 'Quote failed');

    const out = q.details.currencyOut.amountFormatted;
    setStatus('Sign in Phantom — you receive ~<b>' + Number(out).toLocaleString(undefined, { maximumFractionDigits: 0 }) + ' ' + token.symbol + '</b>');

    const w3 = await loadWeb3();
    const conn = new w3.Connection(SOLANA_RPC);
    const tx = new w3.Transaction();
    q.steps.forEach(function (step) {
      step.items.forEach(function (item) {
        (item.data.instructions || []).forEach(function (ins) {
          tx.add(new w3.TransactionInstruction({
            programId: new w3.PublicKey(ins.programId),
            keys: ins.keys.map(function (k) { return { pubkey: new w3.PublicKey(k.pubkey), isSigner: k.isSigner, isWritable: k.isWritable }; }),
            data: hexToBytes(ins.data),
          }));
        });
      });
    });
    tx.feePayer = new w3.PublicKey(pubkey);
    tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
    const sent = await window.phantom.solana.signAndSendTransaction(tx);
    setStatus('Sent (' + sent.signature.slice(0, 8) + '…) — filling…');

    const check = q.steps[0].items[0].check;
    for (let i = 0; i < 45; i++) {
      await sleep(2000);
      const st = await fetch('https://api.relay.link' + check.endpoint).then(function (r) { return r.json(); });
      if (st.status === 'success') { setStatus('✅ Bought ' + token.symbol + '!', 'ok'); return; }
      if (st.status === 'failure' || st.status === 'refund') throw new Error('Relay ' + st.status + ' — SOL refunded if deducted.');
    }
    setStatus('Still filling — check relay.link with your wallet.');
  }

  async function executeSell() {
    const amt = parseFloat($('tk-amt').value) || 0;
    if (amt <= 0) throw new Error('Enter token amount to sell');
    const eth = window.ethereum;
    if (!eth) throw new Error('Selling needs an EVM wallet (MetaMask) on Robinhood Chain');
    const accounts = await eth.request({ method: 'eth_requestAccounts' });
    try {
      await eth.request({ method: 'wallet_addEthereumChain', params: [{
        chainId: '0x1237',
        chainName: 'Robinhood Chain',
        nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
        rpcUrls: ['https://rpc.mainnet.chain.robinhood.com'],
        blockExplorerUrls: [EXPLORER],
      }] });
    } catch (e) {}

    setStatus('Getting quote…');
    const wei = BigInt(Math.floor(amt * 1e6)) * 10n ** 12n;
    const q = await fetch(API + '/api/quote/sell?token=' + address + '&tokenAmountWei=' + wei.toString() +
      '&evmAddress=' + accounts[0] + '&solanaRecipient=' + (pubkey || accounts[0])).then(function (r) { return r.json(); });
    if (!q.steps) throw new Error(q.message || 'Quote failed');
    setStatus('Sign the transaction(s) in your wallet…');
    for (const step of q.steps) {
      for (const item of step.items) {
        if (!item.data || !item.data.to) continue;
        await eth.request({ method: 'eth_sendTransaction', params: [{
          from: accounts[0],
          to: item.data.to,
          value: item.data.value ? '0x' + BigInt(item.data.value).toString(16) : '0x0',
          data: item.data.data || '0x',
        }] });
      }
    }
    setStatus('✅ Sell submitted — SOL arrives at your Phantom wallet shortly.', 'ok');
  }

  // ---------- wiring ----------

  $('tk-buy-tab').addEventListener('click', function () {
    side = 'buy';
    this.classList.add('on');
    $('tk-sell-tab').classList.remove('on');
    updateCta();
  });
  $('tk-sell-tab').addEventListener('click', function () {
    side = 'sell';
    this.classList.add('on');
    $('tk-buy-tab').classList.remove('on');
    updateCta();
  });
  $('tk-presets').addEventListener('click', function (e) {
    const b = e.target.closest('button');
    if (b) $('tk-amt').value = b.dataset.usd;
  });
  $('tk-cta').addEventListener('click', async function () {
    const cta = $('tk-cta');
    try {
      cta.disabled = true;
      if (!pubkey) { await connect(); return; }
      if (side === 'buy') await executeBuy();
      else await executeSell();
    } catch (e) {
      setStatus(e.message || String(e), 'err');
    } finally {
      cta.disabled = false;
    }
  });
  $('tk-ca').addEventListener('click', function () {
    navigator.clipboard.writeText(address);
    this.textContent = 'copied ✓';
    const self = this;
    setTimeout(function () { self.textContent = address.slice(0, 6) + '…' + address.slice(-4) + ' ⧉'; }, 900);
  });
  $('tk-list-tabs').addEventListener('click', function (e) {
    const b = e.target.closest('.tk-list-tab');
    if (!b) return;
    document.querySelectorAll('.tk-list-tab').forEach(function (el) { el.classList.remove('on'); });
    b.classList.add('on');
    bucket = b.dataset.bucket;
    renderList();
  });
  $('tk-search').addEventListener('input', function () {
    keyword = this.value.trim().toLowerCase();
    renderList();
  });
  $('tk-tfbar').addEventListener('click', function (e) {
    const b = e.target.closest('.tk-tf');
    if (!b) return;
    document.querySelectorAll('.tk-tf').forEach(function (el) { el.classList.remove('on'); });
    b.classList.add('on');
    interval = Number(b.dataset.i);
    renderChart();
  });

  async function refresh() {
    const results = await Promise.all([
      fetch(API + '/api/board').then(function (r) { return r.json(); }),
      fetch(API + '/api/tokens/' + address + '/trades?limit=200').then(function (r) { return r.json(); }),
      fetch('https://api.coinbase.com/v2/prices/ETH-USD/spot').then(function (r) { return r.json(); }).catch(function () { return null; }),
      fetch('https://api.coinbase.com/v2/prices/SOL-USD/spot').then(function (r) { return r.json(); }).catch(function () { return null; }),
      fetch(API + '/api/tokens/' + address).then(function (r) { return r.ok ? r.json() : null; }),
    ]);
    board = results[0];
    trades = results[1];
    if (results[2]) ethUsd = Number(results[2].data.amount);
    if (results[3]) solUsd = Number(results[3].data.amount);
    token = results[4];
    renderList();
    if (token) renderHead(token);
    renderSwaps();
    renderChart();
    updateCta();
  }

  refresh();
  setInterval(refresh, 5000);
})();
