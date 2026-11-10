import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocale } from '../i18n/locale-state';
import type {
  AuthCapabilities,
  FederatedAuthFlowView,
  SessionView,
  TaskPilotDesktopApi,
} from '../../shared/contracts';
import { formatLegalEffectiveDate, legalDocument, resolveLegalBundle, type LegalBundle, type LegalDocumentKind } from '../legal/legal-bundle';
import { ProjectHome } from '../features/shell/project-home';
import { displayNameInitials } from '../shared/lib/profile';
import { PRODUCT_TEXT_LIMITS, normalizePersistedText } from '../shared/lib/text-constraints';
import { TextFeedback } from '../shared/ui/text-feedback';
import { useBoundedText } from '../shared/ui/use-bounded-text';
import { LanguageSelector } from '../shared/ui/language-selector';
import { WorkGraphBackground } from '../features/auth/work-graph-background';
import { loginWorkGraphConfig } from '../features/auth/work-graph-config';

type CodedError = Error & { code?: string; path?: string; retryAfterSeconds?: number; recovery?: string };
type CapabilityState = 'loading' | 'ready' | 'unavailable';
type AuthIssue = 'offline' | 'expired' | 'unable';


export function App({ api }: { api: TaskPilotDesktopApi }) {
  const { t } = useTranslation();
  const [session, setSession] = useState<SessionView>({ status: 'restoring' });
  const [retryPending, setRetryPending] = useState(false);
  const [logoutWarning, setLogoutWarning] = useState(false);
  const lifetime = useRef({ api, active: true, operation: 0 });
  const pendingLogout = useRef<object | undefined>(undefined);
  const pendingRetry = useRef<object | undefined>(undefined);

  const invalidate = useCallback(() => {
    lifetime.current.operation += 1;
    pendingLogout.current = undefined;
    pendingRetry.current = undefined;
    setLogoutWarning(false);
    setRetryPending(false);
  }, []);

  useEffect(() => {
    const current = { api, active: true, operation: 0 };
    lifetime.current = current;
    queueMicrotask(() => { if (current.active) invalidate(); });
    let observed = false;
    void api.auth.getSessionView().then((view) => {
      if (current.active && !observed) setSession(view);
    }).catch(() => {
      if (current.active && !observed) setSession({ status: 'temporarilyUnavailable' });
    });
    const unsubscribe = api.auth.subscribeSessionView((view) => {
      if (!current.active) return;
      observed = true;
      // signedOut from this logout must not suppress its later cleanup error.
      if (view.status === 'authenticated') invalidate();
      setSession(view);
    });
    return () => {
      current.active = false;
      current.operation += 1;
      pendingLogout.current = undefined;
      pendingRetry.current = undefined;
      unsubscribe();
    };
  }, [api, invalidate]);

  const logout = useCallback(async () => {
    if (pendingLogout.current) return;
    const current = lifetime.current;
    const identity = {};
    const operation = ++current.operation;
    pendingLogout.current = identity;
    setLogoutWarning(false);
    try { await api.auth.logout(); }
    catch (error) {
      if (current.active && current === lifetime.current && current.api === api && current.operation === operation &&
          pendingLogout.current === identity && (error as CodedError)?.code === 'CREDENTIAL_STORAGE_UNAVAILABLE') {
        setLogoutWarning(true);
      }
    } finally {
      if (pendingLogout.current === identity) pendingLogout.current = undefined;
    }
  }, [api]);

  const retry = async () => {
    if (pendingRetry.current) return;
    const current = lifetime.current;
    const identity = {};
    pendingRetry.current = identity;
    setRetryPending(true);
    try { await api.auth.retrySessionRestore(); }
    catch { /* Main subscription remains authoritative for temporary and terminal states. */ }
    finally {
      if (current.active && current === lifetime.current && pendingRetry.current === identity) {
        pendingRetry.current = undefined;
        setRetryPending(false);
      }
    }
  };

  if (session.status === 'restoring') {
    return <main id="main-content" className="center"><LanguageSelector /><p role="status">{t('session.restoring')}</p></main>;
  }
  if (session.status === 'temporarilyUnavailable') {
    return (
      <main id="main-content" className="center">
        <section className="notice" aria-labelledby="connection-title">
          <LanguageSelector variant="inline" />
          <h1 id="connection-title">{t('session.unavailableTitle')}</h1>
          <p>{t('session.unavailableDetail')}</p>
          <button type="button" disabled={retryPending} aria-busy={retryPending} onClick={() => void retry()}>{t('common.retry')}</button>
        </section>
      </main>
    );
  }
  if (session.status === 'signedOut') {
    return <AuthExperience auth={api.auth} onSignInIntent={invalidate} logoutWarning={logoutWarning}
      onDismissLogoutWarning={() => setLogoutWarning(false)} onAuthenticated={(currentUser) => { invalidate(); setSession({ status: 'authenticated', currentUser }); }} />;
  }
  return <ProjectHome api={api} session={session} onLogout={logout} />;
}

function AuthExperience({ auth, onAuthenticated, onSignInIntent, logoutWarning, onDismissLogoutWarning }: {
  onSignInIntent(): void;
  logoutWarning: boolean;
  onDismissLogoutWarning(): void;
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
    onSignInIntent();
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
  }, [acceptView, auth, classifyIssue, onSignInIntent]);

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
          <WorkGraphBackground config={loginWorkGraphConfig} />
          <div className="wordmark">
            <span className="brand-glyph" aria-hidden="true"><i /><i /><i /><i /></span>
            <span>TaskPilot</span>
          </div>
          <div className="brand-message">
            <p className="brand-signal">{t('auth.brandEyebrow')}</p>
            <h1>{t('auth.brandTitleLine1')}<br />{t('auth.brandTitleLine2')}</h1>
            <p className="brand-copy">{t('auth.brandCopy')}</p>
          </div>
          <div className="brand-foot" aria-hidden="true">
            <span>{t('auth.brandPointIdentity')}</span>
            <span>{t('auth.brandPointVisibility')}</span>
            <span>{t('auth.brandPointControl')}</span>
          </div>
          <div className="board-signature" aria-hidden="true">
            <div className="board-toolbar">
              <span className="board-toolbar-mark"><i /><i /><i /></span>
              <span className="board-toolbar-title" />
              <span className="board-toolbar-actions"><i /><i /></span>
            </div>
            <div className="board-lanes">
              <div className="board-lane board-lane--human">
                <span className="board-lane-heading"><i /><b /></span>
                <span className="board-ticket board-ticket--wide"><i /><b /><em /></span>
                <span className="board-ticket board-ticket--compact"><i /><b /><em /></span>
              </div>
              <div className="board-lane board-lane--agent">
                <span className="board-lane-heading"><i /><b /></span>
                <span className="board-ticket board-ticket--active"><i /><b /><em /></span>
                <span className="board-ticket"><i /><b /><em /></span>
              </div>
              <div className="board-lane board-lane--review">
                <span className="board-lane-heading"><i /><b /></span>
                <span className="board-ticket board-ticket--review"><i /><b /><em /></span>
              </div>
            </div>
          </div>
        </aside>
        <section className="auth-panel" aria-label={t('auth.region')}>
          <LanguageSelector />
          <div className="auth-card">
            {logoutWarning ? <div role="alert" className="error">
              <p>{t('session.logoutCleanupWarning')}</p>
              <button type="button" onClick={onDismissLogoutWarning}>{t('session.dismissLogoutWarning')}</button>
            </div> : null}
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
  const [legalRejected, setLegalRejected] = useState(false);
  const legalBundle = legalRejected ? undefined : resolveLegalBundle({
    locale,
    legalBundleVersion: view.legalBundleVersion,
    termsVersion: view.termsVersion,
    privacyVersion: view.privacyVersion,
  });
  const displayName = useBoundedText(view.suggestedDisplayName, PRODUCT_TEXT_LIMITS.displayName);
  const [nameTouched, setNameTouched] = useState(false);
  const [submitted, setSubmitted] = useState(false);
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
  const nameLabelId = 'github-registration-display-name-label';
  const nameFeedbackId = 'github-registration-display-name-feedback';
  const legalBundleSupported = legalBundle !== undefined && view.legalLocales.includes(locale);
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
    setSubmitted(true);
    const normalizedName = normalizePersistedText(displayName.value);
    if (!normalizedName || !displayName.withinProductLimit) {
      setErrorKey(undefined);
      setErrorPath(undefined);
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
      } else if (code === 'LEGAL_BUNDLE_REJECTED') {
        setLegalRejected(true);
        setAcceptedLocale(undefined);
        setErrorKey(undefined);
        setErrorPath(undefined);
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
  const showNameError = nameTouched || submitted;
  const nameError = showNameError
    ? !normalizePersistedText(displayName.value)
      ? t('registration.errorName')
      : !displayName.withinProductLimit
        ? t('registration.errorNameTooLong')
        : undefined
    : undefined;
  return (
    <>
      <button type="button" className="registration-back" disabled={blocked} onClick={() => void onCancel()}>
        {cancelling ? t('registration.returning') : t('registration.back')}
      </button>
      <p className="eyebrow">{t('registration.eyebrow')}</p>
      <h2>{t('registration.title')}</h2>
      {!legalBundleSupported
        ? <p className="error" role="alert">{t('registration.legalUnsupported')}</p>
        : null}
      <form className="registration-form" noValidate onSubmit={(event) => void submit(event)}>
        <div className={`avatar-choice-row${view.suggestedAvatarUrl && avatarAvailable ? '' : ' avatar-choice-row--fallback'}`}>
          {view.suggestedAvatarUrl && avatarAvailable ? (
            <img className="profile-avatar" src={view.suggestedAvatarUrl} alt="" width="48" height="48" referrerPolicy="no-referrer"
              onError={() => { setAvatarAvailable(false); setUseSuggestedAvatar(false); }} />
          ) : (
            <span className="profile-avatar avatar-fallback" aria-label={t('registration.avatarInitials', { initials: displayNameInitials(displayName.value) })}>
              {displayNameInitials(displayName.value)}
            </span>
          )}
          {view.suggestedAvatarUrl && avatarAvailable ? (
            <label className="avatar-option"><input type="checkbox" checked={useSuggestedAvatar}
              onChange={(event) => setUseSuggestedAvatar(event.target.checked)} />{t('registration.useAvatar')}</label>
          ) : null}
        </div>
        <label className="field">
          <span id={nameLabelId}>{t('registration.displayName')}</span>
          <input
            ref={nameRef}
            required
            name="displayName"
            type="text"
            autoComplete="name"
            autoFocus
            aria-labelledby={nameLabelId}
            aria-invalid={Boolean(nameError) || errorPath === 'displayName' || undefined}
            aria-describedby={`${nameFeedbackId}${errorPath === 'displayName' ? ` ${errorId}` : ''}`}
            onBlur={() => setNameTouched(true)}
            {...displayName.inputProps}
            onChange={(event) => {
              displayName.inputProps.onChange(event);
              setErrorKey(undefined);
              setErrorPath(undefined);
            }}
          />
          <TextFeedback
            id={nameFeedbackId}
            count={displayName.count}
            limit={displayName.limit}
            showCount={displayName.showCount}
            limitReached={displayName.limitReached}
            error={nameError}
          />
        </label>
        <div className="terms-check">
          <input id="legal-consent" ref={termsRef} type="checkbox" checked={acceptedTerms} disabled={!legalBundleSupported || blocked}
            aria-label={t('registration.consentLabel')}
            aria-invalid={errorPath === 'termsVersion' ? true : undefined}
            aria-describedby={errorPath === 'termsVersion' ? errorId : undefined}
            onChange={(event) => { setAcceptedLocale(event.target.checked ? locale : undefined); setErrorKey(undefined); setErrorPath(undefined); }} />
          <div className="terms-copy">
            <label htmlFor="legal-consent">{t('registration.consentBeforeTerms')}</label>
            <button ref={termsLinkRef} type="button" className="legal-link" disabled={!legalBundleSupported || blocked}
              onClick={() => openLegalDocument('terms')}>{t('registration.terms')}</button>
            <label htmlFor="legal-consent">{t('registration.consentBeforePrivacy')}</label>
            <button ref={privacyLinkRef} type="button" className="legal-link" disabled={!legalBundleSupported || blocked}
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

function GitHubMark() {
  return <svg className="github-mark" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 .7a11.5 11.5 0 0 0-3.64 22.4c.58.1.79-.25.79-.56v-2.23c-3.22.7-3.9-1.37-3.9-1.37-.52-1.34-1.29-1.7-1.29-1.7-1.05-.72.08-.71.08-.71 1.17.08 1.78 1.2 1.78 1.2 1.04 1.78 2.72 1.27 3.38.97.1-.75.4-1.27.74-1.56-2.57-.3-5.27-1.29-5.27-5.69 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.47.11-3.05 0 0 .97-.31 3.16 1.18a10.9 10.9 0 0 1 5.76 0c2.2-1.49 3.16-1.18 3.16-1.18.63 1.58.23 2.76.11 3.05.74.81 1.19 1.83 1.19 3.09 0 4.41-2.71 5.39-5.29 5.68.42.36.79 1.07.79 2.17v3.22c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .7Z" /></svg>;
}
