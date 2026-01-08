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
    const ECircuitBreakerActive: u64 = 4; // <--- [NUEVO] Error cuando el modo pánico está activo

    // --- CONSTANTES DE RIESGO ---
    const VOLATILITY_THRESHOLD_PERCENT: u128 = 10; // <--- [NUEVO] 10% de variación permitida
    const PRICE_WINDOW_MS: u64 = 3600000;          // <--- [NUEVO] Ventana de 1 hora (3600s * 1000)

    // --- OBJETOS ---
    
    public struct BudgetConfig has key, store {
        id: UID,
        agent_id: ID,
        daily_limit_usd: u64, 
        current_spend_usd: u64,
        last_reset_time: u64,
        
        // [NUEVO] CAMPOS CIRCUIT BREAKER
        last_known_price: u128,  // El precio de referencia de la última hora
        last_price_time: u64,    // Cuándo tomamos ese precio
        is_circuit_broken: bool  // ¿Está activado el modo pánico?
    }

    public struct SpendingRequest has key, store {
        id: UID,
        agent_id: ID,
        amount_sui: u64,
        amount_usd_estimated: u64,
        inference_hash: vector<u8>, 
        timestamp: u64
    }

    public struct FinanceApproval {
        agent_id: ID,
        amount_sui: u64,
        amount_usd: u64,
        inference_hash: vector<u8> 
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

    public struct ApprovalNeeded has copy, drop {
        request_id: ID,
        agent_id: ID,
        amount_sui: u64,
        amount_usd: u64,
        inference_hash: vector<u8> 
    }

    // [NUEVO] Evento de Pánico
    public struct CircuitBreakerTriggered has copy, drop {
        agent_id: ID,
        old_price: u128,
        new_price: u128,
        timestamp: u64
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
            
            // [NUEVO] Inicialización
            last_known_price: 0, 
            last_price_time: 0,
            is_circuit_broken: false
        };
        transfer::share_object(budget);
        
        event::emit(BudgetUpdated { agent_id, new_limit: limit_usd_cents });
    }

    /**
     * [NUEVO] Función administrativa para resetear el pánico manualmente.
     */
    public entry fun reset_circuit_breaker(
        _admin: &AgentAdminCap,
        budget: &mut BudgetConfig
    ) {
        budget.is_circuit_broken = false;
        // Reseteamos el precio de referencia para empezar limpio
        budget.last_known_price = 0; 
    }

    public fun check_and_record_spend(
        budget: &mut BudgetConfig,
        amount_sui: u64, 
        inference_hash: vector<u8>, 
        aggregator: &Aggregator, 
        clock: &Clock,
        ctx: &mut TxContext
    ): bool {
        
        let now = clock::timestamp_ms(clock);

        // 0. VERIFICAR CIRCUIT BREAKER (Defensa Primero)
        if (budget.is_circuit_broken) {
            abort ECircuitBreakerActive
        };

        // 1. Reset diario
        if (now > budget.last_reset_time + 86400000) {
            budget.current_spend_usd = 0;
            budget.last_reset_time = now;
        };

        // 2. OBTENER PRECIO ACTUAL (Con validación de volatilidad)
        let (usd_value, current_price_u128) = calculate_usd_and_check_volatility(
            amount_sui, 
            aggregator, 
            budget, // Pasamos el budget para comparar con historia
            now
        );

        // Si se activó el CB durante el cálculo, abortamos inmediatamente
        if (budget.is_circuit_broken) {
            abort ECircuitBreakerActive
        };

        // 3. Verificar Presupuesto
        let new_total = budget.current_spend_usd + usd_value;
        
        if (new_total <= budget.daily_limit_usd) {
            // A. DENTRO DEL LÍMITE
            budget.current_spend_usd = new_total;
            
            event::emit(SpendRecorded { 
                agent_id: budget.agent_id, 
                amount_sui, 
                amount_usd: usd_value 
            });
            
            return true 
        } else {
            // B. EXCEDE LÍMITE
            let request = SpendingRequest {
                id: object::new(ctx),
                agent_id: budget.agent_id,
                amount_sui,
                amount_usd_estimated: usd_value,
                inference_hash: inference_hash, 
                timestamp: now
            };

            let req_id = object::id(&request);
            
            transfer::public_transfer(request, tx_context::sender(ctx));

            event::emit(ApprovalNeeded {
                request_id: req_id,
                agent_id: budget.agent_id,
                amount_sui,
                amount_usd: usd_value,
                inference_hash 
            });

            return false 
        }
    }

    public fun approve_spend_request(
        _admin: &AgentAdminCap, 
        budget: &mut BudgetConfig,
        request: SpendingRequest 
    ): FinanceApproval {
        
        let SpendingRequest { id, agent_id, amount_sui, amount_usd_estimated, inference_hash, timestamp: _ } = request;
        object::delete(id); 

        // Chequeo de seguridad extra: Si el CB está activo, no permitimos aprobar viejas solicitudes
        if (budget.is_circuit_broken) {
            abort ECircuitBreakerActive
        };

        budget.current_spend_usd = budget.current_spend_usd + amount_usd_estimated;

        event::emit(SpendRecorded { 
            agent_id, 
            amount_sui, 
            amount_usd: amount_usd_estimated 
        });

        FinanceApproval {
            agent_id,
            amount_sui,
            amount_usd: amount_usd_estimated,
            inference_hash 
        }
    }

    public fun burn_approval(approval: FinanceApproval): vector<u8> {
        let FinanceApproval { agent_id: _, amount_sui: _, amount_usd: _, inference_hash } = approval;
        inference_hash
    }

    // --- Helpers Privados ---

    /**
     * Calcula USD y verifica volatilidad.
     * Retorna (Valor en USD, Precio Unitario u128)
     * Si detecta volatilidad > 10%, activa budget.is_circuit_broken
     */
    fun calculate_usd_and_check_volatility(
        amount_sui: u64, 
        aggregator: &Aggregator,
        budget: &mut BudgetConfig,
        now: u64
    ): (u64, u128) {
        let current_result = aggregator.current_result();
        let result = current_result.result();

        if (result.neg()) {
            abort EPriceNegative
        };

        let current_price: u128 = result.value(); 
        
        // --- LÓGICA DE CIRCUIT BREAKER ---
        
        // 1. Si es la primera vez o pasó más de 1 hora, actualizamos la referencia sin chequear
        if (budget.last_known_price == 0 || now > budget.last_price_time + PRICE_WINDOW_MS) {
            budget.last_known_price = current_price;
            budget.last_price_time = now;
        } else {
            // 2. Estamos dentro de la ventana de 1 hora. Verificar variación.
            let diff: u128;
            if (current_price > budget.last_known_price) {
                diff = current_price - budget.last_known_price;
            } else {
                diff = budget.last_known_price - current_price;
            };

            // Cálculo de porcentaje: (Diferencia * 100) / Precio Anterior
            // Usamos u128 para evitar overflow
            let percent_change = (diff * 100) / budget.last_known_price;

            if (percent_change >= VOLATILITY_THRESHOLD_PERCENT) {
                // !!! PÁNICO !!!
                budget.is_circuit_broken = true;
                
                event::emit(CircuitBreakerTriggered {
                    agent_id: budget.agent_id,
                    old_price: budget.last_known_price,
                    new_price: current_price,
                    timestamp: now
                });
                
                // No retornamos nada útil, el caller abortará.
                return (0, 0)
            };
        };

        // --- CÁLCULO DE USD ---
        let amount_sui_u128 = (amount_sui as u128);
        let raw_value = amount_sui_u128 * current_price;
        let divisor: u128 = 10000000000000000; 
        
        ((raw_value / divisor) as u64, current_price)
    }
}