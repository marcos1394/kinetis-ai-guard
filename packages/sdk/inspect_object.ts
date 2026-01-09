import { SuiClient } from '@mysten/sui/client';

// EL OBJETO "HIJO" QUE ENCONTRAMOS (CAMPO "2")
const TARGET_OBJECT_ID = "0x3ec4e8db62e3a757ce9e23a45476b0c7d69e2efc0bb1f31d6a71314530d40998";

async function main() {
    console.log(`📦 INSPECCIONANDO OBJETO: ${TARGET_OBJECT_ID}`);
    console.log("==================================================");

    const client = new SuiClient({ url: 'https://fullnode.testnet.sui.io:443' });

    const objectData = await client.getObject({
        id: TARGET_OBJECT_ID,
        options: { showContent: true }
    });

    console.log(JSON.stringify(objectData.data?.content, null, 2));
}

main();