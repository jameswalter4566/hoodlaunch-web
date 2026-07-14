import { Buffer } from 'buffer'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { PrivyProvider } from '@privy-io/react-auth'
import { toSolanaWalletConnectors } from '@privy-io/react-auth/solana'
import App from './App.jsx'
import '../styles.css'
import './app.css'

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
        walletChainType: 'solana-only',
        // show only Solana wallets in the modal (no MetaMask/EVM clutter)
        walletList: ['phantom', 'solflare', 'backpack', 'okx_wallet'],
      },
      loginMethods: ['wallet'],
      externalWallets: { solana: { connectors: toSolanaWalletConnectors() } },
      embeddedWallets: { createOnLogin: 'off', showWalletUIs: false },
    }}
  >
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </PrivyProvider>,
)
