import { NETWORK,validateEndpoint } from './config.mjs';

// One-time migration from the old opt-in default, as requested for 0.4.1.
// A deliberate OFF choice made after migration must survive every later unlock.
export function walletSettings(data={}) {
  return {
    endpoint:validateEndpoint(data.endpoint??NETWORK.rpc),
    selectedAddress:data.selectedAddress,
    autoRefresh:data.autoRefreshVersion===1?data.autoRefresh!==false:true,
    autoRefreshVersion:1,
  };
}
