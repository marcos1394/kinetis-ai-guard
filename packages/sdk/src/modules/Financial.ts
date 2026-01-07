import { SuiClient } from '@mysten/sui/client';
import { Transaction } from '@mysten/sui/transactions';
import { SUI_CLOCK_OBJECT_ID } from '../utils/constants'; // Usamos las constantes centralizadas

// ID OFICIAL DE SWITCHBOARD SUI/USD (TESTNET)
// Este es el objeto que contiene el precio. El contrato lo leerá.
const SWITCHBOARD_SUI_USD_AGGREGATOR = '0x1690022350868a881855a0224449830855239a5c898c614b77f98cf4a9557476'; 

export class FinancialModule {
    private client: SuiClient;
    private packageId: string;

    constructor(client: SuiClient, packageId: string) {
        this.client = client;
        this.packageId = packageId;
    }

    /**
     * Simula (Dry Run) si un gasto sería aprobado por las reglas financieras.
     * Útil para que el Agente sepa si puede gastar antes de enviar la tx real.
     */
    async checkSpendSimulation(
        senderAddress: string,
        budgetConfigId: string,
        amountSui: number
    ): Promise<{ approved: boolean; reason?: string }> {
        const tx = new Transaction();
        
        // 1. Convertir SUI a MIST (1 SUI = 10^9 MIST)
        const amountMist = BigInt(amountSui * 1_000_000_000);

        // 2. Construir la llamada Move
        // financial_rules::check_and_record_spend(budget, amount, aggregator, clock)
        tx.moveCall({
            target: `${this.packageId}::financial_rules::check_and_record_spend`,
            arguments: [
                tx.object(budgetConfigId),
                tx.pure.u64(amountMist),
                tx.object(SWITCHBOARD_SUI_USD_AGGREGATOR), // <--- CAMBIO CLAVE: Usamos Switchboard
                tx.object(SUI_CLOCK_OBJECT_ID)
            ],
        });

        // 3. Ejecutar DevInspect (Simulación sin costo de gas ni firma)
        try {
            const result = await this.client.devInspectTransactionBlock({
                transactionBlock: tx,
                sender: senderAddress,
            });

            if (result.effects.status.status === 'failure') {
                return { 
                    approved: false, 
                    reason: result.effects.status.error || "Regla financiera rechazada (Límite excedido o Error de Oráculo)" 
                };
            }

            return { approved: true };

        } catch (error) {
            return { approved: false, reason: `Error de conexión RPC: ${error}` };
        }
    }
}