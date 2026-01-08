import { SuiClient } from '@mysten/sui/client';
import { Aggregator, SwitchboardClient } from '@switchboard-xyz/sui-sdk'; // <--- Importamos SwitchboardClient
import { SWITCHBOARD_SUI_USD_AGGREGATOR_ID } from '../utils/constants';

/**
 * Módulo de Administración de Oráculos.
 * Verifica la salud de los feeds oficiales.
 */
export class OracleSetupModule {
    private client: SuiClient;

    constructor(client: SuiClient) {
        this.client = client;
    }

    /**
     * Verifica la salud del Oráculo Oficial SUI/USD.
     */
    async checkOracleHealth(): Promise<{ 
        isHealthy: boolean; 
        price?: number; 
        lastUpdate?: Date; 
        error?: string 
    }> {
        try {
            console.log(`📡 Conectando a Oráculo Switchboard: ${SWITCHBOARD_SUI_USD_AGGREGATOR_ID}`);

            // 1. [CORRECCIÓN] Envolvemos el SuiClient en un SwitchboardClient
            const sbClient = new SwitchboardClient(this.client);

            // 2. Instanciamos el Agregador usando el sbClient
            const aggregator = new Aggregator(sbClient, SWITCHBOARD_SUI_USD_AGGREGATOR_ID);

            // 3. Cargamos la data cruda (Raw Move Struct)
            const result = await aggregator.loadData();

            // 4. [CORRECCIÓN] Parseo Manual del "Switchboard Decimal"
            // La data viene como 'latest_result' (snake_case) y es un objeto complejo.
            // Usamos 'any' temporalmente para saltar el chequeo estricto de tipos de TS
            // ya que la librería a veces tiene discrepancias en los tipos exportados.
            const rawData = result as any;

            // Accedemos a las propiedades snake_case que vienen de la blockchain
            const latestResult = rawData.latest_result || rawData.latestResult;
            const latestTimestamp = rawData.latest_timestamp || rawData.latestTimestamp;

            if (!latestResult) {
                return { isHealthy: false, error: "Oráculo vacío (Sin resultados)" };
            }

            // 5. Conversión Matemática: (value / 10^scale) * (neg ? -1 : 1)
            const value = Number(latestResult.value);
            const scale = Number(latestResult.scale);
            const neg = latestResult.neg;

            let price = value / Math.pow(10, scale);
            if (neg) price = price * -1;

            // Conversión de Timestamp
            const timestampMs = Number(latestTimestamp) * 1000;
            const lastUpdateDate = new Date(timestampMs);

            // --- Validaciones de Negocio ---

            // A. Defensa: Precio Negativo o Cero
            if (price <= 0) {
                return { isHealthy: false, price, error: "CRITICAL: Precio de Oráculo inválido (<= 0)" };
            }

            // B. Defensa: Datos Obsoletos (Stale Data > 10 min)
            const now = Date.now();
            const timeDiff = now - timestampMs;
            const STALE_THRESHOLD_MS = 10 * 60 * 1000;

            if (timeDiff > STALE_THRESHOLD_MS) {
                console.warn(`⚠️ ALERTA: Datos de oráculo antiguos. Última act: ${lastUpdateDate.toISOString()}`);
            }

            return { 
                isHealthy: true, 
                price: price, 
                lastUpdate: lastUpdateDate 
            };

        } catch (error: any) {
            console.error("❌ Error leyendo Switchboard:", error);
            return { 
                isHealthy: false, 
                error: error.message || "Error de conexión con el Oráculo" 
            };
        }
    }

    getAggregatorId(): string {
        return SWITCHBOARD_SUI_USD_AGGREGATOR_ID;
    }
}