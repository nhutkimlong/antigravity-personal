import * as fs from 'fs';
import * as path from 'path';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const initSqlJs = require('sql.js');
import {
    getVSCDBPath,
    getActiveDbPaths,
    CLI_SESSION_PATH,
    DB_KEY_AGENT_STATE,
    DB_KEY_ONBOARDING
} from './constants';
import { encodeVarint } from './utils';

// sql.js WASM 初始化（单例，避免多次加载）
let sqlJsPromise: Promise<any> | null = null;
function getSqlJs() {
    if (!sqlJsPromise) {
        sqlJsPromise = initSqlJs();
    }
    return sqlJsPromise;
}

/**
 * 使用 sql.js (纯 WASM) 代替 sqlite3 原生模块
 * 彻底避免 Electron ABI 版本不兼容的问题
 */
export class DBManager {
    static resolveDbPath(dbPath?: string): string {
        return dbPath && dbPath.trim() ? dbPath.trim() : getVSCDBPath();
    }

    static resolveDbPaths(dbPaths?: string | string[]): string[] {
        if (Array.isArray(dbPaths)) {
            const filtered = dbPaths.map(p => p.trim()).filter(p => !!p);
            return filtered.length > 0 ? filtered : getActiveDbPaths();
        }
        if (dbPaths && dbPaths.trim()) {
            return [dbPaths.trim()];
        }
        return getActiveDbPaths();
    }

    /**
     * 打开数据库文件并返回 sql.js Database 实例
     */
    private static async openDb(dbPath: string): Promise<any> {
        const SQL = await getSqlJs();
        const buffer = await fs.promises.readFile(dbPath);
        return new SQL.Database(buffer);
    }

    /**
     * 将 sql.js Database 实例写回磁盘
     */
    private static saveDb(db: any, dbPath: string) {
        const data = db.export();
        const buffer = Buffer.from(data);
        fs.writeFileSync(dbPath, buffer);
    }

    /**
     * 对单个或多个数据库注入 Token，实现 Antigravity IDE 与 Desktop/Tools 2.6+ 智能同步
     */
    static async injectToken(accessToken: string, refreshToken: string, expiry: number, email: string, dbPath?: string | string[]) {
        const targetPaths = this.resolveDbPaths(dbPath);
        let injectedCount = 0;
        let lastError: any = null;

        for (const targetPath of targetPaths) {
            try {
                await this.injectTokenToSingleDb(accessToken, refreshToken, expiry, email, targetPath);
                injectedCount++;
            } catch (err) {
                lastError = err;
                console.error(`[DBManager] Failed to inject token into ${targetPath}:`, err);
            }
        }

        // Đồng bộ thêm vào jetski-standalone-oauth-token nếu thư mục .gemini tồn tại
        try {
            if (CLI_SESSION_PATH && fs.existsSync(path.dirname(CLI_SESSION_PATH))) {
                const cliPayload = JSON.stringify({
                    access_token: accessToken,
                    refresh_token: refreshToken,
                    expiry: expiry,
                    email: email
                }, null, 2);
                fs.writeFileSync(CLI_SESSION_PATH, cliPayload, 'utf-8');
            }
        } catch (cliErr) {
            console.warn('[DBManager] Failed to write CLI session file:', cliErr);
        }

        if (injectedCount === 0 && lastError) {
            throw lastError;
        }
    }

    static async injectTokenToSingleDb(accessToken: string, refreshToken: string, expiry: number, email: string, resolvedDbPath: string) {
        if (!fs.existsSync(resolvedDbPath)) {
            throw new Error(`Database not found at ${resolvedDbPath}`);
        }

        // Backup
        const backupPath = resolvedDbPath + '.backup';
        fs.copyFileSync(resolvedDbPath, backupPath);

        let db: any = null;
        try {
            db = await this.openDb(resolvedDbPath);
            const KEY_OLD = DB_KEY_AGENT_STATE;
            const KEY_NEW = "antigravityUnifiedStateSync.oauthToken";
            const KEY_ONBOARD = DB_KEY_ONBOARDING;

            // 1. 新格式注入 (oauthToken)
            try {
                const oauthInfo = this.createOAuthInfo(accessToken, refreshToken, expiry);
                const oauthTokenB64 = this.createUnifiedStateEntry("oauthTokenInfoSentinelKey", oauthInfo);
                db.run("INSERT OR REPLACE INTO ItemTable (key, value) VALUES (?, ?)", [KEY_NEW, oauthTokenB64]);
            } catch (e) {
                console.error('New format injection failed', e);
            }

            // 2. 注入 userStatus (Antigravity 2.6+ 认证链路强依赖)
            try {
                const userStatusPayload = this.createMinimalUserStatusPayload(email);
                const userStatusB64 = this.createUnifiedStateEntry("userStatusSentinelKey", userStatusPayload);
                db.run("INSERT OR REPLACE INTO ItemTable (key, value) VALUES (?, ?)", ["antigravityUnifiedStateSync.userStatus", userStatusB64]);
            } catch (e) {
                console.error('UserStatus injection failed', e);
            }

            // 3. 彻底删除旧版 agentManagerInitState，防止 IDE 读取到残留的陈旧 UserID 导致状态冲突
            try {
                db.run("DELETE FROM ItemTable WHERE key = ?", [KEY_OLD]);
            } catch (e) {
                console.error('Delete old state failed', e);
            }

            // 4. Onboarding 标记
            db.run("INSERT OR REPLACE INTO ItemTable (key, value) VALUES (?, ?)", [KEY_ONBOARD, "true"]);

            // 5. 擦除旧账号可能残留的临时认证状态，迫使 IDE 启动时使用新注入的凭据触发拉取
            db.run("DELETE FROM ItemTable WHERE key = ?", ["antigravityAuthStatus"]);

            // 写回磁盘
            this.saveDb(db, resolvedDbPath);
        } finally {
            db?.close();
        }
    }

    private static encodeLenDelim(fieldNum: number, data: Buffer): Buffer {
        const tag = (fieldNum << 3) | 2;
        return Buffer.concat([encodeVarint(tag), encodeVarint(data.length), data]);
    }

    private static encodeStringField(fieldNum: number, value: string): Buffer {
        return this.encodeLenDelim(fieldNum, Buffer.from(value, 'utf-8'));
    }

    private static createOAuthInfo(accessToken: string, refreshToken: string, expiry: number): Buffer {
        const f1 = this.encodeStringField(1, accessToken);
        const f2 = this.encodeStringField(2, "Bearer");
        const f3 = this.encodeStringField(3, refreshToken);
        const timestampTag = (1 << 3) | 0;
        const timestampMsg = Buffer.concat([encodeVarint(timestampTag), encodeVarint(expiry)]);
        const f4 = this.encodeLenDelim(4, timestampMsg);
        return Buffer.concat([f1, f2, f3, f4]);
    }

    private static createEmailField(email: string): Buffer {
        return this.encodeStringField(2, email);
    }

    private static createMinimalUserStatusPayload(email: string): Buffer {
        return Buffer.concat([
            this.encodeStringField(3, email),
            this.encodeStringField(7, email)
        ]);
    }

    private static createUnifiedStateEntry(sentinelKey: string, payload: Buffer): string {
        const payloadB64 = payload.toString('base64');
        const inner2 = this.encodeStringField(1, payloadB64);
        const inner1 = this.encodeStringField(1, sentinelKey);
        const inner = Buffer.concat([inner1, this.encodeLenDelim(2, inner2)]);
        const outer = this.encodeLenDelim(1, inner);
        return outer.toString('base64');
    }

    static async readFullTokenInfo(dbPath?: string | string[]): Promise<{ access_token: string, refresh_token: string, expiry: number, email?: string } | null> {
        const paths = this.resolveDbPaths(dbPath);

        for (const p of paths) {
            if (fs.existsSync(p)) {
                const res = await this.readFullTokenInfoFromSingleDb(p);
                if (res) {
                    return res;
                }
            }
        }

        // Fallback: đọc trực tiếp từ jetski-standalone-oauth-token
        try {
            if (CLI_SESSION_PATH && fs.existsSync(CLI_SESSION_PATH)) {
                const content = fs.readFileSync(CLI_SESSION_PATH, 'utf-8');
                const parsed = JSON.parse(content);
                if (parsed && parsed.access_token && parsed.refresh_token) {
                    return {
                        access_token: parsed.access_token,
                        refresh_token: parsed.refresh_token,
                        expiry: parsed.expiry || 0,
                        email: parsed.email
                    };
                }
            }
        } catch (cliErr) {
            // ignore
        }

        return null;
    }

    static async readFullTokenInfoFromSingleDb(resolvedDbPath: string): Promise<{ access_token: string, refresh_token: string, expiry: number } | null> {
        if (!fs.existsSync(resolvedDbPath)) {
            return null;
        }

        let db: any = null;
        try {
            db = await this.openDb(resolvedDbPath);
            const KEY_NEW = "antigravityUnifiedStateSync.oauthToken";
            const stmt = db.prepare("SELECT value FROM ItemTable WHERE key = ?");
            stmt.bind([KEY_NEW]);

            if (!stmt.step()) {
                stmt.free();
                return null;
            }

            const row = stmt.getAsObject();
            stmt.free();

            if (!row || !row.value) {
                return null;
            }

            // 1. 外层
            const outerProto = Buffer.from(row.value as string, 'base64');

            // 强力防溢出无符号整型读取
            const readVarint = (buf: Buffer, off: number): [number, number] => {
                let res = 0, shift = 0;
                const startOff = off;
                while (off < buf.length) {
                    const b = buf[off++];
                    // 使用无符号整型操作防溢出为负数
                    res = (res + ((b & 0x7F) << shift)) >>> 0;
                    if (!(b & 0x80)) break;
                    shift += 7;
                    if (off - startOff > 10) {
                        break; // 防 varint 本身死循环
                    }
                }
                return [res, off];
            };

            // 2. 寻找 Inner (新版在 field 2，老版在 field 1)
            let innerProto: Buffer | null = null;
            let offset = 0;
            let iterations = 0;

            while (offset < outerProto.length) {
                iterations++;
                if (iterations > 1000) {
                    console.warn('[Cockpit] 第一层循环触发安全阈值，强退。');
                    break;
                }

                const [tag, off1] = readVarint(outerProto, offset);
                const wire = tag & 7;
                const fieldNum = tag >> 3;

                if (fieldNum === 1 || fieldNum === 2) {
                    const [len, off2] = readVarint(outerProto, off1);
                    const subBuf = outerProto.subarray(off2, off2 + len);
                    
                    // 检查子 Buffer 中是否包含 'oauthTokenInfoSentinelKey'，若包含则是我们需要的目标子协议
                    if (subBuf.toString('utf-8').includes('oauthTokenInfoSentinelKey')) {
                        innerProto = subBuf;
                        break;
                    }
                    
                    // 正常步进
                    if (wire === 2) {
                        offset = off2 + len;
                    } else if (wire === 0) {
                        offset = off2;
                    } else {
                        offset = off1 + 8;
                    }
                } else {
                    if (wire === 2) {
                        const [len, off2] = readVarint(outerProto, off1);
                        offset = off2 + len;
                    } else if (wire === 0) {
                        const [, off2] = readVarint(outerProto, off1);
                        offset = off2;
                    } else {
                        offset = off1 + 8;
                    }
                }
            }

            if (!innerProto) {
                return null;
            }

            // 3. 寻找 B64_OAuthInfo (Field 2)
            let oauthInfoB64Str: string | null = null;
            offset = 0;
            iterations = 0;
            while (offset < innerProto.length) {
                iterations++;
                if (iterations > 1000) {
                    console.warn('[Cockpit] 第二层循环触发安全阈值，强退。');
                    break;
                }

                const [tag, off1] = readVarint(innerProto, offset);
                const fieldNum = tag >> 3;
                const wire = tag & 7;

                if (fieldNum === 2) {
                    const [len, off2] = readVarint(innerProto, off1);
                    oauthInfoB64Str = innerProto.subarray(off2, off2 + len).toString('utf-8');
                    break;
                } else {
                    if (wire === 2) {
                        const [len, off2] = readVarint(innerProto, off1);
                        offset = off2 + len;
                    } else {
                        offset++;
                    }
                }
            }

            if (!oauthInfoB64Str) {
                return null;
            }

            // 4. 解析明文 OAuthInfo
            const oauthInfo = Buffer.from(oauthInfoB64Str, 'base64');
            let accessToken: string | null = null;
            let refreshToken: string | null = null;
            let expiry = 0;

            offset = 0;
            iterations = 0;
            while (offset < oauthInfo.length) {
                iterations++;
                if (iterations > 1000) {
                    console.warn('[Cockpit] 第三层循环触发安全阈值，强退。');
                    break;
                }

                const [tag, off1] = readVarint(oauthInfo, offset);
                const fieldNum = tag >> 3;
                const wire = tag & 7;

                if (fieldNum === 1) { // Access Token
                    const [len, off2] = readVarint(oauthInfo, off1);
                    accessToken = oauthInfo.subarray(off2, off2 + len).toString('utf-8');
                    offset = off2 + len;
                } else if (fieldNum === 3) { // Refresh Token
                    const [len, off2] = readVarint(oauthInfo, off1);
                    refreshToken = oauthInfo.subarray(off2, off2 + len).toString('utf-8');
                    offset = off2 + len;
                } else if (fieldNum === 4) { // Expiry (Timestamp)
                    const [len, off2] = readVarint(oauthInfo, off1);
                    const timeBuf = oauthInfo.subarray(off2, off2 + len);
                    let toff = 0;
                    while (toff < timeBuf.length) {
                        const [tTag, tOff1] = readVarint(timeBuf, toff);
                        const tField = tTag >> 3;
                        if (tField === 1) {
                            const [val, tOff2] = readVarint(timeBuf, tOff1);
                            expiry = val;
                            toff = tOff2;
                        } else {
                            toff++;
                        }
                    }
                    offset = off2 + len;
                } else {
                    if (wire === 2) {
                        const [len, off2] = readVarint(oauthInfo, off1);
                        offset = off2 + len;
                    } else {
                        offset++;
                    }
                }
            }

            if (accessToken && refreshToken) {
                return {
                    access_token: accessToken,
                    refresh_token: refreshToken,
                    expiry: expiry
                };
            }

            return null;
        } catch (e) {
            console.error('Failed to read new token format from ' + resolvedDbPath, e);
            return null;
        } finally {
            db?.close();
        }
    }

    /**
     * 读取 Antigravity 当前登录状态 (antigravityAuthStatus)
     * 支持多数据库探测，优先返回最近更新的数据库中的登录状态
     */
    static async readAuthStatus(dbPath?: string | string[]): Promise<{
        state: 'authenticated' | 'logged_out' | 'missing';
        email?: string;
        name?: string;
        apiKey?: string;
    }> {
        const paths = this.resolveDbPaths(dbPath);
        // 按修改时间降序排序（优先检查最近变动的数据库）
        const sortedPaths = paths.filter(p => fs.existsSync(p)).sort((a, b) => {
            try {
                return fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs;
            } catch {
                return 0;
            }
        });

        if (sortedPaths.length === 0) {
            return { state: 'missing' };
        }

        let sawLoggedOut = false;
        for (const p of sortedPaths) {
            const res = await this.readSingleDbAuthStatus(p);
            if (res.state === 'authenticated') {
                return res;
            }
            if (res.state === 'logged_out') {
                sawLoggedOut = true;
            }
        }

        return sawLoggedOut ? { state: 'logged_out' } : { state: 'missing' };
    }

    private static async readSingleDbAuthStatus(resolvedDbPath: string): Promise<{
        state: 'authenticated' | 'logged_out' | 'missing';
        email?: string;
        name?: string;
        apiKey?: string;
    }> {
        if (!fs.existsSync(resolvedDbPath)) {
            return { state: 'missing' };
        }

        let db: any = null;
        try {
            db = await this.openDb(resolvedDbPath);
            const stmt = db.prepare("SELECT value FROM ItemTable WHERE key = ?");
            stmt.bind(["antigravityAuthStatus"]);

            if (!stmt.step()) {
                stmt.free();
                return { state: 'missing' };
            }

            const row = stmt.getAsObject();
            stmt.free();

            if (!row || !row.value) {
                return { state: 'missing' };
            }

            const rawValue = String(row.value).trim();
            if (!rawValue || rawValue === 'null') {
                return { state: 'logged_out' };
            }

            const parsed = JSON.parse(rawValue);
            if (!parsed || !parsed.email) {
                return { state: 'logged_out' };
            }

            return {
                state: 'authenticated',
                email: parsed.email,
                name: parsed.name,
                apiKey: parsed.apiKey
            };
        } catch (e) {
            console.error('Failed to read auth status from DB ' + resolvedDbPath, e);
            return { state: 'missing' };
        } finally {
            db?.close();
        }
    }

    private static createOAuthField(accessToken: string, refreshToken: string, expiry: number): Buffer {
        const f1 = this.encodeStringField(1, accessToken);
        const f2 = this.encodeStringField(2, "Bearer");
        const f3 = this.encodeStringField(3, refreshToken);
        const timestampTag = (1 << 3) | 0;
        const timestampMsg = Buffer.concat([encodeVarint(timestampTag), encodeVarint(expiry)]);
        const f4 = this.encodeLenDelim(4, timestampMsg);
        const inner = Buffer.concat([f1, f2, f3, f4]);
        return this.encodeLenDelim(6, inner);
    }
}
