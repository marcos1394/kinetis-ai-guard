import { SuiClient } from '@mysten/sui/client';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'; // Ajustado para soportar ambos tipos si es necesario
import {Secp256k1Keypair} from '@mysten/sui/keypairs/secp256k1'
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

    // IDs Verificados manualmente (09/01/2026)
    // Estos IDs son la verdad absoluta en la Testnet ahora mismo.
    private readonly REAL_COORDINATOR_ID = "0x4d157b7415a298c56ec2cb1dcab449525fa74aec17ddba376a83a7600f2062fc";
    private readonly REAL_KEY_ID = "0xe7c79a60931299e110297554fc02e0a0e095e96778775092c97f07a1bd1337cc";

    constructor(client: SuiClient, network: 'testnet' | 'mainnet' = 'testnet') {
        this.client = client;
        this.network = network;

        console.log("🔧 Constructor: Parcheando configuración de Ika...");

        // 1. Obtenemos la configuración base
        const config = getNetworkConfig(network);
        
        // 2. CORRECCIÓN DEL ERROR TS Y PARCHEO:
        // Casteamos a 'any' aquí antes de asignarlo, así no dependemos de propiedades privadas.
        const configAny = config as any;

        // Inyectamos los IDs correctos
        configAny.ikaDwalletCoordinator = this.REAL_COORDINATOR_ID;
        configAny.dwalletNetworkEncryptionKeyId = this.REAL_KEY_ID;

        // Aseguramos también en sub-objetos si existen
        if (configAny.objectIds) {
            configAny.objectIds.ikaDwalletCoordinator = this.REAL_COORDINATOR_ID;
            configAny.objectIds.dwalletNetworkEncryptionKeyId = this.REAL_KEY_ID;
        }

        console.log(`   👉 Config Coordinator: ${this.REAL_COORDINATOR_ID.slice(0, 10)}...`);
        console.log(`   👉 Config Key ID:      ${this.REAL_KEY_ID.slice(0, 10)}...`);

        // 3. Creamos el cliente con la configuración YA ARREGLADA
        this.ikaClient = new IkaClient({
            suiClient: client,
            config: config, 
        });
    }

    async init() {
        // Ya no necesitamos parchear aquí, se hizo en el constructor
        await this.ikaClient.initialize();
        console.log("✅ IkaClient inicializado correctamente.");
    }
    async createDWallet(
        signerKeypair: Ed25519Keypair | Secp256k1Keypair, 
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
        
        const dkgRequestInput = await prepareDKGAsync(
            this.ikaClient,
            curve,
            userKeys,
            sessionId,
            userAddress
        );

        // 4. Construcción de Transacción
        console.log("\n📝 [DEBUG] --- INICIO CONSTRUCCIÓN DE TRANSACCIÓN ---");
        const tx = new Transaction();
        const ikaTx = new IkaTransaction({
            ikaClient: this.ikaClient,
            transaction: tx,
            userShareEncryptionKeys: userKeys
        });

        // 4.1. Session ID
        const sessionIdentifier = ikaTx.createSessionIdentifier();
        console.log(`  -> [DEBUG] Session ID Objeto creado.`);

        // 4.2. IKA Coin (Pago del servicio)
        const ikaCoinId = await this.findIkaCoin(userAddress);
        console.log(`  -> [DEBUG] IKA Coin ID encontrado: ${ikaCoinId}`);
        
        if (!ikaCoinId) {
            throw new Error("❌ Error: No tienes tokens IKA. Usa el faucet.");
        }

        const IKA_AMOUNT = 1_000_000_000; 
        console.log(`  -> [DEBUG] Split IKA Coin: ${IKA_AMOUNT}`);
        const ikaOriginCoin = tx.object(ikaCoinId);
        const [ikaPaymentCoin] = tx.splitCoins(ikaOriginCoin, [tx.pure.u64(IKA_AMOUNT)]);

        // 4.3. SUI Coin (Pago de gas/servicio)
        const SUI_AMOUNT = 50_000_000; 
        console.log(`  -> [DEBUG] Split SUI Coin: ${SUI_AMOUNT}`);
        const [suiPaymentCoin] = tx.splitCoins(tx.gas, [tx.pure.u64(SUI_AMOUNT)]);

        // 4.4. La Llamada Crítica (Move Call)
        console.log("  -> [DEBUG] Llamando a 'ikaTx.requestDWalletDKG'...");
        
        // Aquí pasamos explícitamente el ID de la llave que sabemos que funciona
        const dwalletCap = await ikaTx.requestDWalletDKG({
            dkgRequestInput: dkgRequestInput,
            sessionIdentifier: sessionIdentifier,
            dwalletNetworkEncryptionKeyId: this.REAL_KEY_ID, // <--- USO DEL ID VERIFICADO
            curve: curve, 
            ikaCoin: ikaPaymentCoin, 
            suiCoin: suiPaymentCoin, 
        });
        
        console.log("  -> [DEBUG] MoveCall agregado correctamente.");

        // 4.5. Transferencia de Resultados (CORREGIDO)
        // La función devuelve: (DWalletCap, Cambio IKA, Cambio SUI)
        // Debemos transferir estos resultados, NO las variables de entrada.
        
        const result = dwalletCap as any;

        console.log("  -> [INFO] Transfiriendo Resultados (Cap + Cambio) a la wallet...");
        
        // Transferimos índice 0 (Cap), 1 (Cambio IKA) y 2 (Cambio SUI)
        tx.transferObjects(
            [result[0], result[1], result[2]], 
            tx.pure.address(userAddress)
        );
       
        console.log("📝 [DEBUG] --- FIN CONSTRUCCIÓN ---");
        
        // 5. Ejecución
        console.log("🚀 Enviando transacción...");
        
        const executeResult = await this.client.signAndExecuteTransaction({
            signer: signerKeypair,
            transaction: tx,
            options: { showEffects: true, showObjectChanges: true },
        });

        console.log(`⏳ Esperando confirmación... Digest: ${executeResult.digest}`);
        await this.client.waitForTransaction({ digest: executeResult.digest });

        // 6. Validación de Éxito
        if (executeResult.effects?.status.status === 'failure') {
            console.error("❌ ERROR EN EJECUCIÓN:", JSON.stringify(executeResult.effects.status, null, 2));
            throw new Error(`La transacción falló en la red: ${executeResult.effects.status.error}`);
        }

        // 7. Extracción del ID de la dWallet
        let dWalletId = "";
        executeResult.objectChanges?.forEach((change) => {
            if (change.type === 'created') {
                if (change.objectType.includes('dwallet::DWallet')) {
                    dWalletId = change.objectId;
                }
            }
        });

        if (!dWalletId) {
            console.log("⚠️ DEBUG OBJECT CHANGES:", JSON.stringify(executeResult.objectChanges, null, 2));
            throw new Error(`⚠️ Transacción exitosa pero no se encontró el objeto dWallet.`);
        }

        console.log(`✅ dWallet Creada: ${dWalletId}`);

        // 8. Obtención de la Clave Pública
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

            // Conversión explícita para evitar errores de tipo en TS
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
        
        // ID Oficial IKA Testnet
        const OFFICIAL_IKA_TYPE = "0x1f26bb2f711ff82dcda4d02c77d5123089cb7f8418751474b9fb744ce031526a::ika::IKA";

        console.log(`🔎 Buscando IKA Oficial...`);

        while (hasNext) {
            const coinPage = await this.client.getAllCoins({ owner, cursor });
            
            for (const coin of coinPage.data) {
                if (coin.coinType === OFFICIAL_IKA_TYPE && parseInt(coin.balance) > 0) {
                    console.log(`   ✅ ENCONTRADO: ${coin.coinObjectId} (Balance: ${coin.balance})`);
                    return coin.coinObjectId;
                }
            }
            
            if (!coinPage.hasNextPage) break;
            cursor = coinPage.nextCursor;
        }
        
        console.error("❌ No se encontró el token IKA Oficial.");
        return null;
    }
}