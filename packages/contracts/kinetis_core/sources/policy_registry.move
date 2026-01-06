module kinetis_core::policy_registry {
    use std::string::{Self, String};
    use std::vector; // <--- AGREGADO: Necesario para vector::length
    use sui::event;
    use sui::object::{Self, UID, ID};
    use sui::tx_context::{Self, TxContext};
    use sui::transfer;

    // --- ERRORES ---
    const ENameTooLong: u64 = 0;

    // --- OBJETOS ---

    // 1. El Perfil del Agente (Identidad Pública)
    public struct AgentProfile has key, store {
        id: UID,
        name: String,
        ai_model_version: String,
        human_owner: address,   // Informativo, el control real es la Cap
        is_paused: bool,        
        created_at: u64,
    }

    // 2. La Llave de Administración (Control Privado)
    public struct AgentAdminCap has key, store {
        id: UID,
        for_agent: ID, // ID del AgentProfile vinculado
    }

    // --- EVENTOS ---
    public struct AgentRegistered has copy, drop {
        agent_id: ID,
        owner: address,
        name: String
    }

    // --- FUNCIONES ---

    public entry fun register_agent(
        name_bytes: vector<u8>,
        model_bytes: vector<u8>,
        ctx: &mut TxContext
    ) {
        // 1. Validación
        assert!(vector::length(&name_bytes) <= 64, ENameTooLong);

        let sender = tx_context::sender(ctx);

        // 2. Crear UID y ID
        let agent_uid = object::new(ctx);
        let agent_id = object::uid_to_inner(&agent_uid);

        // 3. Instanciar Perfil
        let agent = AgentProfile {
            id: agent_uid,
            name: string::utf8(name_bytes),
            ai_model_version: string::utf8(model_bytes),
            human_owner: sender,
            is_paused: false,
            created_at: tx_context::epoch(ctx),
        };

        // 4. Crear Capability (Llave Maestra)
        let admin_cap = AgentAdminCap {
            id: object::new(ctx),
            for_agent: agent_id,
        };

        // 5. Evento
        event::emit(AgentRegistered {
            agent_id,
            owner: sender,
            name: string::utf8(name_bytes)
        });

        // 6. TRANSFERENCIAS (Ajuste Arquitectónico)
        
        // Hacemos el Perfil COMPARTIDO para que Kinetis Node pueda leerlo 
        // sin necesitar la firma del humano a cada segundo.
        transfer::share_object(agent);

        // La Llave de Admin sí se va al bolsillo del usuario.
        transfer::public_transfer(admin_cap, sender);
    }

    // --- GETTERS (Cruciales para interoperabilidad) ---

    // Permite que otros módulos (como policy_rules) sepan de quién es esta llave
    public fun admin_cap_agent_id(cap: &AgentAdminCap): ID {
        cap.for_agent
    }

    // Permite leer el ID de un perfil
    public fun profile_id(profile: &AgentProfile): ID {
        object::id(profile)
    }

    // Verifica si el agente está pausado
    public fun is_paused(profile: &AgentProfile): bool {
        profile.is_paused
    }
}