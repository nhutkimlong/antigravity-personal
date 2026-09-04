import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import axios from 'axios';

const GITHUB_REPO = 'nhutkimlong/antigravity-personal';
const GITHUB_RELEASES_API = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;
const GITHUB_RAW_PACKAGE_JSON = `https://raw.githubusercontent.com/${GITHUB_REPO}/main/package.json`;

/**
 * So sánh 2 chuỗi version semver (ví dụ: "1.0.1" > "1.0.0")
 */
export function isNewerVersion(latest: string, current: string): boolean {
    const cleanLatest = latest.replace(/^v/, '').trim();
    const cleanCurrent = current.replace(/^v/, '').trim();
    const lParts = cleanLatest.split('.').map(p => parseInt(p, 10) || 0);
    const cParts = cleanCurrent.split('.').map(p => parseInt(p, 10) || 0);

    for (let i = 0; i < Math.max(lParts.length, cParts.length); i++) {
        const l = lParts[i] || 0;
        const c = cParts[i] || 0;
        if (l > c) return true;
        if (l < c) return false;
    }
    return false;
}

export class UpdateManager {
    private static _checkTimer: NodeJS.Timeout | null = null;
    private static _isUpdating = false;

    /**
     * Khởi động cơ chế tự động kiểm tra và cập nhật định kỳ
     */
    public static init(context: vscode.ExtensionContext): void {
        // Đăng ký lệnh kiểm tra cập nhật thủ công
        context.subscriptions.push(
            vscode.commands.registerCommand('antigravity-cockpit.checkForUpdates', async () => {
                await this.checkAndApplyUpdate(context, true);
            })
        );

        // Tự động kiểm tra sau 10 giây khi khởi động IDE
        setTimeout(() => {
            this.checkAndApplyUpdate(context, false).catch(err => {
                console.log('[UpdateManager] Background update check:', err.message);
            });
        }, 10000);

        // Định kỳ kiểm tra mỗi 4 tiếng
        this._checkTimer = setInterval(() => {
            this.checkAndApplyUpdate(context, false).catch(err => {
                console.log('[UpdateManager] Periodic update check:', err.message);
            });
        }, 4 * 60 * 60 * 1000);
    }

    public static dispose(): void {
        if (this._checkTimer) {
            clearInterval(this._checkTimer);
            this._checkTimer = null;
        }
    }

    /**
     * Kiểm tra phiên bản mới nhất trên GitHub và tự động tải/cài đặt
     */
    public static async checkAndApplyUpdate(context: vscode.ExtensionContext, isManual = false): Promise<void> {
        if (this._isUpdating) return;

        const currentVersion = context.extension.packageJSON.version || '1.0.0';

        if (isManual) {
            vscode.window.setStatusBarMessage('🔄 Đang kiểm tra bản cập nhật Antigravity Personal...', 3000);
        }

        try {
            let latestVersion = '';
            let downloadUrl = '';
            let releaseNotes = '';

            // 1. Thử lấy từ GitHub Releases API
            try {
                const res = await axios.get(GITHUB_RELEASES_API, {
                    headers: { 'User-Agent': 'Antigravity-Personal-Updater' },
                    timeout: 8000
                });

                if (res.status === 200 && res.data) {
                    latestVersion = (res.data.tag_name || '').replace(/^v/, '');
                    releaseNotes = res.data.body || '';
                    const vsixAsset = (res.data.assets || []).find((a: any) => a.name && a.name.endsWith('.vsix'));
                    if (vsixAsset && vsixAsset.browser_download_url) {
                        downloadUrl = vsixAsset.browser_download_url;
                    }
                }
            } catch (_e) {
                // Fallback nếu chưa tạo release: kiểm tra raw package.json trên main
            }

            // 2. Fallback sang raw package.json nếu không có release asset
            if (!latestVersion) {
                try {
                    const rawPkgRes = await axios.get(GITHUB_RAW_PACKAGE_JSON, {
                        headers: { 'User-Agent': 'Antigravity-Personal-Updater' },
                        timeout: 8000
                    });
                    if (rawPkgRes.status === 200 && rawPkgRes.data && rawPkgRes.data.version) {
                        latestVersion = rawPkgRes.data.version;
                        downloadUrl = `https://github.com/${GITHUB_REPO}/releases/download/v${latestVersion}/antigravity-personal-${latestVersion}.vsix`;
                    }
                } catch (_e) { }
            }

            if (!latestVersion) {
                if (isManual) {
                    vscode.window.showInformationMessage('✅ Bạn đang sử dụng phiên bản mới nhất (v' + currentVersion + ')');
                }
                return;
            }

            // So sánh phiên bản
            if (!isNewerVersion(latestVersion, currentVersion)) {
                if (isManual) {
                    vscode.window.showInformationMessage(`✅ Extension đã ở phiên bản mới nhất: v${currentVersion}`);
                }
                return;
            }

            console.log(`[UpdateManager] 🚀 Phát hiện phiên bản mới: v${latestVersion} (Hiện tại: v${currentVersion})`);

            if (!downloadUrl) {
                downloadUrl = `https://github.com/${GITHUB_REPO}/releases/download/v${latestVersion}/antigravity-personal-${latestVersion}.vsix`;
            }

            // Tiến hành tải và cập nhật
            this._isUpdating = true;
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: `⚡ Đang tự động cập nhật Antigravity Personal lên v${latestVersion}...`,
                cancellable: false
            }, async (progress) => {
                progress.report({ increment: 20, message: 'Đang tải bản cài đặt .vsix từ GitHub...' });

                const tmpDir = os.tmpdir();
                const vsixPath = path.join(tmpDir, `antigravity-personal-${latestVersion}.vsix`);

                const downloadRes = await axios.get(downloadUrl, {
                    responseType: 'arraybuffer',
                    headers: { 'User-Agent': 'Antigravity-Personal-Updater' },
                    timeout: 30000
                });

                fs.writeFileSync(vsixPath, Buffer.from(downloadRes.data));

                progress.report({ increment: 60, message: 'Đang cài đặt phiên bản mới vào IDE...' });

                // Cài đặt VSIX vào IDE
                await vscode.commands.executeCommand('workbench.extensions.installExtension', vscode.Uri.file(vsixPath));

                try { fs.unlinkSync(vsixPath); } catch (_) { }

                progress.report({ increment: 20, message: 'Hoàn tất cập nhật!' });
            });

            this._isUpdating = false;

            // Thông báo người dùng khởi động lại IDE để hoàn tất
            const reloadChoice = await vscode.window.showInformationMessage(
                `🚀 Antigravity Personal đã tự động cập nhật lên phiên bản v${latestVersion}! Khởi động lại IDE để áp dụng ngay.`,
                'Khởi động lại ngay',
                'Để sau'
            );

            if (reloadChoice === 'Khởi động lại ngay') {
                vscode.commands.executeCommand('workbench.action.reloadWindow');
            }

        } catch (err: any) {
            this._isUpdating = false;
            console.error('[UpdateManager] Lỗi kiểm tra cập nhật:', err.message);
            if (isManual) {
                vscode.window.showErrorMessage(`❌ Không thể kiểm tra cập nhật: ${err.message}`);
            }
        }
    }
}
