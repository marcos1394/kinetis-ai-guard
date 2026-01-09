import { SuiClient } from '@mysten/sui/client';

// EL OBJETO GIGANTE QUE ENCONTRASTE (El wrapper del Dynamic Field campo "2")
const TARGET_OBJECT_ID = "0x3ec4e8db62e3a757ce9e23a45476b0c7d69e2efc0bb1f31d6a71314530d40998";

async function main() {
    console.log(`🔎 FILTRANDO LLAVES EN OBJETO: ${TARGET_OBJECT_ID}`);
    console.log("==================================================");

    const client = new SuiClient({ url: 'https://fullnode.testnet.sui.io:443' });

    // 1. Obtenemos el objeto completo
    const objectData = await client.getObject({
        id: TARGET_OBJECT_ID,
        options: { showContent: true }
    });

    const content = objectData.data?.content as any;

    // 2. Navegación profunda al lugar donde Ika guarda los datos
    // Estructura usual: fields -> value -> fields
    const innerFields = content?.fields?.value?.fields;

    if (!innerFields) {
        console.log("❌ No se pudo navegar a la estructura interna. ¿El objeto es correcto?");
        return;
    }

    console.log("📂 RESULTADOS FILTRADOS (Solo IDs y Llaves):");
    console.log("--------------------------------------------");

    let foundCandidates = 0;

    // 3. Iteramos sobre cada campo y aplicamos lógica de detective
    for (const key of Object.keys(innerFields)) {
        const value = innerFields[key];
        let extractedId = "No es un ID simple";

        // Intentamos extraer un ID si es un objeto de Move (UID)
        if (value && typeof value === 'object') {
            if (value.id) {
                // Caso directo: { id: "0x..." }
                extractedId = value.id; 
            } else if (value.fields && value.fields.id && value.fields.id.id) {
                // Caso UID anidado: { fields: { id: { id: "0x..." } } }
                extractedId = value.fields.id.id;
            }
        }

        // 4. FILTRO INTELIGENTE:
        // Solo mostramos si el nombre del campo parece importante
        const isSuspicious = key.includes("key") || 
                             key.includes("encryption") || 
                             key.includes("network") ||
                             key.includes("coordinator");

        if (isSuspicious) {
            foundCandidates++;
            console.log(`\n🔑 NOMBRE DEL CAMPO: [ ${key} ]`);
            console.log(`   └─ ID EXTRAÍDO:   ${extractedId}`);
            
            if (extractedId.startsWith("0x")) {
                 console.log(`   ✨ ¡ESTE ES UN CANDIDATO FUERTE! Cópialo.`);
            }
        }
    }

    if (foundCandidates === 0) {
        console.log("\n⚠️ No encontré campos obvios con 'key' o 'encryption'.");
        console.log("Listando TODAS las llaves para revisión manual rápida:");
        console.log(Object.keys(innerFields).join(", "));
    }
}

main();