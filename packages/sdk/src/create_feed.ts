import { 
    SwitchboardClient, 
    Aggregator
  } from "@switchboard-xyz/sui-sdk";
  import { CrossbarClient, OracleJob } from "@switchboard-xyz/common";
  import { getFullnodeUrl, SuiClient } from "@mysten/sui/client";
  import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
  import { Transaction } from "@mysten/sui/transactions";
  import { fromB64 } from "@mysten/sui/utils"; // Importante para decodificar
  import * as dotenv from "dotenv";
  
  // Cargar variables de entorno (.env)
  dotenv.config();
  
  // CAMBIO: Leemos la variable del Keystore
  const KEYSTORE_STRING = process.env.SUI_KEYSTORE_STRING;
  
  async function main() {
    if (!KEYSTORE_STRING) {
      throw new Error("❌ Error: No se encontró SUI_KEYSTORE_STRING en el archivo .env");
    }
  
    console.log("🔌 Conectando a Sui Testnet...");
    const client = new SuiClient({ url: getFullnodeUrl("testnet") });
    
    // --- LÓGICA DE RECUPERACIÓN DE LLAVE ---
    // 1. Decodificar la cadena Base64
    const rawBytes = fromB64(KEYSTORE_STRING);
    // 2. Eliminar el primer byte (flag de esquema, usualmente 0 para Ed25519)
    const privateKeyBytes = rawBytes.slice(1);
    // 3. Crear el Keypair
    const keypair = Ed25519Keypair.fromSecretKey(privateKeyBytes);
    
    const userAddress = keypair.toSuiAddress();
    console.log(`👤 Usuario (Owner): ${userAddress}`);
  
    // 1. Inicializar cliente de Switchboard
    const sb = new SwitchboardClient(client);
    
    // 2. Cliente de Crossbar para guardar trabajos
    const crossbar = new CrossbarClient("https://crossbar.switchboard.xyz");
  
    console.log("🛠️  Definiendo el trabajo (Job) para SUI/USDT...");
  
    const jobs: OracleJob[] = [
      OracleJob.fromObject({
        tasks: [
          {
            httpTask: {
              url: "https://api.binance.com/api/v3/ticker/price?symbol=SUIUSDT",
            },
          },
          {
            jsonParseTask: {
              path: "$.price",
            },
          },
        ],
      }),
    ];
  
    // 3. Guardar Job en Crossbar
    // Queue de Testnet (Hardcoded para asegurar compatibilidad)
    const TESTNET_QUEUE = "0x78902506b3a0429a3977c07da33246eb74a62df8ce429739f8299ba420d2d79d"; 
    
    console.log("💾 Guardando definición del Job...");
    const { feedHash } = await crossbar.store(TESTNET_QUEUE, jobs);
    console.log(`📝 Feed Hash generado: ${feedHash}`);
  
    // 4. Crear Transacción
    const tx = new Transaction();
  
    // Configuración del Feed
    await Aggregator.initTx(sb, tx, {
      feedHash,
      name: "Kinetis SUI/USD",
      authority: userAddress,
      minSampleSize: 1,
      maxStalenessSeconds: 60,
      maxVariance: 1e9,
      minResponses: 1,
    });
  
    console.log("🚀 Enviando transacción...");
    const res = await client.signAndExecuteTransaction({
      signer: keypair,
      transaction: tx,
      options: {
        showEffects: true,
        showObjectChanges: true,
      },
    });
  
    console.log("⏳ Esperando confirmación...");
    await client.waitForTransaction({ digest: res.digest });
  
    // 5. Buscar el ID
    let aggregatorId;
    res.objectChanges?.forEach((change) => {
      if (change.type === 'created' && change.objectType.includes('aggregator::Aggregator')) {
        aggregatorId = change.objectId;
      }
    });
    
    if (aggregatorId) {
      console.log("\n✅ ¡ÉXITO! Aggregator Creado.");
      console.log("==========================================");
      console.log(`🆔 AGGREGATOR ID: ${aggregatorId}`);
      console.log("==========================================");
    } else {
      console.log("⚠️  La transacción pasó, pero no encontré el ID en los logs. Revisa el explorer:");
      console.log(`https://suiscan.xyz/testnet/tx/${res.digest}`);
    }
  }
  
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });