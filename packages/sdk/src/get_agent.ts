import { SuiClient, getFullnodeUrl } from '@mysten/sui/client';
import dotenv from 'dotenv';

// Cargar variables de entorno
dotenv.config();

const PACKAGE_ID = process.env.PACKAGE_ID;
// Reemplaza esto con TU dirección pública (la que usaste para el deploy)
// Puedes obtenerla con `sui client active-address` en la terminal
const MY_ADDRESS = '0x...PON_TU_DIRECCION_AQUI...'; 

async function main() {
  console.log('📡 Conectando a Sui Testnet...');

  // 1. Inicializar el Cliente (RPC)
  const client = new SuiClient({
    url: getFullnodeUrl('testnet'),
  });

  console.log(`🔍 Buscando agentes propiedad de: ${MY_ADDRESS}`);
  console.log(`📦 Filtrando por contrato: ${PACKAGE_ID}`);

  // 2. Consultar objetos propiedad del usuario
  // Filtramos específicamente por el tipo "AgentProfile" de nuestro contrato
  const response = await client.getOwnedObjects({
    owner: MY_ADDRESS,
    filter: {
      StructType: `${PACKAGE_ID}::policy_registry::AgentProfile`,
    },
    options: {
      showContent: true, // Queremos ver los datos (nombre, modelo), no solo el ID
    },
  });

  // 3. Procesar y mostrar resultados
  if (response.data.length === 0) {
    console.log('⚠️ No se encontraron Agentes. ¿Hiciste el deploy y la llamada register_agent?');
    return;
  }

  console.log(`✅ ¡Éxito! Se encontraron ${response.data.length} Agente(s).`);

  response.data.forEach((obj: any) => {
    const fields = obj.data?.content?.fields;
    if (fields) {
      console.log('------------------------------------------------');
      console.log(`🤖 ID Objeto: ${obj.data?.objectId}`);
      console.log(`📝 Nombre:    ${fields.name}`);
      console.log(`🧠 Modelo IA: ${fields.ai_model_version}`);
      console.log(`⏸️ Pausado:   ${fields.is_paused}`);
      console.log('------------------------------------------------');
    }
  });
}

main().catch(console.error);