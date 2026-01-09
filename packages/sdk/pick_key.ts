import { SuiClient } from '@mysten/sui/client';

// EL ID DEL "LLAVERO" QUE ENCONTRASTE (dwallet_network_encryption_keys)
const TABLE_ID = "0xaa254e9a8ec6665341d2be2c00ecdf7fea142ab2a07f81f58133ba181f55239a";

async function main() {
    console.log(`🔑 ABRIENDO LLAVERO MAESTRO: ${TABLE_ID}`);
    console.log("==================================================");

    const client = new SuiClient({ url: 'https://fullnode.testnet.sui.io:443' });

    // Consultamos los campos dinámicos de la tabla
    const fields = await client.getDynamicFields({
        parentId: TABLE_ID
    });

    console.log(`📦 Llaves encontradas: ${fields.data.length}`);

    fields.data.forEach((item) => {
        console.log(`\n🗝️  LLAVE DISPONIBLE:`);
        // En las tablas de Ika, el 'name' suele ser el ID de la llave
        console.log(`   👉 Name (Key ID): ${item.name.value}`); 
        console.log(`   👉 Object ID:     ${item.objectId}`);
        
        console.log("------------------------------------------------");
        console.log("✅ ESTE ES EL ID QUE DEBES COPIAR (El 'Name' o el 'Object ID')");
        console.log("   (Normalmente Ika usa el Object ID de la llave como referencia)");
    });
}

main();