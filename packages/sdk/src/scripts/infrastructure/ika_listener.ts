import { getNetworkConfig, IkaClient } from '@ika.xyz/sdk';
import { getFullnodeUrl, SuiClient } from '@mysten/sui/client';
import * as dotenv from 'dotenv';

dotenv.config();

async function main() {
  console.log("🛡️  Iniciando Kinetis Sentinel (Ika Listener)...");

  try {
    // 1. Configurar conexión base a Sui Testnet
    const suiClient = new SuiClient({ url: getFullnodeUrl('testnet') });
    console.log("✅ Conectado a Sui Testnet RPC");

    // 2. Inicializar Ika Client con la configuración de Testnet
    // Según tu doc: "We recommend you to have a single instance... enables caching"
    console.log("🔄 Inicializando Ika Client...");
    
    const ikaClient = new IkaClient({
      suiClient: suiClient,
      config: getNetworkConfig('testnet'), 
    });

    // "This will initialize the Ika Client and fetch the Ika protocol state and objects."
    await ikaClient.initialize();
    console.log("✅ Ika Client Inicializado correctamente.");

    // 3. Prueba de Conexión: Consultar el Epoch actual de Ika
    const epoch = await ikaClient.getEpoch();
    console.log(`🌍 Ika Network Epoch actual: ${epoch}`);

    // 4. Prueba de Consulta de Llaves de Encriptación
    // Esto nos confirma que podemos leer el estado criptográfico de la red
    const latestKey = await ikaClient.getLatestNetworkEncryptionKey();
    console.log(`DKG Latest Key ID: ${latestKey.id}`);

    console.log("\n🚀 Infraestructura Off-Chain: LISTA Y CONECTADA.");

  } catch (error) {
    console.error("❌ Error de conexión con Ika:", error);
    if (error instanceof Error) {
        console.error("Detalles:", error.message);
    }
  }
}

main().catch(console.error);