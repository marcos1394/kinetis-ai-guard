import { SuiClient } from '@mysten/sui/client';

// Tu wallet
const OWNER = '0xa571a4d71a7dbf5f61c6538188c2759a1a27d56b8af25d52dac7734f7479be59';

async function main() {
    const client = new SuiClient({ url: 'https://fullnode.testnet.sui.io:443' });
    console.log(`💰 Escaneando monedas (Tokens) en: ${OWNER}...`);
    console.log("===================================================");

    let hasNext = true;
    let cursor = null;

    while (hasNext) {
        const coins = await client.getAllCoins({ owner: OWNER, cursor });
        
        for (const coin of coins.data) {
            // Ignoramos SUI normal para no llenar la pantalla, pero lo mostramos resumido
            if (coin.coinType === '0x2::sui::SUI') {
                // console.log(`🔹 SUI (Gas): ${coin.balance}`);
                continue; 
            }

            console.log(`\n📦 TOKEN ENCONTRADO:`);
            console.log(`   Type:     ${coin.coinType}`);
            console.log(`   Balance:  ${coin.balance}`);
            console.log(`   ObjectID: ${coin.coinObjectId}`);
            
            // Análisis rápido
            if (coin.coinType.includes("0x785d2a18f8211d2baf25bf856cbe01a2c11addd27fab2f5ff2d4f9853d4e9b49")) {
                console.log("   👉 ESTE ES TU IKA (Desplegado por ti - Kinetis)");
            } else {
                console.log("   ✅ ¡POSIBLE IKA OFICIAL! (O token externo)");
            }
            console.log("---------------------------------------------------");
        }
        
        if (!coins.hasNextPage) break;
        cursor = coins.nextCursor as any;
    }
}

main();