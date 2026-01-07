import { SuiClient } from '@mysten/sui/client';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';
import { 
    IkaClient, 
    IkaTransaction, 
    UserShareEncryptionKeys, 
    Curve, 
    getNetworkConfig, 
    prepareDKG,
    createRandomSessionIdentifier,
    publicKeyFromDWalletOutput 
} from '@ika.xyz/sdk';
import { webcrypto } from 'node:crypto';

export class DWalletModule {
    private client: SuiClient;
    private ikaClient: IkaClient;
    private network: 'testnet' | 'mainnet';

    constructor(client: SuiClient, network: 'testnet' | 'mainnet' = 'testnet') {
        this.client = client;
        this.network = network;
        
        this.ikaClient = new IkaClient({
            suiClient: client,
            config: getNetworkConfig(network),
        });
    }

    async init() {
        await this.ikaClient.initialize();
    }

    async createDWallet(
        signerKeypair: Ed25519Keypair, 
        curve: Curve = Curve.SECP256K1,
        existingSeed?: Uint8Array
    ): Promise<{ 
        dWalletId: string, 
        seed: Uint8Array, 
        publicKeyHex: string 
    }> {
        const userAddress = signerKeypair.toSuiAddress();
        
        const curveName = curve === Curve.SECP256K1 ? "BTC/ETH (SECP256K1)" : 
                          curve === Curve.ED25519 ? "SOLANA (ED25519)" : "OTHER";

        console.log(`🔐 Iniciando DKG [${curveName}] para: ${userAddress}`);

        // 1. Gestión de Semilla
        let seedKey: Uint8Array;
        if (existingSeed) {
            if (existingSeed.length !== 32) throw new Error("❌ Error: La semilla debe ser de 32 bytes exactamente.");
            seedKey = existingSeed;
            console.log("♻️  Usando semilla existente.");
        } else {
            seedKey = new Uint8Array(32);
            webcrypto.getRandomValues(seedKey);
            console.log("🆕 Generando nueva semilla maestra.");
        }

        // 2. Criptografía del Usuario
        const userKeys = await UserShareEncryptionKeys.fromRootSeedKey(seedKey, curve);

        // 3. Preparación DKG
        console.log(`📥 Obteniendo parámetros del protocolo para ${curveName}...`);
        const protocolParams = await this.ikaClient.getProtocolPublicParameters(undefined, curve);

        const sessionId = createRandomSessionIdentifier();

        console.log("⚙️  Generando pruebas Zero-Knowledge (WASM)...");
        const encryptionKeyBytes = new Uint8Array(userKeys.getPublicKey().toSuiBytes().slice(1));

        const dkgRequestInput = await prepareDKG(
            protocolParams,
            curve,
            encryptionKeyBytes,
            sessionId,
            userAddress
        );

        // 4. Construcción de Transacción
        console.log("📝 Construyendo transacción en Sui...");
        const tx = new Transaction();
        const ikaTx = new IkaTransaction({
            ikaClient: this.ikaClient,
            transaction: tx,
            userShareEncryptionKeys: userKeys
        });

        const sessionIdentifier = ikaTx.createSessionIdentifier();
        const networkEncryptionKey = await this.ikaClient.getLatestNetworkEncryptionKey();
        
        const ikaCoinId = await this.findIkaCoin(userAddress);
        if (!ikaCoinId) throw new Error("❌ Error: No tienes tokens IKA. Son necesarios para crear la dWallet.");

        const dwalletCap = await ikaTx.requestDWalletDKG({
            dkgRequestInput: dkgRequestInput,
            sessionIdentifier: sessionIdentifier,
            dwalletNetworkEncryptionKeyId: networkEncryptionKey.id,
            curve: curve, 
            ikaCoin: tx.object(ikaCoinId), 
            suiCoin: tx.splitCoins(tx.gas, [50000000]), 
        });

        tx.transferObjects([dwalletCap], tx.pure.address(userAddress));

        // 5. Ejecución
        console.log("🚀 Enviando transacción...");
        const result = await this.client.signAndExecuteTransaction({
            signer: signerKeypair,
            transaction: tx,
            options: { showEffects: true, showObjectChanges: true },
        });

        await this.client.waitForTransaction({ digest: result.digest });

        // 6. Extracción de Resultados
        let dWalletId = "";
        result.objectChanges?.forEach((change) => {
            // PASO 1: "Type Guard". Primero filtramos por tipo.
            // TypeScript ahora sabe que dentro de este IF, 'change' tiene las propiedades correctas.
            if (change.type === 'created') {
                // PASO 2: Ahora es seguro acceder a 'objectType' y 'objectId'
                if (change.objectType.includes('dwallet::DWallet')) {
                    dWalletId = change.objectId;
                }
            }
        });

        if (!dWalletId) {
            throw new Error(`⚠️ Transacción confirmada pero no se encontró dWallet ID. Digest: ${result.digest}`);
        }

        console.log(`✅ dWallet Creada: ${dWalletId}`);

        // 7. Obtención de la Clave Pública
        console.log("🔍 Obteniendo llave pública final...");
        const publicKeyHex = await this.getDWalletPublicKey(dWalletId, curve);
        console.log(`🔑 Public Key: ${publicKeyHex}`);

        return { dWalletId, seed: seedKey, publicKeyHex };
    }

    async getDWalletPublicKey(dWalletId: string, curve: Curve = Curve.SECP256K1): Promise<string> {
        try {
            const dWallet = await this.ikaClient.getDWallet(dWalletId);

            if (dWallet.state.$kind !== 'Active') {
                throw new Error(`dWallet ${dWalletId} is not Active. State: ${dWallet.state.$kind}`);
            }

            // --- CORRECCIÓN CRÍTICA AQUÍ ---
            // Convertimos el array de números (number[]) a Uint8Array explícitamente
            // TypeScript se quejaba porque dWallet.state.Active.public_output viene como number[] desde la red
            const rawOutput = new Uint8Array(dWallet.state.Active.public_output);

            const publicKeyBytes = await publicKeyFromDWalletOutput(
                curve,
                rawOutput
            );

            return Buffer.from(publicKeyBytes).toString('hex');
        } catch (error) {
            console.error("Error fetching public key:", error);
            throw error;
        }
    }

    async recoverKeys(seed: Uint8Array, curve: Curve = Curve.SECP256K1): Promise<UserShareEncryptionKeys> {
        return await UserShareEncryptionKeys.fromRootSeedKey(seed, curve);
    }

    private async findIkaCoin(owner: string): Promise<string | null> {
        let cursor = null;
        let hasNext = true;
        
        while (hasNext) {
            // --- CORRECCIÓN DE VARIABLE AQUÍ ---
            // Renombramos 'coins' a 'coinPage' para evitar errores de referencia cíclica
            const coinPage = await this.client.getAllCoins({ owner, cursor });
            
            for (const coin of coinPage.data) {
                if (coin.coinType !== "0x2::sui::SUI" && parseInt(coin.balance) > 0) {
                    return coin.coinObjectId;
                }
            }
            
            if (!coinPage.hasNextPage) break;
            cursor = coinPage.nextCursor;
        }
        return null;
    }
}