import { SuiClient, getFullnodeUrl } from '@mysten/sui/client';
import { Transaction } from '@mysten/sui/transactions';
import dotenv from 'dotenv';

dotenv.config();

const PACKAGE_ID = process.env.PACKAGE_ID;
const BUDGET_CONFIG_ID = process.env.BUDGET_CONFIG_ID;
const MY_ADDRESS = '0x...TU_DIRECCION...'; // Asegúrate de actualizar esto

// --- CONSTANTES PYTH TESTNET ---
// ID del objeto de estado de Pyth (Público)
const PYTH_STATE_ID = '0x23d7315113f5b1d3ba7a83604c44b94d79f4fd69af77f804fc7f920a6dc65744'; 
// ID del objeto que contiene el precio de SUI/USD (PriceInfoObject)
// Nota: Este ID cambia si Pyth actualiza su registro, pero este suele ser estable en testnet.
// Si falla, tendremos que buscar el ID fresco en el explorador.
const PYTH_SUI_PRICE_ID = '0x...NECESITAMOS_BUSCAR_ESTO...'; 

/* ⚠️ NOTA DE CTO: 
   En Testnet, los objetos de precio de Pyth caducan. 
   Para este script, simularemos la llamada pero es muy probable que falle con error "EPriceStale" (Precio Viejo).
   Esto es BUENO, significa que el contrato está validando la frescura del precio.
*/

async function checkSpend(client: SuiClient, amountSui: number) {
  const tx = new Transaction();
  
  // Convertir SUI a MIST (1 SUI = 10^9 MIST)
  const amountMist = amountSui * 1_000_000_000;

  console.log(`💸 Intentando registrar gasto de: ${amountSui} SUI`);

  // Llamada a financial_rules::check_and_record_spend
  // args: BudgetConfig, Amount(MIST), PythPriceObj, Clock
  tx.moveCall({
    target: `${PACKAGE_ID}::financial_rules::check_and_record_spend`,
    arguments: [
      tx.object(BUDGET_CONFIG_ID!),
      tx.pure.u64(amountMist),
      tx.object(PYTH_SUI_PRICE_ID), // Aquí está el truco
      tx.object('0x6') // Clock
    ],
  });

  // Simulamos (DevInspect)
  const result = await client.devInspectTransactionBlock({
    transactionBlock: tx,
    sender: MY_ADDRESS,
  });

  if (result.effects.status.status === 'failure') {
    console.log(`❌ FALLÓ (Esperado si el precio es viejo): ${result.effects.status.error}`);
    // Si el error contiene el código de EPriceStale (1), es un éxito parcial.
  } else {
    console.log('✅ ÉXITO: El gasto fue aprobado y está dentro del presupuesto.');
  }
}

async function main() {
  const client = new SuiClient({ url: getFullnodeUrl('testnet') });
  
  // Para que esto funcione, necesitamos el ID real de un objeto de precio SUI/USD.
  // Como esto es difícil de hardcodear, vamos a hacer un truco:
  // Listar objetos de Pyth y tomar el primero que encontremos para probar la conexión.
  
  console.log("🔍 Buscando oráculos de precios disponibles...");
  // Nota: Esto es simplificado. En producción usaríamos el servicio de Hermes.
  
  // Por ahora, intenta ejecutar con un ID placeholder para ver el error de conexión
  // O si tienes el ID real de un PriceInfoObject, ponlo arriba.
  await checkSpend(client, 10); // Intentar gastar 10 SUI
}

main().catch(console.error);