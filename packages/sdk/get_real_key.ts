import { SuiClient } from '@mysten/sui/client';

// EL ID QUE ENCONTRAMOS EN TU JSON:
const COORDINATOR_ID = "0x4d157b7415a298c56ec2cb1dcab449525fa74aec17ddba376a83a7600f2062fc";

async function main() {
    console.log("🔑 BUSCANDO LLAVE ACTIVA EN EL COORDINADOR");
    console.log(`📍 Coordinator: ${COORDINATOR_ID}`);
    console.log("========================================");

    const client = new SuiClient({ url: 'https://fullnode.testnet.sui.io:443' });

    let hasNext = true;
    let cursor: string | null | undefined = null;

    while (hasNext) {
        const fields = await client.getDynamicFields({
            parentId: COORDINATOR_ID,
            cursor
        });

        console.log(`\n📦 Encontrados ${fields.data.length} campos dinámicos...`);

        for (const item of fields.data) {
            // Ika guarda las llaves usando el tipo '0x2::object::ID' como nombre del campo
            if (item.name.type === '0x2::object::ID') {
                 console.log(`\n✅ ¡CANDIDATO ENCONTRADO!`);
                 console.log(`   👉 Key ID (Value):  ${item.name.value}`);
                 console.log(`   👉 Object ID:       ${item.objectId}`);
                 console.log("------------------------------------------------");
                 console.log("⚠️ COPIA EL 'Key ID' DE ARRIBA PARA USARLO EN TU CÓDIGO ⚠️");
            }
        }
        
        if (!fields.hasNextPage) break;
        cursor = fields.nextCursor;
    }
}

main();