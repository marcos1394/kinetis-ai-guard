import { getNetworkConfig } from '@ika.xyz/sdk';
import { SuiClient } from '@mysten/sui/client';

async function main() {
    console.log("🕵️‍♂️ INSPECTOR DE CONFIGURACIÓN IKA");
    console.log("==================================");

    // 1. "Casteamos" a any para que TypeScript no se queje de las propiedades
    const config = getNetworkConfig('testnet') as any;

    // 2. Imprimimos TODO el objeto para ver los nombres reales y los valores
    console.log("📦 Objeto Configuración Completo:");
    console.log(JSON.stringify(config, null, 2));

    // 3. Intentamos detectar el ID del Coordinador buscando en las rutas comunes
    // Basado en la estructura usual de Ika, suele estar en 'objectIds' o raíz.
    let coordinatorId = config.objectIds?.ikaDwalletCoordinator || config.ikaDwalletCoordinator || config.coordinator;
    
    // También extraemos el Key ID que está fallando actualmente
    let currentKeyId = config.objectIds?.dwalletNetworkEncryptionKeyId || config.dwalletNetworkEncryptionKeyId;

    if (!coordinatorId) {
        console.log("\n⚠️  No pude detectar automáticamente el Coordinator ID.");
        console.log("👉 Por favor, revisa el JSON de arriba y busca el ID del objeto Coordinador.");
        // Si no lo encuentra auto, trataremos de usar uno conocido de testnet si existe en el log
        return; 
    }

    console.log(`\n📍 ID Coordinador detectado: ${coordinatorId}`);
    console.log(`🔑 Key ID actual (Posiblemente erróneo): ${currentKeyId}`);

    // 4. Conectamos a la red para ver la VERDAD
    const client = new SuiClient({ url: 'https://fullnode.testnet.sui.io:443' });
    
    // Solución al error de tipo del cursor que viste antes
    let cursor: string | null | undefined = null; 
    let hasNext = true;

    console.log("\n🔎 Buscando llaves válidas en la Blockchain...");

    while (hasNext) {
        const fields = await client.getDynamicFields({
            parentId: coordinatorId,
            cursor
        });

        for (const item of fields.data) {
            // Buscamos objetos que parezcan IDs (así guarda Ika las llaves en el dynamic field)
            if (item.name.type === '0x2::object::ID') {
                 console.log(`\n✅ LLAVE VÁLIDA ENCONTRADA EN BLOCKCHAIN:`);
                 console.log(`   Value (Key ID): ${item.name.value}`);
                 console.log(`   Object ID:      ${item.objectId}`);
                 
                 if (item.name.value === currentKeyId) {
                     console.log("   (Esta es la que tienes configurada... y existe. ¡Qué raro!)");
                 } else {
                     console.log("   ⚠️ ¡DIFERENTE A TU CONFIG! Deberías usar esta.");
                 }
            }
        }
        
        if (!fields.hasNextPage) break;
        cursor = fields.nextCursor;
    }
}

main();