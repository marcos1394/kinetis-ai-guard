module kinetis_core::policy_rules {
    use sui::object::{Self, UID, ID};
    use sui::tx_context::{Self, TxContext};
    use sui::table::{Self, Table};
    use sui::clock::{Self, Clock};
    use sui::event;
    
    // Importamos nuestro módulo anterior para verificar tipos
    use kinetis_core::policy_registry::{AgentAdminCap};

    // --- ERRORES ---
    const ENotAuthorized: u64 = 0;
    const ETargetNotWhitelisted: u64 = 1;
    const EPermissionExpired: u64 = 2;

    // --- OBJETOS ---

    // Este objeto guarda la configuración de seguridad de UN agente.
   public struct PolicyConfig has key, store {
        id: UID,
        agent_id: ID, // Enlace al perfil del agente
        // Tabla: Dirección Destino -> Timestamp de Caducidad (ms)
        // Si la dirección no está en la tabla, está bloqueada.
        // Si está en la tabla pero el tiempo pasó, está bloqueada.
        whitelist: Table<address, u64>, 
    }

    // --- EVENTOS ---
    public struct WhitelistUpdated has copy, drop {
        agent_id: ID,
        target: address,
        expiry: u64,
        action: u8 // 1=Add, 0=Remove
    }

    // --- FUNCIONES ---

    // 1. Inicializar las reglas para un agente nuevo
    public entry fun create_policy_config(
        _admin: &AgentAdminCap, // Solo el dueño puede crear esto
        agent_id: ID,
        ctx: &mut TxContext
    ) {
        let config = PolicyConfig {
            id: object::new(ctx),
            agent_id,
            whitelist: table::new(ctx),
        };
        // Hacemos el objeto compartido (Shared) para que el Agente (y cualquiera) pueda leerlo,
        // pero solo el Admin podrá modificarlo.
        sui::transfer::share_object(config);
    }

    // 2. Añadir una dirección a la lista blanca (con caducidad)
    public entry fun add_whitelist_rule(
        _admin: &AgentAdminCap, // Auth Check: Requiere la AdminCap
        config: &mut PolicyConfig,
        target: address,
        duration_hours: u64,
        clock: &Clock // Necesitamos el reloj para calcular la fecha futura
    ) {
        let current_time = clock::timestamp_ms(clock);
        let expiry_ms = current_time + (duration_hours * 3600 * 1000);

        // Si ya existe, actualizamos. Si no, insertamos.
        if (table::contains(&config.whitelist, target)) {
            let entry = table::borrow_mut(&mut config.whitelist, target);
            *entry = expiry_ms;
        } else {
            table::add(&mut config.whitelist, target, expiry_ms);
        };

        event::emit(WhitelistUpdated {
            agent_id: config.agent_id,
            target,
            expiry: expiry_ms,
            action: 1
        });
    }

    // 3. LA FUNCIÓN CRÍTICA: Verificar si una transacción es válida
    // Esta función la llamará el Agente antes de intentar firmar.
    public fun verify_transaction(
        config: &PolicyConfig,
        target: address,
        clock: &Clock
    ): bool {
        // Chequeo 1: ¿Está en la lista?
        if (!table::contains(&config.whitelist, target)) {
            return false // Bloqueado
        };

        // Chequeo 2: ¿Ha caducado el permiso?
        let expiry = *table::borrow(&config.whitelist, target);
        let now = clock::timestamp_ms(clock);
        
        if (now > expiry) {
            return false // Expirado
        };

        return true // Aprobado
    }
}