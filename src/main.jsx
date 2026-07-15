import { Buffer } from 'buffer'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { PrivyProvider } from '@privy-io/react-auth'
import { toSolanaWalletConnectors } from '@privy-io/react-auth/solana'
import { defineChain } from 'viem'
import App from './App.jsx'
import '../styles.css'
import './app.css'

// Robinhood Chain — the embedded EVM wallet transacts here (holds the user's
// bought tokens, signs sells). Users still LOG IN with Phantom (Solana); the
// embedded EVM wallet is provisioned silently so trading feels pure-SOL.
const robinhoodChain = defineChain({
  id: 4663,
  name: 'Robinhood Chain',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.mainnet.chain.robinhood.com'] } },
})

// Privy's Solana SIWS flow references the Node Buffer global, which browsers
// lack and Vite doesn't polyfill — without this, login throws buffer_not_defined.
globalThis.Buffer = globalThis.Buffer || Buffer

const PRIVY_APP_ID = 'cmrkbr03m007f0cl5o5rgw12t'

// NOTE: no React.StrictMode — its double-mount re-fires Privy's internal auth
// effects and corrupts the SIWS session handshake ("Error authenticating session").
ReactDOM.createRoot(document.getElementById('root')).render(
  <PrivyProvider
    appId={PRIVY_APP_ID}
    config={{
      appearance: {
        theme: 'dark',
        accentColor: '#21c95e',
        logo: '/logo.png',
        // 'ethereum-and-solana' so Privy provisions the embedded EVM wallet;
        // walletList keeps the LOGIN modal Solana-only (no MetaMask/EVM clutter).
        walletChainType: 'ethereum-and-solana',
        walletList: ['phantom', 'solflare', 'backpack', 'okx_wallet'],
      },
      loginMethods: ['wallet'],
      externalWallets: { solana: { connectors: toSolanaWalletConnectors() } },
      // create a silent embedded EVM wallet on login — it holds bought tokens and
      // signs sells on Robinhood Chain, so users never touch MetaMask/EVM gas.
      embeddedWallets: { ethereum: { createOnLogin: 'all-users' }, showWalletUIs: false },
      supportedChains: [robinhoodChain],
      defaultChain: robinhoodChain,
    }}
  >
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </PrivyProvider>,
)
