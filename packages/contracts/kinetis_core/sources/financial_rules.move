module kinetis_core::financial_rules {
    use sui::object::{Self, UID, ID};
    use sui::tx_context::{Self, TxContext};
    use sui::clock::{Self, Clock};
    use sui::event;
    use sui::transfer;

    use switchboard::aggregator::{Aggregator}; 
    use switchboard::decimal::{Decimal};

    use kinetis_core::policy_registry::{AgentAdminCap};

    // --- ERRORES ---
    const EPriceStale: u64 = 1; 
    const EPriceNegative: u64 = 2;
    const EAmountMismatch: u64 = 3; // Error si intentan aprobar una solicitud alterada

    // --- OBJETOS ---
    
    public struct BudgetConfig has key, store {
        id: UID,
        agent_id: ID,
        daily_limit_usd: u64, 
        current_spend_usd: u64,
        last_reset_time: u64, 
    }

    // [NUEVO] Objeto que representa una transacción detenida por exceder presupuesto
    // Se envía al Admin para que la revise.
    public struct SpendingRequest has key, store {
        id: UID,
        agent_id: ID,
        amount_sui: u64,
        amount_usd_estimated: u64,
        timestamp: u64
    }

    // [NUEVO] "Hot Potato" (Sin key/store). 
    // Es una prueba efímera de que el Admin aprobó el gasto.
    // Debe consumirse inmediatamente en la misma transacción.
    public struct FinanceApproval {
        agent_id: ID,
        amount_sui: u64,
        amount_usd: u64
    }

    // --- EVENTOS ---
    
    public struct BudgetUpdated has copy, drop {
        agent_id: ID,
        new_limit: u64
    }

    public struct SpendRecorded has copy, drop {
        agent_id: ID,
        amount_sui: u64,
        amount_usd: u64
    }

    // [NUEVO] Evento para notificar al Admin
    public struct ApprovalNeeded has copy, drop {
        request_id: ID,
        agent_id: ID,
        amount_sui: u64,
        amount_usd: u64
    }

    // --- FUNCIONES ---

    public entry fun set_daily_budget(
        _admin: &AgentAdminCap,
        agent_id: ID,
        limit_usd_cents: u64, 
        ctx: &mut TxContext
    ) {
        let budget = BudgetConfig {
            id: object::new(ctx),
            agent_id,
            daily_limit_usd: limit_usd_cents,
            current_spend_usd: 0,
            last_reset_time: 0,
        };
        transfer::share_object(budget);
        
        event::emit(BudgetUpdated { agent_id, new_limit: limit_usd_cents });
    }

    /**
     * Función principal llamada por el BOT.
     * Retorna TRUE si puede gastar.
     * Retorna FALSE si excede el límite (y crea una SpendingRequest).
     */
    public fun check_and_record_spend(
        budget: &mut BudgetConfig,
        amount_sui: u64, 
        aggregator: &Aggregator, 
        clock: &Clock,
        ctx: &mut TxContext
    ): bool { // <-- CAMBIO: Ahora retorna bool
        
        // 1. Reset diario
        let now = clock::timestamp_ms(clock);
        if (now > budget.last_reset_time + 86400000) {
            budget.current_spend_usd = 0;
            budget.last_reset_time = now;
        };

        // 2. Calcular USD usando Switchboard
        let usd_value = calculate_usd_value(amount_sui, aggregator);

        // 3. Verificar Presupuesto
        let new_total = budget.current_spend_usd + usd_value;
        
        if (new_total <= budget.daily_limit_usd) {
            // A. DENTRO DEL LÍMITE: Aprobación Automática
            budget.current_spend_usd = new_total;
            
            event::emit(SpendRecorded { 
                agent_id: budget.agent_id, 
                amount_sui, 
                amount_usd: usd_value 
            });
            
            return true // Ejecutar transacción
        } else {
            // B. EXCEDE LÍMITE: Human-in-the-Loop
            // No abortamos. Creamos una solicitud y la enviamos al dueño.
            let request = SpendingRequest {
                id: object::new(ctx),
                agent_id: budget.agent_id,
                amount_sui,
                amount_usd_estimated: usd_value,
                timestamp: now
            };

            let req_id = object::id(&request);
            
            // Transferimos la solicitud al Admin (quien firmó la tx del bot o es el dueño)
            // En este caso, se la enviamos al sender (que debería ser el agente, 
            // pero el agente debería reenviarla o el sistema indexarla).
            // Estrategia Kinetis: Se envía al sender, el SDK detecta el evento y avisa al humano.
            transfer::public_transfer(request, tx_context::sender(ctx));

            event::emit(ApprovalNeeded {
                request_id: req_id,
                agent_id: budget.agent_id,
                amount_sui,
                amount_usd: usd_value
            });

            return false // Detener ejecución automática
        }
    }

    /**
     * [NUEVO] Función para el HUMANO.
     * El Admin revisa la SpendingRequest y la aprueba explícitamente.
     * Retorna un "FinanceApproval" (Hot Potato) que se debe usar en execution_layer.
     */
    public fun approve_spend_request(
        _admin: &AgentAdminCap, // Requiere ser Admin
        budget: &mut BudgetConfig,
        request: SpendingRequest // Consume la solicitud (la quema)
    ): FinanceApproval {
        
        let SpendingRequest { id, agent_id, amount_sui, amount_usd_estimated, timestamp: _ } = request;
        object::delete(id); // Borramos el objeto de solicitud

        // Actualizamos el gasto acumulado (aunque se pase del límite, porque es manual)
        budget.current_spend_usd = budget.current_spend_usd + amount_usd_estimated;

        event::emit(SpendRecorded { 
            agent_id, 
            amount_sui, 
            amount_usd: amount_usd_estimated 
        });

        // Retornamos la prueba de aprobación
        FinanceApproval {
            agent_id,
            amount_sui,
            amount_usd: amount_usd_estimated
        }
    }

    /**
     * Helper para destruir el Hot Potato una vez usado en execution_layer
     */
    public fun burn_approval(approval: FinanceApproval) {
        let FinanceApproval { agent_id: _, amount_sui: _, amount_usd: _ } = approval;
        // Simplemente se deshace de ella.
    }

    // --- Helpers Privados ---

    fun calculate_usd_value(amount_sui: u64, aggregator: &Aggregator): u64 {
        let current_result = aggregator.current_result();
        let result = current_result.result();

        if (result.neg()) {
            abort EPriceNegative
        };

        let value_u128: u128 = result.value(); 
        let amount_sui_u128 = (amount_sui as u128);
        let raw_value = amount_sui_u128 * value_u128;
        
        // Ajuste de escala (asumiendo SUI 9 decimales y precio 9 decimales)
        let divisor: u128 = 10000000000000000; 
        (raw_value / divisor) as u64
    }
}