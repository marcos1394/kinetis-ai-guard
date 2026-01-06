import { 
  IkaClient, 
  IkaTransaction, 
  UserShareEncryptionKeys, 
  Curve, 
  getNetworkConfig,
  prepareDKG 
} from '@ika.xyz/sdk';
import { SuiClient, getFullnodeUrl, SuiHTTPTransport } from '@mysten/sui/client';
import { Transaction } from '@mysten/sui/transactions';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { fromB64 } from '@mysten/sui/utils';
import * as dotenv from 'dotenv';
import { webcrypto } from 'node:crypto';

dotenv.config();

const KEYSTORE_STRING = process.env.SUI_KEYSTORE_STRING;
const RPC_URL = "https://rpc-testnet.suiscan.xyz:443"; 

// --- UTILERÍA 1: Lógica de Reintentos ---
async function withRetry<T>(fn: () => Promise<T>, retries = 5, delayMs = 3000, context = ""): Promise<T> {
  try {
    return await fn();
  } catch (error: any) {
    if (retries <= 0) throw error;
    const isNetworkError = error.code === 'UND_ERR_CONNECT_TIMEOUT' || 
                           error.cause?.code === 'UND_ERR_CONNECT_TIMEOUT' ||
                           error.message?.includes('fetch failed');
    const msg = isNetworkError ? "⏳ Timeout/Red" : "⚠️ Error";
    console.log(`${msg} en '${context}'. Reintentando en ${delayMs/1000}s... (Quedan ${retries})`);
    await new Promise(resolve => setTimeout(resolve, delayMs));
    return withRetry(fn, retries - 1, delayMs * 1.5, context);
  }
}

// --- UTILERÍA 2: Extractor Inteligente de Bytes (LA CURA DEL ERROR) ---
function extractBytes(data: any): Uint8Array {
  console.log("🔍 INSPECCIONANDO DATOS DESCARGADOS:");
  console.log(`   Tipo JS: ${typeof data}`);
  
  if (!data) throw new Error("❌ Los datos están vacíos/null");

  // Caso A: Ya es Uint8Array
  if (data instanceof Uint8Array) {
    console.log("   ✅ Formato detectado: Uint8Array Puro");
    return data;
  }

  // Caso B: Es un Array normal de JS
  if (Array.isArray(data)) {
    console.log("   ⚠️ Formato detectado: Array de números (Convirtiendo...)");
    return new Uint8Array(data);
  }

  // Caso C: Es un objeto que contiene los bytes (común en respuestas RPC)
  if (typeof data === 'object') {
    console.log("   📦 Formato detectado: Objeto Envoltorio");
    console.log("   🔑 Claves disponibles:", Object.keys(data));

    if (data.bytes) return new Uint8Array(data.bytes);
    if (data.data) return new Uint8Array(data.data);
    if (data.content) return new Uint8Array(data.content);
    
    // Si es un objeto tipo { '0': 23, '1': 44... }
    if (Object.keys(data).every(k => !isNaN(Number(k)))) {
        console.log("   ⚠️ Detectado objeto indexado, convirtiendo a array...");
        return new Uint8Array(Object.values(data));
    }
  }

  // Intento desesperado final
  console.log("   ⚠️ Formato desconocido. Intentando conversión forzada...");
  return new Uint8Array(data);
}

async function getIkaCoin(client: SuiClient, address: string) {
  let cursor = null;
  let hasNext = true;
  while (hasNext) {
    const coins: any = await withRetry(() => client.getAllCoins({ 
      owner: address, cursor, limit: 50
    }), 3, 2000, "Listar Monedas");
    for (const coin of coins.data) {
      if (coin.coinType !== "0x2::sui::SUI" && parseInt(coin.balance) > 0) return coin;
    }
    cursor = coins.nextCursor;
    hasNext = coins.hasNextPage;
  }
  return null;
}

async function main() {
  console.log("==================================================");
  console.log("🔐 KINETIS INFRASTRUCTURE: DEBUG MODE");
  console.log("==================================================");

  if (!KEYSTORE_STRING) throw new Error("❌ Falta SUI_KEYSTORE_STRING");

  console.log(`📡 Conectando a nodo ROBUSTO: ${RPC_URL}`);
  const suiClient = new SuiClient({ 
    transport: new SuiHTTPTransport({ url: RPC_URL, rpc: { } }),
  });

  const ikaClient = new IkaClient({
    suiClient,
    config: getNetworkConfig('testnet'),
  });
  
  await withRetry(() => ikaClient.initialize(), 5, 2000, "Init Client");

  const rawBytes = fromB64(KEYSTORE_STRING);
  const keypair = Ed25519Keypair.fromSecretKey(rawBytes.slice(1));
  const userAddress = keypair.toSuiAddress();
  console.log(`👤 Operador: ${userAddress}`);

  console.log("💰 Buscando IKA...");
  const ikaCoinData = await getIkaCoin(suiClient, userAddress);
  if (!ikaCoinData) throw new Error("❌ No hay tokens IKA.");
  console.log(`✅ IKA OK: ${ikaCoinData.coinType}`);

  const tx = new Transaction();
  const seedKey = new Uint8Array(32);
  webcrypto.getRandomValues(seedKey);
  const userKeys = await UserShareEncryptionKeys.fromRootSeedKey(seedKey, Curve.SECP256K1);

  const ikaTx = new IkaTransaction({
    ikaClient,
    transaction: tx,
    userShareEncryptionKeys: userKeys
  });

  // --- MOMENTO CRÍTICO: DESCARGA ---
  console.log("\n⚡ [PASO 1] Descargando parámetros (44MB+)...");
 // INTENTO V2: Pedir los parámetros por defecto. 
  // Esto suele traer el set correcto y más pequeño para la época actual.
  const rawParamsResponse = await withRetry(
    () => ikaClient.getProtocolPublicParameters(), 
    5, 5000, "Get Protocol Params (Default)"
  );

  // --- MOMENTO CRÍTICO: LIMPIEZA ---
  console.log("\n⚡ [PASO 2] Limpiando datos...");
  // Usamos nuestra función de diagnóstico
  const protocolParams = extractBytes(rawParamsResponse);
  
  console.log(`📊 Tamaño final de parámetros: ${protocolParams.length} bytes`);
  console.log(`   Primeros 10 bytes: [${protocolParams.slice(0, 10).join(', ')}...]`);

  if (protocolParams.length === 0) throw new Error("❌ Error: Parámetros vacíos.");

  const bytesToHash = new Uint8Array(32);
  webcrypto.getRandomValues(bytesToHash);

  const encryptionKeyBytes = new Uint8Array(userKeys.getPublicKey().toSuiBytes().slice(1));
  console.log(`🔑 Encryption Key (User): ${encryptionKeyBytes.length} bytes`);

  // --- MOMENTO CRÍTICO: WASM ---
  console.log("\n⚡ [PASO 3] Ejecutando prepareDKG (WASM)...");
  
  // LOGS DE ARGUMENTOS PARA DEBUGGING
  console.log("   > Arg 1 (Params): Uint8Array " + protocolParams.length);
  console.log("   > Arg 2 (Curve): " + Curve.SECP256K1);
  console.log("   > Arg 3 (Key): Uint8Array " + encryptionKeyBytes.length);
  
  const dkgRequestInput = await prepareDKG(
    protocolParams,           
    Curve.SECP256K1,          
    encryptionKeyBytes,       
    bytesToHash,              
    userAddress               
  );

  console.log("✅ Pruebas generadas exitosamente.");
  console.log("\n⚡ [PASO 4] Transacción On-Chain...");

  const sessionIdentifier = ikaTx.createSessionIdentifier();
  const networkEncryptionKey = await withRetry(
    () => ikaClient.getLatestNetworkEncryptionKey(),
    5, 2000, "Get Network Key"
  );

  const dwalletCap = await ikaTx.requestDWalletDKG({
    dkgRequestInput: dkgRequestInput,
    sessionIdentifier: sessionIdentifier,
    dwalletNetworkEncryptionKeyId: networkEncryptionKey.id,
    curve: Curve.SECP256K1,
    ikaCoin: tx.object(ikaCoinData.coinObjectId), 
    suiCoin: tx.splitCoins(tx.gas, [50000000]), 
  });

  tx.transferObjects([dwalletCap], tx.pure.address(userAddress));

  const result = await suiClient.signAndExecuteTransaction({
    signer: keypair,
    transaction: tx,
    options: { showEffects: true, showObjectChanges: true },
  });

  let dWalletId;
  result.objectChanges?.forEach((change) => {
    if (change.type === 'created' && change.objectType.includes('dwallet::DWallet')) {
      dWalletId = change.objectId;
    }
  });

  if (dWalletId) {
    console.log("\n🎉 ==================================================");
    console.log(`   🆔 dWallet ID: ${dWalletId}`);
    console.log("   ==================================================\n");
  } else {
    console.log("⚠️ Transacción enviada. Digest:", result.digest);
    console.log(`Link: https://suiscan.xyz/testnet/tx/${result.digest}`);
  }
}

main().catch((err) => {
  console.error("\n❌ ERROR FATAL:");
  console.error(err);
});