/**
 * i18n — 主进程层
 *
 * 职责：
 * - 初始化 i18next 实例，加载语言资源文件
 * - 根据配置/系统 locale 解析默认语言
 * - 通过 IPC 向渲染进程提供语言数据和切换能力
 */
import { app, ipcMain } from 'electron';
import path from 'path';
import fsp from 'fs/promises';
import { createInstance } from 'i18next';
import EventEmitter from 'eventemitter3';
import type { IAppConfigReader } from '@appTypes/infra/appConfig';
import type { ILanguageContent } from '@appTypes/infra/i18n';
import { IPC } from './common/constant';

const i18nInstance = createInstance();

interface IEvents {
    languageChanged: [lang: string];
}

class I18n {
    public readonly t = i18nInstance.t.bind(i18nInstance);

    /** 当前生效的界面语言（可能来自用户选择，也可能由系统语言推断） */
    public get language(): string {
        return i18nInstance.language;
    }

    private readonly eventEmitter = new EventEmitter<IEvents>();

    private readonly ns = 'translation';

    private get resPath(): string {
        return globalContext.appPath.res;
    }

    private allLangNames: string[] = [];

    private isSetup = false;

    public on<T extends keyof IEvents>(event: T, listener: (...args: IEvents[T]) => void) {
        this.eventEmitter.on(event, listener);
    }

    public off<T extends keyof IEvents>(event: T, listener: (...args: IEvents[T]) => void) {
        this.eventEmitter.off(event, listener);
    }

    public async setup(appConfigReader: IAppConfigReader) {
        if (this.isSetup) {
            return;
        }

        const preferredLanguage = appConfigReader.getConfigByKey('normal.language');

        try {
            await i18nInstance.init({
                resources: {},
            });

            await this.loadAllLangNames();

            const defaultLang = this.resolveDefaultLang(preferredLanguage);
            if (defaultLang) {
                await this.changeLanguage(defaultLang);
            }

            this.registerIpcHandlers();
            this.isSetup = true;
        } catch (e) {
            console.error('I18N Setup Error', e as Error);
        }
    }

    public async changeLanguage(lang: string): Promise<ILanguageContent | null> {
        if (i18nInstance.hasResourceBundle(lang, this.ns)) {
            await i18nInstance.changeLanguage(lang);
            this.eventEmitter.emit('languageChanged', lang);
            return {
                lang,
                content: i18nInstance.getResourceBundle(lang, this.ns),
            };
        }

        const langContent = await this.readLangContent(lang);
        if (!langContent) {
            return null;
        }

        i18nInstance.addResourceBundle(lang, this.ns, langContent);
        await i18nInstance.changeLanguage(lang);
        this.eventEmitter.emit('languageChanged', lang);

        return {
            lang,
            content: langContent,
        };
    }

    private async loadAllLangNames() {
        const basicDir = this.getResPath('./lang');
        const dirContents = await fsp.readdir(basicDir, {
            withFileTypes: true,
        });

        this.allLangNames = dirContents
            .filter((it) => it.isFile() && it.name.endsWith('.json'))
            .map((it) => it.name.slice(0, -5));
    }

    private resolveDefaultLang(preferredLanguage?: string | null) {
        // 用户显式选择过语言（且资源存在）时始终尊重该选择
        if (preferredLanguage && this.allLangNames.includes(preferredLanguage)) {
            return preferredLanguage;
        }

        return this.resolveSystemLang();
    }

    /**
     * 按系统首选语言推断界面语言：
     *  - 中文系统：繁体（Hant / TW / HK / MO）→ zh-TW，其余 → zh-CN
     *  - 其他系统：有同名语言包则使用，否则回退到 en-US
     */
    private resolveSystemLang(): string {
        const systemLocale = app.getPreferredSystemLanguages()[0] || app.getLocale() || '';
        const has = (lang: string) => this.allLangNames.includes(lang);

        if (/^zh(?:[-_]|$)/i.test(systemLocale)) {
            const isTraditional = /^zh[-_](hant|tw|hk|mo)\b/i.test(systemLocale);
            if (isTraditional && has('zh-TW')) {
                return 'zh-TW';
            }
            if (has('zh-CN')) {
                return 'zh-CN';
            }
        }

        if (has(systemLocale)) {
            return systemLocale;
        }

        if (has('en-US')) {
            return 'en-US';
        }

        return 'zh-CN';
    }

    private getResPath(resourceName: string) {
        return path.resolve(this.resPath, resourceName);
    }

    private async readLangContent(langCode: string, enableRedirect = true): Promise<object | null> {
        const langPath = path.resolve(this.getResPath(`./lang/${langCode}.json`));
        try {
            const content = await fsp.readFile(langPath, 'utf8');
            const jsonObj = JSON.parse(content) as Record<string, unknown>;
            if (jsonObj.$alias && enableRedirect) {
                return this.readLangContent(String(jsonObj.$alias), false);
            }
            return jsonObj;
        } catch {
            return null;
        }
    }

    private registerIpcHandlers() {
        ipcMain.handle(IPC.SETUP, async () => {
            const currentLang = i18nInstance.language;
            const langContent = await this.readLangContent(currentLang);
            if (!langContent) {
                return null;
            }

            return {
                lang: currentLang,
                content: langContent,
                allLangs: this.allLangNames,
            };
        });

        ipcMain.handle(IPC.CHANGE_LANG, async (_, lang: string) => {
            return this.changeLanguage(lang);
        });
    }
}

const i18n = new I18n();

export default i18n;
