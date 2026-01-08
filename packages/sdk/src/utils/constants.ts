/**
 * CONSTANTES GLOBALES DEL PROTOCOLO KINETIS
 * Centraliza direcciones, IDs de sistema y configuraciones por defecto.
 */

// --- 1. SUI SYSTEM OBJECTS ---
// El objeto Clock es necesario para todas las validaciones de tiempo en Move.
export const SUI_CLOCK_OBJECT_ID = '0x6';

// --- 2. EXTERNAL DEPENDENCIES (TESTNET) ---
// Oráculo Switchboard: Aggregator SUI/USD
// Fuente: Switchboard Official Docs / Explorer
// Nota: Este ID es fijo en Testnet, provisto por Switchboard DAO.
export const SWITCHBOARD_SUI_USD_AGGREGATOR_ID = '0x1690022350868a881855a0224449830855239a5c898c614b77f98cf4a9557476';

// --- 3. KINETIS PROTOCOL CONSTANTS ---
// Fee del protocolo cobrado por ejecución (debe coincidir con el contrato: 0.05 SUI)
// Usamos notación 'n' para BigInt en TypeScript.
export const PROTOCOL_FEE_MIST = 50_000_000n; 

// --- 4. MODULE NAMES ---
// Nombres exactos de los módulos Move para evitar errores de dedo al construir transacciones.
export const MODULES = {
    REGISTRY: 'policy_registry',
    RULES: 'policy_rules',
    FINANCE: 'financial_rules',
    EXECUTION: 'execution_layer',
    // Nota: DWallet usa librerías externas (Ika), no un módulo propio de Kinetis.
};

// --- 5. DEFAULT CONFIGURATION ---
// Configuración por defecto para arranque rápido en Testnet.
export const TESTNET_DEFAULTS = {
    // ID del contrato desplegado el [Fecha Actual]
    // Si existe la variable de entorno, la usa. Si no, usa la desplegada por defecto.
    PACKAGE_ID: process.env.KINETIS_PACKAGE_ID || '0x785d2a18f8211d2baf25bf856cbe01a2c11addd27fab2f5ff2d4f9853d4e9b49',
    
    // URLs RPC públicas recomendadas para Testnet
    RPC_URL: 'https://fullnode.testnet.sui.io:443',
};

/**
 * Helper para construir targets de Move.
 * Ejemplo: buildTarget('0x123', 'financial_rules', 'check_spend') -> '0x123::financial_rules::check_spend'
 */
export function buildTarget(packageId: string, module: string, func: string): string {
    return `${packageId}::${module}::${func}`;
}