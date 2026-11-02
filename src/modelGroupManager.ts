import * as fs from 'fs';
import * as path from 'path';
import { DATA_DIR } from './constants';

// 模型分组配置文件路径
export const MODEL_GROUPS_FILE = path.join(DATA_DIR, "model_groups.json");

/**
 * 默认预置的官方分组及其简称规则
 */
export const DEFAULT_OFFICIAL_GROUPS = [
    { pattern: /argon/i, shortName: 'Gemini Argon' },
    { pattern: /claude|3p|gpt/i, shortName: 'Claude' },
    { pattern: /gemini/i, shortName: 'Gemini' }
];

/**
 * 模型信息接口
 */
export interface ModelInfo {
    name: string;          // Mã model backend (như "claude-sonnet-4-6")
    displayName?: string;  // Tên hiển thị thân thiện (như "Claude Sonnet 4.6 (Thinking)")
    resetTime: string;     // Thời gian reset
    percentage: number;    // % quota còn lại
    has_5h?: boolean;
    weekly_percentage?: number;
    has_weekly?: boolean;
    weekly_reset_time?: string;
}

/**
 * Định dạng tên model chuẩn xác, đồng bộ 100% với giao diện Antigravity IDE
 */
export function formatModelDisplayName(modelName: string): string {
    if (!modelName) return '';
    const lower = modelName.toLowerCase();

    // Claude series
    if (lower.includes('claude')) {
        if (lower.includes('opus-5-5') || lower.includes('opus 5.5')) {
            if (lower.includes('high')) return 'Claude Opus 5.5 (High)';
            if (lower.includes('medium')) return 'Claude Opus 5.5 (Medium)';
            if (lower.includes('low')) return 'Claude Opus 5.5 (Low)';
            return 'Claude Opus 5.5';
        }
        if (lower.includes('sonnet-5-5') || lower.includes('sonnet 5.5')) {
            if (lower.includes('high')) return 'Claude Sonnet 5.5 (High)';
            if (lower.includes('medium')) return 'Claude Sonnet 5.5 (Medium)';
            if (lower.includes('low')) return 'Claude Sonnet 5.5 (Low)';
            return 'Claude Sonnet 5.5';
        }
        if (lower.includes('opus-4-6') || lower.includes('opus 4.6')) return 'Claude Opus 4.6 (Thinking)';
        if (lower.includes('sonnet-4-6') || lower.includes('sonnet 4.6')) return 'Claude Sonnet 4.6 (Thinking)';
        if (lower.includes('3.7') || lower.includes('3-7')) return 'Claude 3.7 Sonnet';
        if (lower.includes('3.5') || lower.includes('3-5')) {
            if (lower.includes('haiku')) return 'Claude 3.5 Haiku';
            return 'Claude 3.5 Sonnet';
        }
        return 'Claude';
    }

    // Gemini series
    if (lower.includes('gemini') || lower.includes('argon')) {
        if (lower.includes('argon')) {
            if (lower.includes('high')) return 'Gemini 4 Argon (High)';
            if (lower.includes('medium')) return 'Gemini 4 Argon (Medium)';
            if (lower.includes('low')) return 'Gemini 4 Argon (Low)';
            return 'Gemini 4 Argon';
        }
        if (lower.includes('4.0') || lower.includes('4-0') || lower.includes('gemini-4') || lower.includes('gemini 4')) {
            if (lower.includes('pro')) return 'Gemini 4.0 Pro';
            if (lower.includes('ultra')) return 'Gemini 4.0 Ultra';
            if (lower.includes('flash')) return 'Gemini 4.0 Flash';
            return 'Gemini 4.0';
        }
        if (lower.includes('3.8') || lower.includes('3-8')) {
            if (lower.includes('high')) return 'Gemini 3.8 Flash (High)';
            if (lower.includes('medium')) return 'Gemini 3.8 Flash (Medium)';
            if (lower.includes('low')) return 'Gemini 3.8 Flash (Low)';
            if (lower.includes('tiered')) return 'Gemini 3.8 Flash (Tiered)';
            return 'Gemini 3.8 Flash';
        }
        if (lower.includes('3.7') || lower.includes('3-7')) {
            if (lower.includes('medium')) return 'Gemini 3.7 Flash Medium';
            if (lower.includes('high')) return 'Gemini 3.7 Flash High';
            return 'Gemini 3.7 Flash';
        }
        if (lower.includes('3.6') || lower.includes('3-6')) {
            if (lower.includes('medium')) return 'Gemini 3.6 Flash Medium';
            if (lower.includes('high')) return 'Gemini 3.6 Flash High';
            return 'Gemini 3.6 Flash';
        }
        if (lower.includes('3.5') || lower.includes('3-5')) {
            if (lower.includes('medium')) return 'Gemini 3.5 Flash Medium';
            if (lower.includes('low')) return 'Gemini 3.5 Flash Low';
            return 'Gemini 3.5 Flash';
        }
        if (lower.includes('3.1') || lower.includes('3-1')) {
            if (lower.includes('pro-low') || lower.includes('pro low')) return 'Gemini 3.1 Pro Low';
            if (lower.includes('pro-high') || lower.includes('pro high')) return 'Gemini 3.1 Pro High';
            if (lower.includes('pro')) return 'Gemini 3.1 Pro';
            if (lower.includes('flash-lite')) return 'Gemini 3.1 Flash Lite';
            return 'Gemini 3.1 Flash';
        }
        if (lower.includes('gemini-3') || lower.includes('gemini 3')) {
            if (lower.includes('flash')) return 'Gemini 3 Flash';
            if (lower.includes('pro')) return 'Gemini 3 Pro';
            return 'Gemini 3';
        }
        if (lower.includes('2.5') || lower.includes('2-5')) {
            if (lower.includes('thinking')) return 'Gemini 2.5 Flash Thinking';
            if (lower.includes('lite')) return 'Gemini 2.5 Flash Lite';
            if (lower.includes('flash')) return 'Gemini 2.5 Flash';
            if (lower.includes('pro')) return 'Gemini 2.5 Pro';
            return 'Gemini 2.5';
        }
        if (lower.includes('2.0') || lower.includes('2-0')) {
            if (lower.includes('thinking')) return 'Gemini 2.0 Flash Thinking';
            if (lower.includes('flash')) return 'Gemini 2.0 Flash';
            if (lower.includes('pro')) return 'Gemini 2.0 Pro';
            return 'Gemini 2.0';
        }
        if (lower.includes('1.5') || lower.includes('1-5')) {
            if (lower.includes('flash')) return 'Gemini 1.5 Flash';
            if (lower.includes('pro')) return 'Gemini 1.5 Pro';
            return 'Gemini 1.5';
        }
        return 'Gemini';
    }

    // GPT series
    if (lower.includes('gpt')) {
        if (lower.includes('120b')) return 'GPT-OSS 120B (Medium)';
        return 'GPT';
    }

    return modelName;
}

/**
 * 模型分组接口
 */
export interface ModelGroup {
    id: string;               // 分组唯一ID
    name: string;             // 分组名称 (如 "Claude", "Gemini")
    models: string[];         // 分组内的模型名称列表
    createdAt: number;        // 创建时间戳
    updatedAt: number;        // 更新时间戳
    officialName?: string;    // 官方全称 (如 "Claude and GPT models")
    enabled?: boolean;        // 是否在状态栏显示该分组
    order?: number;           // 排序序号
    description?: string;     // 官方分组描述
}

/**
 * 分组配置接口
 */
export interface ModelGroupsConfig {
    version?: number;
    groups: ModelGroup[];
    lastAutoGrouped: number | null;  // 上次自动分组时间
}

/**
 * 模型分组管理器
 */
export class ModelGroupManager {
    static generateGroupId(officialName: string): string {
        const id = officialName.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
        return id || `group_${Date.now()}`;
    }

    static generateDefaultShortName(officialName: string): string {
        for (const rule of DEFAULT_OFFICIAL_GROUPS) {
            if (rule.pattern.test(officialName)) {
                return rule.shortName;
            }
        }
        const cleaned = officialName.replace(/\s+models$/i, '').trim();
        return cleaned || officialName;
    }

    /**
     * 加载分组配置
     */
    static loadGroups(): ModelGroupsConfig {
        if (!fs.existsSync(MODEL_GROUPS_FILE)) {
            return { version: 2, groups: [], lastAutoGrouped: null };
        }
        try {
            const raw = JSON.parse(fs.readFileSync(MODEL_GROUPS_FILE, 'utf8'));
            if (!raw.version || (Array.isArray(raw.groups) && raw.groups.some((g: any) => !g.officialName))) {
                return this.migrateOldConfig(raw);
            }
            if (Array.isArray(raw.groups)) {
                for (const g of raw.groups) {
                    if (!Array.isArray(g.models)) {
                        g.models = [];
                    }
                }
            } else {
                raw.groups = [];
            }
            return raw;
        } catch (e) {
            console.error('[ModelGroupManager] Failed to load model groups', e);
            return { version: 2, groups: [], lastAutoGrouped: null };
        }
    }

    /**
     * 保存分组配置
     */
    static saveGroups(config: ModelGroupsConfig): void {
        const dir = path.dirname(MODEL_GROUPS_FILE);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        config.version = 2;
        fs.writeFileSync(MODEL_GROUPS_FILE, JSON.stringify(config, null, 2), 'utf8');
    }

    /**
     * 旧配置升级迁移
     */
    static migrateOldConfig(oldConfig: any): ModelGroupsConfig {
        const now = Date.now();
        const existingGroups: any[] = (oldConfig && Array.isArray(oldConfig.groups)) ? oldConfig.groups : [];
        const newGroups: ModelGroup[] = [];

        const defaultGroups = [
            { officialName: 'Claude and GPT models', name: 'Claude', description: 'Models within this group: Claude Opus, Claude Sonnet, GPT-OSS' },
            { officialName: 'Gemini Models', name: 'Gemini', description: 'Models within this group: Gemini Flash, Gemini Pro' }
        ];

        let order = 1;
        for (const item of defaultGroups) {
            const matchOld = existingGroups.find(g => g.name && g.name.toLowerCase() === item.name.toLowerCase());
            newGroups.push({
                id: this.generateGroupId(item.officialName),
                officialName: item.officialName,
                name: item.name,
                models: matchOld?.models || [],
                enabled: true,
                order: order++,
                description: item.description,
                createdAt: matchOld?.createdAt || now,
                updatedAt: now
            });
        }

        const migratedConfig: ModelGroupsConfig = {
            version: 2,
            groups: newGroups,
            lastAutoGrouped: now
        };

        this.saveGroups(migratedConfig);
        return migratedConfig;
    }

    /**
     * 同步发现的模型分组 (结合 Quota Groups)
     */
    static syncDiscoveredGroups(quotaGroups: any[] | null, models: string[] = []): ModelGroupsConfig {
        const config = this.loadGroups();
        let changed = false;

        const discovered: Array<{ displayName: string; description?: string }> = [];

        if (quotaGroups && Array.isArray(quotaGroups) && quotaGroups.length > 0) {
            for (const qg of quotaGroups) {
                if (qg.displayName && !discovered.some(d => d.displayName.toLowerCase() === qg.displayName.toLowerCase())) {
                    discovered.push({ displayName: qg.displayName, description: qg.description });
                }
            }
        } else if (models && models.length > 0) {
            if (models.some(m => /claude|3p|gpt/i.test(m))) {
                discovered.push({ displayName: 'Claude and GPT models', description: 'Models within this group: Claude Opus, Claude Sonnet, GPT-OSS' });
            }
            if (models.some(m => /argon/i.test(m))) {
                discovered.push({ displayName: 'Gemini Argon', description: 'Models within this group: Gemini Argon' });
            }
            if (models.some(m => /gemini/i.test(m) && !/argon/i.test(m))) {
                discovered.push({ displayName: 'Gemini Models', description: 'Models within this group: Gemini Flash, Gemini Pro' });
            }
        }

        if (discovered.length === 0) {
            return config;
        }

        for (const item of discovered) {
            const existingIndex = config.groups.findIndex(
                g => (g.officialName && g.officialName.toLowerCase() === item.displayName.toLowerCase()) ||
                     (g.id === this.generateGroupId(item.displayName))
            );

            if (existingIndex >= 0) {
                if (!config.groups[existingIndex].description && item.description) {
                    config.groups[existingIndex].description = item.description;
                    changed = true;
                }
            } else {
                const newGroup: ModelGroup = {
                    id: this.generateGroupId(item.displayName),
                    officialName: item.displayName,
                    name: this.generateDefaultShortName(item.displayName),
                    models: [],
                    enabled: true,
                    order: config.groups.length + 1,
                    description: item.description,
                    createdAt: Date.now(),
                    updatedAt: Date.now()
                };
                config.groups.push(newGroup);
                changed = true;
            }
        }

        // Tự động phân bổ models vào groups
        if (models && models.length > 0) {
            for (const model of models) {
                const lower = model.toLowerCase();
                const isClaudeOrGpt = lower.startsWith('claude') || lower.startsWith('gpt') || lower.includes('sonnet') || lower.includes('opus');
                const isGemini = lower.startsWith('gemini') || lower.includes('gemini');

                for (const group of config.groups) {
                    if (!Array.isArray(group.models)) {
                        group.models = [];
                    }
                    const gname = (group.officialName || group.name).toLowerCase();
                    const match = isClaudeOrGpt
                        ? (gname.includes('claude') || gname.includes('gpt') || gname.includes('3p'))
                        : isGemini
                            ? (gname.includes('gemini') || (!gname.includes('claude') && !gname.includes('gpt') && !gname.includes('3p')))
                            : false;

                    if (match && !group.models.includes(model)) {
                        group.models.push(model);
                        changed = true;
                    }
                }
            }
        }

        if (changed) {
            config.lastAutoGrouped = Date.now();
            this.saveGroups(config);
        }

        return config;
    }

    static extractGroupsFromQuota(quotaData: any): Array<{ displayName: string; description?: string }> {
        if (!quotaData || quotaData.is_error) return [];
        const discovered: Array<{ displayName: string; description?: string }> = [];

        if (quotaData.quota_groups && Array.isArray(quotaData.quota_groups) && quotaData.quota_groups.length > 0) {
            for (const qg of quotaData.quota_groups) {
                if (qg.displayName && !discovered.some(d => d.displayName.toLowerCase() === qg.displayName.toLowerCase())) {
                    discovered.push({ displayName: qg.displayName, description: qg.description });
                }
            }
        } else if (quotaData.models && Array.isArray(quotaData.models) && quotaData.models.length > 0) {
            if (quotaData.models.some((m: any) => /claude|3p|gpt/i.test(m.name))) {
                discovered.push({ displayName: 'Claude and GPT models', description: 'Models within this group: Claude Opus, Claude Sonnet, GPT-OSS' });
            }
            if (quotaData.models.some((m: any) => /argon/i.test(m.name))) {
                discovered.push({ displayName: 'Gemini Argon', description: 'Models within this group: Gemini Argon' });
            }
            if (quotaData.models.some((m: any) => /gemini/i.test(m.name) && !/argon/i.test(m.name))) {
                discovered.push({ displayName: 'Gemini Models', description: 'Models within this group: Gemini Flash, Gemini Pro' });
            }
        }

        return discovered;
    }

    static resetToDefaults(discovered?: Array<{ displayName: string; description?: string }>): ModelGroupsConfig {
        const now = Date.now();
        const baseList = (discovered && discovered.length > 0) ? discovered : [
            { displayName: 'Claude and GPT models', description: 'Models: Claude Opus, Claude Sonnet, GPT-OSS' },
            { displayName: 'Gemini Models', description: 'Models: Gemini Flash, Gemini Pro' }
        ];

        let order = 1;
        const groups: ModelGroup[] = baseList.map(item => ({
            id: this.generateGroupId(item.displayName),
            officialName: item.displayName,
            name: this.generateDefaultShortName(item.displayName),
            models: [],
            enabled: true,
            order: order++,
            description: item.description,
            createdAt: now,
            updatedAt: now
        }));

        const newConfig: ModelGroupsConfig = {
            version: 2,
            groups,
            lastAutoGrouped: now
        };

        this.saveGroups(newConfig);
        return newConfig;
    }

    static createGroup(name: string, models: string[] = []): ModelGroup {
        const now = Date.now();
        return {
            id: this.generateGroupId(name),
            officialName: name,
            name: this.generateDefaultShortName(name),
            models,
            enabled: true,
            order: 999,
            createdAt: now,
            updatedAt: now
        };
    }

    static addGroup(config: ModelGroupsConfig, group: ModelGroup): ModelGroupsConfig {
        return {
            ...config,
            groups: [...config.groups, group]
        };
    }

    static updateGroup(config: ModelGroupsConfig, groupId: string, updates: Partial<ModelGroup>): ModelGroupsConfig {
        return {
            ...config,
            groups: config.groups.map(g => g.id === groupId ? { ...g, ...updates, updatedAt: Date.now() } : g)
        };
    }

    static deleteGroup(config: ModelGroupsConfig, groupId: string): ModelGroupsConfig {
        return {
            ...config,
            groups: config.groups.filter(g => g.id !== groupId)
        };
    }

    static addModelToGroup(config: ModelGroupsConfig, groupId: string, modelName: string): ModelGroupsConfig {
        return {
            ...config,
            groups: config.groups.map(g => {
                const currentModels = Array.isArray(g.models) ? g.models : [];
                if (g.id === groupId && !currentModels.includes(modelName)) {
                    return { ...g, models: [...currentModels, modelName], updatedAt: Date.now() };
                }
                return { ...g, models: currentModels };
            })
        };
    }

    static removeModelFromGroup(config: ModelGroupsConfig, groupId: string, modelName: string): ModelGroupsConfig {
        return {
            ...config,
            groups: config.groups.map(g => {
                const currentModels = Array.isArray(g.models) ? g.models : [];
                if (g.id === groupId) {
                    return { ...g, models: currentModels.filter(m => m !== modelName), updatedAt: Date.now() };
                }
                return { ...g, models: currentModels };
            })
        };
    }

    static extractSeriesName(modelName: string): string {
        const lower = modelName.toLowerCase();
        if (lower.includes('argon')) return 'Gemini Argon';
        if (lower.includes('claude')) return 'Claude';
        if (lower.includes('gemini')) return 'Gemini';
        if (lower.includes('gpt')) return 'GPT';
        return 'Khác';
    }

    static autoGroup(models: ModelInfo[]): ModelGroup[] {
        const now = Date.now();
        const argonModels = models.filter(m => m.name.toLowerCase().includes('argon')).map(m => m.name);
        const claudeModels = models.filter(m => m.name.toLowerCase().includes('claude')).map(m => m.name);
        const geminiModels = models.filter(m => m.name.toLowerCase().includes('gemini') && !m.name.toLowerCase().includes('argon')).map(m => m.name);
        const gptModels = models.filter(m => m.name.toLowerCase().includes('gpt')).map(m => m.name);
        const otherModels = models.filter(m => !m.name.toLowerCase().includes('claude') && !m.name.toLowerCase().includes('gemini') && !m.name.toLowerCase().includes('gpt') && !m.name.toLowerCase().includes('argon')).map(m => m.name);

        const groups: ModelGroup[] = [];

        if (argonModels.length > 0) {
            groups.push({
                id: 'group_gemini_argon',
                officialName: 'Gemini Argon',
                name: 'Gemini Argon',
                models: argonModels,
                enabled: true,
                order: 1,
                createdAt: now,
                updatedAt: now
            });
        }

        if (claudeModels.length > 0) {
            groups.push({
                id: 'group_claude',
                officialName: 'Claude and GPT models',
                name: 'Claude',
                models: claudeModels,
                enabled: true,
                order: groups.length + 1,
                createdAt: now,
                updatedAt: now
            });
        }

        if (geminiModels.length > 0) {
            groups.push({
                id: 'group_gemini',
                officialName: 'Gemini Models',
                name: 'Gemini',
                models: geminiModels,
                enabled: true,
                order: groups.length + 1,
                createdAt: now,
                updatedAt: now
            });
        }

        if (gptModels.length > 0) {
            groups.push({
                id: 'group_gpt',
                officialName: 'Claude and GPT models',
                name: 'GPT',
                models: gptModels,
                enabled: true,
                order: groups.length + 1,
                createdAt: now,
                updatedAt: now
            });
        }

        if (otherModels.length > 0) {
            groups.push({
                id: 'group_other',
                officialName: 'Khác',
                name: 'Khác',
                models: otherModels,
                enabled: true,
                order: groups.length + 1,
                createdAt: now,
                updatedAt: now
            });
        }

        return groups;
    }

    static syncAndAutoGroupModels(models: ModelInfo[]): ModelGroupsConfig {
        if (!models || models.length === 0) {
            return this.loadGroups();
        }

        let config = this.loadGroups();
        const now = Date.now();

        if (config.groups.length === 0) {
            const newGroups = this.autoGroup(models);
            config = {
                version: 2,
                groups: newGroups,
                lastAutoGrouped: now
            };
            this.saveGroups(config);
            return config;
        }

        const groupedModels = this.getGroupedModels(config);
        const newModels = models.filter(m => !groupedModels.has(m.name));

        if (newModels.length > 0) {
            let changed = false;
            for (const model of newModels) {
                const targetSeries = this.extractSeriesName(model.name);
                let targetGroup = config.groups.find(g => g.name.toLowerCase() === targetSeries.toLowerCase());

                if (!targetGroup) {
                    targetGroup = {
                        id: `group_${targetSeries.toLowerCase()}`,
                        officialName: targetSeries,
                        name: targetSeries,
                        models: [],
                        enabled: true,
                        order: config.groups.length + 1,
                        createdAt: now,
                        updatedAt: now
                    };
                    config.groups.push(targetGroup);
                }

                if (!Array.isArray(targetGroup.models)) {
                    targetGroup.models = [];
                }

                if (!targetGroup.models.includes(model.name)) {
                    targetGroup.models.push(model.name);
                    targetGroup.updatedAt = now;
                    changed = true;
                }
            }

            if (changed) {
                this.saveGroups(config);
            }
        }

        return config;
    }

    static getGroupedModels(config: ModelGroupsConfig): Set<string> {
        const grouped = new Set<string>();
        for (const group of config.groups) {
            for (const model of (group.models || [])) {
                grouped.add(model);
            }
        }
        return grouped;
    }

    static getUngroupedModels(config: ModelGroupsConfig, allModels: ModelInfo[]): ModelInfo[] {
        const grouped = this.getGroupedModels(config);
        return allModels.filter(m => !grouped.has(m.name));
    }

    static initDefaultGroupIfNeeded(models: ModelInfo[]): ModelGroupsConfig {
        return this.syncAndAutoGroupModels(models);
    }
}
