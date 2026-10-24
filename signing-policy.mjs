import {t} from './i18n.mjs';
import { blake2AsHex, decodeAddress } from '@polkadot/util-crypto';
import { compactToU8a, u8aConcat, u8aToHex } from '@polkadot/util';
import { validateRecipient } from './core.mjs';

// Release-time trust anchor, NOT learned from the user's selected RPC.
// NUMEN runtime-v10000; see README.md for provenance and update procedure.
export const SIGNING_POLICY = Object.freeze({
  specName:'numen-runtime', specVersion:10000, transactionVersion:1,
  metadataVersion:16,
  metadataHash:'0x00512c77d428dd9d941262d93a7407036f7144584a4d2b8bb82899b093468ccc',
  extensions:Object.freeze(['CheckNonZeroSender','CheckSpecVersion','CheckTxVersion','CheckGenesis','CheckMortality','CheckNonce','CheckWeight','ChargeTransactionPayment','CheckMetadataHash','WeightReclaim']),
});
export function assertSigningPolicy(api) {
  const p=SIGNING_POLICY,r=api.runtimeVersion;
  if(r.specName.toString()!==p.specName||r.specVersion.toNumber()!==p.specVersion||r.transactionVersion.toNumber()!==p.transactionVersion||
    api.extrinsicVersion!==4||api.runtimeMetadata.version!==p.metadataVersion||blake2AsHex(api.runtimeMetadata.toU8a())!==p.metadataHash||
    JSON.stringify(api.registry.signedExtensions)!==JSON.stringify(p.extensions))
    throw Error(t('Непроверенный runtime или metadata RPC. Отправка заблокирована: требуется проверенное обновление кошелька.'));
}
export function expectedTransferCall(recipient,amount) {
  validateRecipient(recipient);
  if(!/^[1-9][0-9]*$/.test(String(amount))||BigInt(amount)>=(1n<<128n))throw Error(t('Некорректная сумма перевода.'));
  // Runtime pallet Balances=3, transfer_keep_alive=3, MultiAddress::Id=0.
  // Encoding is deliberately independent of RPC-provided call names/types.
  return u8aToHex(u8aConcat(new Uint8Array([3,3,0]),decodeAddress(recipient),compactToU8a(BigInt(amount))));
}
export function assertTransferCall(tx,recipient,amount) {
  if(tx.method.toHex()!==expectedTransferCall(recipient,amount))throw Error(t('RPC изменил код, получателя или сумму перевода. Подпись запрещена.'));
}
