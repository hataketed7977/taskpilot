import { useTranslation } from 'react-i18next';
import { useLocale } from '../i18n/locale-state';
import { SUPPORTED_LOCALES, type SupportedLocale } from '../i18n/locale';
import { Select, type SelectOption } from './select';

export type LanguageSelectorVariant = 'floating' | 'inline' | 'account';

export function LanguageSelector({ variant = 'floating' }: { variant?: LanguageSelectorVariant }) {
  const { locale, changeLocale } = useLocale();
  const { t } = useTranslation();
  const options: readonly SelectOption[] = SUPPORTED_LOCALES.map((value) => ({
    value,
    label: value === 'zh-CN' ? t('language.chinese') : t('language.english'),
  }));

  const selector = (
    <Select
      ariaLabel={t('language.label')}
      value={locale}
      options={options}
      onValueChange={(next) => void changeLocale(next as SupportedLocale)}
      variant="compact"
      onPointerDownOutside={variant === 'account' ? preventAccountTriggerOutsidePointerDown : undefined}
    />
  );

  if (variant === 'account') {
    return (
      <div className="account-language account-menu__row">
        <span className="account-menu__icon" aria-hidden="true"><GlobeIcon /></span>
        <span className="account-menu__row-label">{t('language.label')}</span>
        {selector}
      </div>
    );
  }

  return (
    <div className={`language-selector${variant === 'inline' ? ' language-selector--inline' : ''}`}>
      <GlobeIcon />
      {selector}
    </div>
  );
}

function GlobeIcon() {
  return (
    <svg className="language-selector__icon" viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="10" cy="10" r="7.25" />
      <path d="M2.9 10h14.2M10 2.75c2.05 2.02 3.1 4.44 3.1 7.25S12.05 15.23 10 17.25C7.95 15.23 6.9 12.81 6.9 10S7.95 4.77 10 2.75Z" />
    </svg>
  );
}

function preventAccountTriggerOutsidePointerDown(event: CustomEvent<{ originalEvent: PointerEvent }>) {
  if (event.detail.originalEvent.composedPath().some((target) => target instanceof Element && target.closest('.account-trigger'))) {
    event.preventDefault();
  }
}
