import { SuiClient, getFullnodeUrl } from "@mysten/sui/client";
import { Transaction } from "@mysten/sui/transactions";
import { TESTNET_CONFIG } from "./constants";

/**
 * Interfaz para los datos de un Agente en el Frontend
 */
export interface AgentData {
  id: string;
  name: string;
  model: string;
  isPaused: boolean;
  owner: string;
}

export class KinetisClient {
  private client: SuiClient;
  private packageId: string;

  constructor(network: "testnet" | "mainnet" = "testnet") {
    this.client = new SuiClient({ url: getFullnodeUrl(network) });
    this.packageId = TESTNET_CONFIG.PACKAGE_ID;
  }

  // ===========================================================================
  // ✍️ MÉTODOS DE ESCRITURA (Generan Transacciones para firmar)
  // ===========================================================================

  /**
   * 1. Registrar un nuevo Agente
   * Crea un AgentProfile y una AgentAdminCap.
   */
  registerAgent(name: string, aiModel: string): Transaction {
    const tx = new Transaction();
    tx.moveCall({
      target: `${this.packageId}::${TESTNET_CONFIG.MODULES.REGISTRY}::register_agent`,
      arguments: [
        tx.pure.string(name),   // Nombre (ej. "Kinetis Trader")
        tx.pure.string(aiModel) // Modelo (ej. "GPT-4o")
      ],
    });
    return tx;
  }

  /**
   * 2. Asignar Presupuesto Diario
   * Requiere la AdminCap del dueño.
   * @param dailyLimitAmount Monto en centavos USD (ej. 5000 = $50.00)
   */
  setDailyBudget(adminCapId: string, agentProfileId: string, dailyLimitAmount: number): Transaction {
    const tx = new Transaction();
    tx.moveCall({
      target: `${this.packageId}::${TESTNET_CONFIG.MODULES.FINANCE}::set_daily_budget`,
      arguments: [
        tx.object(adminCapId),
        tx.object(agentProfileId),
        tx.pure.u64(dailyLimitAmount),
      ],
    });
    return tx;
  }

  /**
   * 3. Crear Configuración de Reglas (Whitelist)
   * Inicializa el objeto PolicyConfig.
   */
  createPolicyConfig(adminCapId: string, agentProfileId: string): Transaction {
    const tx = new Transaction();
    tx.moveCall({
      target: `${this.packageId}::${TESTNET_CONFIG.MODULES.RULES}::create_policy_config`,
      arguments: [
        tx.object(adminCapId),
        tx.object(agentProfileId),
      ],
    });
    return tx;
  }

  /**
   * 4. EJECUCIÓN: Verificar y Registrar Gasto (El Core del Sistema)
   * Consulta el Oráculo Switchboard, verifica límites y actualiza el estado.
   * @param amountSui Monto en SUI (ej. 1.5) -> Se convierte a MIST internamente
   */
  checkAndRecordSpend(amountSui: number): Transaction {
    const tx = new Transaction();
    
    // Conversión: 1 SUI = 1,000,000,000 MIST
    const amountMist = BigInt(Math.floor(amountSui * 1_000_000_000));

    tx.moveCall({
      target: `${this.packageId}::${TESTNET_CONFIG.MODULES.FINANCE}::check_and_record_spend`,
      arguments: [
        // CORREGIDO: Acceso directo a las propiedades (sin .OBJECTS)
        tx.object(TESTNET_CONFIG.BUDGET_CONFIG_ID),       // Objeto de Presupuesto
        tx.pure.u64(amountMist),                          // Monto a gastar
        tx.object(TESTNET_CONFIG.SWITCHBOARD_AGGREGATOR_ID), // Oráculo Switchboard
        tx.object(TESTNET_CONFIG.CLOCK_ID)                // Reloj (0x6)
      ],
    });
    return tx;
  }

  // ===========================================================================
  // 🔍 MÉTODOS DE LECTURA (Consultas al estado de la Blockchain)
  // ===========================================================================

  /**
   * Busca todos los agentes que posee una dirección (Wallet).
   */
  async getOwnedAgents(ownerAddress: string): Promise<AgentData[]> {
    const response = await this.client.getOwnedObjects({
      owner: ownerAddress,
      filter: {
        StructType: `${this.packageId}::${TESTNET_CONFIG.MODULES.REGISTRY}::AgentProfile`,
      },
      options: { showContent: true },
    });

    return response.data.map((obj) => {
      const content = obj.data?.content as any;
      const fields = content?.fields;
      
      return {
        id: obj.data?.objectId!,
        name: fields?.name,
        model: fields?.ai_model_version,
        isPaused: fields?.is_paused,
        owner: fields?.human_owner,
      };
    });
  }

  /**
   * Busca la AdminCap (Llave Maestra) para un Agente específico.
   * Útil para cuando el Frontend necesita autorizar cambios.
   */
  async getAdminCapForAgent(ownerAddress: string, agentId: string): Promise<string | null> {
    const response = await this.client.getOwnedObjects({
      owner: ownerAddress,
      filter: {
        StructType: `${this.packageId}::${TESTNET_CONFIG.MODULES.REGISTRY}::AgentAdminCap`,
      },
      options: { showContent: true },
    });

    // Buscamos la Cap que tenga "for_agent" igual al ID que buscamos
    const cap = response.data.find((obj) => {
      const content = obj.data?.content as any;
      return content?.fields?.for_agent === agentId;
    });

    return cap?.data?.objectId || null;
  }

  /**
   * Consulta el estado actual del presupuesto (Cuánto se ha gastado hoy).
   */
  async getBudgetState() {
    const result = await this.client.getObject({
      // CORREGIDO: Acceso directo (sin .OBJECTS)
      id: TESTNET_CONFIG.BUDGET_CONFIG_ID,
      options: { showContent: true },
    });
    // Retorna los campos crudos (daily_limit, current_spend, last_reset, etc.)
    return (result.data?.content as any)?.fields;
  }
}