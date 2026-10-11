import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  AuthCapabilities,
  FederatedAuthFlowView,
  SessionView,
  TaskPilotDesktopApi,
} from '../shared/contracts';
import { CURRENT_LEGAL_BUNDLE, legalDocument, type LegalDocumentKind } from './legal/legal-bundle';
import { displayNameInitials } from './profile';

type CodedError = Error & { code?: string; path?: string; retryAfterSeconds?: number; recovery?: string };
type CapabilityState = 'loading' | 'ready' | 'unavailable';
type AuthIssue = 'offline' | 'expired' | 'unable';



export function App({ api }: { api: TaskPilotDesktopApi }) {
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
    return <main id="main-content" className="center"><p role="status">正在恢复会话…</p></main>;
  }
  if (session.status === 'temporarilyUnavailable') {
    return (
      <main id="main-content" className="center">
        <section className="notice" aria-labelledby="connection-title">
          <h1 id="connection-title">暂时无法连接</h1>
          <p>你的登录信息仍安全保存在此设备上。</p>
          <button type="button" onClick={() => window.location.reload()}>重试</button>
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
      <a className="skip-link" href="#main-content">跳到主要内容</a>
      <main id="main-content" className="auth-layout">
        <aside className="brand-panel">
          <div className="wordmark"><span>TP</span> TaskPilot</div>
          <div>
            <p className="eyebrow">Quiet control desk</p>
            <h1>把工作交给 Agent，<br />把判断留给你。</h1>
            <p className="brand-copy">一个清晰、安全的桌面工作台，连接你的团队、项目与本地执行环境。</p>
          </div>
          <p className="trust-note">登录凭据由系统钥匙串保护 · GitHub 授权在系统浏览器完成</p>
        </aside>
        <section className="auth-panel" aria-label="账号访问">
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
  if (props.capability === 'loading') {
    return <AuthNotice eyebrow="安全登录" title="正在检查登录能力" status="正在检查 GitHub 登录配置…" />;
  }
  if (props.capability === 'unavailable') {
    return (
      <AuthNotice eyebrow="安全登录" title={props.issue === 'offline' ? '暂时无法连接' : 'GitHub 登录尚未配置'}
        alert={props.issue === 'offline' ? '无法读取登录配置，请检查网络后重试。' : '当前开发环境尚未启用 GitHub 登录。'}>
        <button type="button" className="primary" onClick={() => void props.onReloadCapabilities()}>重新检查</button>
      </AuthNotice>
    );
  }
  if (props.issue) return <AuthIssueView issue={props.issue} onRetry={props.onContinue} onRestart={props.onRestart} />;
  if (!props.flow) {
    return (
      <>
        <p className="eyebrow">安全登录</p>
        <h2>登录 TaskPilot</h2>
        <p className="muted">使用 GitHub 验证身份。已有身份会直接登录，新身份只需确认一次账号资料。</p>
        <button type="button" className="primary github-action" disabled={props.pending === 'start'} onClick={() => void props.onStart()}>
          <GitHubMark /><span translate="no">{props.pending === 'start' ? '正在打开 GitHub…' : '使用 GitHub 登录'}</span>
        </button>
        {props.pending === 'start' ? <p className="flow-status" role="status">正在打开系统浏览器…</p> : null}
        <p className="auth-footnote">授权将在系统浏览器中完成。TaskPilot 不会获得你的 GitHub 密码或仓库权限。</p>
      </>
    );
  }
  if (props.flow.status === 'registrationRequired') {
    return <GitHubRegistration auth={props.auth} view={props.flow} cancelling={props.pending === 'cancel'} onCancel={props.onCancel} onView={props.onView} onIssue={props.onIssue} />;
  }
  if (props.flow.status === 'waiting' || props.flow.status === 'completionRequired') {
    return (
      <AuthNotice eyebrow="GitHub" title="在浏览器中继续"
        status={props.flow.status === 'completionRequired' ? '等待浏览器安全完成登录…' : '等待你在浏览器完成 GitHub 授权…'}>
        <div className="browser-wait" aria-hidden="true"><span /><span /><span /></div>
        <button type="button" className="secondary" disabled={props.pending === 'cancel'} onClick={() => void props.onCancel()}>
          {props.pending === 'cancel' ? '正在取消…' : '取消登录'}
        </button>
      </AuthNotice>
    );
  }
  if (props.flow.status === 'authenticated') {
    return <AuthNotice eyebrow="安全登录" title="登录已完成" status="正在进入 TaskPilot…" />;
  }
  const terminal: Record<'denied' | 'cancelled' | 'expired' | 'failed' | 'resultUnavailable', { title: string; detail: string }> = {
    denied: { title: '未完成 GitHub 授权', detail: 'GitHub 未授权本次登录。你可以重新开始。' },
    cancelled: { title: '已取消 GitHub 登录', detail: '本次登录已安全取消。' },
    expired: { title: '登录请求已过期', detail: '旧请求已失效，请重新开始登录。' },
    failed: { title: '无法完成 GitHub 登录', detail: '身份验证没有完成，请重新开始。' },
    resultUnavailable: { title: '登录结果已失效', detail: '本次登录结果不可再使用，请重新开始。' },
  };
  const copy = terminal[props.flow.status];
  return (
    <AuthNotice eyebrow="GitHub" title={copy.title} alert={copy.detail}>
      <button type="button" className="primary" onClick={props.onRestart}>重新开始</button>
    </AuthNotice>
  );
}

function AuthIssueView({ issue, onRetry, onRestart }: { issue: AuthIssue; onRetry(): Promise<void>; onRestart(): void }) {
  const copy: Record<AuthIssue, { title: string; detail: string; retry: boolean }> = {
    offline: { title: '暂时无法连接', detail: '登录进度仍安全保留。请检查网络后重试。', retry: true },
    expired: { title: '登录请求已过期', detail: '旧请求已失效，请重新开始登录。', retry: false },
    unable: { title: '无法完成 GitHub 登录', detail: '无法安全完成身份验证，请重新开始。', retry: false },
  };
  return (
    <AuthNotice eyebrow="GitHub" title={copy[issue].title} alert={copy[issue].detail}>
      {copy[issue].retry
        ? <button type="button" className="primary" onClick={() => void onRetry()}>重试</button>
        : <button type="button" className="primary" onClick={onRestart}>重新开始</button>}
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
  const [displayName, setDisplayName] = useState(view.suggestedDisplayName);
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [legalDocumentKind, setLegalDocumentKind] = useState<LegalDocumentKind>();
  const [useSuggestedAvatar, setUseSuggestedAvatar] = useState(Boolean(view.suggestedAvatarUrl));
  const [avatarAvailable, setAvatarAvailable] = useState(Boolean(view.suggestedAvatarUrl));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [errorPath, setErrorPath] = useState<string>();
  const operation = useRef(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const termsRef = useRef<HTMLInputElement>(null);
  const termsLinkRef = useRef<HTMLButtonElement>(null);
  const privacyLinkRef = useRef<HTMLButtonElement>(null);
  const legalReturnFocus = useRef<LegalDocumentKind | undefined>(undefined);
  const errorId = 'github-registration-error';
  const legalBundleSupported = view.legalBundleVersion === CURRENT_LEGAL_BUNDLE.version;

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
    if (operation.current || !legalBundleSupported) return;
    const normalizedName = displayName.trim();
    if (!normalizedName) {
      setError('请输入显示名称。');
      setErrorPath('displayName');
      nameRef.current?.focus();
      return;
    }
    if (!acceptedTerms) {
      setError('请先阅读并同意用户协议。');
      setErrorPath('termsVersion');
      termsRef.current?.focus();
      return;
    }
    operation.current = true;
    setPending(true);
    setError('');
    setErrorPath(undefined);
    try {
      const result = await auth.completeGitHubRegistration({
        flowId: view.flowId,
        displayName: normalizedName,
        useSuggestedAvatar: avatarAvailable && useSuggestedAvatar,
        legalBundleVersion: CURRENT_LEGAL_BUNDLE.version,
        termsVersion: CURRENT_LEGAL_BUNDLE.terms.version,
        privacyVersion: CURRENT_LEGAL_BUNDLE.privacy.version,
        locale: CURRENT_LEGAL_BUNDLE.locale,
      });
      onView(result);
    } catch (caught) {
      const { code, path } = caught as CodedError;
      if (code === 'VALIDATION_FAILED') {
        setError('请检查填写的信息。');
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
    return <LegalDocument kind={legalDocumentKind} onBack={() => setLegalDocumentKind(undefined)} />;
  }

  const blocked = pending || cancelling;
  return (
    <>
      <button type="button" className="registration-back" disabled={blocked} onClick={() => void onCancel()}>
        {cancelling ? '正在返回…' : '← 返回登录方式'}
      </button>
      <p className="eyebrow">首次使用</p>
      <h2>创建 TaskPilot 账号</h2>
      <p className="muted">GitHub 身份已验证。确认公开资料后即可继续。</p>
      {!legalBundleSupported
        ? <p className="error" role="alert">当前协议已更新，请更新 TaskPilot 后继续。</p>
        : null}
      <form noValidate onSubmit={(event) => void submit(event)}>
        <div className="profile-editor">
          <div className="profile-avatar">
            {view.suggestedAvatarUrl && avatarAvailable ? (
              <img src={view.suggestedAvatarUrl} alt="GitHub 头像预览" width="56" height="56"
                onError={() => { setAvatarAvailable(false); setUseSuggestedAvatar(false); }} />
            ) : (
              <span className="avatar-fallback" aria-label={`头像缩写：${displayNameInitials(displayName)}`}>
                {displayNameInitials(displayName)}
              </span>
            )}
          </div>
          <div className="profile-fields">
            <Field name="displayName" label="显示名称" autoComplete="name" autoFocus value={displayName}
              onChange={(value) => { setDisplayName(value); setError(''); setErrorPath(undefined); }} inputRef={nameRef}
              errorId={errorPath === 'displayName' ? errorId : undefined} />
            {view.suggestedAvatarUrl && avatarAvailable ? (
              <label className="avatar-option"><input type="checkbox" checked={useSuggestedAvatar}
                onChange={(event) => setUseSuggestedAvatar(event.target.checked)} />使用 GitHub 头像</label>
            ) : null}
          </div>
        </div>
        <div className="terms-check">
          <input id="legal-consent" ref={termsRef} type="checkbox" checked={acceptedTerms} disabled={!legalBundleSupported || blocked}
            aria-label="我已阅读并同意《用户协议》，并确认已阅读《隐私政策》"
            aria-invalid={errorPath === 'termsVersion' ? true : undefined}
            aria-describedby={errorPath === 'termsVersion' ? errorId : undefined}
            onChange={(event) => { setAcceptedTerms(event.target.checked); setError(''); setErrorPath(undefined); }} />
          <div className="terms-copy">
            <label htmlFor="legal-consent">我已阅读并同意</label>
            <button ref={termsLinkRef} type="button" className="legal-link" disabled={blocked}
              onClick={() => openLegalDocument('terms')}>《用户协议》</button>
            <label htmlFor="legal-consent">，并确认已阅读</label>
            <button ref={privacyLinkRef} type="button" className="legal-link" disabled={blocked}
              onClick={() => openLegalDocument('privacy')}>《隐私政策》</button>
          </div>
        </div>
        {error ? <p id={errorId} className="error" role="alert">{error}</p> : null}
        <button type="submit" className="primary" disabled={blocked || !legalBundleSupported}>{pending ? '正在创建账号…' : '创建 TaskPilot 账号'}</button>
      </form>
    </>
  );
}

function LegalDocument({ kind, onBack }: { kind: LegalDocumentKind; onBack(): void }) {
  const document = legalDocument(kind);
  return (
    <article className="legal-document" aria-labelledby="legal-document-title">
      <button type="button" className="legal-back" onClick={onBack}>← 返回账号创建</button>
      <p className="eyebrow">首次使用</p>
      <h2 id="legal-document-title">{document.title}</h2>
      <p className="legal-effective">生效日期：{new Intl.DateTimeFormat(CURRENT_LEGAL_BUNDLE.locale, { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(`${document.effectiveDate}T00:00:00Z`))}</p>
      <div className="legal-scroll">
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
  const [loggingOut, setLoggingOut] = useState(false);
  const user = session.currentUser;
  const initials = displayNameInitials(user.displayName);
  return (
    <main id="main-content" className="center">
      <section className="notice account-home" aria-labelledby="account-title">
        {user.avatarUrl
          ? <img className="account-avatar" src={user.avatarUrl} alt="" width="72" height="72" referrerPolicy="no-referrer" />
          : <span className="account-avatar avatar-fallback" aria-hidden="true">{initials}</span>}
        <p className="eyebrow">已登录</p>
        <h1 id="account-title" className="user-content">{user.displayName}</h1>
        <p>GitHub 登录已就绪。更多功能将在后续版本提供。</p>
        <button type="button" className="secondary" disabled={loggingOut} onClick={() => {
          setLoggingOut(true);
          void auth.logout().finally(() => setLoggingOut(false));
        }}>{loggingOut ? '正在退出…' : '退出登录'}</button>
      </section>
    </main>
  );
}
