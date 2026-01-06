module kinetis_core::policy_registry {
    use std::string::{Self, String};
    use sui::event;
    use sui::object::{Self, UID, ID};
    use sui::tx_context::{Self, TxContext};
    use sui::transfer;

    // --- ERRORES (Código de Calidad) ---
    // Definimos errores constantes para facilitar el debugging
    const ENameTooLong: u64 = 0;

    // --- OBJETOS ---

    // 1. El Perfil del Agente (Agent Identity)
    // Este objeto representa al "Bot" en la blockchain.
   public struct AgentProfile has key, store {
        id: UID,
        name: String,           // Ej: "Kinetis Trader V1"
        ai_model_version: String, // INNOVACIÓN: ¿Qué cerebro usa? Ej: "GPT-4o"
        human_owner: address,   // El jefe (tú)
        is_paused: bool,        // Botón de pánico
        created_at: u64,        // Timestamp (aprox por epoch)
    }

    // 2. La Llave de Administración (Admin Cap)
    // Quien tenga este objeto controla al Agente.
    // Usamos el patrón "Capability" de Sui para seguridad máxima.
   public struct AgentAdminCap has key, store {
        id: UID,
        for_agent: ID, // Vincula esta llave a un perfil específico
    }

    // --- EVENTOS ---
    // Útiles para que nuestro Frontend se entere de lo que pasa
    public struct AgentRegistered has copy, drop {
        agent_id: ID,
        owner: address,
        name: String
    }

    // --- FUNCIONES ---

    // Constructor: Crea un nuevo Agente
    public entry fun register_agent(
        name_bytes: vector<u8>,
        model_bytes: vector<u8>,
        ctx: &mut TxContext
    ) {
        // 1. Validación de inputs
        // Limitamos el nombre a 64 caracteres para ahorrar almacenamiento
        assert!(vector::length(&name_bytes) <= 64, ENameTooLong);

        let sender = tx_context::sender(ctx);

        // 2. Crear el UID del Agente
        let agent_uid = object::new(ctx);
        let agent_id = object::uid_to_inner(&agent_uid);

        // 3. Instanciar el Objeto
        let agent = AgentProfile {
            id: agent_uid,
            name: string::utf8(name_bytes),
            ai_model_version: string::utf8(model_bytes),
            human_owner: sender,
            is_paused: false,
            created_at: tx_context::epoch(ctx),
        };

        // 4. Crear la Capability (Llave) para el dueño
        let admin_cap = AgentAdminCap {
            id: object::new(ctx),
            for_agent: agent_id,
        };

        // 5. Emitir evento
        event::emit(AgentRegistered {
            agent_id,
            owner: sender,
            name: string::utf8(name_bytes)
        });

        // 6. Transferir propiedad
        // El perfil es público (shared) o del usuario? 
        // Para el MVP, se lo damos al usuario, luego lo haremos SharedObject para que el bot lo lea.
        transfer::public_transfer(agent, sender);
        transfer::public_transfer(admin_cap, sender);
    }
}