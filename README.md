# DiffPool NUMEN Wallet for Android

An independent, non-custodial wallet for native NUMEN Mainnet (NUMN). This is **not
an official Numen Network wallet**. Beta software; no independent security audit.
Start with a small amount and keep an offline backup of every account's recovery
phrase or original secret seed. Never use the public test keys in this repository.

Download the signed Android APK from [GitHub Releases](https://github.com/trokl1/diffpool-numen-wallet/releases).
The current release is [0.5.3 beta](https://github.com/trokl1/diffpool-numen-wallet/releases/tag/v0.5.3).
Release assets include SHA-256 checksums; source archives are generated from the release tag.

**0.5.3 includes public Identity profiles, optional donations and large-balance layout fixes,
along with Russian/English language selection and all 0.5.1 security fixes.**
Users of 0.5.0 should update; that release does not include these fixes. See the
security notes below. Install the new APK over the existing app without uninstalling.

**0.5.3 adds on-chain Identity viewing and editing.**
Identity is separate from device-local names. Fields are public and remain in
historical blocks after editing. Never put recovery phrases, keys or private data
in the profile. A deposit is reserved for storage and a network fee is charged
separately; both are shown before password/biometric confirmation.

## Features

- Create and import sr25519 accounts, multiple accounts and watch-only addresses.
- Local account names and address book; encrypted storage and optional biometrics.
- Read the selected account's on-chain Identity; create or
  edit public name, avatar URL, bio, website, email, GitHub, Matrix, X, Telegram
  and Discord. Watch-only profiles are read-only. Names are not unique or proof
  of verification. Links/images are displayed as text, not automatically fetched.
  Cyrillic is preserved; the name limit is 32 UTF-8 bytes (usually 16 Russian
  letters), with byte counters for every field.
- Optional **Support development** footer using the public
  FEE address `nu4dxPMnaPXN4ZRWJaUM6RnSY8zuhi1NrYiR7Nfh42wB9YAxr`.
  It prefills the normal transfer recipient, leaves the amount empty and requires
  explicit confirmation. No automatic donations or added wallet fee.
- Switch **Русский / English** before unlocking or in **Settings → Language**.
  The device-local preference survives restarts; existing wallets default to
  Russian. App screens, validation errors and native biometric prompts are
  translated. Android-owned system messages may follow the device language.
  Account/contact names, addresses, keys and amounts are never translated.
- Native NUMN transfers with an explicit fee/recipient confirmation and durable outbox.
- Compact, responsive balance display. An approximate headline is marked with
  `≈`; expand **Exact balance** to see every decimal. Tiny nonzero balances are
  never shortened to zero. Transfer amounts and accounting precision are unchanged.
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
node scripts/check-security-chain.mjs
node scripts/check-security-ui.mjs
node scripts/check-language-ui.mjs
node scripts/check-identity-chain.mjs
node scripts/check-identity-ui.mjs
node scripts/check-balance-ui.mjs
# Optional read-only mainnet Identity/fee probe; never broadcasts:
node scripts/check-identity-live.mjs

# Set NUMEN_SIGNING_PASSWORD securely in the process environment, not source code.
./scripts/build.ps1 -Sdk C:/Android/sdk -Jdk C:/Java/jdk-17 -KeyStore C:/private/wallet.p12
```

The browser QA fixture reads public chain metadata, then substitutes test RPC
responses; it does not broadcast transactions. Android QA scripts must be run
**only on the dedicated disposable emulator with public test wallets**, never on
a user's funded phone. A `-Qa` APK enables WebView debugging; never distribute it.

`i18n-en.mjs` is the shared English catalog. `scripts/localization.mjs` generates
`web/language-en.json` for native dialogs during the build. Tests check catalog
coverage and preserve interpolated values. Translate only source literals, never
rendered DOM, RPC output, account names or secrets. Dates follow the selected
language; transaction amounts keep their exact decimal representation.

## Security model and limits

- PBKDF2-SHA256 (600,000 iterations) + AES-256-GCM vault and Android Keystore wrapper.
  Biometric authentication uses a per-operation CryptoObject. sr25519 signing is
  performed in the application; the private key is not a hardware signing key.
- HTTPS RPC with pinned NUMEN genesis, network properties and a release-time
  runtime/metadata fingerprint. Only explicit
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

### 0.5.1 security changes and trust boundaries

- Fee estimation sends only a fake, invalid signature. A real signed extrinsic
  stays local until the pending journal has been durably saved. A timeout after
  that point remains an unknown transaction, never an automatic retry.
- Signing requires the reviewed NUMEN `specVersion=10000`, transaction version 1,
  metadata v16 BLAKE2b-256 fingerprint
  `00512c77d428dd9d941262d93a7407036f7144584a4d2b8bb82899b093468ccc`
  and the exact signed-extension sequence. The transfer call is also checked
  against independently encoded SCALE bytes (`Balances=3`, `transfer_keep_alive=3`,
  `MultiAddress::Id`, exact u128 amount). Unknown metadata/runtime blocks sending;
  it is never automatically accepted from the selected RPC.
- Identity uses independently encoded SCALE `Identity=8`, `set_identity=1` with
  the ten ordered bounded UTF-8 byte fields from the
  [NUMEN Identity source](https://github.com/numen-network/numen/blob/master/runtime/src/identity_info.rs).
  This is NOT the generic Substrate `Data` enum. Byte limits are 32/128/2048/64
  for display/avatar/bio/web and 32 for each remaining field. Deposit calculation
  includes SCALE length prefixes. The original full registration is checked
  again before signing to reject concurrent edits; fields are not merged blindly.
  Fee quotes remain fake-signed; Identity and transfers share the durable outbox
  and pending-nonce guard. No registrar judgement, sub-account management or
  `clear_identity` transaction is implemented. Empty fields clear their values,
  but do not remove the registration or release its entire basic deposit.
- The fingerprint was compared on 2026-10-24 between the official HTTPS RPC and
  an independently operated DiffPool node. Runtime types/version/extensions were
  checked against [the official runtime source](https://github.com/numen-network/numen/blob/runtime-v10000/runtime/src/lib.rs).
  To update the allowlist, review the new runtime and call encoding, compare two
  independent nodes, rerun hostile-metadata and signature tests, then ship an app
  update. This fingerprint is NOT the protocol's merkleized CheckMetadataHash;
  the latter remains in disabled mode. The wallet is not a light client: balances,
  fees, nonce, chain head and history still depend on the RPC/indexer being honest.
- Cancelled operations and old native/biometric callbacks cannot reopen a locked
  session. Vault replacement uses a compare-and-swap check to reject stale writers.
  A native disk write already in progress may finish; fresh authentication reloads it.
- Lock after three minutes without user activity; recovery displays close after
  60 seconds. Consumed passwords and decrypted key references are cleared in finally
  blocks. JS/Java strings and garbage collection cannot guarantee physical RAM erasure.
- Seed displays are non-selectable and omitted from accessibility output. Native
  WebView selection/IME copy, cut and process-text exports are blocked; paste and
  the public-address copy button remain available. This deliberately limits screen
  reader access to recovery secrets. IMEs are asked not to learn input; use a trusted
  keyboard. Overlay touch filtering and Android 12+ overlay hiding are enabled.

The earlier audit demonstrated RPC metadata call substitution, valid signed fee
queries before journaling, late-save reopening after lock, and system clipboard
export of seed text. The regression suite now rejects these scenarios using public
test keys. This is an internal source/QA review, not an independent penetration
test or a guarantee of absence of vulnerabilities. A compromised OS, trusted
accessibility service, keyboard or application JS realm is outside these controls;
the native bridge is not an independent hardware signing boundary.

## License

ISC, with attribution to Pearl Personal contributors for the adapted native shell
and address book. Third-party dependencies retain their licenses; see
`THIRD-PARTY-NOTICES.txt` (regenerated by `node scripts/notices.mjs`).
