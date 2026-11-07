import { useTranslation } from 'react-i18next';

export function TextFeedback({
  id,
  count,
  limit,
  showCount,
  limitReached,
  error,
}: {
  id: string;
  count: number;
  limit: number;
  showCount: boolean;
  limitReached: boolean;
  error?: string;
}) {
  const { t } = useTranslation();
  return (
    <span className="text-feedback" id={id}>
      <span className="text-feedback__message" role={error ? 'alert' : undefined}>{error ?? ''}</span>
      <span className="text-feedback__meta">
        {limitReached ? <span role="status">{t('common.limitReached')}</span> : null}
        {showCount ? <span aria-label={t('common.characterCount', { count, limit })}>{count} / {limit}</span> : null}
      </span>
    </span>
  );
}
