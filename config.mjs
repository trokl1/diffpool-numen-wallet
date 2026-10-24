export const NETWORK = Object.freeze({
  name: 'NUMEN Mainnet', symbol: 'NUMN', decimals: 18, ss58: 14240,
  rpc: 'https://rpc.numen-network.org',
  explorer: 'https://explorer.numen-network.org',
  // Cross-check with our node before release; never trust a custom endpoint's name alone.
  genesis: '0x7b7c7b93a0454cf907b400703e67691394db8558bb07d470af3d0ac510d91904',
});
export const VERSION = '0.5.0';
export function validateEndpoint(value) {
  const url = new URL(String(value).trim());
  if (url.protocol !== 'https:' || !url.hostname || url.username || url.password || url.hash || url.search)
    throw Error('RPC: нужен HTTPS-адрес без логина, пароля, query и фрагмента.');
  if (url.href.length > 300) throw Error('Слишком длинный адрес RPC.');
  return url.href.replace(/\/$/, '');
}
export const RPC_METHODS = new Set([
  'rpc_methods', 'system_chain', 'system_name', 'system_version', 'system_properties',
  'system_health', 'system_accountNextIndex', 'chain_getBlockHash', 'chain_getHeader',
  'chain_getFinalizedHead', 'chain_getBlock', 'state_getRuntimeVersion', 'state_getMetadata',
  'state_getStorage', 'state_queryStorageAt', 'state_call', 'payment_queryInfo',
  'payment_queryFeeDetails', 'author_submitExtrinsic',
]);
export function validateRpc(method, params) {
  if (!RPC_METHODS.has(method) || !Array.isArray(params) || JSON.stringify(params).length > 262144)
    throw Error('RPC-метод или параметры запрещены.');
  if (method === 'state_call' && !/^(Metadata_metadata(_versions|_at_version)?|TransactionPaymentApi_query_(info|fee_details))$/.test(params[0]))
    throw Error('Runtime API запрещён.');
  if (method === 'author_submitExtrinsic' && (params.length !== 1 || !/^0x(?:[0-9a-f]{2}){10,131072}$/i.test(params[0])))
    throw Error('Неверный формат подписанной транзакции.');
}
