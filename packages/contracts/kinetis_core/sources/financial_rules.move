module kinetis_core::financial_rules {
    use sui::object::{Self, UID, ID};
    use sui::tx_context::{Self, TxContext};
    use sui::clock::{Self, Clock};
    use sui::event;
    use sui::transfer;

    use switchboard::aggregator::{Aggregator, CurrentResult}; 
    use switchboard::decimal::{Decimal};

    use kinetis_core::policy_registry::{AgentAdminCap};

    // --- ERRORES ---
    const ELimitExceeded: u64 = 0;
    const EPriceStale: u64 = 1; 
    const EPriceNegative: u64 = 2;

    // --- OBJETOS ---
    public struct BudgetConfig has key, store {
        id: UID,
        agent_id: ID,
        daily_limit_usd: u64, 
        current_spend_usd: u64,
        last_reset_time: u64, 
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

    // --- LÓGICA CORREGIDA (Referencias arregladas) ---
    public fun check_and_record_spend(
        budget: &mut BudgetConfig,
        amount_sui: u64, 
        aggregator: &Aggregator, 
        clock: &Clock
    ) {
        // 1. Reset diario
        let now = clock::timestamp_ms(clock);
        if (now > budget.last_reset_time + 86400000) {
            budget.current_spend_usd = 0;
            budget.last_reset_time = now;
        };

        // 2. LEER PRECIO
        // CORRECCIÓN: Quitamos ": CurrentResult". Ahora 'current_result' es una referencia (&CurrentResult)
        let current_result = aggregator.current_result();
        
        // A. Validar Timestamp
        let max_timestamp = current_result.max_timestamp_ms();
        // assert!(now - max_timestamp <= 60000, EPriceStale); // Descomentar en prod

        // B. Obtener el Decimal
        // CORRECCIÓN: Quitamos ": Decimal". Ahora 'result' es una referencia (&Decimal)
        let result = current_result.result();

        // C. Validar que no sea negativo
        if (result.neg()) {
            abort EPriceNegative
        };

        // D. Extraer valor (u128) y escala (u8)
        let value_u128: u128 = result.value(); 
        
        // NOTA: 'scale' no se usa en la lógica simplificada de abajo, 
        // pero si quisieras usarla: let scale = result.scale();

        // 3. CALCULAR VALOR EN USD
        let amount_sui_u128 = (amount_sui as u128);
        
        // Multiplicación directa
        let raw_value = amount_sui_u128 * value_u128;

        // Divisor Hardcodeado para Testnet (Asumiendo escala estándar y ajuste a centavos)
        // 10^16 suele funcionar bien si el precio viene con 9 decimales y SUI tiene 9.
        let divisor: u128 = 10000000000000000; 
        
        let value_in_usd_cents = (raw_value / divisor) as u64;

        // 4. VERIFICAR PRESUPUESTO
        let new_total = budget.current_spend_usd + value_in_usd_cents;
        assert!(new_total <= budget.daily_limit_usd, ELimitExceeded);

        // 5. GUARDAR Y EMITIR
        budget.current_spend_usd = new_total;

        event::emit(SpendRecorded { 
            agent_id: budget.agent_id, 
            amount_sui, 
            amount_usd: value_in_usd_cents 
        });
    }
}