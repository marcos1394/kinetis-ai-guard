module kinetis_core::execution_layer {
    use sui::object::{Self, ID};
    use sui::tx_context::{Self, TxContext};
    use sui::clock::{Clock};
    use sui::event;
    use sui::coin::{Self, Coin}; 
    use sui::sui::SUI;           
    use sui::transfer;

    // Imports de módulos internos
    use kinetis_core::policy_registry::{Self, AgentAdminCap, AgentProfile}; 
    use kinetis_core::policy_rules::{Self, PolicyConfig};
    
    // Importamos FinanceApproval para manejar la aprobación manual
    use kinetis_core::financial_rules::{Self, BudgetConfig, FinanceApproval};
    
    use switchboard::aggregator::{Aggregator};

    // Ika (Custodia 2PC-MPC)
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
        fee_paid: u64
    }

    // Evento informativo cuando una tx queda pendiente
    public struct ExecutionPending has copy, drop {
        agent_id: ID,
        reason: vector<u8>
    }

    // --- FUNCIONES ---

    // 1. EJECUCIÓN ESTÁNDAR (Intento Automático)
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
        ctx: &mut TxContext
    ) {
        // A. Validaciones Comunes (Pausa, Fee, Whitelist)
        validate_common_rules(agent_profile, &fee_payment, policy_config, target_addr, clock);

        // Cobrar Fee (Se cobra por el intento, sea aprobado o pendiente)
        process_fee(fee_payment);

        // B. FINANZAS: Verificar Presupuesto
        // Ahora check_and_record_spend devuelve un booleano
        let is_approved = financial_rules::check_and_record_spend(
            budget_config,
            amount_sui,
            aggregator,
            clock,
            ctx // Pasamos ctx para crear la SpendingRequest si es necesario
        );

        let real_agent_id = policy_registry::admin_cap_agent_id(agent_cap);

        if (is_approved) {
            // C.1. APROBADO: Emitir evento para que Ika firme
            emit_execution_event(real_agent_id, target_addr, amount_sui, tx_payload, PROTOCOL_FEE);
        } else {
            // C.2. PENDIENTE: No hacemos nada más.
            // Al terminar la función exitosamente, la 'SpendingRequest' creada en financial_rules 
            // se guarda en la blockchain. Ika NO firmará porque no hay evento ExecutionRequest.
            event::emit(ExecutionPending {
                agent_id: real_agent_id,
                reason: b"Budget Limit Exceeded. Spending Request Created."
            });
        }
    }

    // 2. EJECUCIÓN MANUAL (Después de Aprobación Humana)
    // Esta función se llama cuando el humano ya aprobó la SpendingRequest y tiene el objeto FinanceApproval
    public entry fun execute_approved_transfer(
        agent_cap: &AgentAdminCap, 
        agent_profile: &AgentProfile, 
        _dwallet_cap: &DWalletCap, 
        policy_config: &PolicyConfig,
        // Nota: No necesitamos BudgetConfig aquí porque el gasto ya se registró al aprobar
        clock: &Clock,
        fee_payment: Coin<SUI>, 
        
        // PARAMETRO CLAVE: La prueba de aprobación (Hot Potato)
        approval: FinanceApproval,

        target_addr: address,
        tx_payload: vector<u8>, 
        _ctx: &mut TxContext
    ) {
        // A. Validaciones Comunes (Seguridad en capas: Verificamos Pausa y Whitelist de nuevo)
        validate_common_rules(agent_profile, &fee_payment, policy_config, target_addr, clock);

        // Cobrar Fee (El humano paga por ejecutar la aprobación)
        process_fee(fee_payment);

        // B. CONSUMIR LA APROBACIÓN (Hot Potato)
        // Esto garantiza que la aprobación se use solo una vez y para este agente.
        // (En una versión más avanzada, FinanceApproval tendría el hash de la tx para vincularla fuerte,
        // por ahora confiamos en el flujo secuencial).
        financial_rules::burn_approval(approval);

        // C. EJECUCIÓN
        let real_agent_id = policy_registry::admin_cap_agent_id(agent_cap);
        
        // Como ya tenemos la aprobación manual, asumimos que el monto es el correcto (venía en la approval).
        // Aquí pasamos 0 en amount_sui solo para el log, o deberíamos extraerlo del approval si quisiéramos ser exactos.
        // Para simplificar, emitimos el evento.
        
        emit_execution_event(real_agent_id, target_addr, 0, tx_payload, PROTOCOL_FEE);
    }

    // --- HELPERS PRIVADOS (Para no repetir código) ---

    fun validate_common_rules(
        agent_profile: &AgentProfile,
        fee_payment: &Coin<SUI>,
        policy_config: &PolicyConfig,
        target_addr: address,
        clock: &Clock
    ) {
        // 1. Pausa
        if (policy_registry::is_paused(agent_profile)) {
            abort EAgentPaused
        };

        // 2. Fee Suficiente
        assert!(coin::value(fee_payment) >= PROTOCOL_FEE, EInsufficientFee);

        // 3. Whitelist
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
        fee: u64
    ) {
        event::emit(ExecutionRequest {
            agent_id, 
            chain: 0, 
            target,
            amount_sui_equiv: amount,
            tx_hash: hash,
            fee_paid: fee
        });
    }
}