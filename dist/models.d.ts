import type { OpenAIModel, ProviderModel } from './types.js';
export declare const REASONING_LEVELS: readonly ["none", "low", "medium", "high", "xhigh", "max"];
export declare const GPT_5_6_MODELS: readonly ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"];
export declare function fetchAvailableModels(token: string): Promise<OpenAIModel[]>;
export declare function filterGPT5Models(models: OpenAIModel[]): OpenAIModel[];
export declare function generateModelVariants(baseModels: OpenAIModel[]): Record<string, ProviderModel>;
export declare function getDefaultModels(): Record<string, ProviderModel>;
export declare function getModels(token?: string): Promise<Record<string, ProviderModel>>;
//# sourceMappingURL=models.d.ts.map