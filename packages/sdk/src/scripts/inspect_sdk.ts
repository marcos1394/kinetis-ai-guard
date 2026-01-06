// sdk/scripts/inspect_sdk.ts
import * as IkaSDK from '@ika.xyz/sdk';

console.log("🔍 INSPECCIONANDO EXPORTACIONES DEL SDK IKA:");
console.log("===========================================");
Object.keys(IkaSDK).forEach(key => {
  console.log(` - ${key}`);
});