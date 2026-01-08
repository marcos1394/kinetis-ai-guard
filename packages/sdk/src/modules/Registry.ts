import { SuiClient } from '@mysten/sui/client';
import { Transaction } from '@mysten/sui/transactions';
// Nota: Ya no importamos SUI_CLOCK_OBJECT_ID ni REGISTRY_ID porque tu contrato no los usa.

// Definición de datos del Agente
export interface AgentData {
    id: string;
    name: string;
    model: string;
    paused: boolean;
    ownerCapId: string;
}

export class RegistryModule {
    private client: SuiClient;
    private packageId: string;

    constructor(client: SuiClient, packageId: string) {
        this.client = client;
        this.packageId = packageId;
    }

    /**
     * CREAR (WRITE): Construye la transacción para registrar un nuevo Agente.
     * Coincide con: public entry fun register_agent(name_bytes, model_bytes, ctx)
     */
    createAgentTransaction(name: string, model: string): Transaction {
        const tx = new Transaction();

        tx.moveCall({
            target: `${this.packageId}::policy_registry::register_agent`,
            arguments: [
                // 1. name_bytes: vector<u8> (El SDK convierte string a vector<u8> automáticamente)
                tx.pure.string(name),       
                
                // 2. model_bytes: vector<u8>
                tx.pure.string(model)
                
                // 3. ctx: &mut TxContext (Inyectado automáticamente por Sui, NO se envía)
            ],
        });

        return tx;
    }

    /**
     * CONSULTAR (READ): Busca todos los agentes que controla una dirección.
     * Estrategia: Buscar las llaves 'AgentAdminCap' y ver qué agente controlan.
     */
    async getAgentsByOwner(ownerAddress: string): Promise<AgentData[]> {
        // 1. Buscar las llaves de administrador (AgentAdminCap)
        const capsResponse = await this.client.getOwnedObjects({
            owner: ownerAddress,
            filter: {
                // Filtramos por el tipo de Struct de la llave administrativa
                StructType: `${this.packageId}::policy_registry::AgentAdminCap`,
            },
            options: { showContent: true },
        });

        const agents: AgentData[] = [];

        // 2. Iterar sobre las caps
        for (const capObj of capsResponse.data) {
            const content = capObj.data?.content as any;
            if (!content || !content.fields) continue;

            const adminCapId = capObj.data?.objectId;
            // En tu contrato: struct AgentAdminCap { ..., for_agent: ID }
            const agentId = content.fields.for_agent; 

            // 3. Consultar el Perfil Público (AgentProfile)
            // En tu contrato: transfer::share_object(agent); -> Es un objeto compartido.
            const profileObj = await this.client.getObject({
                id: agentId,
                options: { showContent: true }
            });

            if (profileObj.data?.content) {
                const fields = (profileObj.data.content as any).fields;
                agents.push({
                    id: agentId,
                    name: fields.name,
                    model: fields.ai_model_version,
                    paused: fields.is_paused,
                    ownerCapId: adminCapId!
                });
            }
        }

        return agents;
    }

    /**
     * Consulta un agente específico por su ID
     */
    async getAgentById(agentId: string): Promise<AgentData | null> {
        try {
            const obj = await this.client.getObject({
                id: agentId,
                options: { showContent: true }
            });

            if (!obj.data || !obj.data.content) return null;

            const fields = (obj.data.content as any).fields;
            return {
                id: agentId,
                name: fields.name,
                model: fields.ai_model_version,
                paused: fields.is_paused,
                ownerCapId: "UNKNOWN" // Sin buscar la cap, no sabemos cuál es
            };
        } catch (e) {
            console.error("Error fetching agent:", e);
            return null;
        }
    }
}