import * as fs from 'fs';
import * as path from 'path';
import { DATA_DIR } from './constants';

// 模型分组配置文件路径
export const MODEL_GROUPS_FILE = path.join(DATA_DIR, "model_groups.json");

/**
 * 模型信息接口
 */
export interface ModelInfo {
    name: string;          // Mã model backend (như "claude-sonnet-4-6")
    displayName?: string;  // Tên hiển thị thân thiện (như "Claude Sonnet 4.6 (Thinking)")
    resetTime: string;     // Thời gian reset
    percentage: number;    // % quota còn lại
}

/**
 * Định dạng tên model chuẩn xác, đồng bộ 100% với giao diện Antigravity IDE
 */
export function formatModelDisplayName(modelName: string): string {
    if (!modelName) return '';
    const lower = modelName.toLowerCase();

    // Claude series
    if (lower.includes('claude')) {
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
    if (lower.includes('gemini')) {
        if (lower.includes('3.8') || lower.includes('3-8')) {
            if (lower.includes('high')) return 'Gemini 3.8 Flash High';
            if (lower.includes('medium')) return 'Gemini 3.8 Flash Medium';
            if (lower.includes('low')) return 'Gemini 3.8 Flash Low';
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
    id: string;            // 分组唯一ID
    name: string;          // 分组名称 (如 "Claude", "Gemini 3 Pro")
    models: string[];      // 分组内的模型名称列表
    createdAt: number;     // 创建时间戳
    updatedAt: number;     // 更新时间戳
}

/**
 * 分组配置接口
 */
export interface ModelGroupsConfig {
    groups: ModelGroup[];
    lastAutoGrouped: number | null;  // 上次自动分组时间
}

/**
 * 模型分组管理器
 */
export class ModelGroupManager {

    /**
     * 加载分组配置
     */
    static loadGroups(): ModelGroupsConfig {
        if (!fs.existsSync(MODEL_GROUPS_FILE)) {
            return { groups: [], lastAutoGrouped: null };
        }
        try {
            return JSON.parse(fs.readFileSync(MODEL_GROUPS_FILE, 'utf8'));
        } catch (e) {
            console.error('Failed to load model groups', e);
            return { groups: [], lastAutoGrouped: null };
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
        fs.writeFileSync(MODEL_GROUPS_FILE, JSON.stringify(config, null, 2), 'utf8');
    }

    /**
     * 创建新分组
     */
    static createGroup(name: string, models: string[] = []): ModelGroup {
        const now = Date.now();
        return {
            id: `group_${now}_${Math.random().toString(36).substring(2, 8)}`,
            name,
            models,
            createdAt: now,
            updatedAt: now
        };
    }

    /**
     * 添加分组
     */
    static addGroup(config: ModelGroupsConfig, group: ModelGroup): ModelGroupsConfig {
        return {
            ...config,
            groups: [...config.groups, group]
        };
    }

    /**
     * 更新分组
     */
    static updateGroup(config: ModelGroupsConfig, groupId: string, updates: Partial<ModelGroup>): ModelGroupsConfig {
        return {
            ...config,
            groups: config.groups.map(g =>
                g.id === groupId
                    ? { ...g, ...updates, updatedAt: Date.now() }
                    : g
            )
        };
    }

    /**
     * 删除分组
     */
    static deleteGroup(config: ModelGroupsConfig, groupId: string): ModelGroupsConfig {
        return {
            ...config,
            groups: config.groups.filter(g => g.id !== groupId)
        };
    }

    /**
     * 向分组添加模型
     */
    static addModelToGroup(config: ModelGroupsConfig, groupId: string, modelName: string): ModelGroupsConfig {
        return {
            ...config,
            groups: config.groups.map(g => {
                if (g.id === groupId && !g.models.includes(modelName)) {
                    return { ...g, models: [...g.models, modelName], updatedAt: Date.now() };
                }
                return g;
            })
        };
    }

    /**
     * 从分组移除模型
     */
    static removeModelFromGroup(config: ModelGroupsConfig, groupId: string, modelName: string): ModelGroupsConfig {
        return {
            ...config,
            groups: config.groups.map(g => {
                if (g.id === groupId) {
                    return { ...g, models: g.models.filter(m => m !== modelName), updatedAt: Date.now() };
                }
                return g;
            })
        };
    }

    /**
     * Tự động phân loại model:
     * Chuẩn hóa về 2 nhóm chính: 'Claude' và 'Gemini' (hoặc 'GPT' / 'Khác' nếu có)
     */
    static extractSeriesName(modelName: string): string {
        const lowerName = modelName.toLowerCase();

        // Tất cả model Claude
        if (lowerName.includes('claude')) {
            return 'Claude';
        }

        // Tất cả model Gemini của Google
        if (lowerName.includes('gemini')) {
            return 'Gemini';
        }

        // Model GPT (nếu có)
        if (lowerName.includes('gpt')) {
            return 'GPT';
        }

        return 'Khác';
    }

    /**
     * Tự động gom nhóm chuẩn: Chỉ chia thành Claude và Gemini (hoặc GPT/Khác)
     * Toàn bộ model Claude gom vào nhóm 'Claude', toàn bộ model Gemini gom vào nhóm 'Gemini'
     */
    static autoGroup(models: ModelInfo[]): ModelGroup[] {
        const now = Date.now();
        const claudeModels: string[] = [];
        const geminiModels: string[] = [];
        const gptModels: string[] = [];
        const otherModels: string[] = [];

        for (const m of models) {
            const series = this.extractSeriesName(m.name);
            if (series === 'Claude') {
                if (!claudeModels.includes(m.name)) claudeModels.push(m.name);
            } else if (series === 'Gemini') {
                if (!geminiModels.includes(m.name)) geminiModels.push(m.name);
            } else if (series === 'GPT') {
                if (!gptModels.includes(m.name)) gptModels.push(m.name);
            } else {
                if (!otherModels.includes(m.name)) otherModels.push(m.name);
            }
        }

        const groups: ModelGroup[] = [];

        if (claudeModels.length > 0) {
            groups.push({
                id: 'group_claude',
                name: 'Claude',
                models: claudeModels,
                createdAt: now,
                updatedAt: now
            });
        }

        if (geminiModels.length > 0) {
            groups.push({
                id: 'group_gemini',
                name: 'Gemini',
                models: geminiModels,
                createdAt: now,
                updatedAt: now
            });
        }

        if (gptModels.length > 0) {
            groups.push({
                id: 'group_gpt',
                name: 'GPT',
                models: gptModels,
                createdAt: now,
                updatedAt: now
            });
        }

        if (otherModels.length > 0) {
            groups.push({
                id: 'group_other',
                name: 'Khác',
                models: otherModels,
                createdAt: now,
                updatedAt: now
            });
        }

        return groups;
    }

    /**
     * Tự động đồng bộ và cập nhật model mới từ IDE vào các nhóm:
     * - Nếu chưa có nhóm hoặc đang có các nhóm cũ phân mảnh -> Chuẩn hóa về Claude & Gemini.
     * - Nếu trong IDE xuất hiện bất kỳ model mới nào -> Tự động thêm vào nhóm Claude hoặc Gemini.
     * - Tự động lưu và trả về cấu hình nhóm cập nhật nhất.
     */
    static syncAndAutoGroupModels(models: ModelInfo[]): ModelGroupsConfig {
        if (!models || models.length === 0) {
            return this.loadGroups();
        }

        let config = this.loadGroups();
        const now = Date.now();

        // Kiểm tra xem cấu hình có đang bị phân mảnh nhóm kiểu cũ (ví dụ "Gemini 2.5 Flash", "Gemini 3 Flash", "Gemini 3.1 Pro", etc.) không
        const isFragmented = config.groups.some(g =>
            (g.name.toLowerCase().startsWith('gemini') && g.name.toLowerCase() !== 'gemini') ||
            (g.name.toLowerCase().startsWith('claude') && g.name.toLowerCase() !== 'claude') ||
            g.name.toLowerCase() === 'group1'
        );

        if (config.groups.length === 0 || isFragmented) {
            const newGroups = this.autoGroup(models);
            config = {
                groups: newGroups,
                lastAutoGrouped: now
            };
            this.saveGroups(config);
            console.log(`[ModelGroupManager] ✅ Đã tự động chuẩn hóa ${models.length} model về 2 nhóm chính: Claude và Gemini.`);
            return config;
        }

        // Kiểm tra xem có model mới nào trong IDE chưa thuộc bất kỳ nhóm nào không
        const groupedModels = this.getGroupedModels(config);
        const newModels = models.filter(m => !groupedModels.has(m.name));

        if (newModels.length > 0) {
            console.log(`[ModelGroupManager] ⚡ Phát hiện ${newModels.length} model mới từ IDE, đang tự động cập nhật:`, newModels.map(m => m.name));
            let changed = false;

            for (const model of newModels) {
                const targetSeries = this.extractSeriesName(model.name);
                let targetGroup = config.groups.find(g => g.name.toLowerCase() === targetSeries.toLowerCase());

                if (!targetGroup) {
                    targetGroup = {
                        id: `group_${targetSeries.toLowerCase()}`,
                        name: targetSeries,
                        models: [],
                        createdAt: now,
                        updatedAt: now
                    };
                    config.groups.push(targetGroup);
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

    /**
     * 获取所有已分组的模型名称
     */
    static getGroupedModels(config: ModelGroupsConfig): Set<string> {
        const grouped = new Set<string>();
        for (const group of config.groups) {
            for (const model of group.models) {
                grouped.add(model);
            }
        }
        return grouped;
    }

    /**
     * 获取未分组的模型
     */
    static getUngroupedModels(config: ModelGroupsConfig, allModels: ModelInfo[]): ModelInfo[] {
        const grouped = this.getGroupedModels(config);
        return allModels.filter(m => !grouped.has(m.name));
    }

    /**
     * 初始化默认分组
     */
    static initDefaultGroupIfNeeded(models: ModelInfo[]): ModelGroupsConfig {
        return this.syncAndAutoGroupModels(models);
    }
}

