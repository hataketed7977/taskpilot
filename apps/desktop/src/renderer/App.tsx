import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  AuthCapabilities,
  FederatedAuthFlowView,
  SessionView,
  TaskPilotDesktopApi,
} from '../shared/contracts';
import { useLocale } from './i18n/locale-state';
import { currentLegalBundle, formatLegalEffectiveDate, legalDocument, type LegalBundle, type LegalDocumentKind } from './legal/legal-bundle';
import { displayNameInitials } from './profile';

type CodedError = Error & { code?: string; path?: string; retryAfterSeconds?: number; recovery?: string };
type CapabilityState = 'loading' | 'ready' | 'unavailable';
type AuthIssue = 'offline' | 'expired' | 'unable';



export function App({ api }: { api: TaskPilotDesktopApi }) {
  const { t } = useTranslation();
  const [session, setSession] = useState<SessionView>({ status: 'restoring' });

  useEffect(() => {
    let active = true;
    void api.auth.getSessionView().then((view) => {
      if (active) setSession(view);
    });
    const unsubscribe = api.auth.subscribeSessionView((view) => {
      if (active) setSession(view);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [api]);

  if (session.status === 'restoring') {
    return <main id="main-content" className="center"><LanguageSelector /><p role="status">{t('session.restoring')}</p></main>;
  }
  if (session.status === 'temporarilyUnavailable') {
    return (
      <main id="main-content" className="center">
        <section className="notice" aria-labelledby="connection-title">
          <LanguageSelector inline />
          <h1 id="connection-title">{t('session.unavailableTitle')}</h1>
          <p>{t('session.unavailableDetail')}</p>
          <button type="button" onClick={() => window.location.reload()}>{t('common.retry')}</button>
        </section>
      </main>
    );
  }
  if (session.status === 'signedOut') {
    return <AuthExperience auth={api.auth} onAuthenticated={(currentUser) => setSession({ status: 'authenticated', currentUser })} />;
  }
  return <AccountHome auth={api.auth} session={session} />;
}

function AuthExperience({ auth, onAuthenticated }: {
  auth: AuthCapabilities;
  onAuthenticated(currentUser: Extract<SessionView, { status: 'authenticated' }>['currentUser']): void;
}) {
  const { t } = useTranslation();
  const [capability, setCapability] = useState<CapabilityState>('loading');
  const [flow, setFlow] = useState<FederatedAuthFlowView>();
  const [issue, setIssue] = useState<AuthIssue>();
  const [pending, setPending] = useState<'start' | 'register' | 'cancel'>();
  const operation = useRef(false);
  const generation = useRef(0);

  const loadCapabilities = useCallback(async () => {
    const currentGeneration = ++generation.current;
    setCapability('loading');
    setIssue(undefined);
    try {
      const result = await auth.getCapabilities();
      if (currentGeneration === generation.current) setCapability(result.github.enabled ? 'ready' : 'unavailable');
    } catch {
      if (currentGeneration === generation.current) {
        setCapability('unavailable');
        setIssue('offline');
      }
    }
  }, [auth]);

  useEffect(() => {
    queueMicrotask(() => void loadCapabilities());
    return () => { generation.current += 1; };
  }, [loadCapabilities]);

  const acceptView = useCallback((view: FederatedAuthFlowView) => {
    setIssue(undefined);
    setFlow(view);
    if (view.status === 'authenticated') onAuthenticated(view.currentUser);
  }, [onAuthenticated]);

  const classifyIssue = useCallback((error: unknown) => {
    const { code, category } = error as CodedError & { category?: string };
    if (code === 'FEDERATED_LOGIN_EXPIRED' || code === 'FEDERATED_LOGIN_CONTEXT_INVALID') return setIssue('expired');
    if (code === 'NETWORK_UNAVAILABLE' || category === 'temporary' || code === 'AUTHENTICATION_TEMPORARILY_UNAVAILABLE') {
      return setIssue('offline');
    }
    return setIssue('unable');
  }, []);

  const start = useCallback(async () => {
    if (operation.current) return;
    operation.current = true;
    const currentGeneration = ++generation.current;
    setPending('start');
    setIssue(undefined);
    setFlow(undefined);
    try {
      const view = await auth.startGitHubSignIn();
      if (currentGeneration === generation.current) acceptView(view);
    } catch (error) {
      if (currentGeneration === generation.current) classifyIssue(error);
    } finally {
      if (currentGeneration === generation.current) setPending(undefined);
      operation.current = false;
    }
  }, [acceptView, auth, classifyIssue]);

  const continueFlow = useCallback(async () => {
    if (operation.current) return;
    const flowId = flow && 'flowId' in flow ? flow.flowId : undefined;
    if (!flowId) return void start();
    operation.current = true;
    const currentGeneration = generation.current;
    try {
      const view = await auth.continueGitHubSignIn({ flowId });
      if (currentGeneration === generation.current) acceptView(view);
    } catch (error) {
      if (currentGeneration === generation.current) classifyIssue(error);
    } finally {
      operation.current = false;
    }
  }, [acceptView, auth, classifyIssue, flow, start]);

  useEffect(() => {
    if (issue || (flow?.status !== 'waiting' && flow?.status !== 'completionRequired')) return undefined;
    const timer = window.setTimeout(() => { void continueFlow(); }, 1_000);
    return () => window.clearTimeout(timer);
  }, [continueFlow, flow?.status, issue]);

  const cancel = useCallback(async () => {
    if (operation.current || !flow || !('flowId' in flow)) return;
    operation.current = true;
    ++generation.current;
    setPending('cancel');
    try {
      await auth.cancelGitHubSignIn({ flowId: flow.flowId });
      setIssue(undefined);
      setFlow(undefined);
    } catch (error) {
      classifyIssue(error);
    } finally {
      setPending(undefined);
      operation.current = false;
    }
  }, [auth, classifyIssue, flow]);

  const restart = useCallback(() => {
    ++generation.current;
    setFlow(undefined);
    setIssue(undefined);
    setPending(undefined);
    operation.current = false;
  }, []);

  return (
    <>
      <a className="skip-link" href="#main-content">{t('auth.skip')}</a>
      <main id="main-content" className="auth-layout">
        <aside className="brand-panel">
          <div className="wordmark"><span>TP</span> TaskPilot</div>
          <div>
            <p className="eyebrow">{t('auth.brandEyebrow')}</p>
            <h1>{t('auth.brandTitleLine1')}<br />{t('auth.brandTitleLine2')}</h1>
            <p className="brand-copy">{t('auth.brandCopy')}</p>
          </div>
          <p className="trust-note">{t('auth.trustNote')}</p>
        </aside>
        <section className="auth-panel" aria-label={t('auth.region')}>
          <LanguageSelector />
          <div className="auth-card">
            <AuthContent
              auth={auth}
              capability={capability}
              flow={flow}
              issue={issue}
              pending={pending}
              onReloadCapabilities={loadCapabilities}
              onStart={start}
              onContinue={continueFlow}
              onCancel={cancel}
              onRestart={restart}
              onView={acceptView}
              onIssue={classifyIssue}
            />
          </div>
        </section>
      </main>
    </>
  );
}

function AuthContent(props: {
  auth: AuthCapabilities;
  capability: CapabilityState;
  flow?: FederatedAuthFlowView;
  issue?: AuthIssue;
  pending?: 'start' | 'register' | 'cancel';
  onReloadCapabilities(): Promise<void>;
  onStart(): Promise<void>;
  onContinue(): Promise<void>;
  onCancel(): Promise<void>;
  onRestart(): void;
  onView(view: FederatedAuthFlowView): void;
  onIssue(error: unknown): void;
}) {
  const { t } = useTranslation();
  if (props.capability === 'loading') {
    return <AuthNotice eyebrow={t('auth.security')} title={t('auth.checkingTitle')} status={t('auth.checkingStatus')} />;
  }
  if (props.capability === 'unavailable') {
    return (
      <AuthNotice eyebrow={t('auth.security')} title={props.issue === 'offline' ? t('session.unavailableTitle') : t('auth.unavailableTitle')}
        alert={props.issue === 'offline' ? t('auth.unavailableOffline') : t('auth.unavailableConfig')}>
        <button type="button" className="primary" onClick={() => void props.onReloadCapabilities()}>{t('auth.recheck')}</button>
      </AuthNotice>
    );
  }
  if (props.issue) return <AuthIssueView issue={props.issue} onRetry={props.onContinue} onRestart={props.onRestart} />;
  if (!props.flow) {
    return (
      <>
        <p className="eyebrow">{t('auth.security')}</p>
        <h2>{t('auth.title')}</h2>
        <p className="muted">{t('auth.description')}</p>
        <button type="button" className="primary github-action" disabled={props.pending === 'start'} onClick={() => void props.onStart()}>
          <GitHubMark /><span translate="no">{props.pending === 'start' ? t('auth.opening') : t('auth.signIn')}</span>
        </button>
        {props.pending === 'start' ? <p className="flow-status" role="status">{t('auth.openingBrowser')}</p> : null}
        <p className="auth-footnote">{t('auth.footnote')}</p>
      </>
    );
  }
  if (props.flow.status === 'registrationRequired') {
    return <GitHubRegistration auth={props.auth} view={props.flow} cancelling={props.pending === 'cancel'} onCancel={props.onCancel} onView={props.onView} onIssue={props.onIssue} />;
  }
  if (props.flow.status === 'waiting' || props.flow.status === 'completionRequired') {
    return (
      <AuthNotice eyebrow="GitHub" title={t('auth.browserTitle')}
        status={props.flow.status === 'completionRequired' ? t('auth.browserCompletion') : t('auth.browserWaiting')}>
        <div className="browser-wait" aria-hidden="true"><span /><span /><span /></div>
        <button type="button" className="secondary" disabled={props.pending === 'cancel'} onClick={() => void props.onCancel()}>
          {props.pending === 'cancel' ? t('auth.cancelling') : t('auth.cancel')}
        </button>
      </AuthNotice>
    );
  }
  if (props.flow.status === 'authenticated') {
    return <AuthNotice eyebrow={t('auth.security')} title={t('auth.completeTitle')} status={t('auth.entering')} />;
  }
  const terminal: Record<'denied' | 'cancelled' | 'expired' | 'failed' | 'resultUnavailable', { title: string; detail: string }> = {
    denied: { title: t('auth.terminal.denied.title'), detail: t('auth.terminal.denied.detail') },
    cancelled: { title: t('auth.terminal.cancelled.title'), detail: t('auth.terminal.cancelled.detail') },
    expired: { title: t('auth.terminal.expired.title'), detail: t('auth.terminal.expired.detail') },
    failed: { title: t('auth.terminal.failed.title'), detail: t('auth.terminal.failed.detail') },
    resultUnavailable: { title: t('auth.terminal.resultUnavailable.title'), detail: t('auth.terminal.resultUnavailable.detail') },
  };
  const copy = terminal[props.flow.status];
  return (
    <AuthNotice eyebrow="GitHub" title={copy.title} alert={copy.detail}>
      <button type="button" className="primary" onClick={props.onRestart}>{t('common.restart')}</button>
    </AuthNotice>
  );
}

function AuthIssueView({ issue, onRetry, onRestart }: { issue: AuthIssue; onRetry(): Promise<void>; onRestart(): void }) {
  const { t } = useTranslation();
  const copy: Record<AuthIssue, { title: string; detail: string; retry: boolean }> = {
    offline: { title: t('auth.issue.offline.title'), detail: t('auth.issue.offline.detail'), retry: true },
    expired: { title: t('auth.issue.expired.title'), detail: t('auth.issue.expired.detail'), retry: false },
    unable: { title: t('auth.issue.unable.title'), detail: t('auth.issue.unable.detail'), retry: false },
  };
  return (
    <AuthNotice eyebrow="GitHub" title={copy[issue].title} alert={copy[issue].detail}>
      {copy[issue].retry
        ? <button type="button" className="primary" onClick={() => void onRetry()}>{t('common.retry')}</button>
        : <button type="button" className="primary" onClick={onRestart}>{t('common.restart')}</button>}
    </AuthNotice>
  );
}

function AuthNotice({ eyebrow, title, status, alert, children }: {
  eyebrow: string; title: string; status?: string; alert?: string; children?: React.ReactNode;
}) {
  return (
    <>
      <p className="eyebrow">{eyebrow}</p>
      <h2>{title}</h2>
      {status ? <p className="muted flow-status" role="status">{status}</p> : null}
      {alert ? <p className="error" role="alert">{alert}</p> : null}
      {children}
    </>
  );
}

function GitHubRegistration({ auth, view, cancelling, onCancel, onView, onIssue }: {
  auth: AuthCapabilities;
  view: Extract<FederatedAuthFlowView, { status: 'registrationRequired' }>;
  cancelling: boolean;
  onCancel(): Promise<void>;
  onView(result: FederatedAuthFlowView): void;
  onIssue(error: unknown): void;
}) {
  const { locale } = useLocale();
  const { t } = useTranslation();
  const legalBundle = currentLegalBundle(locale);
  const [displayName, setDisplayName] = useState(view.suggestedDisplayName);
  const [acceptedLocale, setAcceptedLocale] = useState<typeof locale>();
  const [legalDocumentKind, setLegalDocumentKind] = useState<LegalDocumentKind>();
  const [useSuggestedAvatar, setUseSuggestedAvatar] = useState(Boolean(view.suggestedAvatarUrl));
  const [avatarAvailable, setAvatarAvailable] = useState(Boolean(view.suggestedAvatarUrl));
  const [pending, setPending] = useState(false);
  const [errorKey, setErrorKey] = useState<'errorName' | 'errorConsent' | 'errorValidation'>();
  const [errorPath, setErrorPath] = useState<string>();
  const operation = useRef(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const termsRef = useRef<HTMLInputElement>(null);
  const termsLinkRef = useRef<HTMLButtonElement>(null);
  const privacyLinkRef = useRef<HTMLButtonElement>(null);
  const legalReturnFocus = useRef<LegalDocumentKind | undefined>(undefined);
  const errorId = 'github-registration-error';
  const legalBundleSupported = legalBundle !== undefined && view.legalBundleVersion === legalBundle.version;
  const acceptedTerms = acceptedLocale === locale;
  const error = errorKey ? {
    errorName: t('registration.errorName'),
    errorConsent: t('registration.errorConsent'),
    errorValidation: t('registration.errorValidation'),
  }[errorKey] : '';

  useEffect(() => {
    if (legalDocumentKind || !legalReturnFocus.current) return;
    const target = legalReturnFocus.current === 'terms' ? termsLinkRef.current : privacyLinkRef.current;
    legalReturnFocus.current = undefined;
    target?.focus();
  }, [legalDocumentKind]);

  const openLegalDocument = (kind: LegalDocumentKind) => {
    legalReturnFocus.current = kind;
    setLegalDocumentKind(kind);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (operation.current || !legalBundleSupported || !legalBundle) return;
    const normalizedName = displayName.trim();
    if (!normalizedName) {
      setErrorKey('errorName');
      setErrorPath('displayName');
      nameRef.current?.focus();
      return;
    }
    if (!acceptedTerms) {
      setErrorKey('errorConsent');
      setErrorPath('termsVersion');
      termsRef.current?.focus();
      return;
    }
    operation.current = true;
    setPending(true);
    setErrorKey(undefined);
    setErrorPath(undefined);
    try {
      const result = await auth.completeGitHubRegistration({
        flowId: view.flowId,
        displayName: normalizedName,
        useSuggestedAvatar: avatarAvailable && useSuggestedAvatar,
        legalBundleVersion: legalBundle.version,
        termsVersion: legalBundle.terms.version,
        privacyVersion: legalBundle.privacy.version,
        locale: legalBundle.locale,
      });
      onView(result);
    } catch (caught) {
      const { code, path } = caught as CodedError;
      if (code === 'VALIDATION_FAILED') {
        setErrorKey('errorValidation');
        setErrorPath(path);
        if (path === 'displayName') nameRef.current?.focus();
        else termsRef.current?.focus();
      } else {
        onIssue(caught);
      }
    } finally {
      setPending(false);
      operation.current = false;
    }
  };

  if (legalDocumentKind) {
    if (!legalBundle) return null;
    return <LegalDocument bundle={legalBundle} kind={legalDocumentKind} onBack={() => setLegalDocumentKind(undefined)} />;
  }

  const blocked = pending || cancelling;
  return (
    <>
      <button type="button" className="registration-back" disabled={blocked} onClick={() => void onCancel()}>
        {cancelling ? t('registration.returning') : t('registration.back')}
      </button>
      <p className="eyebrow">{t('registration.eyebrow')}</p>
      <h2>{t('registration.title')}</h2>
      <p className="muted">{t('registration.description')}</p>
      {!legalBundleSupported
        ? <p className="error" role="alert">{t('registration.legalUnsupported')}</p>
        : null}
      <form noValidate onSubmit={(event) => void submit(event)}>
        <div className="profile-editor">
          <div className="profile-avatar">
            {view.suggestedAvatarUrl && avatarAvailable ? (
              <img src={view.suggestedAvatarUrl} alt={t('registration.avatarPreview')} width="56" height="56"
                onError={() => { setAvatarAvailable(false); setUseSuggestedAvatar(false); }} />
            ) : (
              <span className="avatar-fallback" aria-label={t('registration.avatarInitials', { initials: displayNameInitials(displayName) })}>
                {displayNameInitials(displayName)}
              </span>
            )}
          </div>
          <div className="profile-fields">
            <Field name="displayName" label={t('registration.displayName')} autoComplete="name" autoFocus value={displayName}
              onChange={(value) => { setDisplayName(value); setErrorKey(undefined); setErrorPath(undefined); }} inputRef={nameRef}
              errorId={errorPath === 'displayName' ? errorId : undefined} />
            {view.suggestedAvatarUrl && avatarAvailable ? (
              <label className="avatar-option"><input type="checkbox" checked={useSuggestedAvatar}
                onChange={(event) => setUseSuggestedAvatar(event.target.checked)} />{t('registration.useAvatar')}</label>
            ) : null}
          </div>
        </div>
        <div className="terms-check">
          <input id="legal-consent" ref={termsRef} type="checkbox" checked={acceptedTerms} disabled={!legalBundleSupported || blocked}
            aria-label={t('registration.consentLabel')}
            aria-invalid={errorPath === 'termsVersion' ? true : undefined}
            aria-describedby={errorPath === 'termsVersion' ? errorId : undefined}
            onChange={(event) => { setAcceptedLocale(event.target.checked ? locale : undefined); setErrorKey(undefined); setErrorPath(undefined); }} />
          <div className="terms-copy">
            <label htmlFor="legal-consent">{t('registration.consentBeforeTerms')}</label>
            <button ref={termsLinkRef} type="button" className="legal-link" disabled={blocked}
              onClick={() => openLegalDocument('terms')}>{t('registration.terms')}</button>
            <label htmlFor="legal-consent">{t('registration.consentBeforePrivacy')}</label>
            <button ref={privacyLinkRef} type="button" className="legal-link" disabled={blocked}
              onClick={() => openLegalDocument('privacy')}>{t('registration.privacy')}</button>
          </div>
        </div>
        {error ? <p id={errorId} className="error" role="alert">{error}</p> : null}
        <button type="submit" className="primary" disabled={blocked || !legalBundleSupported}>{pending ? t('registration.creating') : t('registration.create')}</button>
      </form>
    </>
  );
}

function LegalDocument({ bundle, kind, onBack }: { bundle: LegalBundle; kind: LegalDocumentKind; onBack(): void }) {
  const { t } = useTranslation();
  const document = legalDocument(bundle, kind);
  return (
    <article className="legal-document" aria-labelledby="legal-document-title">
      <button type="button" className="legal-back" onClick={onBack}>{t('registration.legalBack')}</button>
      <p className="eyebrow">{t('registration.eyebrow')}</p>
      <h2 id="legal-document-title">{document.title}</h2>
      <p className="legal-effective">{t('registration.effectiveDate', { date: formatLegalEffectiveDate(bundle.locale, document.effectiveDate) })}</p>
      <div className="legal-scroll" role="region" aria-label={t('registration.legalContent')} tabIndex={0}>
        {document.sections.map((section) => (
          <section key={section.title}>
            <h3>{section.title}</h3>
            {section.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
          </section>
        ))}
      </div>
    </article>
  );
}

function LanguageSelector({ inline = false }: { inline?: boolean }) {
  const { locale, changeLocale } = useLocale();
  const { t } = useTranslation();
  return (
    <label className={`language-selector${inline ? ' language-selector--inline' : ''}`}>
      <span>{t('language.label')}</span>
      <select aria-label={t('language.label')} value={locale} onChange={(event) => void changeLocale(event.target.value as 'zh-CN' | 'en')}>
        <option value="zh-CN">{t('language.chinese')}</option>
        <option value="en">{t('language.english')}</option>
      </select>
    </label>
  );
}

function GitHubMark() {
  return <svg className="github-mark" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 .7a11.5 11.5 0 0 0-3.64 22.4c.58.1.79-.25.79-.56v-2.23c-3.22.7-3.9-1.37-3.9-1.37-.52-1.34-1.29-1.7-1.29-1.7-1.05-.72.08-.71.08-.71 1.17.08 1.78 1.2 1.78 1.2 1.04 1.78 2.72 1.27 3.38.97.1-.75.4-1.27.74-1.56-2.57-.3-5.27-1.29-5.27-5.69 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.47.11-3.05 0 0 .97-.31 3.16 1.18a10.9 10.9 0 0 1 5.76 0c2.2-1.49 3.16-1.18 3.16-1.18.63 1.58.23 2.76.11 3.05.74.81 1.19 1.83 1.19 3.09 0 4.41-2.71 5.39-5.29 5.68.42.36.79 1.07.79 2.17v3.22c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .7Z" /></svg>;
}

function Field({ name, label, type = 'text', value, onChange, autoComplete, autoFocus, inputRef, errorId }: {
  name: string; label: string; type?: string; value: string; onChange(value: string): void;
  autoComplete?: string; autoFocus?: boolean; inputRef?: React.RefObject<HTMLInputElement | null>; errorId?: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input ref={inputRef} required name={name} type={type} value={value} autoComplete={autoComplete} autoFocus={autoFocus}
        aria-invalid={errorId ? true : undefined} aria-describedby={errorId} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}


function AccountHome({ auth, session }: {
  auth: AuthCapabilities;
  session: Extract<SessionView, { status: 'authenticated' }>;
}) {
  const { t } = useTranslation();
  const [loggingOut, setLoggingOut] = useState(false);
  const user = session.currentUser;
  const initials = displayNameInitials(user.displayName);
  return (
    <main id="main-content" className="center">
      <section className="notice account-home" aria-labelledby="account-title">
        <LanguageSelector inline />
        {user.avatarUrl
          ? <img className="account-avatar" src={user.avatarUrl} alt="" width="72" height="72" referrerPolicy="no-referrer" />
          : <span className="account-avatar avatar-fallback" aria-hidden="true">{initials}</span>}
        <p className="eyebrow">{t('account.eyebrow')}</p>
        <h1 id="account-title" className="user-content">{user.displayName}</h1>
        <p>{t('account.detail')}</p>
        <button type="button" className="secondary" disabled={loggingOut} onClick={() => {
          setLoggingOut(true);
          void auth.logout().finally(() => setLoggingOut(false));
        }}>{loggingOut ? t('account.loggingOut') : t('account.logout')}</button>
      </section>
    </main>
  );
}
