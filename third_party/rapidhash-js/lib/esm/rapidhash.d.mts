type RapidMumBehaviour = 'fast' | 'protected';
interface RapidhashOptions {
    seed: bigint;
    rapidMumBehaviour: RapidMumBehaviour;
}
/**
 * Calculate a 64-bit hash value of the given message.
 *
 * @param message {string|Uint8Array|DataView} The message to be hashed.
 * @param options Options for modifying the hash calculation.
 * @param options.seed {bigint} 64-bit unsigned seed value.
 * @param options.rapidMumBehaviour {'fast'|'protected'} Alters behaviour of the rapid_mum function. Defaults to 'fast'.
 */
export declare function rapidhash(message: string | Uint8Array | DataView, options?: Partial<RapidhashOptions>): bigint;
/**
 * Calculate a 64-bit hash value of the given message.
 * This function is equivalent to rapidhash() with options.rapidMumBehaviour set to 'fast'.
 *
 * @param message {string|Uint8Array|DataView} The message to be hashed.
 * @param options Options for modifying the hash calculation.
 * @param options.seed {bigint} 64-bit unsigned seed value.
 */
export declare function rapidhash_fast(message: string | Uint8Array | DataView, options?: Partial<Omit<RapidhashOptions, 'rapidMumBehaviour'>>): bigint;
/**
 * Calculate a 64-bit hash value of the given message.
 * This function is equivalent to rapidhash() with options.rapidMumBehaviour set to 'protected'.
 *
 * @param message {string|Uint8Array|DataView} The message to be hashed.
 * @param options Options for modifying the hash calculation.
 * @param options.seed {bigint} 64-bit unsigned seed value.
 */
export declare function rapidhash_protected(message: string | Uint8Array | DataView, options?: Partial<Omit<RapidhashOptions, 'rapidMumBehaviour'>>): bigint;
export {};
