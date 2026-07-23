const MODELS_ENDPOINT = 'https://api.openai.com/v1/models';
export const REASONING_LEVELS = ['none', 'low', 'medium', 'high', 'xhigh', 'max'];
export const GPT_5_6_MODELS = [
    'gpt-5.6-sol',
    'gpt-5.6-terra',
    'gpt-5.6-luna'
];
const MODEL_LIMITS = {
    'gpt-5.6-sol': { context: 1_050_000, input: 922_000, output: 128_000 },
    'gpt-5.6-luna': { context: 1_050_000, input: 922_000, output: 128_000 },
    'gpt-5.6-terra': { context: 1_050_000, input: 922_000, output: 128_000 },
    'gpt-5.5': { context: 530000, input: 400000, output: 130000 },
    'gpt-5.4': { context: 1050000, input: 922000, output: 128000 },
    'gpt-5.3': { context: 272000, output: 128000 },
    'gpt-5.3-codex-spark': { context: 272000, output: 128000 },
    'gpt-5.2': { context: 272000, output: 128000 },
    'gpt-5.3-codex': { context: 272000, output: 128000 },
    'gpt-5.2-codex': { context: 272000, output: 128000 },
    'gpt-5.1': { context: 272000, output: 128000 },
    'gpt-5.1-codex': { context: 272000, output: 128000 },
    'gpt-5.1-codex-max': { context: 272000, output: 128000 },
    'gpt-5.1-codex-mini': { context: 272000, output: 128000 },
};
function getModelLimits(modelId) {
    for (const [prefix, limits] of Object.entries(MODEL_LIMITS)) {
        if (modelId.startsWith(prefix))
            return limits;
    }
    return { context: 128000, output: 32000 };
}
function isGPT56Family(baseId) {
    return baseId.startsWith('gpt-5.6-');
}
function buildReasoningOptions(level) {
    // OpenAI names its strongest effort "xhigh"; expose "max" as an OpenCode alias.
    const reasoningEffort = level === 'max' ? 'xhigh' : level;
    return {
        reasoningEffort,
        reasoningSummary: reasoningEffort === 'high' || reasoningEffort === 'xhigh' ? 'detailed' : 'auto',
        textVerbosity: 'medium',
        include: ['reasoning.encrypted_content'],
        store: false
    };
}
function supportsFastMode(baseId) {
    return isGPT56Family(baseId) || baseId === 'gpt-5.5' || baseId === 'gpt-5.4';
}
function getReasoningLevels(baseId) {
    if (isGPT56Family(baseId))
        return REASONING_LEVELS;
    if (baseId === 'gpt-5.1-codex-mini')
        return ['medium', 'high'];
    if (baseId === 'gpt-5.1-codex')
        return ['low', 'medium', 'high'];
    if (baseId === 'gpt-5.1')
        return ['none', 'low', 'medium', 'high'];
    if (baseId.includes('codex'))
        return ['low', 'medium', 'high', 'xhigh'];
    return ['none', 'low', 'medium', 'high', 'xhigh'];
}
function buildProviderModel(baseId) {
    const variants = Object.fromEntries(getReasoningLevels(baseId).map((level) => [level, buildReasoningOptions(level)]));
    if (supportsFastMode(baseId)) {
        variants.fast = {
            ...buildReasoningOptions('medium'),
            serviceTier: 'priority'
        };
    }
    return {
        name: `${baseId} (OAuth)`,
        reasoning: true,
        limit: getModelLimits(baseId),
        modalities: {
            input: ['text', 'image'],
            output: ['text']
        },
        options: buildReasoningOptions('medium'),
        variants
    };
}
export async function fetchAvailableModels(token) {
    try {
        const res = await fetch(MODELS_ENDPOINT, {
            headers: { Authorization: `Bearer ${token}` }
        });
        if (!res.ok) {
            console.error(`[multi-auth] Failed to fetch models: ${res.status}`);
            return [];
        }
        const data = (await res.json());
        return data.data || [];
    }
    catch (err) {
        console.error('[multi-auth] Error fetching models:', err);
        return [];
    }
}
export function filterGPT5Models(models) {
    return models.filter(m => m.id.match(/^gpt-5/));
}
export function generateModelVariants(baseModels) {
    const result = {};
    for (const model of baseModels) {
        const baseId = model.id;
        result[baseId] = buildProviderModel(baseId);
    }
    return result;
}
export function getDefaultModels() {
    const defaults = [
        ...GPT_5_6_MODELS,
        'gpt-5.5',
        'gpt-5.4',
        'gpt-5.3',
        'gpt-5.3-codex-spark',
        'gpt-5.3-codex',
        'gpt-5.2',
        'gpt-5.2-codex',
        'gpt-5.1',
        'gpt-5.1-codex',
        'gpt-5.1-codex-max',
        'gpt-5.1-codex-mini'
    ];
    const result = {};
    for (const baseId of defaults) {
        result[baseId] = buildProviderModel(baseId);
    }
    return result;
}
let cachedModels = null;
let cacheExpiry = 0;
export async function getModels(token) {
    const now = Date.now();
    const CACHE_TTL = 60 * 60 * 1000;
    if (cachedModels && now < cacheExpiry) {
        return cachedModels;
    }
    if (token) {
        const fetched = await fetchAvailableModels(token);
        const gpt5 = filterGPT5Models(fetched);
        if (gpt5.length > 0) {
            cachedModels = generateModelVariants(gpt5);
            cacheExpiry = now + CACHE_TTL;
            return cachedModels;
        }
    }
    cachedModels = getDefaultModels();
    cacheExpiry = now + CACHE_TTL;
    return cachedModels;
}
//# sourceMappingURL=models.js.map