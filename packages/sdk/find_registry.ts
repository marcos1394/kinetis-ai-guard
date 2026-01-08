import { SuiClient } from '@mysten/sui/client';

// Tus datos reales
const OWNER = '0xa571a4d71a7dbf5f61c6538188c2759a1a27d56b8af25d52dac7734f7479be59';
const PACKAGE_ID = '0x785d2a18f8211d2baf25bf856cbe01a2c11addd27fab2f5ff2d4f9853d4e9b49';
const NETWORK = 'https://fullnode.testnet.sui.io:443';

async function main() {
    console.log(`🔍 Buscando Kinetis Registry en la cuenta: ${OWNER.slice(0,6)}...`);
    
    const client = new SuiClient({ url: NETWORK });

    // 1. Buscamos objetos propios
    let hasNextPage = true;
    let nextCursor = null;
    let found = false;

    while (hasNextPage && !found) {
        const response = await client.getOwnedObjects({
            owner: OWNER,
            options: { showType: true, showContent: true },
            cursor: nextCursor
        });

        // Buscamos el objeto que contenga "policy_registry::Registry" o similar
        // El nombre exacto depende de tu contrato, buscamos "Registry" genérico dentro de tu Package
        const registry = response.data.find(obj => 
            obj.data?.type?.includes(PACKAGE_ID) && 
            (obj.data?.type?.includes('::Registry') || obj.data?.type?.includes('::PolicyRegistry'))
        );

        if (registry) {
            console.log("\n✅ ¡OBJETO ENCONTRADO!");
            console.log("------------------------------------------------");
            console.log(`📦 Tipo: ${registry.data?.type}`);
            console.log(`🆔 OBJECT ID: ${registry.data?.objectId}`);
            console.log("------------------------------------------------");
            console.log("👉 Copia ese ID y pégalo en constants.ts");
            found = true;
        }

        hasNextPage = response.hasNextPage;
        nextCursor = response.nextCursor as any;
    }

    if (!found) {
        console.log("\n❌ No se encontró un objeto 'Registry' propiedad de esta cuenta.");
        console.log("   Posibilidad A: Es un objeto compartido (Shared Object).");
        console.log("   Posibilidad B: El nombre del struct en Move no es 'Registry'.");
        
        // Si no está, inspeccionamos la transacción de despliegue para ver qué creó
        console.log("\n🕵️ Intentando buscar en la transacción de despliegue original...");
        const DEPLOY_TX = '56f6A3rdDiwpiZcbcYuzq3BbP8jf5nBRko6K5XSpdJK8'; // Tu digest
        const tx = await client.getTransactionBlock({
            digest: DEPLOY_TX,
            options: { showObjectChanges: true }
        });

        if (tx.objectChanges) {
            console.log("   Objetos creados en el despliegue:");
            tx.objectChanges.forEach((change: any) => {
                if (change.type === 'created') {
                    console.log(`   - ${change.objectType} \n     ID: ${change.objectId}`);
                }
            });
        }
    }
}

main();