import { SuiClient } from '@mysten/sui/client';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { fromB64 } from '@mysten/sui/utils';
import { DWalletModule } from '../sdk/src/modules/Dwallet'; // Ajusta la ruta si es necesario

// TU LLAVE PRIVADA (La misma del deployer que tiene los IKA coins)
const KEYSTORE_BASE64 = 'AILnXvnwAuQeDltDVMk1IRBSRLAWL7kMdTMZ7qjiLbg9'; 

async function main() {
    console.clear();
    console.log("🔐 KINETIS: INICIANDO CREACIÓN DE dWALLET (MPC-DKG)");
    console.log("====================================================");

    try {
        // 1. Setup Básico
        const client = new SuiClient({ url: 'https://fullnode.testnet.sui.io:443' });
        
        let privKeyBytes = fromB64(KEYSTORE_BASE64);
        if (privKeyBytes.length === 33) privKeyBytes = privKeyBytes.slice(1);
        const keypair = Ed25519Keypair.fromSecretKey(privKeyBytes);
        
        console.log(`👤 Usuario: ${keypair.toSuiAddress()}`);

        // 2. Inicializar Módulo DWallet
        console.log("\n[1/3] 🔌 Inicializando WASM de Ika...");
        const dwallet = new DWalletModule(client, 'testnet');
        await dwallet.init(); // ¡CRÍTICO! Carga la criptografía WASM
        console.log("✅ Criptografía lista.");

        // 3. Ejecutar DKG
        console.log("\n[2/3] ⚙️  Ejecutando DKG (Esto tardará unos 10-30 segundos)...");
        console.log("      (Requiere monedas IKA para pagar el servicio MPC)");

        const result = await dwallet.createDWallet(keypair);

        // 4. Resultado
        console.log("\n[3/3] 🎉 ¡ÉXITO! dWALLET CREADA");
        console.log("====================================================");
        console.log(`🆔 dWallet ID (Sui Object): ${result.dWalletId}`);
        console.log(`🔑 Bitcoin/Ethereum Address (Derivada): 0x${result.publicKeyHex}`); // (Simplificación, esto es la PubKey raw)
        console.log(`🌱 Semilla Local (Guárdala!):`, result.seed);
        console.log("====================================================");
        
        console.log("\n👉 COPIA EL 'dWallet ID' y guárdalo para vincularlo a tu Agente.");

    } catch (error) {
        console.error("\n❌ ERROR CRÍTICO:");
        console.error(error);
    }
}

main();