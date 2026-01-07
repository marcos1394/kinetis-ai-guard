import { SwitchboardClient, Aggregator } from "@switchboard-xyz/sui-sdk";
import { CrossbarClient, OracleJob } from "@switchboard-xyz/common";
import { SuiClient } from "@mysten/sui/client";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";

// Queue de Testnet de Switchboard (Estable)
const SWITCHBOARD_TESTNET_QUEUE = "0x78902506b3a0429a3977c07da33246eb74a62df8ce429739f8299ba420d2d79d";

export class OracleSetupModule {
    private client: SuiClient;
    private switchboard: SwitchboardClient;
    private crossbar: CrossbarClient;

    constructor(client: SuiClient) {
        this.client = client;
        this.switchboard = new SwitchboardClient(client);
        // Cliente para guardar la definición del trabajo (Job) off-chain
        this.crossbar = new CrossbarClient("https://crossbar.switchboard.xyz");
    }

    /**
     * Crea un nuevo Feed de Precios en la blockchain.
     * @param signerKeypair - Las credenciales del Admin que pagará el gas.
     * @param pairName - Nombre del par (ej. "SUI/USDT").
     * @param binanceSymbol - Símbolo en Binance API (ej. "SUIUSDT").
     */
    async createPriceFeed(
        signerKeypair: Ed25519Keypair,
        pairName: string,
        binanceSymbol: string
    ): Promise<string | null> {
        console.log(`🛠️ Configurando oráculo para ${pairName}...`);

        const userAddress = signerKeypair.toSuiAddress();

        // 1. Definir el Trabajo (Job) - Tarea: Leer de Binance y parsear precio
        const jobs: OracleJob[] = [
            OracleJob.fromObject({
                tasks: [
                    {
                        httpTask: {
                            url: `https://api.binance.com/api/v3/ticker/price?symbol=${binanceSymbol}`,
                        },
                    },
                    {
                        jsonParseTask: {
                            path: "$.price",
                        },
                    },
                ],
            }),
        ];

        try {
            // 2. Guardar definición en Crossbar (IPFS/Storage de Switchboard)
            console.log("💾 Subiendo definición del Job a Crossbar...");
            const { feedHash } = await this.crossbar.store(SWITCHBOARD_TESTNET_QUEUE, jobs);
            console.log(`📝 Feed Hash: ${feedHash}`);

            // 3. Preparar Transacción de Inicialización en Sui
            const tx = new Transaction();
            
            await Aggregator.initTx(this.switchboard, tx, {
                feedHash,
                name: `Kinetis ${pairName}`,
                authority: userAddress, // Tú eres el dueño del feed
                minSampleSize: 1,
                maxStalenessSeconds: 60,
                maxVariance: 1e9,
                minResponses: 1,
            });

            // 4. Firmar y Ejecutar
            console.log("🚀 Creando objeto Aggregator en cadena...");
            const res = await this.client.signAndExecuteTransaction({
                signer: signerKeypair,
                transaction: tx,
                options: {
                    showEffects: true,
                    showObjectChanges: true,
                },
            });

            // 5. Esperar confirmación
            await this.client.waitForTransaction({ digest: res.digest });

            // 6. Extraer el ID del nuevo Aggregator creado
            let aggregatorId = null;
            res.objectChanges?.forEach((change) => {
                if (change.type === 'created' && change.objectType.includes('aggregator::Aggregator')) {
                    aggregatorId = change.objectId;
                }
            });

            if (aggregatorId) {
                console.log(`✅ Oráculo Creado Exitosamente: ${aggregatorId}`);
                return aggregatorId;
            } else {
                console.warn("⚠️ Transacción exitosa pero no se encontró el ID del Aggregator en los logs.");
                return null;
            }

        } catch (error) {
            console.error(`❌ Error creando el oráculo: ${error}`);
            throw error;
        }
    }
}