export declare function isDebugEnvOverrideActive(): boolean;
export declare function isDebugEnabled(): boolean;
export declare function formatDebugValue(value: unknown): string;
export declare function logInfo(message: string): void;
export declare function logWarn(message: string): void;
export declare function logError(message: string): void;
export declare function logDebug(message: string, enabled?: boolean): void;
export declare function logDebugValue(label: string, value: unknown, enabled?: boolean): void;
export declare function getLogPath(): string;
export declare function readLogTail(maxLines?: number): string[];
//# sourceMappingURL=logger.d.ts.map