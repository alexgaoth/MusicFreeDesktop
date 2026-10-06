import { useTranslation } from 'react-i18next';
import { SettingsCard } from '../components/SettingsCard';
import { SettingRow } from '../components/SettingRow';
import { Badge } from '@renderer/mainWindow/components/ui/Badge';
import { Select } from '@renderer/mainWindow/components/ui/Select';
import { Toggle } from '@renderer/mainWindow/components/ui/Toggle';
import appConfig from '@infra/appConfig/renderer';
import { useCurrentContext } from '@infra/contextEngine/renderer';
import { setDefaultContext, useContextConfig } from '@renderer/mainWindow/common/contextConfig';
import type { ContextHelperStatus, ContextMeetingAction } from '@appTypes/infra/contextEngine';
import { ContextStatus } from './context/ContextStatus';
import { ContextList } from './context/ContextList';
import { RuleList } from './context/RuleList';
import { NumberField } from './context/NumberField';
import './context/index.scss';

function HelperStatusBadge({ status }: { status: ContextHelperStatus | undefined }) {
    const { t } = useTranslation();
    switch (status) {
        case 'running':
            return <Badge variant="tint">{t('settings.context.helper_running')}</Badge>;
        case 'starting':
            return <Badge variant="outline">{t('settings.context.helper_starting')}</Badge>;
        case 'unavailable':
            return (
                <Badge variant="outline" colorScheme="warn">
                    {t('settings.context.helper_unavailable')}
                </Badge>
            );
        default:
            return <Badge variant="outline">{t('settings.context.helper_stopped')}</Badge>;
    }
}

/**
 * Soundtrack (context) settings
 *
 * Config keys: context.enabled, context.contexts, context.rules, context.defaultContextId,
 *              context.debounceSec, context.minDwellSec, context.meetingAction
 */
export function ContextSection() {
    const { t } = useTranslation();
    const config = useContextConfig();
    const state = useCurrentContext();

    const helperStatus = state?.helperStatus;

    return (
        <>
            <SettingsCard
                title={t('settings.section_name.context')}
                subtitle={t('settings.context.subtitle')}
            >
                <SettingRow
                    label={t('settings.context.enabled_label')}
                    description={t('settings.context.enabled_desc')}
                    control={
                        <Toggle
                            checked={config.enabled}
                            onChange={(checked) =>
                                appConfig.setConfig({ 'context.enabled': checked })
                            }
                        />
                    }
                />
                <SettingRow
                    label={t('settings.context.helper_label')}
                    description={
                        helperStatus === 'unavailable'
                            ? t('settings.context.helper_unavailable_desc')
                            : t('settings.context.helper_desc')
                    }
                    control={<HelperStatusBadge status={helperStatus} />}
                />
                <ContextStatus config={config} />
            </SettingsCard>

            <SettingsCard
                title={t('settings.context.contexts_title')}
                subtitle={t('settings.context.contexts_subtitle')}
            >
                <SettingRow
                    label={t('settings.context.default_context_label')}
                    description={t('settings.context.default_context_desc')}
                    control={
                        <Select
                            value={config.defaultContextId}
                            onChange={setDefaultContext}
                            options={config.contexts.map((ctx) => ({
                                value: ctx.id,
                                label: ctx.name,
                            }))}
                        />
                    }
                />
                <ContextList config={config} />
            </SettingsCard>

            <SettingsCard
                title={t('settings.context.rules_title')}
                subtitle={t('settings.context.rules_subtitle')}
            >
                <RuleList config={config} />
            </SettingsCard>

            <SettingsCard
                title={t('settings.context.timing_title')}
                subtitle={t('settings.context.timing_subtitle')}
            >
                <SettingRow
                    label={t('settings.context.debounce_label')}
                    description={t('settings.context.debounce_desc')}
                    control={
                        <NumberField
                            value={config.debounceSec}
                            min={0}
                            max={600}
                            unit={t('settings.context.seconds_unit')}
                            aria-label={t('settings.context.debounce_label')}
                            onCommit={(value) =>
                                appConfig.setConfig({ 'context.debounceSec': value })
                            }
                        />
                    }
                />
                <SettingRow
                    label={t('settings.context.dwell_label')}
                    description={t('settings.context.dwell_desc')}
                    control={
                        <NumberField
                            value={Math.round(config.minDwellSec / 60)}
                            min={0}
                            max={120}
                            unit={t('settings.context.minutes_unit')}
                            aria-label={t('settings.context.dwell_label')}
                            onCommit={(value) =>
                                appConfig.setConfig({ 'context.minDwellSec': value * 60 })
                            }
                        />
                    }
                />
                <SettingRow
                    label={t('settings.context.meeting_label')}
                    description={t('settings.context.meeting_desc')}
                    control={
                        <Select
                            value={config.meetingAction}
                            onChange={(value) =>
                                appConfig.setConfig({
                                    'context.meetingAction': value as ContextMeetingAction,
                                })
                            }
                            options={[
                                { value: 'duck', label: t('settings.context.meeting_duck') },
                                { value: 'pause', label: t('settings.context.meeting_pause') },
                                { value: 'none', label: t('settings.context.meeting_none') },
                            ]}
                        />
                    }
                />
            </SettingsCard>
        </>
    );
}
