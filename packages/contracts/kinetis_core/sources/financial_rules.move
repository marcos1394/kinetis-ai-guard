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
    const EAmountMismatch: u64 = 3; 

    // --- OBJETOS ---
    
    public struct BudgetConfig has key, store {
        id: UID,
        agent_id: ID,
        daily_limit_usd: u64, 
        current_spend_usd: u64,
        last_reset_time: u64, 
    }

    // [MODIFICADO] Objeto de solicitud pendiente.
    // Ahora incluye 'inference_hash' para auditoría forense.
    public struct SpendingRequest has key, store {
        id: UID,
        agent_id: ID,
        amount_sui: u64,
        amount_usd_estimated: u64,
        inference_hash: vector<u8>, // <--- NUEVO: El "ADN" del pensamiento de la IA
        timestamp: u64
    }

    // [MODIFICADO] Hot Potato de aprobación.
    // Vincula la aprobación manual con la inferencia original.
    public struct FinanceApproval {
        agent_id: ID,
        amount_sui: u64,
        amount_usd: u64,
        inference_hash: vector<u8> // <--- NUEVO
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

    // [MODIFICADO] Evento para notificar al Admin
    public struct ApprovalNeeded has copy, drop {
        request_id: ID,
        agent_id: ID,
        amount_sui: u64,
        amount_usd: u64,
        inference_hash: vector<u8> // <--- NUEVO: Visible en el Dashboard
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
     * [MODIFICADO] Ahora recibe 'inference_hash'.
     */
    public fun check_and_record_spend(
        budget: &mut BudgetConfig,
        amount_sui: u64, 
        inference_hash: vector<u8>, // <--- NUEVO ARGUMENTO
        aggregator: &Aggregator, 
        clock: &Clock,
        ctx: &mut TxContext
    ): bool {
        
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
            // B. EXCEDE LÍMITE: Human-in-the-Loop + Proof of Inference
            // Guardamos la solicitud CON el hash de la inferencia
            let request = SpendingRequest {
                id: object::new(ctx),
                agent_id: budget.agent_id,
                amount_sui,
                amount_usd_estimated: usd_value,
                inference_hash: inference_hash, // <--- Guardamos la evidencia
                timestamp: now
            };

            let req_id = object::id(&request);
            
            // Se envía al sender (el agente) para que el dueño la apruebe luego
            transfer::public_transfer(request, tx_context::sender(ctx));

            event::emit(ApprovalNeeded {
                request_id: req_id,
                agent_id: budget.agent_id,
                amount_sui,
                amount_usd: usd_value,
                inference_hash // Emitimos para indexadores
            });

            return false // Detener ejecución automática
        }
    }

    /**
     * Función para el HUMANO.
     * Aprueba la solicitud y pasa el hash a la 'FinanceApproval'.
     */
    public fun approve_spend_request(
        _admin: &AgentAdminCap, 
        budget: &mut BudgetConfig,
        request: SpendingRequest 
    ): FinanceApproval {
        
        // Desempaquetamos incluyendo el hash
        let SpendingRequest { id, agent_id, amount_sui, amount_usd_estimated, inference_hash, timestamp: _ } = request;
        object::delete(id); 

        // Actualizamos gasto
        budget.current_spend_usd = budget.current_spend_usd + amount_usd_estimated;

        event::emit(SpendRecorded { 
            agent_id, 
            amount_sui, 
            amount_usd: amount_usd_estimated 
        });

        // Retornamos la prueba de aprobación CON el hash original
        FinanceApproval {
            agent_id,
            amount_sui,
            amount_usd: amount_usd_estimated,
            inference_hash // <--- Mantenemos la cadena de custodia
        }
    }

    /**
     * Helper para destruir el Hot Potato.
     * [MODIFICADO] Ahora retorna el hash para que execution_layer lo use.
     */
    public fun burn_approval(approval: FinanceApproval): vector<u8> {
        let FinanceApproval { agent_id: _, amount_sui: _, amount_usd: _, inference_hash } = approval;
        
        // Retornamos el hash para el evento final
        inference_hash
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