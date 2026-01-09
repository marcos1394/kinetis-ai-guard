import { SuiClient } from '@mysten/sui/client';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';
import { 
    IkaClient, 
    IkaTransaction, 
    UserShareEncryptionKeys, 
    Curve, 
    getNetworkConfig, 
    prepareDKGAsync,
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
        

        const sessionId = createRandomSessionIdentifier();

        console.log("⚙️  Generando pruebas Zero-Knowledge (WASM)...");
        // CAMBIO CRÍTICO: Usamos prepareDKGAsync
        // Esta función se encarga de buscar los params y formatear las llaves correctamente
        const dkgRequestInput = await prepareDKGAsync(
            this.ikaClient, // Le pasamos el cliente para que él busque los params
            curve,
            userKeys,       // Le pasamos el objeto completo, no bytes crudos
            sessionId,      // bytesToHash
            userAddress     // senderAddress
        );
        // 4. Construcción de Transacción con LOGS CORREGIDOS
        console.log("\n📝 [DEBUG] --- INICIO CONSTRUCCIÓN DE TRANSACCIÓN ---");
        const tx = new Transaction();
        const ikaTx = new IkaTransaction({
            ikaClient: this.ikaClient,
            transaction: tx,
            userShareEncryptionKeys: userKeys
        });

        // 1. Session ID (Es un Objeto de Transacción, no bytes)
        const sessionIdentifier = ikaTx.createSessionIdentifier();
        console.log(`  -> [DEBUG] Session ID Objeto creado (Ref Transaction).`);

        // 2. Network Key
        const networkEncryptionKey = await this.ikaClient.getLatestNetworkEncryptionKey();
        console.log(`  -> [DEBUG] Network Key ID: ${networkEncryptionKey.id}`);

        // 3. Preparar IKA Coin
        const ikaCoinId = await this.findIkaCoin(userAddress);
        console.log(`  -> [DEBUG] IKA Coin ID encontrado: ${ikaCoinId}`);
        
        if (!ikaCoinId) {
            console.error("  -> [ERROR] No se encontró moneda IKA en la wallet.");
            throw new Error("❌ Error: No tienes tokens IKA.");
        }

        // Split de IKA
        const IKA_AMOUNT = 1_000_000_000; 
        console.log(`  -> [DEBUG] Preparando Split de IKA Coin. Monto: ${IKA_AMOUNT}`);
        
        const ikaOriginCoin = tx.object(ikaCoinId);
        const [ikaPaymentCoin] = tx.splitCoins(ikaOriginCoin, [tx.pure.u64(IKA_AMOUNT)]);

        // 4. Preparar SUI Coin
        const SUI_AMOUNT = 50_000_000; // 0.05 SUI
        console.log(`  -> [DEBUG] Preparando Split de SUI Coin. Monto: ${SUI_AMOUNT}`);
        const [suiPaymentCoin] = tx.splitCoins(tx.gas, [tx.pure.u64(SUI_AMOUNT)]);

        // 5. Verificación de Inputs DKG (Con nombres corregidos)
        console.log("  -> [DEBUG] Verificando DKG Request Input:");
        // Imprimimos las llaves para confirmar qué propiedades tiene el objeto real
        console.log(`      - Propiedades disponibles: ${Object.keys(dkgRequestInput).join(', ')}`);
        
        // Usamos la notación de corchetes ['propiedad'] o 'as any' para evitar error de TS si la definición difiere,
        // pero usamos los nombres que confirmaste.
        const inputAny = dkgRequestInput as any;
        if (inputAny.userDKGMessage) console.log(`      - userDKGMessage length: ${inputAny.userDKGMessage.length}`);
        if (inputAny.userPublicOutput) console.log(`      - userPublicOutput length: ${inputAny.userPublicOutput.length}`);

        // 6. La Llamada Crítica
        console.log("  -> [DEBUG] Llamando a 'ikaTx.requestDWalletDKG'...");
        
        const dwalletCap = await ikaTx.requestDWalletDKG({
            dkgRequestInput: dkgRequestInput,
            sessionIdentifier: sessionIdentifier,
            dwalletNetworkEncryptionKeyId: networkEncryptionKey.id,
            curve: curve, 
            ikaCoin: ikaPaymentCoin, 
            suiCoin: suiPaymentCoin, 
        });
        
        console.log("  -> [DEBUG] MoveCall agregado correctamente.");
        tx.transferObjects([dwalletCap], tx.pure.address(userAddress));
        console.log("📝 [DEBUG] --- FIN CONSTRUCCIÓN ---");
        
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