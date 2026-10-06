/** localStorage 缓存 key */
export const THEMEPACK_STORAGE_KEY = 'themepack-cache';

/** 注入到 <head> 的 <style> 节点 ID */
export const THEMEPACK_STYLE_NODE_ID = 'themepack-style';

/** BlurHash 占位层的 DOM 节点 ID */
export const THEMEPACK_BLURHASH_NODE_ID = 'themepack-blurhash';

/** 背景 iframe 的 DOM 节点 ID */
export const THEMEPACK_IFRAME_NODE_ID = 'themepack-iframe';

/** 主题包安装目录名（位于 userData 下） */
export const THEMEPACK_DIR_NAME = 'musicfree-themepacks';

/** 内置主题包目录名（位于 res 下） */
export const BUILTIN_THEME_DIR_NAME = 'builtin-themes';

/** 新配置（从未选择过主题）首次启动时应用的内置主题目录名 */
export const DEFAULT_BUILTIN_THEME_DIR = 'soundtrack';

/**
 * localStorage 标记：已做过「新配置默认主题」判定。
 * 写入后不再自动应用默认主题，用户之后的任何选择（包括「默认主题」）都会被保留。
 */
export const THEMEPACK_DEFAULT_APPLIED_KEY = 'themepack-default-applied';

/** IPC 通道 */
export const IPC = {
    THEME_SWITCHED: '@infra/themepack/theme-switched',
} as const;

/** contextBridge key */
export const CONTEXT_BRIDGE_KEY = '@infra/themepack';
