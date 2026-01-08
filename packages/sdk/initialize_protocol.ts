import { KinetisClient } from './src/core/KinetisClient';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { fromB64 } from '@mysten/sui/utils';
import { Transaction } from '@mysten/sui/transactions';
import { SUI_CLOCK_OBJECT_ID } from './src/utils/constants';

// --- TUS DATOS DEL DEPLOY ---
const KEYSTORE_BASE64 = 'AILnXvnwAuQeDltDVMk1IRBSRLAWL7kMdTMZ7qjiLbg9'; // Tu llave privada
const PACKAGE_ID = '0x785d2a18f8211d2baf25bf856cbe01a2c11addd27fab2f5ff2d4f9853d4e9b49';
const SYSTEM_CAP_ID = '0xcb8b7a95522f7495a9691415b92fe5b38d529672a6507b8919e89fcdae05bcef';

async function main() {
    console.log("🚀 INICIALIZANDO PROTOCOLO KINETIS...");
    
    // 1. Setup Wallet
    let privKeyBytes = fromB64(KEYSTORE_BASE64);
    if (privKeyBytes.length === 33) privKeyBytes = privKeyBytes.slice(1);
    const keypair = Ed25519Keypair.fromSecretKey(privKeyBytes);
    
    // 2. Setup Cliente (Modo Raw, sin init complejo)
    const sdk = new KinetisClient({ 
        network: 'testnet',
        packageId: PACKAGE_ID 
    });

    // 3. Construir Transacción de Inicialización
    // Llamamos a: policy_registry::initialize(SystemObjectCap, &Clock)
    // OJO: Asumo que la función se llama 'initialize'. Si tu contrato tiene otro nombre, avísame.
    const tx = new Transaction();
    
    tx.moveCall({
        target: `${PACKAGE_ID}::policy_registry::initialize`,
        arguments: [
            tx.object(SYSTEM_CAP_ID),      // La llave maestra
            tx.object(SUI_CLOCK_OBJECT_ID) // El reloj
        ]
    });

    // 4. Ejecutar
    console.log("⏳ Enviando transacción de inicialización...");
    const result = await sdk.signAndExecute(keypair, tx, {
        showObjectChanges: true,
        showEffects: true
    });

    if (result.effects?.status.status === 'success') {
        console.log("✅ ¡PROTOCOLO INICIALIZADO!");
        
        // Buscar el objeto creado
        const registry = result.objectChanges?.find(
            (o: any) => o.type === 'created' && o.objectType.includes('::Registry')
        );

        if (registry) {
            console.log("\n🔥🔥🔥 REGISTRY NACIDO 🔥🔥🔥");
            console.log(`🆔 ID: ${(registry as any).objectId}`);
            console.log("---------------------------------------");
            console.log("👉 COPIA ESTE ID A TU constants.ts");
        } else {
            console.log("⚠️ Transacción exitosa, pero no veo el objeto Registry en los cambios. Revisa el log completo:");
            console.dir(result.objectChanges, { depth: null });
        }
    } else {
        console.error("❌ Falló la inicialización:", result.effects?.status.error);
    }
}

main();