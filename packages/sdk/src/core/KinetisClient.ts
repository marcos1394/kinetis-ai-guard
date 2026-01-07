import { SuiClient, getFullnodeUrl } from '@mysten/sui/client';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';

// Importamos nuestros módulos
import { RegistryModule } from '../modules/Registry';
import { PoliciesModule } from '../modules/Policies';
import { FinancialModule } from '../modules/Financial';
import { OracleSetupModule } from '../modules/OracleSetup';

// Configuración de entrada
export interface KinetisConfig {
    network: 'mainnet' | 'testnet' | 'devnet' | 'localnet';
    rpcUrl?: string;     // Opcional: Si quieres usar un nodo privado (Blast, Alchemy)
    packageId?: string;  // El ID del contrato publicado (0x...)
}

export class KinetisClient {
    // Propiedades Base
    public client: SuiClient;
    public packageId: string;

    // Módulos Públicos (Acceso a la funcionalidad)
    public registry: RegistryModule;
    public policies: PoliciesModule;
    public financial: FinancialModule;
    public oracle: OracleSetupModule;

    constructor(config: KinetisConfig) {
        // 1. Configuración de Red
        const url = config.rpcUrl || getFullnodeUrl(config.network);
        this.client = new SuiClient({ url });

        // 2. Configuración del Contrato
        // Si no pasan ID, intentamos leer de variables de entorno o usamos una dummy
        this.packageId = config.packageId || (process.env.KINETIS_PACKAGE_ID as string);

        if (!this.packageId) {
            console.warn("⚠️ KINETIS WARNING: No se proveyó Package ID. El SDK corre en modo abstracto.");
            this.packageId = "0x0000000000000000000000000000000000000000000000000000000000000000";
        }

        // 3. Inicialización de Módulos (Inyección de Dependencias)
        this.registry = new RegistryModule(this.client, this.packageId);
        this.policies = new PoliciesModule(this.client, this.packageId);
        this.financial = new FinancialModule(this.client, this.packageId);
        this.oracle = new OracleSetupModule(this.client);
        
        console.log(`✅ Kinetis Client inicializado en red: ${config.network}`);
    }

    /**
     * Helper Maestro: Firma y Ejecuta cualquier transacción generada por los módulos.
     * Simplifica la vida del desarrollador para no lidiar con bytes y gas manualmente.
     */
    async signAndExecute(
        signer: Ed25519Keypair,
        tx: Transaction,
        options: { showEffects?: boolean; showObjectChanges?: boolean } = { showEffects: true }
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