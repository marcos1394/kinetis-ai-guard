import { SuiClient } from '@mysten/sui/client';
import { Transaction } from '@mysten/sui/transactions';
import { SUI_CLOCK_OBJECT_ID } from '../utils/constants';
import { ProofOfInference } from '../utils/ProofOfInference';

export class ExecutionModule {
    private client: SuiClient;
    private packageId: string;

    constructor(client: SuiClient, packageId: string) {
        this.client = client;
        this.packageId = packageId;
    }

    /**
     * 1. EJECUCIÓN ESTÁNDAR (AI Agent Path).
     * * El Agente intenta ejecutar una transferencia.
     * - Si está bajo el presupuesto -> Se ejecuta inmediatamente.
     * - Si excede el presupuesto -> El contrato crea una 'SpendingRequest' y detiene la ejecución.
     * - Si el Circuit Breaker está activo -> Falla inmediatamente.
     * * Incluye "Proof of Inference": Ancla criptográficamente el pensamiento de la IA a la tx.
     * * @param params.llmLog - El JSON crudo de la respuesta de OpenAI/Anthropic/DeepSeek.
     */
    async executeTransfer(
        params: {
            agentCapId: string,      // La llave del agente
            agentProfileId: string,  // El perfil (para chequear pausas)
            dWalletCapId: string,    // La capacidad de la DWallet (Ika)
            policyConfigId: string,  // Whitelists
            budgetConfigId: string,  // Reglas financieras
            aggregatorId: string,    // Oráculo Switchboard
            targetAddress: string,   // Destino
            amountSui: bigint,       // Monto en MIST (1 SUI = 10^9 MIST)
            llmLog: Record<string, any> // <--- Feature #2: Auditoría Forense
        }
    ): Promise<Transaction> {
        const tx = new Transaction();

        // A. Generar Hash de Auditoría (Proof of Inference)
        // Esto crea una huella digital única del razonamiento de la IA.
        const inferenceHash = await ProofOfInference.hashInference(params.llmLog);

        // B. Preparar el pago del Protocol Fee (0.05 SUI)
        // Separamos una moneda de gas por valor de 50,000,000 MIST
        const [feeCoin] = tx.splitCoins(tx.gas, [50000000]); 

        // C. Llamada al Contrato
        tx.moveCall({
            target: `${this.packageId}::execution_layer::execute_transfer`,
            arguments: [
                tx.object(params.agentCapId),
                tx.object(params.agentProfileId),
                tx.object(params.dWalletCapId),
                tx.object(params.policyConfigId),
                tx.object(params.budgetConfigId),
                tx.object(params.aggregatorId),
                tx.object(SUI_CLOCK_OBJECT_ID),
                feeCoin, // Pasamos la moneda del fee
                tx.pure.address(params.targetAddress),
                tx.pure.u64(params.amountSui),
                tx.pure.vector('u8', []), // tx_payload (Vacío por ahora, futuro uso para EVM data)
                tx.pure.vector('u8', inferenceHash) // <--- Pasamos el hash forense
            ]
        });

        return tx;
    }

    /**
     * 2. EJECUCIÓN MANUAL (Human-in-the-Loop Path).
     * * Se usa cuando una transacción quedó pendiente (SpendingRequest).
     * Construye un PTB (Programmable Transaction Block) Atómico que:
     * 1. Llama a 'approve_spend_request' -> Retorna un objeto "Hot Potato" (FinanceApproval).
     * 2. Llama a 'execute_approved_transfer' -> Consume el "Hot Potato" y ejecuta el envío.
     * * Nota: El "Hot Potato" no puede existir fuera de esta transacción, por lo que
     * ambos pasos deben ocurrir en el mismo bloque.
     */
    executeApprovedTransfer(
        params: {
            adminCapId: string,      // La llave del Admin/Dueño
            agentProfileId: string,
            dWalletCapId: string,
            policyConfigId: string,
            budgetConfigId: string,
            spendingRequestId: string, // <--- ID de la solicitud que estaba pendiente
            targetAddress: string      // Debe coincidir con la solicitud original
        }
    ): Transaction {
        const tx = new Transaction();

        // PASO A: Aprobar la solicitud
        // Esto quema la 'SpendingRequest' y nos da un 'FinanceApproval' (Potato)
        // moveCall devuelve un array de resultados, tomamos el primero (el Potato)
        const [approvalPotato] = tx.moveCall({
            target: `${this.packageId}::financial_rules::approve_spend_request`,
            arguments: [
                tx.object(params.adminCapId),
                tx.object(params.budgetConfigId),
                tx.object(params.spendingRequestId)
            ]
        });

        // PASO B: Preparar Fee (El humano paga la ejecución)
        const [feeCoin] = tx.splitCoins(tx.gas, [50000000]);

        // PASO C: Ejecutar consumiendo la Aprobación
        tx.moveCall({
            target: `${this.packageId}::execution_layer::execute_approved_transfer`,
            arguments: [
                tx.object(params.adminCapId),
                tx.object(params.agentProfileId),
                tx.object(params.dWalletCapId),
                tx.object(params.policyConfigId),
                tx.object(SUI_CLOCK_OBJECT_ID),
                feeCoin,
                approvalPotato, // <--- Aquí pasamos el Hot Potato generado en el Paso A
                tx.pure.address(params.targetAddress),
                tx.pure.vector('u8', []) // tx_payload
            ]
        });

        return tx;
    }
}