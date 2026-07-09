// Launch page: Phantom connect -> /api/launch quote -> sign Relay deposit -> track fill.
(function () {
  const API = window.HOODLAUNCH_API || 'https://hoodlaunchbackend-production.up.railway.app';
  const SOLANA_RPC = window.HOODLAUNCH_SOLANA_RPC || 'https://api.mainnet-beta.solana.com';
  const EXPLORER = 'https://robinhoodchain.blockscout.com';

  let pubkey = null;
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

  document.getElementById('hl-image').addEventListener('change', function () {
    const url = this.value.trim();
    const box = document.getElementById('hl-logo-box');
    if (url) box.innerHTML = '<img src="' + url.replace(/"/g, '') + '" alt="logo"/>';
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
        cta.textContent = 'Launch Token';
        setStatus('Connected: ' + pubkey.slice(0, 4) + '…' + pubkey.slice(-4), 'hl-ok');
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
    const creator = document.getElementById('hl-creator').value.trim();
    if (!name || !symbol) throw new Error('Token name and symbol are required');
    if (!/^0x[0-9a-fA-F]{40}$/.test(creator)) throw new Error('Creator fee wallet must be a valid EVM address (0x...)');
    const initialBuyEth = parseFloat(document.getElementById('hl-initialbuy').value) || 0;

    setStatus('Getting launch quote…');
    const res = await fetch(API + '/api/launch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: name,
        symbol: symbol,
        description: document.getElementById('hl-desc').value.trim(),
        imageUrl: document.getElementById('hl-image').value.trim(),
        socials: {
          twitter: document.getElementById('hl-twitter').value.trim(),
          telegram: document.getElementById('hl-telegram').value.trim(),
          website: document.getElementById('hl-website').value.trim(),
        },
        creator: creator,
        solanaAddress: pubkey,
        initialBuyEth: initialBuyEth || undefined,
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
