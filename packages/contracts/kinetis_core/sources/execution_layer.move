module kinetis_core::execution_layer {
    use sui::object::{Self, ID};
    use sui::tx_context::{TxContext};
    use sui::clock::{Clock};
    use sui::event;
    
    // Importamos nuestros módulos anteriores
    use kinetis_core::policy_registry::{AgentAdminCap};
    use kinetis_core::policy_rules::{Self, PolicyConfig};
    use kinetis_core::financial_rules::{Self, BudgetConfig};
    
    // --- CAMBIO: Usamos Switchboard en lugar de Pyth ---
    use switchboard::aggregator::{Aggregator};

    // --- CAMBIO: Usamos la ruta correcta de Ika que vimos en display.move ---
    use ika_dwallet_2pc_mpc::coordinator_inner::{DWalletCap};

    // --- ERRORES ---
    const EPolicyViolation: u64 = 0;
    // const EBudgetExceeded: u64 = 1; // Ya no se usa aquí, financial_rules se encarga

    // --- EVENTOS ---
    public struct ExecutionRequest has copy, drop {
        agent_id: ID,
        chain: u8, // 0 = BTC, 1 = ETH
        target: address,
        amount_sui_equiv: u64,
        tx_hash: vector<u8> // El hash que Ika firmó
    }

    // --- FUNCIONES ---

    // FUNCIÓN PRINCIPAL: "Execute Transaction"
    public entry fun execute_transfer(
        // 1. Identidad
        agent_cap: &AgentAdminCap, // Demo: Usamos AdminCap como prueba de autoridad del agente
        _dwallet_cap: &DWalletCap,  // El permiso de firma de Ika (Prefijo _ para evitar warning si no se usa en demo)
        
        // 2. Reglas
        policy_config: &PolicyConfig,
        budget_config: &mut BudgetConfig,
        
        // 3. Contexto Externo (Oráculo y Reloj)
        // CAMBIO: Ahora recibimos el Aggregator de Switchboard
        aggregator: &Aggregator,
        clock: &Clock,

        // 4. Parámetros de la Transacción (Lo que el Agente quiere hacer)
        target_addr: address,
        amount_sui: u64,     // Monto estimado en moneda base
        tx_payload: vector<u8>, // El hash de la transacción Bitcoin a firmar
        
        _ctx: &mut TxContext
    ) {
        // A. VERIFICACIÓN DE WHITELIST (El Policía)
        if (!policy_rules::verify_transaction(policy_config, target_addr, clock)) {
            abort EPolicyViolation
        };

        // B. VERIFICACIÓN DE PRESUPUESTO (El Contador)
        // CAMBIO: Pasamos el aggregator a la regla financiera
        financial_rules::check_and_record_spend(
            budget_config,
            amount_sui,
            aggregator,
            clock
        );

        // C. EJECUCIÓN (La Firma)
        // Aquí iría la llamada real a Ika para firmar.
        // Por ahora emitimos el evento de éxito.
        
        event::emit(ExecutionRequest {
            agent_id: object::id(agent_cap), 
            chain: 0, // Hardcoded BTC para demo
            target: target_addr,
            amount_sui_equiv: amount_sui,
            tx_hash: tx_payload
        });
    }
}