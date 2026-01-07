import { SuiClient } from '@mysten/sui/client';
import { Transaction } from '@mysten/sui/transactions';
import { bcs } from '@mysten/sui/bcs'; // Importante para leer el retorno (true/false)
import { SUI_CLOCK_OBJECT_ID } from '../utils/constants';

export class PoliciesModule {
    private client: SuiClient;
    private packageId: string;

    constructor(client: SuiClient, packageId: string) {
        this.client = client;
        this.packageId = packageId;
    }

    /**
     * Verifica si una dirección destino está en la Whitelist y si el permiso sigue vigente.
     * Utiliza 'devInspect' para leer el resultado booleano del contrato sin gastar gas.
     * * @param senderAddress - Quien hace la consulta (usualmente el Agente)
     * @param policyConfigId - El ID del objeto PolicyConfig (donde están las reglas)
     * @param targetAddress - La dirección a la que queremos enviar dinero
     */
    async verifyTransaction(
        senderAddress: string,
        policyConfigId: string,
        targetAddress: string
    ): Promise<{ allowed: boolean; reason?: string }> {
        const tx = new Transaction();

        // Construimos la llamada a policy_rules::verify_transaction
        tx.moveCall({
            target: `${this.packageId}::policy_rules::verify_transaction`,
            arguments: [
                tx.object(policyConfigId),
                tx.pure.address(targetAddress),
                tx.object(SUI_CLOCK_OBJECT_ID) // Usamos la constante centralizada '0x6'
            ],
        });

        try {
            // Ejecutamos la inspección
            const result = await this.client.devInspectTransactionBlock({
                transactionBlock: tx,
                sender: senderAddress,
            });

            // 1. Verificar si hubo error de ejecución (ej. objeto no existe)
            if (result.effects.status.status === 'failure') {
                return { 
                    allowed: false, 
                    reason: `Error de ejecución en Move: ${result.effects.status.error}` 
                };
            }

            // 2. Decodificar el valor de retorno (El "return bool" de Move)
            // Kinetis Return Value Decoding Magic ✨
            if (result.results && result.results[0].returnValues) {
                const rawValue = result.results[0].returnValues[0]; // [bytes, type]
                const bytes = new Uint8Array(rawValue[0]);
                
                // Usamos BCS para convertir los bytes crudos a true/false de JS
                const isAllowed = bcs.bool().parse(bytes);

                return { 
                    allowed: isAllowed,
                    reason: isAllowed ? "Whitelist OK" : "Destino no encontrado en Whitelist o Permiso Expirado"
                };
            }

            return { allowed: false, reason: "No se pudo leer el valor de retorno del contrato." };

        } catch (error) {
            return { allowed: false, reason: `Error RPC: ${error}` };
        }
    }

    /**
     * (Opcional para futuro) Método para agregar reglas.
     * Esto requeriría firma real, no devInspect.
     */
     // async addRule(...) { ... }
}