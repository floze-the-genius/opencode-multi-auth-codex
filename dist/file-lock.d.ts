export declare function acquireFileLock(targetFile: string): () => void;
export declare function withFileLock<T>(targetFile: string, fn: () => T): T;
//# sourceMappingURL=file-lock.d.ts.map