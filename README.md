# DiffPool NUMEN Wallet for Android

An independent, non-custodial wallet for native NUMEN Mainnet (NUMN). This is **not
an official Numen Network wallet**. Beta software; no independent security audit.
Start with a small amount and keep an offline backup of every account's recovery
phrase or original secret seed. Never use the public test keys in this repository.

Download the signed Android APK from [GitHub Releases](https://github.com/trokl1/diffpool-numen-wallet/releases).
The current release is [0.5.0 beta](https://github.com/trokl1/diffpool-numen-wallet/releases/tag/v0.5.0).
Release assets include SHA-256 checksums; source archives are generated from the release tag.

## Features

- Create and import sr25519 accounts, multiple accounts and watch-only addresses.
- Local account names and address book; encrypted storage and optional biometrics.
- Native NUMN transfers with an explicit fee/recipient confirmation and durable outbox.
- Balance and incoming transfers refresh on unlock and every minute on the home
  screen. Only the selected account is polled; the setting can be disabled.
- Incoming/outgoing transfers and mining rewards inside the wallet, server-side
  pagination, bounded encrypted cache. The indexer can lag behind the chain.
- Scan a recipient's **plain nu… address** with the camera. Scanning never sends,
  signs, imports a key, opens a link or changes the RPC. Rejects other networks.
- Receive screen with QR and Android's **Share QR** menu (public address only).
- No developer fee, analytics or remote scripts. Network transaction fees apply.

**WalletConnect/dApp pairing is not implemented.** A `wc:` QR is not a payment
address and is rejected with an explanation. There is no automatic site signing.
The built-in DiffPool address presets are public watch-only accounts; adding an
address does not grant spending access.

## Requirements and updates

Android 9+ (API 28), Android System WebView/Chrome 100+. Camera permission is
optional and requested only when scanning; the microphone is never requested.
Without a camera, paste an address or choose an address-book entry.
The first Android camera permission dialog can lock the wallet. After allowing
access, unlock it again and tap QR. Background locking is intentionally retained.
Camera lifecycle and sharing were tested on an Android 15 emulator, not yet with
a physical phone camera.

Install a release APK over the existing app **without uninstalling** it. Updates
must have the same signing certificate. Package: `xyz.diffpool.numen`.

Release certificate SHA-256:
`3b267c9dd93b1e65bd8f5e77d28ed90d6ed2817b3c86195c75964275c39cf3e4`

## Build and test

Node.js 22+, JDK 17, Android SDK platform 35 and build-tools 34.0.0. Dependencies
are pinned in `package-lock.json`. Use your own signing keystore outside this repo.

```powershell
npm ci --ignore-scripts
npm test
npm run bundle
# Optional: Chrome browser tests; synthetic transfers, never real broadcasts.
$env:QA_CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
npm run test:ui
node scripts/check-qr-ui.mjs

# Set NUMEN_SIGNING_PASSWORD securely in the process environment, not source code.
./scripts/build.ps1 -Sdk C:/Android/sdk -Jdk C:/Java/jdk-17 -KeyStore C:/private/wallet.p12
```

The browser QA fixture reads public chain metadata, then substitutes test RPC
responses; it does not broadcast transactions. Android QA scripts must be run
**only on the dedicated disposable emulator with public test wallets**, never on
a user's funded phone. A `-Qa` APK enables WebView debugging; never distribute it.

## Security model and limits

- PBKDF2-SHA256 (600,000 iterations) + AES-256-GCM vault and Android Keystore wrapper.
  Biometric authentication uses a per-operation CryptoObject. sr25519 signing is
  performed in the application; the private key is not a hardware signing key.
- HTTPS RPC with pinned NUMEN genesis and network properties. Only explicit
  transaction preparation/confirmation may sign and submit. No automatic resubmission.
- History uses the official read-only indexer, not an independent proof of finality.
  It is never used for signing, nonce selection or calculating spendable balance.
- RPC/indexer see the selected public address and IP. Camera frames are decoded
  locally. Sharing sends only a public QR image/address to the app you select.
- Going into the background locks the wallet and stops the scanner. Release APKs
  disable Android backup, WebView debugging, screenshots and cleartext traffic.
- No encrypted Polkadot JSON-keystore import, Ledger, EVM accounts, staking/governance
  UI, QR key import or dApp signing. Native transfers use `transferKeepAlive`.

Do not put recovery phrases, wallet JSON files, signing keys, private RPC credentials,
device backups or real transaction secrets into GitHub issues or pull requests.

## License

ISC, with attribution to Pearl Personal contributors for the adapted native shell
and address book. Third-party dependencies retain their licenses; see
`THIRD-PARTY-NOTICES.txt` (regenerated by `node scripts/notices.mjs`).
