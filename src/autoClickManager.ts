import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import * as http from 'http';
import * as url from 'url';
import { execSync, execFile } from 'child_process';

const TAG_START = '<!-- AG-AUTO-CLICK-SCROLL-START -->';
const TAG_END = '<!-- AG-AUTO-CLICK-SCROLL-END -->';

function escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function writeFileElevated(filePath: string, content: string): void {
    try {
        fs.writeFileSync(filePath, content, 'utf8');
    } catch (err: any) {
        if (err.code !== 'EACCES' && err.code !== 'EPERM') {
            throw err;
        }

        const tmpPath = path.join(os.tmpdir(), 'ag-auto-' + Date.now() + '.tmp');
        fs.writeFileSync(tmpPath, content, 'utf8');

        try {
            if (process.platform === 'linux') {
                execSync(`pkexec bash -c "cp '${tmpPath}' '${filePath}' && chmod 644 '${filePath}'"`, { timeout: 30000 });
                console.log('[AG Auto] ✅ Elevated write (pkexec) →', path.basename(filePath));
            } else if (process.platform === 'darwin') {
                const cmd = `cp '${tmpPath}' '${filePath}' && chmod 644 '${filePath}'`;
                execSync(`osascript -e 'do shell script "${cmd}" with administrator privileges'`, { timeout: 30000 });
                console.log('[AG Auto] ✅ Elevated write (osascript) →', path.basename(filePath));
            } else {
                throw err;
            }
        } catch (elevErr: any) {
            try { fs.unlinkSync(tmpPath); } catch (_) { }
            if (elevErr === err) {
                throw err;
            }
            console.error('[AG Auto] Elevation failed:', elevErr.message);
            throw new Error(`Permission denied. On Linux/macOS try running with elevated permissions.`);
        }

        try { fs.unlinkSync(tmpPath); } catch (_) { }
    }
}

function findFileRecursive(dir: string, filename: string, maxDepth: number): string | null {
    if (maxDepth <= 0) return null;
    try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isFile() && entry.name === filename) return fullPath;
            if (entry.isDirectory()) {
                const result = findFileRecursive(fullPath, filename, maxDepth - 1);
                if (result) return result;
            }
        }
    } catch (_) { }
    return null;
}

export function getWorkbenchPath(): string | null {
    const appRoot = vscode.env.appRoot;
    const candidates = [
        path.join(appRoot, 'out', 'vs', 'code', 'electron-browser', 'workbench', 'workbench.html'),
        path.join(appRoot, 'out', 'vs', 'code', 'electron-sandbox', 'workbench', 'workbench.html'),
        path.join(appRoot, 'out', 'vs', 'workbench', 'workbench.html'),
        path.join(appRoot, 'out', 'vs', 'code', 'browser', 'workbench', 'workbench.html'),
        path.join(appRoot, 'out', 'vs', 'code', 'electron-main', 'workbench', 'workbench.html'),
    ];
    for (const p of candidates) {
        if (fs.existsSync(p)) return p;
    }
    const outDir = path.join(appRoot, 'out');
    return findFileRecursive(outDir, 'workbench.html', 6);
}

export class AutoClickManager {
    private static _extensionContext: vscode.ExtensionContext | null = null;
    private static _settingsPanel: vscode.WebviewPanel | null = null;
    private static _statusBarAccept: vscode.StatusBarItem | null = null;
    private static _statusBarScroll: vscode.StatusBarItem | null = null;

    private static _autoAcceptEnabled = true;
    private static _httpScrollEnabled = true;
    private static _httpClickPatterns: string[] = [];
    private static _httpScrollConfig = { pauseScrollMs: 5000, scrollIntervalMs: 500, clickIntervalMs: 2000 };
    private static _clickStats: Record<string, number> = {};
    private static _clickLog: Array<{ time: string; pattern: string; button: string }> = [];
    private static _totalClicks = 0;
    private static _resetStatsRequested = false;

    private static _httpServer: http.Server | null = null;
    private static AG_HTTP_PORT_START = 48787;
    private static AG_HTTP_PORT_END = 48850;
    private static _actualPort = 0;

    private static _autoAcceptInterval: NodeJS.Timeout | null = null;
    private static CHAT_ACCEPT_COMMANDS = [
        'antigravity.agent.acceptAgentStep',
        'antigravity.terminalCommand.accept'
    ];

    public static activate(context: vscode.ExtensionContext): void {
        this._extensionContext = context;
        console.log('[AG Auto] AutoClickManager activating...');

        const cfg = vscode.workspace.getConfiguration('ag-auto');
        // Luôn đảm bảo Auto Accept tự động BẬT (ON) mỗi khi khởi động lại extension hoặc reload window
        if (!cfg.get<boolean>('enabled', true)) {
            cfg.update('enabled', true, vscode.ConfigurationTarget.Global);
        }
        this._autoAcceptEnabled = true;
        this._httpScrollEnabled = cfg.get<boolean>('scrollEnabled', true);
        const configPatterns = cfg.get<string[]>('clickPatterns', [
            'Allow', 'Always Allow', 'Allow Once', 'Run', 'Run in Terminal', 'Run Command', 'Keep Waiting',
            'Accept', 'Accept all', 'Proceed', 'Continue', 'Retry', 'Submit', 'Confirm',
            'Cho phép', 'Luôn cho phép', 'Chạy', 'Tiếp tục', 'Thử lại', 'Chấp nhận', 'Chấp thuận', 'Đồng ý', 'Xác nhận'
        ]);
        const disabledPatterns = context.globalState.get<string[]>('disabledClickPatterns', []);
        this._httpClickPatterns = configPatterns.filter(p => !disabledPatterns.includes(p));
        if (!disabledPatterns.includes('Submit') && !this._httpClickPatterns.includes('Submit')) {
            this._httpClickPatterns.push('Submit');
        }

        // Restore stats
        this._clickStats = context.globalState.get('clickStats', {});
        this._totalClicks = context.globalState.get('totalClicks', 0);
        const storedLog = context.globalState.get('clickLog', []);
        if (storedLog && storedLog.length > 0) {
            this._clickLog = storedLog;
        }

        // Background Keep Waiting dialog clicker for Windows
        if (process.platform === 'win32') {
            const keepWaitingScript = `
Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class AgWin32 {
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr hwnd, EnumWindowsProc cb, IntPtr lParam);
    [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder s, int n);
    [DllImport("user32.dll")] public static extern int GetClassName(IntPtr hWnd, StringBuilder s, int n);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hWnd, uint Msg, IntPtr w, IntPtr l);
}
"@
$global:clicked = $false
[AgWin32]::EnumWindows({
    param($hWnd, $lp)
    if (-not [AgWin32]::IsWindowVisible($hWnd)) { return $true }
    if ($global:clicked) { return $false }
    [AgWin32]::EnumChildWindows($hWnd, {
        param($ch, $lp2)
        $cls = New-Object System.Text.StringBuilder 64
        [AgWin32]::GetClassName($ch, $cls, 64) | Out-Null
        if ($cls.ToString() -eq 'Button') {
            $txt = New-Object System.Text.StringBuilder 256
            [AgWin32]::GetWindowText($ch, $txt, 256) | Out-Null
            $t = $txt.ToString()
            if ($t -match 'Keep Waiting') {
                [AgWin32]::PostMessage($ch, 0x00F5, [IntPtr]::Zero, [IntPtr]::Zero)
                $global:clicked = $true
            }
        }
        return $true
    }, [IntPtr]::Zero) | Out-Null
    if ($global:clicked) { return $false }
    return $true
}, [IntPtr]::Zero) | Out-Null
if ($global:clicked) { Write-Output 'CLICKED' }
`.trim();

            const keepWaitingInterval = setInterval(() => {
                if (!this._autoAcceptEnabled) return;
                if (!this._httpClickPatterns.includes('Keep Waiting')) return;

                execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', keepWaitingScript], { timeout: 5000 }, (_err, stdout) => {
                    if (stdout && stdout.trim() === 'CLICKED') {
                        console.log('[AG Auto] 🎯 Native dialog: Keep Waiting clicked via Win32');
                        this._totalClicks++;
                        if (!this._clickStats['Keep Waiting']) this._clickStats['Keep Waiting'] = 0;
                        this._clickStats['Keep Waiting']++;
                        if (this._extensionContext) {
                            this._extensionContext.globalState.update('clickStats', this._clickStats);
                            this._extensionContext.globalState.update('totalClicks', this._totalClicks);
                        }
                    }
                });
            }, 3000);
            context.subscriptions.push({ dispose: () => clearInterval(keepWaitingInterval) });
        }

        // Tự động phát hiện khi Antigravity cập nhật phiên bản mới và tự động re-inject script hoàn toàn tự động từ A-Z
        this.checkAndAutoInjectOnUpdate(context);

        // Khởi động trình giám sát ngầm theo thời gian thực (realtime watcher)
        this.startBackgroundIntegrityWatcher(context);

        // Start services
        this.startHttpServer();
        this.startCommandsLoop();
        this.writeConfigJson(context);

        // Status bar
        this.createStatusBarItem(context);

        // Listen for config changes
        context.subscriptions.push(
            vscode.workspace.onDidChangeConfiguration(e => {
                if (e.affectsConfiguration('ag-auto')) {
                    const cfg = vscode.workspace.getConfiguration('ag-auto');
                    this._autoAcceptEnabled = cfg.get<boolean>('enabled', true);
                    this._httpScrollEnabled = cfg.get<boolean>('scrollEnabled', true);
                    const configPatterns = cfg.get<string[]>('clickPatterns', [
                        'Allow', 'Always Allow', 'Allow Once', 'Run', 'Run in Terminal', 'Run Command', 'Keep Waiting',
                        'Accept', 'Accept all', 'Proceed', 'Continue', 'Retry', 'Submit', 'Confirm',
                        'Cho phép', 'Luôn cho phép', 'Chạy', 'Tiếp tục', 'Thử lại', 'Chấp nhận', 'Chấp thuận', 'Đồng ý', 'Xác nhận'
                    ]);
                    const disabledPatterns = context.globalState.get<string[]>('disabledClickPatterns', []);
                    this._httpClickPatterns = configPatterns.filter(p => !disabledPatterns.includes(p));
                    if (!disabledPatterns.includes('Submit') && !this._httpClickPatterns.includes('Submit')) {
                        this._httpClickPatterns.push('Submit');
                    }
                    this.updateStatusBarItem();
                    this.writeConfigJson(context);
                }
            })
        );

        // Commands
        context.subscriptions.push(
            vscode.commands.registerCommand('ag-auto.enable', async () => {
                const success = this.installScript(context);
                if (success) {
                    this.updateStatusBarItem();
                    const choice = await vscode.window.showInformationMessage(
                        '[AG Auto] ✅ Đã chèn script tự động! Khởi động lại VS Code / IDE để kích hoạt.',
                        'Khởi động lại ngay'
                    );
                    if (choice === 'Khởi động lại ngay') {
                        vscode.commands.executeCommand('workbench.action.reloadWindow');
                    }
                }
            })
        );

        context.subscriptions.push(
            vscode.commands.registerCommand('ag-auto.disable', async () => {
                const success = this.uninstallScript();
                if (success) {
                    this.updateStatusBarItem();
                    const choice = await vscode.window.showInformationMessage(
                        '[AG Auto] 🗑️ Đã gỡ bỏ script! Khởi động lại VS Code / IDE để hoàn tất.',
                        'Khởi động lại ngay'
                    );
                    if (choice === 'Khởi động lại ngay') {
                        vscode.commands.executeCommand('workbench.action.reloadWindow');
                    }
                } else {
                    vscode.window.showErrorMessage('[AG Auto] Could not find workbench.html!');
                }
            })
        );

        context.subscriptions.push(
            vscode.commands.registerCommand('ag-auto.openSettings', () => {
                this.openSettingsPanel(context);
            })
        );

        context.subscriptions.push(
            vscode.commands.registerCommand('ag-auto.toggleAccept', async () => {
                const config = vscode.workspace.getConfiguration('ag-auto');
                const currentState = config.get<boolean>('enabled', true);
                const newState = !currentState;
                await config.update('enabled', newState, vscode.ConfigurationTarget.Global);
                this._autoAcceptEnabled = newState;
                this.updateStatusBarItem();
                this.writeConfigJson(context);
                vscode.window.setStatusBarMessage(
                    newState ? '⚡ AG Auto: Đã BẬT Auto Accept (Chạy ngầm)' : '⏸️ AG Auto: Đã TẮT Auto Accept',
                    2500
                );
            })
        );

        context.subscriptions.push(
            vscode.commands.registerCommand('ag-auto.toggleScroll', async () => {
                const config = vscode.workspace.getConfiguration('ag-auto');
                const currentState = config.get<boolean>('scrollEnabled', true);
                const newState = !currentState;
                await config.update('scrollEnabled', newState, vscode.ConfigurationTarget.Global);
                this._httpScrollEnabled = newState;
                this.updateStatusBarItem();
                this.writeConfigJson(context);
                vscode.window.setStatusBarMessage(
                    newState ? '⚡ AG Auto: Đã BẬT Auto Scroll (Chạy ngầm)' : '⏸️ AG Auto: Đã TẮT Auto Scroll',
                    2500
                );
            })
        );
    }

    public static deactivate(): void {
        if (this._statusBarAccept) this._statusBarAccept.dispose();
        if (this._statusBarScroll) this._statusBarScroll.dispose();
        if (this._autoAcceptInterval) clearInterval(this._autoAcceptInterval);
        if (this._httpServer) {
            try { this._httpServer.close(); } catch (_) { }
        }

        try {
            const wbPath = getWorkbenchPath();
            if (wbPath) {
                const portFile = path.join(path.dirname(wbPath), 'ag-auto-port-' + process.pid + '.txt');
                if (fs.existsSync(portFile)) fs.unlinkSync(portFile);
                const listFile = path.join(path.dirname(wbPath), 'ag-auto-ports.json');
                try {
                    let portList = JSON.parse(fs.readFileSync(listFile, 'utf8'));
                    portList = portList.filter((e: any) => e.pid !== process.pid);
                    fs.writeFileSync(listFile, JSON.stringify(portList), 'utf8');
                } catch (_e) { }
            }
        } catch (_e) { }
    }

    private static isScriptInjected(): boolean {
        try {
            const wbPath = getWorkbenchPath();
            if (!wbPath) return false;
            const html = fs.readFileSync(wbPath, 'utf8');
            return html.includes(TAG_START);
        } catch (e: any) {
            console.log('[AG Auto] Cannot check inject status:', e.message);
            return false;
        }
    }

    private static buildScriptContent(context: vscode.ExtensionContext): string {
        const config = vscode.workspace.getConfiguration('ag-auto');
        const pauseMs = config.get<number>('scrollPauseMs', 7000);
        const scrollMs = config.get<number>('scrollIntervalMs', 500);
        const clickMs = config.get<number>('clickIntervalMs', 1000);
        const allPatterns = config.get<string[]>('clickPatterns', [
            'Allow', 'Always Allow', 'Allow Once', 'Run', 'Run in Terminal', 'Run Command', 'Keep Waiting',
            'Submit', 'Accept', 'Accept all', 'Proceed', 'Continue', 'Retry',
            'Cho phép', 'Luôn cho phép', 'Chạy', 'Tiếp tục', 'Thử lại', 'Chấp nhận', 'Chấp thuận', 'Đồng ý'
        ]);
        const disabledPats = context.globalState.get<string[]>('disabledClickPatterns', []);
        const patterns = allPatterns.filter(p => !disabledPats.includes(p));
        if (!disabledPats.includes('Submit') && !patterns.includes('Submit')) {
            patterns.push('Submit');
        }
        const acceptEnabled = allPatterns.some(p => {
            const pl = p.toLowerCase();
            return (pl.includes('accept') || pl.includes('chấp') || pl.includes('đồng ý') || pl.includes('agree')) && !disabledPats.includes('Accept');
        });
        const enabled = config.get<boolean>('enabled', true);
        const scrollEnabled = config.get<boolean>('scrollEnabled', true);

        // Path to media/autoScript.js
        let templatePath = path.join(context.extensionPath, 'media', 'autoScript.js');
        if (!fs.existsSync(templatePath)) {
            templatePath = path.join(context.extensionPath, 'resources', 'autoScript.js');
        }
        let script = fs.readFileSync(templatePath, 'utf8');

        const wbPath = getWorkbenchPath();
        const configFilePath = wbPath ? path.join(path.dirname(wbPath), 'ag-auto-config.json').replace(/\\/g, '/') : '';

        script = script.replace(/\/\*\{\{PAUSE_SCROLL_MS\}\}\*\/\d+/, pauseMs.toString());
        script = script.replace(/\/\*\{\{SCROLL_INTERVAL_MS\}\}\*\/\d+/, scrollMs.toString());
        script = script.replace(/\/\*\{\{CLICK_INTERVAL_MS\}\}\*\/\d+/, clickMs.toString());
        script = script.replace(
            /\/\*\{\{CLICK_PATTERNS\}\}\*\/\[.*?\]/,
            JSON.stringify(patterns)
        );
        script = script.replace(/\/\*\{\{ACCEPT_IN_CHAT_ONLY\}\}\*\/\w+/, acceptEnabled.toString());
        script = script.replace(/\/\*\{\{ENABLED\}\}\*\/\w+/, enabled.toString());
        script = script.replace(/\/\*\{\{SCROLL_ENABLED\}\}\*\/\w+/, scrollEnabled.toString());
        script = script.replace(/\/\*\{\{CONFIG_PATH\}\}\*\//, configFilePath);

        return script;
    }

    private static writeConfigJson(context: vscode.ExtensionContext): void {
        try {
            const wbPath = getWorkbenchPath();
            if (!wbPath) return;
            const wbDir = path.dirname(wbPath);
            const config = vscode.workspace.getConfiguration('ag-auto');
            const allPatterns = config.get<string[]>('clickPatterns', ['Allow', 'Always Allow', 'Run', 'Keep Waiting', 'Submit', 'Accept']);
            const disabledPats = context.globalState.get<string[]>('disabledClickPatterns', []);
            const activePatterns = allPatterns.filter(p => !disabledPats.includes(p) && p !== 'Accept');
            if (!disabledPats.includes('Submit') && !activePatterns.includes('Submit')) {
                activePatterns.push('Submit');
            }
            const acceptEnabled = allPatterns.some(p => {
                const pl = p.toLowerCase();
                return (pl.includes('accept') || pl.includes('chấp') || pl.includes('đồng ý') || pl.includes('agree')) && !disabledPats.includes(p);
            });
            const enabled = config.get<boolean>('enabled', true);
            const configData = JSON.stringify({
                enabled: enabled,
                clickPatterns: activePatterns,
                acceptInChatOnly: acceptEnabled,
                pauseScrollMs: config.get('scrollPauseMs', 7000),
                scrollIntervalMs: config.get('scrollIntervalMs', 500),
                clickIntervalMs: config.get('clickIntervalMs', 1000)
            });
            const configPath = path.join(wbDir, 'ag-auto-config.json');
            writeFileElevated(configPath, configData);
        } catch (e: any) {
            console.error('[AG Auto] Error writing config JSON:', e.message);
        }
    }

    private static installScript(context: vscode.ExtensionContext): boolean {
        const wbPath = getWorkbenchPath();
        if (!wbPath) {
            vscode.window.showErrorMessage('[AG Auto] workbench.html not found! Please check VS Code/Antigravity installation.');
            return false;
        }

        const wbDir = path.dirname(wbPath);
        const scriptContent = this.buildScriptContent(context);

        const JS_TAG_START = '/* AG-AUTO-CLICK-SCROLL-JS-START */';
        const JS_TAG_END = '/* AG-AUTO-CLICK-SCROLL-JS-END */';

        try {
            const htmlContent = fs.readFileSync(wbPath, 'utf8');
            const scriptMatches = htmlContent.match(/src="([^"]*\.js)"/g) || [];
            const jsFiles = new Set<string>();

            for (const match of scriptMatches) {
                const srcMatch = match.match(/src="([^"]*\.js)"/);
                if (srcMatch) {
                    const jsName = path.basename(srcMatch[1].split('?')[0]);
                    if (jsName === 'ag-auto-script.js') continue;
                    const sameDirPath = path.join(wbDir, jsName);
                    if (fs.existsSync(sameDirPath)) jsFiles.add(sameDirPath);
                    const parent1 = path.join(wbDir, '..', jsName);
                    if (fs.existsSync(parent1)) jsFiles.add(path.resolve(parent1));
                    const parent2 = path.join(wbDir, '..', '..', jsName);
                    if (fs.existsSync(parent2)) jsFiles.add(path.resolve(parent2));
                }
            }

            if (jsFiles.size === 0) {
                const fallbackNames = ['workbench.desktop.main.js', 'workbench.js'];
                for (const name of fallbackNames) {
                    const found = findFileRecursive(path.join(wbDir, '..'), name, 3);
                    if (found) { jsFiles.add(found); break; }
                }
            }

            for (const jsPath of jsFiles) {
                let jsContent = fs.readFileSync(jsPath, 'utf8');
                const jsRegex = new RegExp(`${escapeRegex(JS_TAG_START)}[\\s\\S]*?${escapeRegex(JS_TAG_END)}`, 'g');
                if (jsRegex.test(jsContent)) {
                    jsContent = jsContent.replace(jsRegex, '');
                    writeFileElevated(jsPath, jsContent);
                }
            }
        } catch (err: any) {
            console.error('[AG Auto] Error cleaning up old JS:', err.message);
        }

        try {
            const ts = Date.now();
            const destPath = path.join(wbDir, 'ag-auto-script.js');
            writeFileElevated(destPath, scriptContent);

            const injection = `\n${TAG_START}\n<script src="ag-auto-script.js?v=${ts}"></script>\n${TAG_END}`;
            const targetHtmlNames = ['workbench.html', 'workbench-jetski-agent.html'];
            for (const htmlName of targetHtmlNames) {
                const targetHtmlPath = path.join(wbDir, htmlName);
                if (!fs.existsSync(targetHtmlPath)) continue;
                try {
                    let html = fs.readFileSync(targetHtmlPath, 'utf8');
                    const htmlRegex = new RegExp(`${escapeRegex(TAG_START)}[\\s\\S]*?${escapeRegex(TAG_END)}`, 'g');
                    html = html.replace(htmlRegex, '');
                    html = html.replace('</html>', injection + '\n</html>');
                    writeFileElevated(targetHtmlPath, html);
                } catch (htmlErr: any) {
                    console.error(`[AG Auto] Error injecting into ${htmlName}:`, htmlErr.message);
                }
            }
        } catch (err: any) {
            console.error('[AG Auto] Error injecting into HTML:', err.message);
        }

        return true;
    }

    public static getProductJsonPath(): string | null {
        try {
            if ((process as any).resourcesPath) {
                const candidate = path.join((process as any).resourcesPath, 'app', 'product.json');
                if (fs.existsSync(candidate)) return candidate;
            }

            const wbPath = getWorkbenchPath();
            if (!wbPath) return null;
            let searchDir = path.dirname(wbPath);
            for (let i = 0; i < 8; i++) {
                const candidate = path.join(searchDir, 'product.json');
                if (fs.existsSync(candidate)) {
                    return candidate;
                }
                searchDir = path.dirname(searchDir);
            }
        } catch (_) { }
        return null;
    }

    public static getProductJson(): any | null {
        const p = this.getProductJsonPath();
        if (!p || !fs.existsSync(p)) return null;
        try {
            return JSON.parse(fs.readFileSync(p, 'utf8'));
        } catch (_) {
            return null;
        }
    }

    /**
     * Tự động phát hiện khi Antigravity cập nhật phiên bản mới hoặc bị mất script chèn,
     * và tự động thực hiện re-inject script + cập nhật checksums + dọn dẹp cache V8
     * hoàn toàn tự động mà không cần người dùng phải thao tác bất kỳ bước nào thủ công!
     */
    private static checkAndAutoInjectOnUpdate(context: vscode.ExtensionContext): void {
        const wbPath = getWorkbenchPath();
        if (!wbPath || !fs.existsSync(wbPath)) {
            console.warn('[AG Auto] Không tìm thấy workbench.html để tự động inject!');
            return;
        }

        const wbDir = path.dirname(wbPath);
        const scriptDestPath = path.join(wbDir, 'ag-auto-script.js');
        const isHtmlInjected = this.isScriptInjected();
        const isScriptPresent = fs.existsSync(scriptDestPath);

        // Lấy thông tin phiên bản IDE & Commit hiện tại
        const currentIdeVersion = vscode.version;
        const currentExtVersion = context.extension?.packageJSON?.version || '1.0.0';
        let currentIdeCommit = '';
        try {
            const productJson = this.getProductJson();
            if (productJson && productJson.commit) {
                currentIdeCommit = productJson.commit;
            }
        } catch (_) { }

        let currentWbMtime = 0;
        try {
            currentWbMtime = fs.statSync(wbPath).mtimeMs;
        } catch (_) { }

        // Đọc các giá trị đã ghi nhận ở lần inject trước đó
        const lastInjectedIdeVersion = context.globalState.get<string>('ag-injected-ide-version', '');
        const lastInjectedIdeCommit = context.globalState.get<string>('ag-injected-ide-commit', '');
        const lastInjectedExtVersion = context.globalState.get<string>('ag-injected-ext-version', '');
        const lastInjectedWbMtime = context.globalState.get<number>('ag-injected-wb-mtime', 0);
        const lastAutoReloadStamp = context.globalState.get<number>('ag-last-auto-reload-stamp', 0);

        // Điều kiện phát hiện Antigravity cập nhật phiên bản mới hoặc bị mất script:
        const ideUpdated = (lastInjectedIdeVersion !== '' && lastInjectedIdeVersion !== currentIdeVersion) ||
                           (lastInjectedIdeCommit !== '' && lastInjectedIdeCommit !== currentIdeCommit);
        const extUpdated = lastInjectedExtVersion !== currentExtVersion;
        const scriptMissing = !isHtmlInjected || !isScriptPresent;
        const wbFileChanged = lastInjectedWbMtime !== 0 && Math.abs(currentWbMtime - lastInjectedWbMtime) > 1000 && !isHtmlInjected;

        const needsAutoReinject = scriptMissing || ideUpdated || extUpdated || wbFileChanged;

        if (needsAutoReinject) {
            console.log(`[AG Auto] 🔄 Tự động nhận diện Antigravity cập nhật / cần chèn script (scriptMissing=${scriptMissing}, ideUpdated=${ideUpdated}, extUpdated=${extUpdated}, wbFileChanged=${wbFileChanged})`);

            try {
                const installed = this.installScript(context);
                if (installed) {
                    context.globalState.update('ag-injected-ide-version', currentIdeVersion);
                    if (currentIdeCommit) context.globalState.update('ag-injected-ide-commit', currentIdeCommit);
                    context.globalState.update('ag-injected-ext-version', currentExtVersion);
                    try {
                        const newMtime = fs.statSync(wbPath).mtimeMs;
                        context.globalState.update('ag-injected-wb-mtime', newMtime);
                    } catch (_) { }

                    this.clearV8CodeCache();
                    this.updateProductChecksums();

                    // Tự động reload renderer window 1 lần sau cập nhật để script nạp vào Electron DOM ngay lập tức
                    const now = Date.now();
                    if (now - lastAutoReloadStamp > 20000) {
                        context.globalState.update('ag-last-auto-reload-stamp', now);

                        const msg = ideUpdated
                            ? `🚀 Phát hiện Antigravity vừa cập nhật phiên bản mới (${currentIdeVersion})! Đã tự động kích hoạt lại Auto Accept & Scroll.`
                            : `⚡ Antigravity Personal: Đã tự động kích hoạt Auto Accept & Scroll.`;

                        vscode.window.showInformationMessage(
                            `${msg} Cửa sổ đang tự động tải lại...`,
                            'Tải lại ngay'
                        ).then(choice => {
                            if (choice === 'Tải lại ngay') {
                                vscode.commands.executeCommand('workbench.action.reloadWindow');
                            }
                        });

                        setTimeout(() => {
                            vscode.commands.executeCommand('workbench.action.reloadWindow');
                        }, 1800);
                        return;
                    }
                }
            } catch (e: any) {
                console.error('[AG Auto] Lỗi khi tự động chèn script:', e.message);
            }
        } else {
            // Script đã được chèn và hợp lệ, luôn đảm bảo file script và cấu hình trên đĩa mới nhất
            try {
                const scriptContent = this.buildScriptContent(context);
                writeFileElevated(scriptDestPath, scriptContent);
                this.updateProductChecksums();
            } catch (e: any) {
                console.error('[AG Auto] Lỗi khi cập nhật ag-auto-script.js:', e.message);
            }
        }
    }

    /**
     * Giám sát nền theo thời gian thực (Background Realtime Watcher):
     * Định kỳ kiểm tra nếu Antigravity cập nhật ngầm làm mất script trong workbench.html,
     * tiện ích sẽ lập tức tự động re-inject lại ngay trong nền!
     */
    private static startBackgroundIntegrityWatcher(context: vscode.ExtensionContext): void {
        const checkInterval = setInterval(() => {
            try {
                const wbPath = getWorkbenchPath();
                if (!wbPath || !fs.existsSync(wbPath)) return;

                const injected = this.isScriptInjected();
                const scriptDestPath = path.join(path.dirname(wbPath), 'ag-auto-script.js');
                const scriptExists = fs.existsSync(scriptDestPath);

                if (!injected || !scriptExists) {
                    console.log('[AG Auto] ⚠️ Phát hiện workbench.html bị ghi đè (Antigravity background update)! Đang tự động re-inject ngầm...');
                    this.installScript(context);
                    this.updateProductChecksums();
                    this.clearV8CodeCache();
                    console.log('[AG Auto] ✅ Đã tự động re-inject thành công trong nền!');
                }
            } catch (err: any) {
                console.warn('[AG Auto] Background watcher error:', err.message);
            }
        }, 45000); // Kiểm tra mỗi 45 giây

        context.subscriptions.push({ dispose: () => clearInterval(checkInterval) });
    }

    private static updateProductChecksums(): boolean {
        try {
            const productJsonPath = this.getProductJsonPath();
            if (!productJsonPath || !fs.existsSync(productJsonPath)) return false;

            const productJson = JSON.parse(fs.readFileSync(productJsonPath, 'utf8'));
            if (!productJson.checksums) return false;

            const appRoot = path.dirname(productJsonPath);
            const outDir = path.join(appRoot, 'out');
            let updated = false;

            for (const relativePath in productJson.checksums) {
                const nativePath = relativePath.split('/').join(path.sep);
                let filePath = path.join(outDir, nativePath);
                if (!fs.existsSync(filePath)) filePath = path.join(appRoot, nativePath);
                if (fs.existsSync(filePath)) {
                    const content = fs.readFileSync(filePath);
                    const hash = crypto.createHash('sha256').update(content).digest('base64').replace(/=+$/, '');
                    const oldHash = productJson.checksums[relativePath];
                    if (oldHash !== hash) {
                        productJson.checksums[relativePath] = hash;
                        updated = true;
                    }
                }
            }

            if (updated) {
                writeFileElevated(productJsonPath, JSON.stringify(productJson, null, '\t'));
            }
            return updated;
        } catch (e: any) {
            console.error('[AG Auto] Error updating product checksums:', e.message);
            return false;
        }
    }

    private static clearV8CodeCache(): void {
        try {
            const appDataDir = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
            const candidateDirs = ['Antigravity', 'Antigravity IDE', 'Code'];
            for (const c of candidateDirs) {
                const codeCacheDir = path.join(appDataDir, c, 'Code Cache');
                if (fs.existsSync(codeCacheDir)) {
                    fs.rmSync(codeCacheDir, { recursive: true, force: true });
                }
            }
        } catch (e: any) {
            console.log('[AG Auto] Could not clear code cache:', e.message);
        }
    }

    private static uninstallScript(): boolean {
        const wbPath = getWorkbenchPath();
        if (!wbPath) return false;

        const wbDir = path.dirname(wbPath);
        const JS_TAG_START = '/* AG-AUTO-CLICK-SCROLL-JS-START */';
        const JS_TAG_END = '/* AG-AUTO-CLICK-SCROLL-JS-END */';

        try {
            const targetHtmlNames = ['workbench.html', 'workbench-jetski-agent.html'];
            for (const htmlName of targetHtmlNames) {
                const targetHtmlPath = path.join(wbDir, htmlName);
                if (!fs.existsSync(targetHtmlPath)) continue;
                try {
                    let html = fs.readFileSync(targetHtmlPath, 'utf8');
                    const htmlRegex = new RegExp(`${escapeRegex(TAG_START)}[\\s\\S]*?${escapeRegex(TAG_END)}`, 'g');
                    html = html.replace(htmlRegex, '');
                    writeFileElevated(targetHtmlPath, html);
                } catch (_) { }
            }

            const scriptPath = path.join(wbDir, 'ag-auto-script.js');
            if (fs.existsSync(scriptPath)) fs.unlinkSync(scriptPath);

            const mainJsCandidates = ['workbench.desktop.main.js', 'workbench.js'];
            for (const name of mainJsCandidates) {
                const p = path.join(wbDir, name);
                if (fs.existsSync(p)) {
                    let js = fs.readFileSync(p, 'utf8');
                    const jsRegex = new RegExp(`${escapeRegex(JS_TAG_START)}[\\s\\S]*?${escapeRegex(JS_TAG_END)}`, 'g');
                    js = js.replace(jsRegex, '');
                    writeFileElevated(p, js);
                }
            }
            return true;
        } catch (err: any) {
            vscode.window.showErrorMessage(`[AG Auto] Failed to uninstall script: ${err.message}`);
            return false;
        }
    }

    private static startHttpServer(): void {
        if (this._httpServer) return;
        const cfg = vscode.workspace.getConfiguration('ag-auto');
        this._httpClickPatterns = cfg.get<string[]>('clickPatterns', ['Allow', 'Always Allow', 'Run', 'Keep Waiting', 'Accept']);
        const _DEFAULT_PATS = [
            'Run', 'Run in Terminal', 'Run Command', 'Allow', 'Always Allow', 'Keep Waiting',
            'Accept', 'Accept all', 'Continue', 'Retry', 'Allow Once', 'Allow This Con',
            'Cho phép', 'Luôn cho phép', 'Chạy', 'Tiếp tục', 'Thử lại'
        ];
        const _DEFAULT_OFF = ['Accept all'];
        _DEFAULT_PATS.forEach(p => {
            if (!this._httpClickPatterns.includes(p)) {
                if (!_DEFAULT_OFF.includes(p)) this._httpClickPatterns.push(p);
            }
        });
        this._httpScrollEnabled = cfg.get<boolean>('scrollEnabled', true);
        this._httpScrollConfig = {
            pauseScrollMs: cfg.get<number>('scrollPauseMs', 5000),
            scrollIntervalMs: cfg.get<number>('scrollIntervalMs', 500),
            clickIntervalMs: cfg.get<number>('clickIntervalMs', 2000)
        };

        try {
            this._httpServer = http.createServer((req, res) => {
                res.setHeader('Access-Control-Allow-Origin', '*');
                res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
                res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
                res.setHeader('Content-Type', 'application/json');

                if (req.method === 'OPTIONS') {
                    res.writeHead(204);
                    res.end();
                    return;
                }

                const parsed = url.parse(req.url || '', true);

                if (parsed.query && parsed.query.stats) {
                    try {
                        const incoming = JSON.parse(decodeURIComponent(parsed.query.stats as string));
                        for (const key in incoming) {
                            if (!this._clickStats[key]) this._clickStats[key] = 0;
                            this._clickStats[key] += incoming[key];
                        }
                        let total = 0;
                        for (const key in this._clickStats) { total += this._clickStats[key]; }
                        this._totalClicks = total;
                        if (this._extensionContext) {
                            this._extensionContext.globalState.update('clickStats', this._clickStats);
                            this._extensionContext.globalState.update('totalClicks', this._totalClicks);
                        }
                    } catch (e) { }
                }

                if (parsed.pathname === '/ag-reset-stats') {
                    this._clickStats = {};
                    this._totalClicks = 0;
                    res.writeHead(200);
                    res.end(JSON.stringify({ reset: true }));
                    return;
                }

                if (parsed.pathname === '/api/click-log' && req.method === 'POST') {
                    let body = '';
                    req.on('data', chunk => { body += chunk; });
                    req.on('end', () => {
                        try {
                            const data = JSON.parse(body);
                            const d = new Date();
                            const pad = (n: number) => n < 10 ? '0' + n : n;
                            const timestamp = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())} ${pad(d.getDate())}/${pad(d.getMonth() + 1)}`;
                            const entry = { time: timestamp, pattern: data.pattern || 'click', button: (data.button || '').substring(0, 80) };
                            this._clickLog.unshift(entry);
                            if (this._clickLog.length > 50) this._clickLog.pop();
                            if (this._extensionContext) {
                                this._extensionContext.globalState.update('clickLog', this._clickLog);
                            }
                            if (this._settingsPanel) {
                                this._settingsPanel.webview.postMessage({ command: 'clickLogUpdate', log: this._clickLog });
                            }
                            res.writeHead(200);
                            res.end(JSON.stringify({ logged: true }));
                        } catch (e: any) {
                            res.writeHead(200);
                            res.end(JSON.stringify({ error: e.message }));
                        }
                    });
                    return;
                }

                res.writeHead(200);
                const safePatterns = this._httpClickPatterns.filter(p => {
                    const pl = p.toLowerCase();
                    return pl !== 'accept' && !pl.startsWith('chấp') && !pl.startsWith('đồng ý');
                });
                const acceptEnabled = this._httpClickPatterns.some(p => {
                    const pl = p.toLowerCase();
                    return pl.includes('accept') || pl.includes('chấp') || pl.includes('đồng ý') || pl.includes('agree');
                });
                const response: any = {
                    enabled: this._autoAcceptEnabled,
                    scrollEnabled: this._httpScrollEnabled,
                    clickPatterns: safePatterns,
                    acceptInChatOnly: acceptEnabled,
                    pauseScrollMs: this._httpScrollConfig.pauseScrollMs,
                    scrollIntervalMs: this._httpScrollConfig.scrollIntervalMs,
                    clickIntervalMs: this._httpScrollConfig.clickIntervalMs,
                    clickStats: this._clickStats,
                    totalClicks: this._totalClicks
                };
                if (this._resetStatsRequested) {
                    response.resetStats = true;
                    this._resetStatsRequested = false;
                }
                res.end(JSON.stringify(response));
            });

            const tryListenPort = (port: number) => {
                if (port > this.AG_HTTP_PORT_END) {
                    console.log('[AG Auto] ❌ No available port in range ' + this.AG_HTTP_PORT_START + '-' + this.AG_HTTP_PORT_END);
                    return;
                }
                this._httpServer!.removeAllListeners('error');
                this._httpServer!.once('error', (e: any) => {
                    if (e.code === 'EADDRINUSE') {
                        tryListenPort(port + 1);
                    }
                });
                this._httpServer!.listen(port, '127.0.0.1', () => {
                    this._actualPort = port;
                    console.log('[AG Auto] ✅ HTTP server started on port ' + port);
                    try {
                        const wbPath = getWorkbenchPath();
                        if (wbPath) {
                            const portFile = path.join(path.dirname(wbPath), 'ag-auto-port-' + process.pid + '.txt');
                            fs.writeFileSync(portFile, String(port), 'utf8');
                            const listFile = path.join(path.dirname(wbPath), 'ag-auto-ports.json');
                            let portList: any[] = [];
                            try { portList = JSON.parse(fs.readFileSync(listFile, 'utf8')); } catch (_e) { }
                            portList = portList.filter((e: any) => e.pid !== process.pid);
                            portList.push({ pid: process.pid, port: port, time: Date.now() });
                            fs.writeFileSync(listFile, JSON.stringify(portList), 'utf8');
                        }
                    } catch (pe: any) {
                        console.log('[AG Auto] Could not write port file:', pe.message);
                    }
                });
            };
            tryListenPort(this.AG_HTTP_PORT_START);
        } catch (e: any) {
            console.log('[AG Auto] HTTP server failed:', e.message);
        }
    }

    private static startCommandsLoop(): void {
        const config = vscode.workspace.getConfiguration('ag-auto');
        this._autoAcceptEnabled = config.get<boolean>('enabled', true);
        const clickMs = config.get<number>('clickIntervalMs', 2000);

        if (this._autoAcceptInterval) clearInterval(this._autoAcceptInterval);

        this._autoAcceptInterval = setInterval(() => {
            if (!this._autoAcceptEnabled) return;
            const wantsAccept = this._httpClickPatterns.some(p => p.toLowerCase().includes('accept'));
            if (!wantsAccept) return;

            Promise.allSettled(
                this.CHAT_ACCEPT_COMMANDS.map(cmd => vscode.commands.executeCommand(cmd))
            ).catch(() => { });
        }, clickMs);
    }

    private static createStatusBarItem(context: vscode.ExtensionContext): void {
        this._statusBarAccept = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, -10000);
        this._statusBarAccept.command = 'ag-auto.toggleAccept';
        context.subscriptions.push(this._statusBarAccept);

        this._statusBarScroll = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, -10001);
        this._statusBarScroll.command = 'ag-auto.toggleScroll';
        context.subscriptions.push(this._statusBarScroll);

        this.updateStatusBarItem();
        this._statusBarAccept.show();
        this._statusBarScroll.show();
    }

    private static updateStatusBarItem(): void {
        if (!this._statusBarAccept || !this._statusBarScroll) return;
        const cfg = vscode.workspace.getConfiguration('ag-auto');
        const acceptOn = cfg.get<boolean>('enabled', true);
        const scrollOn = cfg.get<boolean>('scrollEnabled', true);
        this._autoAcceptEnabled = acceptOn;
        this._httpScrollEnabled = scrollOn;

        this._statusBarAccept.text = acceptOn ? '$(check) Accept ON' : '$(circle-slash) Accept OFF';
        this._statusBarAccept.color = acceptOn ? '#4EC9B0' : '#F44747';
        this._statusBarAccept.backgroundColor = acceptOn ? undefined : new vscode.ThemeColor('statusBarItem.errorBackground');
        this._statusBarAccept.tooltip = 'Tự động Chấp thuận: ' + (acceptOn ? '✅ Đang BẬT' : '❌ Đang TẮT') + '\n(Click chuột để Bật/Tắt tức thì mà không mở tab)';

        this._statusBarScroll.text = scrollOn ? '$(check) Scroll ON' : '$(circle-slash) Scroll OFF';
        this._statusBarScroll.color = scrollOn ? '#4EC9B0' : '#F44747';
        this._statusBarScroll.backgroundColor = scrollOn ? undefined : new vscode.ThemeColor('statusBarItem.errorBackground');
        this._statusBarScroll.tooltip = 'Tự động Cuộn: ' + (scrollOn ? '✅ Đang BẬT' : '❌ Đang TẮT') + '\n(Click chuột để Bật/Tắt tức thì mà không mở tab)';
    }

    public static openSettingsPanel(context: vscode.ExtensionContext): void {
        if (this._settingsPanel) {
            this._settingsPanel.dispose();
            this._settingsPanel = null;
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'agAutoSettings',
            'AG Auto Click & Scroll - Settings',
            vscode.ViewColumn.One,
            { enableScripts: true }
        );
        this._settingsPanel = panel;

        panel.onDidDispose(() => {
            this._settingsPanel = null;
        });

        const config = vscode.workspace.getConfiguration('ag-auto');

        panel.webview.html = this.getSettingsHtml({
            enabled: config.get<boolean>('enabled', true),
            scrollEnabled: config.get<boolean>('scrollEnabled', true),
            scrollPauseMs: config.get<number>('scrollPauseMs', 7000),
            scrollIntervalMs: config.get<number>('scrollIntervalMs', 500),
            clickIntervalMs: config.get<number>('clickIntervalMs', 1000),
            clickPatterns: config.get<string[]>('clickPatterns', ['Allow', 'Always Allow', 'Run', 'Keep Waiting', 'Submit', 'Accept']),
            disabledClickPatterns: context.globalState.get<string[]>('disabledClickPatterns', []),
            language: config.get<string>('language', 'vi'),
            clickStats: this._clickStats,
            totalClicks: this._totalClicks
        });

        panel.webview.onDidReceiveMessage(async (msg) => {
            if (msg.command === 'changeLang') {
                const cfg = vscode.workspace.getConfiguration('ag-auto');
                await cfg.update('language', msg.lang, vscode.ConfigurationTarget.Global);
                panel.webview.html = this.getSettingsHtml({
                    enabled: cfg.get('enabled', true),
                    scrollEnabled: cfg.get('scrollEnabled', true),
                    scrollPauseMs: cfg.get('scrollPauseMs', 7000),
                    scrollIntervalMs: cfg.get('scrollIntervalMs', 500),
                    clickIntervalMs: cfg.get('clickIntervalMs', 1000),
                    clickPatterns: cfg.get('clickPatterns', ['Run', 'Allow', 'Always Allow', 'Submit', 'Accept']),
                    disabledClickPatterns: context.globalState.get('disabledClickPatterns', []),
                    language: msg.lang,
                    clickStats: this._clickStats,
                    totalClicks: this._totalClicks
                });
                return;
            }
            if (msg.command === 'toggle') {
                this._autoAcceptEnabled = msg.enabled;
                const cfg = vscode.workspace.getConfiguration('ag-auto');
                await cfg.update('enabled', msg.enabled, vscode.ConfigurationTarget.Global);
                this.writeConfigJson(context);
                this.updateStatusBarItem();
                return;
            }
            if (msg.command === 'scrollToggle') {
                this._httpScrollEnabled = msg.enabled;
                const cfg = vscode.workspace.getConfiguration('ag-auto');
                await cfg.update('scrollEnabled', msg.enabled, vscode.ConfigurationTarget.Global);
                this.updateStatusBarItem();
                return;
            }
            if (msg.command === 'save') {
                const cfg = vscode.workspace.getConfiguration('ag-auto');
                await cfg.update('enabled', msg.data.enabled, vscode.ConfigurationTarget.Global);
                await cfg.update('scrollPauseMs', msg.data.scrollPauseMs, vscode.ConfigurationTarget.Global);
                await cfg.update('scrollIntervalMs', msg.data.scrollIntervalMs, vscode.ConfigurationTarget.Global);
                await cfg.update('clickIntervalMs', msg.data.clickIntervalMs, vscode.ConfigurationTarget.Global);
                await cfg.update('clickPatterns', msg.data.clickPatterns, vscode.ConfigurationTarget.Global);
                await context.globalState.update('disabledClickPatterns', msg.data.disabledClickPatterns);
                try {
                    await cfg.update('language', msg.data.language, vscode.ConfigurationTarget.Global);
                } catch (e) {
                    await context.globalState.update('language', msg.data.language);
                }

                this._autoAcceptEnabled = msg.data.enabled;
                this._httpClickPatterns = msg.data.clickPatterns.filter((p: string) => !msg.data.disabledClickPatterns.includes(p));
                this._httpScrollConfig = {
                    pauseScrollMs: msg.data.scrollPauseMs || 5000,
                    scrollIntervalMs: msg.data.scrollIntervalMs || 500,
                    clickIntervalMs: msg.data.clickIntervalMs || 2000
                };

                this.writeConfigJson(context);
                this.updateStatusBarItem();

                const updatedLang = msg.data.language;
                let savedMsg = '$(check) [AG Auto] ✅ Đã lưu!';
                if (updatedLang === 'en') savedMsg = '$(check) [AG Auto] ✅ Saved!';
                if (updatedLang === 'zh') savedMsg = '$(check) [AG Auto] ✅ 已保存！';
                vscode.window.setStatusBarMessage(savedMsg, 3000);
            }
            if (msg.command === 'reload') {
                vscode.commands.executeCommand('workbench.action.reloadWindow');
            }
            if (msg.command === 'resetStats') {
                this._clickStats = {};
                this._totalClicks = 0;
                this._resetStatsRequested = true;
                context.globalState.update('clickStats', {});
                context.globalState.update('totalClicks', 0);
                panel.webview.postMessage({ command: 'statsUpdated', clickStats: {}, totalClicks: 0 });
            }
            if (msg.command === 'clearClickLog') {
                this._clickLog = [];
                if (this._extensionContext) this._extensionContext.globalState.update('clickLog', []);
                panel.webview.postMessage({ command: 'clickLogUpdate', log: [] });
            }
            if (msg.command === 'getClickLog') {
                panel.webview.postMessage({ command: 'clickLogUpdate', log: this._clickLog });
            }
            if (msg.command === 'getStats') {
                panel.webview.postMessage({ command: 'statsUpdated', clickStats: this._clickStats, totalClicks: this._totalClicks });
            }
        }, undefined, context.subscriptions);

        const statsTimer = setInterval(() => {
            try {
                panel.webview.postMessage({ command: 'statsUpdated', clickStats: this._clickStats, totalClicks: this._totalClicks });
            } catch (e) { clearInterval(statsTimer); }
        }, 2000);
        panel.onDidDispose(() => clearInterval(statsTimer));
    }

    private static getSettingsHtml(cfg: any): string {
        const patternsJson = JSON.stringify(cfg.clickPatterns);
        const disabledPatternsJson = JSON.stringify(cfg.disabledClickPatterns);
        const lang = cfg.language || 'vi';
        const t: any = {
            vi: {
                title: "Cấu hình tự động nhấn nút và cuộn khung chat Antigravity",
                status: "Trạng thái",
                enableAuto: "Bật Auto Click & Scroll",
                autoScroll: "Auto Scroll",
                pauseMsTitle: "Thời gian nghỉ khi cuộn tay (ms)",
                pauseMsHint: "Khi bạn cuộn chuột, script sẽ nghỉ bấy nhiêu ms để bạn đọc",
                scrollMsTitle: "Tốc độ quét cuộn (ms)",
                scrollMsHint: "Thấp hơn = cuộn mượt hơn, tốn CPU hơn",
                autoClick: "Auto Click",
                clickMsTitle: "Tốc độ quét nút click (ms)",
                patternsTitle: "Danh sách text nút tự động click:",
                btnSave: "💾 Lưu & Áp Dụng",
                zoomTitle: "Thu phóng",
                langTitle: "Ngôn ngữ / Language"
            },
            en: {
                title: "Configure automatic button clicking and Antigravity chat auto-scrolling",
                status: "Status",
                enableAuto: "Enable Auto Click & Scroll",
                autoScroll: "Auto Scroll",
                pauseMsTitle: "Manual Scroll Pause Time (ms)",
                pauseMsHint: "Script will pause for this duration when you manually scroll to read",
                scrollMsTitle: "Scroll Scan Speed (ms)",
                scrollMsHint: "Lower = smoother scrolling, higher CPU usage",
                autoClick: "Auto Click",
                clickMsTitle: "Click Scan Speed (ms)",
                patternsTitle: "List of button texts to auto-click:",
                btnSave: "💾 Save & Apply",
                zoomTitle: "Zoom",
                langTitle: "Language"
            },
            zh: {
                title: "配置自动点击按钮和 Antigravity 聊天框自动滚动",
                status: "状态",
                enableAuto: "启用 Auto Click & Scroll",
                autoScroll: "自动滚动",
                pauseMsTitle: "手动滚动暂停时间 (ms)",
                pauseMsHint: "手动滚动时，脚本将暂停此时间以便阅读",
                scrollMsTitle: "滚动扫描速度 (ms)",
                scrollMsHint: "越低 = 滚动越流畅，占用 CPU 越高",
                autoClick: "自动点击",
                clickMsTitle: "点击扫描速度 (ms)",
                patternsTitle: "自动点击按钮文本列表:",
                btnSave: "💾 保存并应用",
                zoomTitle: "缩放",
                langTitle: "语言 / Language"
            }
        };

        const strings = t[lang] || t['vi'];

        return `<!DOCTYPE html>
<html lang="${lang}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>AG Auto Settings</title>
<style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
        font-family: 'Segoe UI', system-ui, sans-serif;
        background: #1e1e2e;
        color: #e8ecf4;
        padding: 24px;
        line-height: 1.6;
    }
    .zoom-bar { display:flex; align-items:center; justify-content:center; gap:10px; margin-bottom:20px; }
    .zoom-bar span { font-size:0.85em; color:#9098b0; }
    .zoom-bar button { width:32px; height:32px; border-radius:8px; border:1px solid #45475a; background:#313244; color:#e8ecf4; font-size:1.1em; cursor:pointer; transition:all 0.2s; }
    .zoom-bar button:hover { background:#45475a; border-color:#89b4fa; }
    .zoom-level { font-size:0.88em; color:#89b4fa; font-weight:600; min-width:44px; text-align:center; }
    h1 {
        font-size: 1.6em;
        background: linear-gradient(135deg, #89b4fa, #a6e3a1);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        margin-bottom: 8px;
    }
    .subtitle { color: #9098b0; margin-bottom: 24px; font-size: 0.9em; }
    .title-row { display: flex; align-items: center; gap: 12px; margin-bottom: 8px; flex-wrap: wrap; }
    .click-badge { display: inline-flex; align-items: center; gap: 6px; background: linear-gradient(135deg, #45475a, #313244); border: 1px solid #585b70; border-radius: 20px; padding: 4px 12px; font-size: 0.8em; color: #a6e3a1; font-weight: 600; }
    .click-badge .count { color: #f9e2af; font-size: 1.1em; }
    .btn-reset-stats { background: none; border: 1px solid #585b70; border-radius: 12px; color: #f38ba8; font-size: 0.7em; padding: 2px 10px; cursor: pointer; transition: all 0.2s; }
    .btn-reset-stats:hover { background: #f38ba8; color: #1e1e2e; }
    .top-row { display: flex; gap: 16px; margin-bottom: 16px; }
    .top-row > * { flex: 1; min-width: 0; }
    .stats-card { background: #313244; border-radius: 12px; padding: 16px; border: 1px solid #45475a; }
    .clicklog-card { background: #313244; border-radius: 12px; padding: 16px; border: 1px solid #45475a; }
    .clicklog-title { font-size: 0.9em; color: #f9e2af; font-weight: 600; margin-bottom: 12px; display: flex; align-items: center; gap: 8px; }
    .clicklog-entry { padding: 6px 10px; border-bottom: 1px solid #1e1e2e; display: flex; justify-content: space-between; align-items: center; gap: 8px; }
    .clicklog-entry:last-child { border-bottom: none; }
    .clicklog-pattern { font-weight: 600; font-size: 0.85em; }
    .clicklog-time { color: #bac2de; font-size: 0.75em; white-space: nowrap; }
    .stats-card-title { font-size: 0.9em; color: #89b4fa; font-weight: 600; margin-bottom: 12px; display: flex; align-items: center; gap: 8px; }
    .stats-row { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
    .stats-label { min-width: 100px; font-size: 0.8em; color: #cdd6f4; text-align: right; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .stats-bar-bg { flex: 1; height: 18px; background: #1e1e2e; border-radius: 9px; overflow: hidden; position: relative; }
    .stats-bar { height: 100%; border-radius: 9px; transition: width 0.6s cubic-bezier(0.22, 1, 0.36, 1); min-width: 0; position: relative; }
    .stats-bar.bar-1 { background: linear-gradient(90deg, #89b4fa, #74c7ec); }
    .stats-bar.bar-2 { background: linear-gradient(90deg, #a6e3a1, #94e2d5); }
    .stats-bar.bar-3 { background: linear-gradient(90deg, #f9e2af, #fab387); }
    .stats-bar.bar-4 { background: linear-gradient(90deg, #f38ba8, #eba0ac); }
    .stats-bar.bar-5 { background: linear-gradient(90deg, #cba6f7, #b4befe); }
    .stats-bar.bar-6 { background: linear-gradient(90deg, #94e2d5, #89dceb); }
    .stats-bar.bar-7 { background: linear-gradient(90deg, #fab387, #f9e2af); }
    .stats-bar.bar-8 { background: linear-gradient(90deg, #74c7ec, #89b4fa); }
    .stats-bar.bar-9 { background: linear-gradient(90deg, #eba0ac, #cba6f7); }
    .stats-count { min-width: 36px; font-size: 0.8em; color: #bac2de; font-weight: 600; text-align: left; }
    .stats-crown { font-size: 0.9em; }
    .stats-empty { color: #6c7086; font-size: 0.8em; font-style: italic; text-align: center; padding: 8px; }
    .card {
        background: #313244;
        border-radius: 12px;
        padding: 20px;
        margin-bottom: 16px;
        border: 1px solid #45475a;
        transition: border-color 0.2s;
    }
    .card:hover { border-color: #89b4fa; }
    .card-title {
        font-size: 1.1em;
        font-weight: 600;
        color: #89b4fa;
        margin-bottom: 12px;
        display: flex;
        align-items: center;
        gap: 8px;
    }
    .field {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 12px;
    }
    .field:last-child { margin-bottom: 0; }
    label { color: #d4daf0; font-size: 0.95em; }
    input[type="number"], select {
        width: 140px;
        padding: 8px 12px;
        border: 1px solid #45475a;
        border-radius: 8px;
        background: #1e1e2e;
        color: #cdd6f4;
        font-size: 0.95em;
        outline: none;
        transition: border-color 0.2s;
    }
    input[type="number"]:focus, select:focus { border-color: #89b4fa; }
    .toggle {
        position: relative;
        width: 50px; height: 26px;
        cursor: pointer;
    }
    .toggle input { display: none; }
    .toggle .slider {
        position: absolute; inset: 0;
        background: #45475a;
        border-radius: 26px;
        transition: 0.3s;
    }
    .toggle .slider::before {
        content: '';
        position: absolute;
        left: 3px; top: 3px;
        width: 20px; height: 20px;
        background: #cdd6f4;
        border-radius: 50%;
        transition: 0.3s;
    }
    .toggle input:checked + .slider { background: #00d26a; box-shadow: 0 0 12px rgba(0,210,106,0.5); }
    .toggle input:checked + .slider::before { transform: translateX(24px); background: #fff; }

    .pattern-list { display: flex; flex-direction: column; gap: 8px; margin-top: 8px; }
    .btn {
        padding: 10px 24px;
        border: none;
        border-radius: 8px;
        cursor: pointer;
        font-size: 0.95em;
        font-weight: 600;
        transition: all 0.2s;
    }
    .btn-primary {
        background: linear-gradient(135deg, #89b4fa, #74c7ec);
        color: #1e1e2e;
    }
    .btn-primary:hover { transform: translateY(-1px); box-shadow: 0 4px 12px rgba(137,180,250,0.4); }
    .actions {
        display: flex;
        justify-content: flex-end;
        margin-top: 24px;
        gap: 12px;
    }
    .hint { color: #b8c0d8; font-size: 0.95em; display: block; margin-top: 6px; font-style: italic; opacity: 0.9; }
</style>
</head>
<body>
    <div class="title-row">
        <h1>⚡ AG Auto Click & Scroll</h1>
        <span class="click-badge" id="totalBadge">
            🎯 <span class="count" id="totalCount">${cfg.totalClicks || 0}</span> clicks
        </span>
    </div>
    <div class="top-row">
        <div class="stats-card" id="statsCard">
            <div class="stats-card-title">📊 Click Stats <button class="btn-reset-stats" onclick="resetStats()" title="Reset counter">↺ Reset</button></div>
            <div id="statsBars"></div>
        </div>
        <div class="clicklog-card">
            <div class="clicklog-title">🎯 Click Log <button class="btn-reset-stats" onclick="clearClickLog()">↺ Clear</button></div>
            <div id="clickLogList" style="max-height:300px;overflow-y:auto">
                <div style="color:#6c7086;padding:8px;font-size:0.85em">No clicks yet</div>
            </div>
        </div>
    </div>
    <p class="subtitle">${strings.title}</p>

    <div class="zoom-bar">
        <span>${strings.zoomTitle}</span>
        <button onclick="zoomOut()">−</button>
        <span class="zoom-level" id="zoomDisplay">100%</span>
        <button onclick="zoomIn()">+</button>
        <button onclick="zoomReset()" style="font-size:0.75em;width:auto;padding:0 10px;">Reset</button>
    </div>

    <div class="card">
        <div class="card-title">🔌 ${strings.status}</div>
        <div class="field">
            <label>${strings.enableAuto}</label>
            <label class="toggle">
                <input type="checkbox" id="chkEnabled" ${cfg.enabled ? 'checked' : ''} onchange="instantToggle()">
                <span class="slider"></span>
            </label>
        </div>
        <div class="field" style="margin-top: 12px;">
            <label>${strings.langTitle}</label>
            <select id="selLang" onchange="changeLang()">
                <option value="vi" ${lang === 'vi' ? 'selected' : ''}>Tiếng Việt</option>
                <option value="en" ${lang === 'en' ? 'selected' : ''}>English</option>
                <option value="zh" ${lang === 'zh' ? 'selected' : ''}>中文</option>
            </select>
        </div>
    </div>

    <div class="card">
        <div class="card-title">📜 ${strings.autoScroll}</div>
        <div class="field">
            <label>Enable Auto Scroll</label>
            <label class="toggle">
                <input type="checkbox" id="chkScrollEnabled" ${cfg.scrollEnabled !== false ? 'checked' : ''} onchange="scrollToggle()">
                <span class="slider"></span>
            </label>
        </div>
        <div class="field" style="margin-top:12px;">
            <label>${strings.pauseMsTitle}</label>
            <input type="number" id="txtPauseMs" value="${cfg.scrollPauseMs}" min="1000" max="60000" step="500">
        </div>
        <p class="hint">${strings.pauseMsHint}</p>
        <br>
        <div class="field">
            <label>${strings.scrollMsTitle}</label>
            <input type="number" id="txtScrollMs" value="${cfg.scrollIntervalMs}" min="100" max="5000" step="100">
        </div>
        <p class="hint">${strings.scrollMsHint}</p>
    </div>

    <div class="card">
        <div class="card-title">🎯 ${strings.autoClick}</div>
        <div class="field">
            <label>${strings.clickMsTitle}</label>
            <input type="number" id="txtClickMs" value="${cfg.clickIntervalMs}" min="200" max="5000" step="100">
        </div>

        <div style="margin-top: 16px;">
            <label>BUTTON TEMPLATES</label>
            <div class="pattern-list" id="templateList"></div>
        </div>
    </div>

    <div class="actions">
        <button class="btn" style="background:#45475a;color:#e8ecf4;" onclick="vscode.postMessage({command:'reload'})">🔄 Reload</button>
        <button class="btn btn-primary" onclick="saveSettings()">${strings.btnSave}</button>
    </div>

<script>
    const vscode = acquireVsCodeApi();
    const DEFAULT_PATTERNS = ['Run', 'Allow', 'Submit', 'Accept', 'Always Allow', 'Keep Waiting', 'Retry', 'Continue', 'Allow Once', 'Allow This Con', 'Accept all'];
    const DEFAULT_DISABLED = ['Accept all'];
    let patterns = ${patternsJson};
    let disabledPatterns = ${disabledPatternsJson};
    DEFAULT_PATTERNS.forEach(function(p) {
        if (patterns.indexOf(p) === -1 && disabledPatterns.indexOf(p) === -1) {
            if (DEFAULT_DISABLED.indexOf(p) !== -1) { disabledPatterns.push(p); }
            else { patterns.push(p); }
        }
    });
    patterns = patterns.filter(function(p) { return p !== 'Allow This Conversion'; });
    disabledPatterns = disabledPatterns.filter(function(p) { return p !== 'Allow This Conversion'; });

    var DISPLAY_NAMES = { 'Allow This Con': 'Allow This Conversion' };
    function displayName(p) { return DISPLAY_NAMES[p] || p; }

    function renderPatterns() {
        var list = document.getElementById('templateList');
        var allP = [], seen = {};
        DEFAULT_PATTERNS.concat(patterns).concat(disabledPatterns).forEach(function(p) {
            if (!seen[p]) { seen[p] = true; allP.push(p); }
        });
        var h = '';
        allP.forEach(function(p) {
            var isOn = patterns.indexOf(p) !== -1;
            var bg = isOn ? '#1e1e2e' : '#2a2a3a';
            var brd = isOn ? '#585b70' : '#45475a';
            var opa = isOn ? '1' : '0.5';
            var stIcon = isOn ? 'ON' : 'OFF';
            var stColor = isOn ? '#a6e3a1' : '#f38ba8';
            h += '<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:' + bg + ';border:1px solid ' + brd + ';border-radius:8px;margin-bottom:6px;opacity:' + opa + '">';
            h += '<div style="display:flex;align-items:center;gap:10px">';
            h += '<input type="checkbox" ' + (isOn ? 'checked' : '') + ' onchange="togPat(&quot;' + p + '&quot;)" style="width:16px;height:16px;cursor:pointer;accent-color:#a6e3a1">';
            h += '<span style="font-weight:600;color:#cdd6f4">' + displayName(p) + '</span></div>';
            h += '<div style="display:flex;align-items:center;gap:8px">';
            h += '<span style="font-size:0.75em;padding:2px 8px;border-radius:4px;background:' + (isOn ? '#1a3a1a' : '#3a1a1a') + ';color:' + stColor + ';font-weight:600">' + stIcon + '</span>';
            h += '</div></div>';
        });
        list.innerHTML = h;
    }
    function togPat(v) {
        if (patterns.indexOf(v)!==-1) { patterns=patterns.filter(function(x){return x!==v}); if(disabledPatterns.indexOf(v)===-1) disabledPatterns.push(v); }
        else { disabledPatterns=disabledPatterns.filter(function(x){return x!==v}); if(patterns.indexOf(v)===-1) patterns.push(v); }
        renderPatterns();
    }

    function saveSettings() {
        vscode.postMessage({
            command: 'save',
            data: {
                enabled:         document.getElementById('chkEnabled').checked,
                scrollPauseMs:   parseInt(document.getElementById('txtPauseMs').value) || 7000,
                scrollIntervalMs: parseInt(document.getElementById('txtScrollMs').value) || 500,
                clickIntervalMs: parseInt(document.getElementById('txtClickMs').value) || 1000,
                clickPatterns:   patterns,
                disabledClickPatterns: disabledPatterns,
                language:        document.getElementById('selLang').value
            }
        });
    }

    renderPatterns();

    function instantToggle() {
        var enabled = document.getElementById('chkEnabled').checked;
        vscode.postMessage({ command: 'toggle', enabled: enabled });
    }

    function scrollToggle() {
        var enabled = document.getElementById('chkScrollEnabled').checked;
        vscode.postMessage({ command: 'scrollToggle', enabled: enabled });
    }

    function changeLang() {
        const newLang = document.getElementById('selLang').value;
        vscode.postMessage({ command: 'changeLang', lang: newLang });
    }

    var _zoomLevel = 100;
    try { var saved = localStorage.getItem('ag-zoom'); if(saved) _zoomLevel = parseInt(saved); } catch(e){}
    function applyZoom() {
        document.body.style.zoom = (_zoomLevel/100);
        document.getElementById('zoomDisplay').textContent = _zoomLevel + '%';
        try { localStorage.setItem('ag-zoom', _zoomLevel); } catch(e){}
    }
    function zoomIn() { if(_zoomLevel<150) { _zoomLevel+=10; applyZoom(); } }
    function zoomOut() { if(_zoomLevel>50) { _zoomLevel-=10; applyZoom(); } }
    function zoomReset() { _zoomLevel=100; applyZoom(); }
    if(_zoomLevel!==100) applyZoom();

    function clearClickLog() {
        vscode.postMessage({ command: 'clearClickLog' });
        document.getElementById('clickLogList').innerHTML = '<div style="color:#6c7086;padding:8px;font-size:0.85em">No clicks yet</div>';
    }
    function renderClickLog(log) {
        var el = document.getElementById('clickLogList');
        if (!el) return;
        if (!log || log.length === 0) {
            el.innerHTML = '<div style="color:#6c7086;padding:8px;font-size:0.85em">No clicks yet</div>';
            return;
        }
        var html = '';
        var colors = { Run: '#a6e3a1', Allow: '#89b4fa', Accept: '#fab387', 'Always Allow': '#89dceb', Retry: '#cba6f7', 'Keep Waiting': '#94e2d5', 'Allow Once': '#f9e2af', Continue: '#74c7ec', 'Accept all': '#fab387', 'Allow This Conversation': '#89b4fa' };
        for (var i = 0; i < log.length; i++) {
            var c = log[i];
            var col = colors[c.pattern] || '#cdd6f4';
            html += '<div class="clicklog-entry">';
            html += '<span><span class="clicklog-pattern" style="color:' + col + '">' + c.pattern + '</span></span>';
            html += '<span class="clicklog-time">' + c.time + '</span>';
            html += '</div>';
        }
        el.innerHTML = html;
    }
    function resetStats() {
        vscode.postMessage({ command: 'resetStats' });
        document.getElementById('totalCount').textContent = '0';
        renderStatsBars({}, []);
    }

    var allPatterns = DEFAULT_PATTERNS.slice();

    function renderStatsBars(stats, pats) {
        var container = document.getElementById('statsBars');
        if (!pats || pats.length === 0) { pats = allPatterns; }
        var maxCount = 0;
        for (var i = 0; i < pats.length; i++) {
            var c = (stats[pats[i]] || 0);
            if (c > maxCount) maxCount = c;
        }
        var html = '';
        for (var i = 0; i < pats.length; i++) {
            var name = pats[i];
            var count = stats[name] || 0;
            var pct = maxCount > 0 ? Math.round((count / maxCount) * 100) : 0;
            var barClass = 'bar-' + ((i % 9) + 1);
            var crown = (count > 0 && count === maxCount) ? ' <span class="stats-crown">\uD83D\uDC51</span>' : '';
            html += '<div class="stats-row">';
            html += '  <span class="stats-label">' + displayName(name) + '</span>';
            html += '  <div class="stats-bar-bg"><div class="stats-bar ' + barClass + '" style="width:' + pct + '%"></div></div>';
            html += '  <span class="stats-count">' + count + crown + '</span>';
            html += '</div>';
        }
        if (pats.length === 0) html = '<div class="stats-empty">No patterns configured</div>';
        container.innerHTML = html;
    }

    window.addEventListener('message', function(event) {
        var msg = event.data;
        if (msg.command === 'statsUpdated') {
            document.getElementById('totalCount').textContent = msg.totalClicks || 0;
            renderStatsBars(msg.clickStats || {}, allPatterns);
        }
        if (msg.command === 'clickLogUpdate') {
            renderClickLog(msg.log);
        }
    });

    vscode.postMessage({ command: 'getStats' });
    vscode.postMessage({ command: 'getClickLog' });
    renderStatsBars(${JSON.stringify(cfg.clickStats || {})}, allPatterns);
</script>
</body>
</html>`;
    }
}
