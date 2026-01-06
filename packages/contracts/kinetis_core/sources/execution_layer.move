module kinetis_core::execution_layer {
    use sui::object::{Self, ID};
    use sui::tx_context::{TxContext};
    use sui::clock::{Clock};
    use sui::event;
    
    // Importamos nuestros módulos anteriores
    use kinetis_core::policy_registry::{Self, AgentAdminCap}; // Agregamos Self para usar funciones del módulo
    use kinetis_core::policy_rules::{Self, PolicyConfig};
    use kinetis_core::financial_rules::{Self, BudgetConfig};
    
    // Switchboard (Correcto, ya validamos que 'aggregator' existe en 'on_demand')
    use switchboard::aggregator::{Aggregator};

    // Ika (Asumimos que el módulo 'coordinator_inner' existe en el repo descargado)
    use ika_dwallet_2pc_mpc::coordinator_inner::{DWalletCap};

    // --- ERRORES ---
    const EPolicyViolation: u64 = 0;

    // --- EVENTOS ---
    public struct ExecutionRequest has copy, drop {
        agent_id: ID,
        chain: u8, // 0 = BTC, 1 = ETH
        target: address,
        amount_sui_equiv: u64,
        tx_hash: vector<u8> 
    }

    // --- FUNCIONES ---

    public entry fun execute_transfer(
        // 1. Identidad
        agent_cap: &AgentAdminCap, 
        _dwallet_cap: &DWalletCap, 
        
        // 2. Reglas
        policy_config: &PolicyConfig,
        budget_config: &mut BudgetConfig,
        
        // 3. Contexto Externo 
        aggregator: &Aggregator,
        clock: &Clock,

        // 4. Parámetros
        target_addr: address,
        amount_sui: u64,     
        tx_payload: vector<u8>, 
        
        _ctx: &mut TxContext
    ) {
        // A. VERIFICACIÓN DE WHITELIST (El Policía)
        if (!policy_rules::verify_transaction(policy_config, target_addr, clock)) {
            abort EPolicyViolation
        };

        // B. VERIFICACIÓN DE PRESUPUESTO (El Contador)
        financial_rules::check_and_record_spend(
            budget_config,
            amount_sui,
            aggregator,
            clock
        );

        // C. LOGGING (Corregido para obtener el ID real del Agente)
        let real_agent_id = policy_registry::admin_cap_agent_id(agent_cap);

        event::emit(ExecutionRequest {
            agent_id: real_agent_id, 
            chain: 0, // Hardcoded BTC para demo
            target: target_addr,
            amount_sui_equiv: amount_sui,
            tx_hash: tx_payload
        });
    }
}