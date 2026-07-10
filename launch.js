// Launch page: Phantom connect -> /api/launch quote -> sign Relay deposit -> track fill.
(function () {
  const API = window.HOODLAUNCH_API || 'https://hoodlaunchbackend-production.up.railway.app';
  const SOLANA_RPC = window.HOODLAUNCH_SOLANA_RPC || (API + '/api/solana-rpc');
  const EXPLORER = 'https://robinhoodchain.blockscout.com';

  let pubkey = null;
  let evmCreator = null;
  let imageUrl = '';
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

  function setStatus(msg, cls) {
    const el = document.getElementById('hl-status');
    el.className = 'hl-status' + (cls ? ' ' + cls : '');
    el.innerHTML = msg;
  }

  [['hl-name', 'hl-name-count', 60], ['hl-symbol', 'hl-symbol-count', 20], ['hl-desc', 'hl-desc-count', 256]].forEach(function (c) {
    const input = document.getElementById(c[0]);
    input.addEventListener('input', function () {
      document.getElementById(c[1]).textContent = input.value.length + '/' + c[2];
    });
  });

  document.getElementById('hl-logo-box').addEventListener('click', function () {
    document.getElementById('hl-file').click();
  });

  document.getElementById('hl-file').addEventListener('change', async function () {
    const file = this.files[0];
    if (!file) return;
    if (file.size > 4_500_000) { setStatus('Image too large — max 4.5MB', 'hl-err'); return; }
    try {
      setStatus('Uploading image…');
      let payload;
      if (file.type === 'image/gif') {
        const b64 = await new Promise(function (resolve, reject) {
          const r = new FileReader();
          r.onload = function () { resolve(String(r.result).split(',')[1]); };
          r.onerror = reject;
          r.readAsDataURL(file);
        });
        payload = { data: b64, mime: 'image/gif' };
      } else {
        const bmp = await createImageBitmap(file);
        const c = document.createElement('canvas');
        c.width = 250;
        c.height = 250;
        const s = Math.min(bmp.width, bmp.height);
        c.getContext('2d').drawImage(bmp, (bmp.width - s) / 2, (bmp.height - s) / 2, s, s, 0, 0, 250, 250);
        payload = { data: c.toDataURL('image/webp', 0.9).split(',')[1], mime: 'image/webp' };
      }
      const res = await fetch(API + '/api/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const out = await res.json();
      if (!res.ok) throw new Error(out.error || 'Upload failed');
      imageUrl = out.url;
      document.getElementById('hl-logo-box').innerHTML = '<img src="' + imageUrl + '" alt="logo"/>';
      setStatus('');
    } catch (e) {
      setStatus(e.message || String(e), 'hl-err');
    }
  });

  document.getElementById('hl-cta').addEventListener('click', onCta);

  async function onCta() {
    const cta = document.getElementById('hl-cta');
    try {
      if (!pubkey) {
        const provider = window.phantom && window.phantom.solana;
        if (!provider) { setStatus('Phantom wallet not found — install it at phantom.app', 'hl-err'); return; }
        const res = await provider.connect();
        pubkey = res.publicKey.toString();
        // Phantom is multichain: grab its Ethereum address as the default fee wallet
        try {
          const accounts = await window.phantom.ethereum.request({ method: 'eth_requestAccounts' });
          evmCreator = accounts[0];
        } catch (e) {}
        cta.textContent = 'Launch Coin';
        setStatus('Connected: ' + pubkey.slice(0, 4) + '…' + pubkey.slice(-4) +
          (evmCreator ? ' · fees → ' + evmCreator.slice(0, 6) + '…' + evmCreator.slice(-4) : ''), 'hl-ok');
        return;
      }
      cta.disabled = true;
      await launch();
    } catch (e) {
      setStatus(e.message || String(e), 'hl-err');
    } finally {
      cta.disabled = false;
    }
  }

  async function launch() {
    const name = document.getElementById('hl-name').value.trim();
    const symbol = document.getElementById('hl-symbol').value.trim();
    if (!name || !symbol) throw new Error('Coin name and ticker are required');
    if (!imageUrl) throw new Error('Upload a logo image first');
    const creator = document.getElementById('hl-creator').value.trim() || evmCreator;
    if (!/^0x[0-9a-fA-F]{40}$/.test(creator || '')) {
      throw new Error('No fee wallet found — Phantom did not expose an Ethereum address. Set one under Advanced settings.');
    }

    const initialBuySol = parseFloat(document.getElementById('hl-initialbuy').value) || 0;
    let initialBuyEth = 0;
    if (initialBuySol > 0) {
      setStatus('Converting SOL → ETH…');
      const prices = await Promise.all(['ETH-USD', 'SOL-USD'].map(function (pair) {
        return fetch('https://api.coinbase.com/v2/prices/' + pair + '/spot')
          .then(function (r) { return r.json(); })
          .then(function (p) { return Number(p.data.amount); });
      }));
      initialBuyEth = (initialBuySol * prices[1]) / prices[0];
    }

    setStatus('Getting launch quote…');
    const res = await fetch(API + '/api/launch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: name,
        symbol: symbol,
        description: document.getElementById('hl-desc').value.trim(),
        imageUrl: imageUrl,
        socials: {
          twitter: document.getElementById('hl-twitter').value.trim(),
          telegram: document.getElementById('hl-telegram').value.trim(),
          website: document.getElementById('hl-website').value.trim(),
        },
        creator: creator,
        solanaAddress: pubkey,
        initialBuyEth: initialBuyEth > 0 ? initialBuyEth.toFixed(8) : undefined,
      }),
    });
    const out = await res.json();
    const quote = out.relayQuote;
    if (!res.ok || !quote || !quote.steps) {
      throw new Error((quote && quote.message) || out.error || 'Quote failed');
    }

    const solIn = Number(quote.details.currencyIn.amountFormatted);
    setStatus('Sign in Phantom — total cost <b>' + solIn.toFixed(4) + ' SOL</b>');

    const w3 = await loadWeb3();
    const conn = new w3.Connection(SOLANA_RPC);
    const tx = new w3.Transaction();
    quote.steps.forEach(function (step) {
      step.items.forEach(function (item) {
        (item.data.instructions || []).forEach(function (ins) {
          tx.add(new w3.TransactionInstruction({
            programId: new w3.PublicKey(ins.programId),
            keys: ins.keys.map(function (k) {
              return { pubkey: new w3.PublicKey(k.pubkey), isSigner: k.isSigner, isWritable: k.isWritable };
            }),
            data: hexToBytes(ins.data),
          }));
        });
      });
    });
    tx.feePayer = new w3.PublicKey(pubkey);
    tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;

    const provider = window.phantom.solana;
    const sent = await provider.signAndSendTransaction(tx);
    setStatus('Deposit sent (' + sent.signature.slice(0, 8) + '…) — waiting for Relay to launch on Robinhood Chain…');

    const check = quote.steps[0].items[0].check;
    for (let i = 0; i < 45; i++) {
      await sleep(2000);
      const st = await fetch('https://api.relay.link' + check.endpoint).then(function (r) { return r.json(); });
      if (st.status === 'success') {
        const dstTx = (st.txHashes && st.txHashes[0]) || '';
        setStatus('🚀 Token launched! ' + (dstTx ? '<a href="' + EXPLORER + '/tx/' + dstTx + '" target="_blank">View on Blockscout</a>' : 'Check the Discover board shortly.'), 'hl-ok');
        return;
      }
      if (st.status === 'failure' || st.status === 'refund') {
        throw new Error('Relay reported ' + st.status + ' — your SOL was ' + (st.status === 'refund' ? 'refunded' : 'not spent') + '.');
      }
    }
    setStatus('Still filling — check status on relay.link with your wallet address.', '');
  }
})();
