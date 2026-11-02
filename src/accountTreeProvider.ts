import * as vscode from 'vscode';
import { AccountManager } from './accountManager';

export class AccountTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<vscode.TreeItem | undefined | void> = new vscode.EventEmitter<vscode.TreeItem | undefined | void>();
    readonly onDidChangeTreeData: vscode.Event<vscode.TreeItem | undefined | void> = this._onDidChangeTreeData.event;

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: AccountItem): Promise<(AccountItem | QuotaItem | vscode.TreeItem)[]> {
        if (!element) {
            // Root - List accounts
            const index = AccountManager.loadIndex();
            if (!index.accounts || index.accounts.length === 0) {
                const emptyItem = new vscode.TreeItem("Chưa có tài khoản (Click để mở Bảng điều khiển)");
                emptyItem.iconPath = new vscode.ThemeIcon('info');
                emptyItem.command = {
                    command: 'antigravity-cockpit.openDashboard',
                    title: 'Mở Bảng Điều Khiển'
                };
                return [emptyItem];
            }
            return index.accounts.map(acc => {
                const isCurrent = acc.id === index.current_account_id;
                return new AccountItem(
                    acc.email,
                    acc.name,
                    acc.id,
                    isCurrent ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed,
                    isCurrent
                );
            });
        } else {
            // Account details - List quotas
            try {
                const account = AccountManager.loadAccount(element.accountId);
                if (!account.token) {
                    return [];
                }

                // Check if token needs refresh
                let token = account.token;
                if (Date.now() / 1000 > token.expiry_timestamp - 300) {
                    const refreshed = await AccountManager.refreshToken(token.refresh_token);
                    token.access_token = refreshed.accessToken;
                    token.expiry_timestamp = Math.floor(Date.now() / 1000) + refreshed.expiresIn;
                    account.token = token;
                    AccountManager.saveAccount(account);
                }

                const quota = await AccountManager.fetchQuotaCached(token.access_token);
                if (quota.is_forbidden) {
                    return [new QuotaItem("Forbidden", "No access", vscode.TreeItemCollapsibleState.None)];
                }

                return quota.models.map((m: any) => {
                    const label = m.displayName || m.name;
                    const weeklyText = m.has_weekly ? `Tuần: ${m.weekly_percentage}%` : '';
                    const fiveHText = m.has_5h ? `5H: ${m.percentage}%` : `${m.percentage}%`;
                    const desc = m.has_weekly && m.has_5h ? `${fiveHText} | ${weeklyText}` : `${m.percentage}%`;
                    const tooltip = `${label}\n- Hạn mức 5H: ${m.percentage}% (Reset: ${m.reset_time || '-'})\n` +
                                    (m.has_weekly ? `- Hạn mức Tuần: ${m.weekly_percentage}% (Reset: ${m.weekly_reset_time || '-'})\n` : '');
                    return new QuotaItem(label, desc, vscode.TreeItemCollapsibleState.None, m.percentage, tooltip);
                });
            } catch (e) {
                return [new QuotaItem("Error", (e as Error).message, vscode.TreeItemCollapsibleState.None)];
            }
        }
    }
}

class AccountItem extends vscode.TreeItem {
    constructor(
        public readonly email: string,
        public readonly name: string,
        public readonly accountId: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly isCurrent: boolean
    ) {
        super(email, collapsibleState);
        this.tooltip = `${name} (${email})`;
        this.description = name;
        this.contextValue = 'account';
        if (isCurrent) {
            this.iconPath = new vscode.ThemeIcon('check', new vscode.ThemeColor('charts.green'));
        } else {
            this.iconPath = new vscode.ThemeIcon('account');
        }
    }
}

class QuotaItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly percentage: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        numericPct?: number,
        customTooltip?: string
    ) {
        super(label, collapsibleState);
        this.description = percentage;
        this.tooltip = customTooltip || `${label}: ${percentage}`;

        const num = numericPct !== undefined ? numericPct : parseInt(percentage);
        if (!isNaN(num)) {
            if (num > 50) {
                this.iconPath = new vscode.ThemeIcon('circle-filled', new vscode.ThemeColor('charts.green'));
            } else if (num > 20) {
                this.iconPath = new vscode.ThemeIcon('circle-filled', new vscode.ThemeColor('charts.yellow'));
            } else {
                this.iconPath = new vscode.ThemeIcon('circle-filled', new vscode.ThemeColor('charts.red'));
            }
        }
    }
}
