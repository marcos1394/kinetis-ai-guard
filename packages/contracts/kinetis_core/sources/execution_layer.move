module kinetis_core::execution_layer {
    use sui::object::{Self, ID};
    use sui::tx_context::{Self, TxContext};
    use sui::clock::{Clock};
    use sui::event;
    use sui::coin::{Self, Coin}; // Importamos manejo de monedas
    use sui::sui::SUI;           // Importamos el token nativo SUI
    use sui::transfer;

    // Imports de módulos internos
    use kinetis_core::policy_registry::{Self, AgentAdminCap, AgentProfile}; 
    use kinetis_core::policy_rules::{Self, PolicyConfig};
    use kinetis_core::financial_rules::{Self, BudgetConfig};
    
    // Switchboard (Oráculo)
    use switchboard::aggregator::{Aggregator};

    // Ika (Custodia 2PC-MPC)
    use ika_dwallet_2pc_mpc::coordinator_inner::{DWalletCap};

    // --- ERRORES ---
    const EPolicyViolation: u64 = 0;
    const EAgentPaused: u64 = 1;      // Error si el Kill Switch está activo
    const EInsufficientFee: u64 = 2;  // Error si no pagan la comisión

    // --- CONFIGURACIÓN ECONÓMICA (Whitepaper Sección 4.2) ---
    
    // Tarifa Fija por Ejecución: 0.05 SUI (50,000,000 MIST)
    // En el futuro, esto será un parámetro gobernable por la DAO.
    const PROTOCOL_FEE: u64 = 50000000; 

    // Dirección de la Tesorería (Donde se acumulan los fees para Buyback & Burn)
    // ⚠️ REEMPLAZA ESTO CON TU ADDRESS DE TESTNET PARA RECIBIR LOS PAGOS ⚠️
    const TREASURY: address = @0xa123456789abcdef0123456789abcdef0123456789abcdef0123456789abcd; 

    // --- EVENTOS ---
    public struct ExecutionRequest has copy, drop {
        agent_id: ID,
        chain: u8, 
        target: address,
        amount_sui_equiv: u64,
        tx_hash: vector<u8>,
        fee_paid: u64
    }

    // --- FUNCIONES ---

    public entry fun execute_transfer(
        // 1. Identidad y Autoridad
        agent_cap: &AgentAdminCap, 
        agent_profile: &AgentProfile, // Leemos el perfil para ver el estado de pausa
        _dwallet_cap: &DWalletCap, 
        
        // 2. Reglas
        policy_config: &PolicyConfig,
        budget_config: &mut BudgetConfig,
        
        // 3. Contexto Externo 
        aggregator: &Aggregator,
        clock: &Clock,

        // 4. MODELO DE NEGOCIO: Pago del Fee
        fee_payment: Coin<SUI>, 

        // 5. Parámetros de la Tx Propuesta
        target_addr: address,
        amount_sui: u64,     
        tx_payload: vector<u8>, 
        
        _ctx: &mut TxContext
    ) {
        // --- A. SEGURIDAD: VERIFICACIÓN DE PAUSA (Kill Switch) ---
        // Sección 1.4: Zero-Trust Enforcement.
        // Si el dueño pausó el agente en el Registry, nadie pasa.
        if (policy_registry::is_paused(agent_profile)) {
            abort EAgentPaused
        };

        // --- B. NEGOCIO: COBRO DE COMISIÓN (Revenue Stream) ---
        // Sección 4.2: "El protocolo captura valor al monetizar la confianza"
        let payment_value = coin::value(&fee_payment);
        assert!(payment_value >= PROTOCOL_FEE, EInsufficientFee);

        // Enviamos el SUI a la Tesorería de Kinetis
        transfer::public_transfer(fee_payment, TREASURY); 

        // --- C. POLÍTICAS: WHITELIST (Compliance) ---
        if (!policy_rules::verify_transaction(policy_config, target_addr, clock)) {
            abort EPolicyViolation
        };

        // --- D. FINANZAS: PRESUPUESTO (Risk Mgmt) ---
        financial_rules::check_and_record_spend(
            budget_config,
            amount_sui,
            aggregator,
            clock
        );

        // --- E. EJECUCIÓN: FIRMA ---
        // Obtenemos el ID real para logs forenses
        let real_agent_id = policy_registry::admin_cap_agent_id(agent_cap);

        event::emit(ExecutionRequest {
            agent_id: real_agent_id, 
            chain: 0, 
            target: target_addr,
            amount_sui_equiv: amount_sui,
            tx_hash: tx_payload,
            fee_paid: payment_value
        });
    }
}