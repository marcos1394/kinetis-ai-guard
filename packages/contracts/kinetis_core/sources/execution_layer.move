module kinetis_core::execution_layer {
    use sui::object::{Self, ID};
    use sui::tx_context::{Self, TxContext};
    use sui::clock::{Clock};
    use sui::event;
    use sui::coin::{Self, Coin}; 
    use sui::sui::SUI;           
    use sui::transfer;

    use kinetis_core::policy_registry::{Self, AgentAdminCap, AgentProfile}; 
    use kinetis_core::policy_rules::{Self, PolicyConfig};
    
    // Importamos FinanceApproval para manejar la aprobación manual
    use kinetis_core::financial_rules::{Self, BudgetConfig, FinanceApproval};
    
    use switchboard::aggregator::{Aggregator};
    use ika_dwallet_2pc_mpc::coordinator_inner::{DWalletCap};

    // --- ERRORES ---
    const EPolicyViolation: u64 = 0;
    const EAgentPaused: u64 = 1;      
    const EInsufficientFee: u64 = 2;  

    // --- CONFIGURACIÓN ECONÓMICA ---
    const PROTOCOL_FEE: u64 = 50000000; 
    // ⚠️ REEMPLAZA ESTO CON TU ADDRESS DE TESTNET ⚠️
    const TREASURY: address = @0xa123456789abcdef0123456789abcdef0123456789abcdef0123456789abcd; 

    // --- EVENTOS ---
    public struct ExecutionRequest has copy, drop {
        agent_id: ID,
        chain: u8, 
        target: address,
        amount_sui_equiv: u64,
        tx_hash: vector<u8>,
        inference_hash: vector<u8>, // <--- NUEVO: Proof of Inference (Auditoría)
        fee_paid: u64
    }

    // Evento informativo cuando una tx queda pendiente
    public struct ExecutionPending has copy, drop {
        agent_id: ID,
        inference_hash: vector<u8>, // <--- NUEVO
        reason: vector<u8>
    }

    // --- FUNCIONES ---

    // 1. EJECUCIÓN ESTÁNDAR (Intento Automático)
    // Esta función SÍ es 'entry' porque el Agente la llama directamente desde fuera.
    public entry fun execute_transfer(
        agent_cap: &AgentAdminCap, 
        agent_profile: &AgentProfile, 
        _dwallet_cap: &DWalletCap, 
        policy_config: &PolicyConfig,
        budget_config: &mut BudgetConfig,
        aggregator: &Aggregator,
        clock: &Clock,
        fee_payment: Coin<SUI>, 
        
        target_addr: address,
        amount_sui: u64,     
        tx_payload: vector<u8>,
        inference_hash: vector<u8>, // <--- NUEVO INPUT: El hash del pensamiento de la IA
        
        ctx: &mut TxContext
    ) {
        // A. Validaciones Comunes
        validate_common_rules(agent_profile, &fee_payment, policy_config, target_addr, clock);

        // Cobrar Fee
        process_fee(fee_payment);

        // B. FINANZAS: Verificar Presupuesto
        // Pasamos el hash para que se guarde en la solicitud si es necesario
        let is_approved = financial_rules::check_and_record_spend(
            budget_config,
            amount_sui,
            inference_hash, // Pasamos el hash
            aggregator,
            clock,
            ctx 
        );

        let real_agent_id = policy_registry::admin_cap_agent_id(agent_cap);

        if (is_approved) {
            // C.1. APROBADO: Emitir evento con Proof of Inference
            emit_execution_event(real_agent_id, target_addr, amount_sui, tx_payload, inference_hash, PROTOCOL_FEE);
        } else {
            // C.2. PENDIENTE: Emitir evento de espera
            event::emit(ExecutionPending {
                agent_id: real_agent_id,
                inference_hash,
                reason: b"Budget Limit Exceeded. Spending Request Created."
            });
        }
    }

    // 2. EJECUCIÓN MANUAL (Después de Aprobación Humana)
    // [CORRECCIÓN CRÍTICA]: Eliminamos 'entry'.
    // Ahora es 'public fun'. Esto permite recibir 'FinanceApproval' dentro de un PTB.
    public fun execute_approved_transfer(
        agent_cap: &AgentAdminCap, 
        agent_profile: &AgentProfile, 
        _dwallet_cap: &DWalletCap, 
        policy_config: &PolicyConfig,
        clock: &Clock,
        fee_payment: Coin<SUI>, 
        
        // PARAMETRO CLAVE: La prueba de aprobación (Hot Potato)
        approval: FinanceApproval,

        target_addr: address,
        tx_payload: vector<u8>, 
        _ctx: &mut TxContext
    ) {
        // A. Validaciones Comunes 
        validate_common_rules(agent_profile, &fee_payment, policy_config, target_addr, clock);

        // Cobrar Fee
        process_fee(fee_payment);

        // B. CONSUMIR LA APROBACIÓN y RECUPERAR EL HASH
        // Al quemar la aprobación, recuperamos el 'inference_hash' original que causó el bloqueo.
        // Esto garantiza la cadena de custodia de la auditoría.
        let original_inference_hash = financial_rules::burn_approval(approval);

        // C. EJECUCIÓN
        let real_agent_id = policy_registry::admin_cap_agent_id(agent_cap);
        
        emit_execution_event(real_agent_id, target_addr, 0, tx_payload, original_inference_hash, PROTOCOL_FEE);
    }

    // --- HELPERS PRIVADOS ---

    fun validate_common_rules(
        agent_profile: &AgentProfile,
        fee_payment: &Coin<SUI>,
        policy_config: &PolicyConfig,
        target_addr: address,
        clock: &Clock
    ) {
        if (policy_registry::is_paused(agent_profile)) {
            abort EAgentPaused
        };

        assert!(coin::value(fee_payment) >= PROTOCOL_FEE, EInsufficientFee);

        if (!policy_rules::verify_transaction(policy_config, target_addr, clock)) {
            abort EPolicyViolation
        };
    }

    fun process_fee(payment: Coin<SUI>) {
        transfer::public_transfer(payment, TREASURY);
    }

    fun emit_execution_event(
        agent_id: ID, 
        target: address, 
        amount: u64, 
        hash: vector<u8>, 
        inference_hash: vector<u8>, // <--- Argumento Nuevo
        fee: u64
    ) {
        event::emit(ExecutionRequest {
            agent_id, 
            chain: 0, 
            target,
            amount_sui_equiv: amount,
            tx_hash: hash,
            inference_hash, // <--- Emitimos la prueba forense
            fee_paid: fee
        });
    }
}