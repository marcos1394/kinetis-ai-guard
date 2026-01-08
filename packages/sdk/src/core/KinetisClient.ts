import { SuiClient, getFullnodeUrl } from '@mysten/sui/client';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';

// --- MÓDULOS DE INFRAESTRUCTURA Y REGLAS ---
import { RegistryModule } from '../modules/Registry'; // Importamos AgentData
import type { AgentData } from '../modules/Registry'; // <--- ¡La clave es 'type'!
import { PoliciesModule } from '../modules/Policies';
import { FinancialModule } from '../modules/Financial';
import { OracleSetupModule } from '../modules/OracleSetup';

// --- NUEVOS MÓDULOS (Features Avanzadas) ---
import { DWalletModule } from '../modules/Dwallet';
import { ExecutionModule } from '../modules/Execution';

// --- UTILS ---
// Exportamos ProofOfInference para que el desarrollador pueda usar 'ProofOfInference.hashInference()'
export { ProofOfInference } from '../utils/ProofOfInference';
export { AgentData }; 

// Configuración de entrada
export interface KinetisConfig {
    network: 'mainnet' | 'testnet' | 'devnet' | 'localnet';
    rpcUrl?: string;     // Opcional: Si quieres usar un nodo privado
    packageId?: string;  // El ID del contrato publicado (0x...)
}

/**
 * KINETIS CLIENT (The Brain 🧠)
 * El orquestador central que une Inteligencia Artificial con Blockchain.
 */
export class KinetisClient {
    // Propiedades Base
    public client: SuiClient;
    public packageId: string;

    // --- MÓDULOS PÚBLICOS (Acceso a la funcionalidad) ---
    
    // 1. Identidad: ¿Quién es el agente?
    public registry: RegistryModule;
    
    // 2. Compliance: ¿A dónde puede enviar dinero?
    public policies: PoliciesModule;
    
    // 3. Finanzas: Presupuestos, Circuit Breaker y Solicitudes Pendientes
    public financial: FinancialModule;
    
    // 4. Ejecución: Enviar dinero, Proof of Inference y Aprobación Manual
    public execution: ExecutionModule;
    
    // 5. Infraestructura Cripto: DWallet (Bitcoin/Ethereum/Solana via Ika)
    public dwallet: DWalletModule;
    
    // 6. Admin Tools: Configuración de Oráculos
    public oracle: OracleSetupModule;

    constructor(config: KinetisConfig) {
        // 1. Configuración de Red
        const url = config.rpcUrl || getFullnodeUrl(config.network);
        this.client = new SuiClient({ url });

        // 2. Configuración del Contrato
        this.packageId = config.packageId || (process.env.KINETIS_PACKAGE_ID as string);

        if (!this.packageId) {
            console.warn("⚠️ KINETIS WARNING: No se proveyó Package ID. El SDK corre en modo abstracto.");
            this.packageId = "0x0000000000000000000000000000000000000000000000000000000000000000";
        }

        // 3. Inicialización de Módulos (Inyección de Dependencias)
        
        // Módulos Básicos
        this.registry = new RegistryModule(this.client, this.packageId);
        this.policies = new PoliciesModule(this.client, this.packageId);
        this.financial = new FinancialModule(this.client, this.packageId);
        this.oracle = new OracleSetupModule(this.client);

        // Módulos Avanzados (Nuevas Features)
        this.execution = new ExecutionModule(this.client, this.packageId);
        
        // DWallet requiere configuración específica de red para Ika
        const networkType = config.network === 'mainnet' ? 'mainnet' : 'testnet';
        this.dwallet = new DWalletModule(this.client, networkType);
        
        console.log(`✅ Kinetis Client inicializado en red: ${config.network}`);
    }

    /**
     * [IMPORTANTE] Inicializa dependencias asíncronas (WASM de Ika).
     * Debe llamarse con 'await' inmediatamente después de crear la instancia.
     * Ejemplo: const sdk = await new KinetisClient(...).init();
     */
    async init() {
        await this.dwallet.init();
        return this;
    }

    /**
     * Helper Maestro: Firma y Ejecuta cualquier transacción generada por los módulos.
     * Simplifica la vida del desarrollador para no lidiar con bytes y gas manualmente.
     */
    async signAndExecute(
        signer: Ed25519Keypair,
        tx: Transaction,
        options: { showEffects?: boolean; showObjectChanges?: boolean } = { showEffects: true, showObjectChanges: true }
    ) {
        try {
            const result = await this.client.signAndExecuteTransaction({
                signer: signer,
                transaction: tx,
                options: options
            });

            // Esperamos a que la red confirme (para evitar condiciones de carrera en scripts)
            await this.client.waitForTransaction({ digest: result.digest });

            return result;
        } catch (error) {
            console.error("❌ Error ejecutando transacción:", error);
            throw error;
        }
    }

    /**
     * Verifica la salud de la conexión RPC
     */
    async healthCheck(): Promise<boolean> {
        try {
            const info = await this.client.getChainIdentifier();
            return !!info;
        } catch (e) {
            return false;
        }
    }
}