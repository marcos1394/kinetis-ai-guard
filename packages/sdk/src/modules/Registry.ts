import { SuiClient } from '@mysten/sui/client';
import { Transaction } from '@mysten/sui/transactions';
import { SUI_CLOCK_OBJECT_ID } from '../utils/constants';

// Interfaz para que TypeScript sepa qué devuelve tu Agente
export interface AgentData {
    id: string;
    name: string;
    model: string;
    paused: boolean;
    ownerCapId: string; // Guardamos también el ID de la llave de admin
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
     * @param name - Nombre del Agente (ej. "Kinetis Trader V1")
     * @param model - Modelo de IA (ej. "GPT-4")
     */
    createAgentTransaction(name: string, model: string): Transaction {
        const tx = new Transaction();

        // Llamamos a policy_registry::register_agent
        tx.moveCall({
            target: `${this.packageId}::policy_registry::register_agent`,
            arguments: [
                tx.pure.string(name),       // Nombre
                tx.pure.string(model),      // Modelo
                tx.object(SUI_CLOCK_OBJECT_ID) // Clock
            ],
        });

        return tx;
    }

    /**
     * CONSULTAR (READ): Busca todos los agentes que controla una dirección.
     * Lógica mejorada: Busca los 'AgentAdminCap' y obtiene los perfiles asociados.
     */
    async getAgentsByOwner(ownerAddress: string): Promise<AgentData[]> {
        // 1. Buscar las llaves de administrador (AgentAdminCap)
        // Estas SIEMPRE son propiedad del usuario.
        const capsResponse = await this.client.getOwnedObjects({
            owner: ownerAddress,
            filter: {
                StructType: `${this.packageId}::policy_registry::AgentAdminCap`,
            },
            options: { showContent: true },
        });

        const agents: AgentData[] = [];

        // 2. Iterar sobre las caps y obtener el ID del agente que controlan
        for (const capObj of capsResponse.data) {
            const content = capObj.data?.content as any;
            if (!content || !content.fields) continue;

            const adminCapId = capObj.data?.objectId;
            const agentId = content.fields.for_agent; // El campo que vincula Cap -> Perfil

            // 3. Consultar los detalles del Perfil del Agente (que es un objeto compartido)
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
                ownerCapId: "UNKNOWN" // Si consultamos directo por ID, no sabemos cuál es la Cap
            };
        } catch (e) {
            console.error("Error fetching agent:", e);
            return null;
        }
    }
}