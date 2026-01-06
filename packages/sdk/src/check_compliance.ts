import { SuiClient, getFullnodeUrl } from '@mysten/sui/client';
import { Transaction } from '@mysten/sui/transactions';
import { bcs } from '@mysten/sui/bcs';
import dotenv from 'dotenv';

dotenv.config();

// Constantes del entorno
const PACKAGE_ID = process.env.PACKAGE_ID;
const POLICY_CONFIG_ID = process.env.POLICY_CONFIG_ID;
// Dirección pública del Agente (la tuya o la del bot)
const MY_ADDRESS = '0x...TU_DIRECCION_PUBLICA...'; 

// Direcciones para probar (Test Cases)
const TARGET_ALLOWED = "0x1234567890123456789012345678901234567890123456789012345678901234"; // La que añadiste a la whitelist
const TARGET_BLOCKED = "0x9999999999999999999999999999999999999999999999999999999999999999"; // Una desconocida

async function checkPermission(client: SuiClient, target: string) {
  const tx = new Transaction();

  // Construimos la llamada a la función Move `verify_transaction`
  tx.moveCall({
    target: `${PACKAGE_ID}::policy_rules::verify_transaction`,
    arguments: [
      tx.object(POLICY_CONFIG_ID!), // El objeto con las reglas
      tx.pure.address(target),      // La dirección destino
      tx.object('0x6')              // El Reloj del sistema (Clock)
    ],
  });

  // Ejecutamos DevInspect (Simulación de lectura sin costo de gas)
  const result = await client.devInspectTransactionBlock({
    transactionBlock: tx,
    sender: MY_ADDRESS,
  });

  // Análisis de resultados (CTO Level Debugging)
  if (result.effects.status.status === 'failure') {
    console.error(`❌ Error en la ejecución del contrato: ${result.effects.status.error}`);
    return false;
  }

  // En Move, los retornos de devInspect vienen en `results`.
  // Necesitamos decodificar el valor de retorno (return value 0).
  // verify_transaction devuelve un boolean (true/false).
  if (result.results && result.results[0].returnValues) {
    const rawValue = result.results[0].returnValues[0];
    // rawValue[0] es el array de bytes. rawValue[1] es el tipo.
    // Usamos BCS para decodificarlo a booleano.
    const isAllowed = bcs.bool().parse(new Uint8Array(rawValue[0]));
    return isAllowed;
  }

  return false;
}

async function main() {
  console.log('👮 Kinetis Compliance Engine: Iniciando Verificación...');
  console.log(`📜 Usando Policy Config: ${POLICY_CONFIG_ID}\n`);

  const client = new SuiClient({ url: getFullnodeUrl('testnet') });

  // CASO 1: Verificar dirección permitida
  console.log(`🔹 Test 1: Verificando destino Whitelisted (${TARGET_ALLOWED.slice(0,6)}...)`);
  const allowed = await checkPermission(client, TARGET_ALLOWED);
  if (allowed) {
    console.log('✅ RESULTADO: APROBADO. El agente puede proceder.');
  } else {
    console.log('🚫 RESULTADO: DENEGADO (Inesperado si la añadiste antes).');
  }

  console.log('------------------------------------------------');

  // CASO 2: Verificar dirección desconocida
  console.log(`🔹 Test 2: Verificando destino Desconocido (${TARGET_BLOCKED.slice(0,6)}...)`);
  const blocked = await checkPermission(client, TARGET_BLOCKED);
  if (!blocked) {
    console.log('🛡️ RESULTADO: BLOQUEADO CORRECTAMENTE. El sistema es seguro.');
  } else {
    console.log('⚠️ ALERTA: APROBADO (Esto es un fallo de seguridad, revisa tu código).');
  }
}

main().catch(console.error);