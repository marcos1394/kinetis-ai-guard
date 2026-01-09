import { SuiClient } from '@mysten/sui/client';

const COORDINATOR_ID = "0x4d157b7415a298c56ec2cb1dcab449525fa74aec17ddba376a83a7600f2062fc";

async function main() {
    console.log("🕵️‍♂️ MODO DETECTIVE: IMPRIMIENDO TODO");
    console.log(`📍 Coordinator: ${COORDINATOR_ID}`);
    console.log("========================================");

    const client = new SuiClient({ url: 'https://fullnode.testnet.sui.io:443' });
    
    // Traemos los campos dinámicos sin filtro
    const fields = await client.getDynamicFields({
        parentId: COORDINATOR_ID
    });

    console.log(`📦 Encontrados ${fields.data.length} campos.`);

    fields.data.forEach((item, index) => {
        console.log(`\n📄 CAMPO #${index + 1}:`);
        console.log(`   Name Type:  ${item.name.type}`);
        console.log(`   Name Value: ${JSON.stringify(item.name.value)}`);
        console.log(`   Object ID:  ${item.objectId}`);
        console.log(`   Type:       ${item.type}`);
    });
}

main();