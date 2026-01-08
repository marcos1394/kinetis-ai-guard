import { webcrypto } from 'crypto';

export class ProofOfInference {
    
    /**
     * Genera un hash SHA-256 canónico del objeto de inferencia.
     * Esto asegura que {"a":1, "b":2} genere el mismo hash que {"b":2, "a":1}.
     * * @param llmLog - El objeto JSON crudo de OpenAI/Anthropic/DeepSeek.
     * @returns Uint8Array listo para enviar al contrato.
     */
    static async hashInference(llmLog: Record<string, any> | string): Promise<Uint8Array> {
        let canonicalString = "";

        if (typeof llmLog === 'string') {
            canonicalString = llmLog;
        } else {
            // Ordenamos las llaves alfabéticamente para determinismo
            canonicalString = JSON.stringify(llmLog, Object.keys(llmLog).sort());
        }
        
        // Codificación a Bytes
        const msgUint8 = new TextEncoder().encode(canonicalString);

        // Hashing SHA-256
        const hashBuffer = await webcrypto.subtle.digest('SHA-256', msgUint8);
        
        return new Uint8Array(hashBuffer);
    }

    /**
     * Helper para cuando no hay inferencia (ej. ejecución manual directa sin IA)
     * Retorna un hash de ceros.
     */
    static empty(): Uint8Array {
        return new Uint8Array(32); // 32 bytes de ceros
    }
}