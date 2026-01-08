import { KinetisClient } from '../sdk/src/core/KinetisClient';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { fromB64 } from '@mysten/sui/utils';

// 👇 PEGA AQUÍ LA PRIMERA LLAVE QUE TE SALIÓ EN EL KEYSTORE (Base64)
// (Si al ejecutar ves que la dirección NO es 0xa571..., cambia por la segunda llave)
const KEYSTORE_BASE64 = 'AILnXvnwAuQeDltDVMk1IRBSRLAWL7kMdTMZ7qjiLbg9';

async function runTest() {
    console.clear();
    console.log("🚀 KINETIS PROTOCOL: INICIANDO TEST DE INTEGRACIÓN (CLI MODE)");
    console.log("=============================================================");

    try {
        // 1. Configurar Signer (Adaptado para formato CLI/Base64)
        let privKeyBytes = fromB64(KEYSTORE_BASE64);
        
        // La CLI agrega un byte de "flag" al inicio (0x00 para Ed25519). Lo quitamos.
        if (privKeyBytes.length === 33) {
            privKeyBytes = privKeyBytes.slice(1);
        }

        const keypair = Ed25519Keypair.fromSecretKey(privKeyBytes);
        const ownerAddress = keypair.toSuiAddress();
        
        console.log(`👤 Actor (Wallet): ${ownerAddress}`);
        
        // Verificación rápida para que sepas si estás usando la wallet correcta
        if (ownerAddress.startsWith('0xa571')) {
            console.log("✅ ¡Es la wallet del deployer!");
        } else {
            console.warn("⚠️ OJO: Esta dirección es diferente a la del deploy (0xa571...).");
            console.warn("   Si tienes saldo aquí, funcionará. Si no, cambia la llave en el script.");
        }

        // 2. Inicializar SDK
        console.log("\n[1/4] 🔌 Inicializando SDK...");
        const sdk = new KinetisClient({ network: 'testnet' });
        
        await sdk.init();
        console.log(`✅ SDK Conectado. Package ID: ${sdk.packageId}`);

        // 3. Prueba de Oráculo (Lectura)
        console.log("\n[2/4] 📡 Verificando Salud del Oráculo...");
        const oracle = await sdk.oracle.checkOracleHealth();
        
        if (oracle.isHealthy) {
            console.log(`✅ Oráculo ACTIVO | Precio SUI: $${oracle.price} USD | Last Update: ${oracle.lastUpdate?.toLocaleTimeString()}`);
        } else {
            console.warn(`⚠️ ALERTA ORÁCULO: ${oracle.error}`);
            console.log("Continuando prueba bajo riesgo...");
        }

        // 4. Prueba de Escritura (Registrar Agente)
        const agentName = `Kinetis Agent ${Math.floor(Math.random() * 1000)}`;
        console.log(`\n[3/4] 🤖 Intentando crear agente: "${agentName}"...`);
        console.log("      (Esto puede tardar unos segundos confirmando en blockchain)");

        const tx = sdk.registry.createAgentTransaction(agentName, "Llama-3-70B");
        
        const result = await sdk.signAndExecute(keypair, tx, { 
            showEffects: true,
            showObjectChanges: true 
        });

        if (result.effects?.status.status === 'success') {
            console.log(`🎉 ¡ÉXITO! Transacción confirmada.`);
            console.log(`🔗 Explorer: https://suiscan.xyz/testnet/tx/${result.digest}`);
        } else {
            throw new Error(`❌ La transacción falló: ${result.effects?.status.error}`);
        }

        // 5. Prueba de Lectura (Verificación)
        console.log("\n[4/4] 📋 Verificando inventario de agentes...");
        // Esperamos 2 segundos para asegurar consistencia de lectura en nodos RPC
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        const myAgents = await sdk.registry.getAgentsByOwner(ownerAddress);
        
        console.log(`📊 Agentes encontrados: ${myAgents.length}`);
        
        const newAgent = myAgents.find(a => a.name === agentName);
        if (newAgent) {
            console.table({
                "ID": newAgent.id,
                "Nombre": newAgent.name,
                "Modelo": newAgent.model,
                "AdminCap": newAgent.ownerCapId
            });
            console.log("\n✅ TEST COMPLETADO: El sistema funciona end-to-end.");
        } else {
            console.error("❌ ERROR: El agente se creó pero no aparece en la lista (Problema de Indexación RPC).");
        }

    } catch (error) {
        console.error("\n❌ FATAL ERROR durante el test:");
        console.error(error);
    }
}

runTest();