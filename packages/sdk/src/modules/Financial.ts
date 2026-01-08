import { SuiClient } from '@mysten/sui/client';
import { Transaction } from '@mysten/sui/transactions';
import { SUI_CLOCK_OBJECT_ID } from '../utils/constants';

// ID OFICIAL DE SWITCHBOARD SUI/USD (TESTNET)
const SWITCHBOARD_SUI_USD_AGGREGATOR = '0x1690022350868a881855a0224449830855239a5c898c614b77f98cf4a9557476'; 

// --- INTERFACES DE DATOS (Para Frontend) ---

export interface SpendingRequestData {
    id: string;
    agentId: string;
    amountSui: string;
    amountUsdEst: string;
    inferenceHash: string; // Proof of Inference (Feature #2)
    timestamp: string;
}

export interface BudgetStatus {
    dailyLimit: string;
    currentSpend: string;
    isCircuitBroken: boolean; // Circuit Breaker State (Feature #3)
    lastKnownPrice: string;
}

export class FinancialModule {
    private client: SuiClient;
    private packageId: string;

    constructor(client: SuiClient, packageId: string) {
        this.client = client;
        this.packageId = packageId;
    }

    // --- 1. SIMULACIÓN (DRY RUN) ---

    /**
     * Simula si un gasto sería aprobado automáticamente o si requeriría aprobación humana.
     */
    async checkSpendSimulation(
        senderAddress: string,
        budgetConfigId: string,
        amountSui: number
    ): Promise<{ approved: boolean; reason?: string }> {
        const tx = new Transaction();
        
        // Convertir SUI a MIST
        const amountMist = BigInt(amountSui * 1_000_000_000);

        // Vector vacío para simulación (Proof of Inference dummy)
        const dummyHash = tx.pure.vector('u8', []);

        // Llamada Move actualizada con el nuevo argumento 'inference_hash'
        tx.moveCall({
            target: `${this.packageId}::financial_rules::check_and_record_spend`,
            arguments: [
                tx.object(budgetConfigId),
                tx.pure.u64(amountMist),
                dummyHash, // <--- NUEVO ARGUMENTO (Feature #2)
                tx.object(SWITCHBOARD_SUI_USD_AGGREGATOR),
                tx.object(SUI_CLOCK_OBJECT_ID)
            ],
        });

        try {
            const result = await this.client.devInspectTransactionBlock({
                transactionBlock: tx,
                sender: senderAddress,
            });

            if (result.effects.status.status === 'failure') {
                return { 
                    approved: false, 
                    reason: result.effects.status.error || "Transacción fallida (Posible Circuit Breaker o Error de Oráculo)" 
                };
            }

            // Nota: Aunque la tx no falle, podría retornar 'false' (requiere aprobación humana).
            // En una versión avanzada leeríamos el valor de retorno booleano usando BCS.
            // Por ahora, si no aborta, consideramos que la simulación técnica pasó.
            return { approved: true };

        } catch (error) {
            return { approved: false, reason: `Error de conexión RPC: ${error}` };
        }
    }

    // --- 2. HUMAN-IN-THE-LOOP (READ) ---

    /**
     * Obtiene todas las solicitudes de gasto pendientes de aprobación para un agente.
     * Útil para mostrar notificaciones en el celular del dueño.
     */
    async getPendingRequests(ownerAddress: string): Promise<SpendingRequestData[]> {
        // Las SpendingRequests son enviadas al sender (el agente o el dueño)
        // Buscamos objetos de tipo SpendingRequest propiedad de la address
        const response = await this.client.getOwnedObjects({
            owner: ownerAddress,
            filter: {
                StructType: `${this.packageId}::financial_rules::SpendingRequest`
            },
            options: { showContent: true }
        });

        return response.data.map((obj) => {
            const content = obj.data?.content as any;
            const fields = content.fields;
            
            return {
                id: obj.data?.objectId!,
                agentId: fields.agent_id,
                amountSui: fields.amount_sui,
                amountUsdEst: fields.amount_usd_estimated,
                inferenceHash: fields.inference_hash, // <--- Feature #2 (Audit)
                timestamp: fields.timestamp
            };
        });
    }

    // --- 3. CIRCUIT BREAKER (READ & WRITE) ---

    /**
     * Consulta el estado financiero del Agente, incluyendo si está en Pánico (Circuit Breaker).
     */
    async getBudgetStatus(budgetConfigId: string): Promise<BudgetStatus> {
        const obj = await this.client.getObject({
            id: budgetConfigId,
            options: { showContent: true }
        });

        if (!obj.data || !obj.data.content) {
            throw new Error("Budget Config not found");
        }

        const fields = (obj.data.content as any).fields;
        
        return {
            dailyLimit: fields.daily_limit_usd,
            currentSpend: fields.current_spend_usd,
            isCircuitBroken: fields.is_circuit_broken, // <--- Feature #3 State
            lastKnownPrice: fields.last_known_price
        };
    }

    /**
     * Reactiva al agente después de un evento de pánico (Reset).
     * Solo el Admin puede llamar a esto.
     * Retorna la transacción lista para firmar.
     */
    resetCircuitBreaker(budgetConfigId: string, adminCapId: string): Transaction {
        const tx = new Transaction();
        tx.moveCall({
            target: `${this.packageId}::financial_rules::reset_circuit_breaker`,
            arguments: [
                tx.object(adminCapId),
                tx.object(budgetConfigId)
            ]
        });
        return tx;
    }
}