import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  AuthCapabilities,
  ProjectItem,
  SessionView,
  TaskPilotDesktopApi,
  WorkspaceList,
} from '../shared/contracts';

type AuthScreen =
  | 'password'
  | 'code'
  | 'register-email'
  | 'register-code'
  | 'register-profile'
  | 'reset-email'
  | 'reset-code'
  | 'reset-password';

type CodedError = Error & { code?: string; path?: string; retryAfterSeconds?: number };

function errorMessage(error: unknown): string {
  const { code, retryAfterSeconds } = error as CodedError;
  if (code === 'AUTHENTICATION_RATE_LIMITED' && typeof retryAfterSeconds === 'number') {
    return `尝试次数过多，请在 ${retryAfterSeconds} 秒后再试`;
  }
  const messages: Record<string, string> = {
    INVALID_CREDENTIALS: '邮箱或密码不正确',
    INVALID_OR_EXPIRED_CODE: '验证码无效或已过期',
    REGISTRATION_RESULT_UNKNOWN: '无法确认账号是否创建成功。请返回登录并尝试登录。',
    AUTHENTICATION_RATE_LIMITED: '尝试次数过多，请稍后再试',
    WORKSPACE_RESULT_UNKNOWN: '无法确认 Workspace 是否创建成功。请使用相同信息重试。',
    IDEMPOTENCY_IN_PROGRESS: '创建请求仍在处理中，请稍后重试。',
    IDEMPOTENCY_KEY_REUSED: '创建信息已改变，请重新发起创建。',
    WORKSPACE_CREATION_NOT_ALLOWED: '当前账号无法创建 Workspace。',
    WORKSPACE_TEMPORARILY_UNAVAILABLE: 'Workspace 暂时无法创建，请稍后重试。',
    NETWORK_UNAVAILABLE: '暂时无法连接，请检查网络后重试。',
    VALIDATION_FAILED: '请检查填写的信息。',
    PASSWORD_CONFIRMATION_MISMATCH: '两次输入的密码不一致',
    PROJECTS_TEMPORARILY_UNAVAILABLE: '项目暂时无法加载，请稍后重试。',
  };
  return code && messages[code] ? messages[code] : '暂时无法连接，请检查网络后重试';
}

export function App({ api }: { api: TaskPilotDesktopApi }) {
  const [session, setSession] = useState<SessionView>({ status: 'restoring' });

  useEffect(() => {
    let active = true;
    void api.auth.getSessionView().then((view) => {
      if (active) setSession(view);
    });
    const unsubscribe = api.auth.subscribeSessionView(setSession);
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
  if (session.status === 'signedOut') return <AuthExperience auth={api.auth} />;
  return <WorkspaceExperience api={api} session={session} />;
}

function AuthExperience({ auth }: { auth: AuthCapabilities }) {
  const [screen, setScreen] = useState<AuthScreen>('password');
  const [email, setEmail] = useState('');
  const [challengeId, setChallengeId] = useState('');
  const [flowHandle, setFlowHandle] = useState('');
  const [notice, setNotice] = useState('');

  const navigate = (next: AuthScreen) => {
    setChallengeId('');
    setFlowHandle('');
    setScreen(next);
  };
  const shared: FlowProps = {
    auth, email, setEmail, challengeId, setChallengeId, flowHandle, setFlowHandle, navigate, notice, setNotice,
  };

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
        <p className="trust-note">凭据由系统钥匙串保护 · 本地任务保持本地</p>
      </aside>
      <section className="auth-panel" aria-label="账号访问">
        <div className="auth-card">
          {screen === 'password' ? <PasswordLogin {...shared} /> : null}
          {screen === 'code' ? <CodeLogin {...shared} /> : null}
          {screen.startsWith('register') ? <Registration {...shared} screen={screen} /> : null}
          {screen.startsWith('reset') ? <PasswordReset {...shared} screen={screen} /> : null}
        </div>
      </section>
      </main>
    </>
  );
}

type FlowProps = {
  auth: AuthCapabilities;
  email: string;
  setEmail(value: string): void;
  challengeId: string;
  setChallengeId(value: string): void;
  flowHandle: string;
  setFlowHandle(value: string): void;
  navigate(value: AuthScreen): void;
  notice: string;
  setNotice(value: string): void;
};

function useSubmit(action: () => Promise<void>, onError?: (error: unknown) => void) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [errorPath, setErrorPath] = useState<string>();
  const run = async (event: React.SyntheticEvent) => {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError('');
    setErrorPath(undefined);
    try {
      await action();
    } catch (caught) {
      onError?.(caught);
      setError(errorMessage(caught));
      setErrorPath((caught as CodedError).path);
    } finally {
      setPending(false);
    }
  };
  return { pending, error, errorPath, run };
}

function Field({
  label, name, type = 'text', value, onChange, autoFocus = false, autoComplete, inputMode, inputRef, errorId,
}: {
  label: string;
  name: string;
  type?: string;
  value: string;
  onChange(value: string): void;
  autoFocus?: boolean;
  autoComplete?: string;
  inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode'];
  inputRef?: React.RefObject<HTMLInputElement | null>;
  errorId?: string;
}) {
  const internalRef = useRef<HTMLInputElement>(null);
  const resolvedRef = inputRef ?? internalRef;
  useEffect(() => {
    if (errorId) resolvedRef.current?.focus();
  }, [errorId, resolvedRef]);
  return (
    <label className="field">
      <span>{label}</span>
      <input
        ref={resolvedRef}
        autoFocus={autoFocus}
        required
        name={name}
        spellCheck={type === 'email' || inputMode === 'numeric' ? false : undefined}
        type={type}
        value={value}
        autoComplete={autoComplete}
        inputMode={inputMode}
        aria-invalid={errorId ? true : undefined}
        aria-describedby={errorId}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function ErrorText({ value, id }: { value: string; id?: string }) {
  return value ? <p id={id} className="error" role="alert">{value}</p> : null;
}

function Back({ onClick }: { onClick(): void }) {
  return <button className="back" type="button" onClick={onClick} aria-label="返回">←</button>;
}

function PasswordLogin(props: FlowProps) {
  const [password, setPassword] = useState('');
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const submit = useSubmit(async () => {
    try {
      await props.auth.signInWithPassword({ email: props.email, password });
    } finally {
      setPassword('');
    }
  }, (error) => {
    const path = (error as CodedError).path;
    if (path === 'email') emailRef.current?.focus();
    if (path === 'password') passwordRef.current?.focus();
  });
  const errorId = 'password-login-error';
  return (
    <>
      <p className="eyebrow">欢迎回来</p>
      <h2>登录 TaskPilot</h2>
      <p className="muted">使用你的团队账号继续。</p>
      {props.notice ? <p className="success" role="status">{props.notice}</p> : null}
      <form onSubmit={submit.run}>
        <Field name="email" label="邮箱" type="email" autoComplete="email" autoFocus value={props.email} onChange={props.setEmail} inputRef={emailRef} errorId={submit.errorPath === 'email' ? errorId : undefined} />
        <Field name="password" label="密码" type="password" autoComplete="current-password" value={password} onChange={setPassword} inputRef={passwordRef} errorId={submit.errorPath === 'password' ? errorId : undefined} />
        <div className="field-link"><button type="button" className="link" onClick={() => props.navigate('reset-email')}>忘记密码？</button></div>
        <ErrorText id={errorId} value={submit.error} />
        <button type="submit" className="primary" disabled={submit.pending}>{submit.pending ? '正在登录…' : '登录'}</button>
      </form>
      <button type="button" className="secondary" onClick={() => props.navigate('code')}>使用邮箱验证码登录</button>
      <div className="divider"><span>新用户</span></div>
      <button type="button" className="link-row" onClick={() => props.navigate('register-email')}>创建 TaskPilot 账号 <span>→</span></button>
    </>
  );
}

function CodeLogin(props: FlowProps) {
  const [code, setCode] = useState('');
  const [resendAvailableAt, setResendAvailableAt] = useState(0);
  const [clock, setClock] = useState(() => Date.now());
  const cooldownSeconds = Math.max(0, Math.ceil((resendAvailableAt - clock) / 1000));

  useEffect(() => {
    if (resendAvailableAt <= clock) return undefined;
    const interval = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [clock, resendAvailableAt]);

  const send = useSubmit(async () => {
    const result = await props.auth.requestLoginCode({ email: props.email });
    const now = Date.now();
    setClock(now);
    setResendAvailableAt(now + result.retryAfterSeconds * 1000);
    props.setChallengeId(result.challengeId);
  });
  const verify = useSubmit(async () => {
    try {
      await props.auth.verifyLoginCode({ challengeId: props.challengeId, email: props.email, code });
    } finally {
      setCode('');
    }
  });
  return (
    <>
      <Back onClick={() => props.navigate('password')} />
      <p className="eyebrow">另一种登录方式</p>
      <h2>邮箱验证码登录</h2>
      <p className="muted">验证码仅用于本次登录，不会创建新账号。</p>
      {!props.challengeId ? (
        <form onSubmit={send.run}>
          <Field name="email" label="邮箱" type="email" autoComplete="email" value={props.email} onChange={props.setEmail} autoFocus errorId={send.errorPath === 'email' ? 'login-code-request-error' : undefined} />
          <ErrorText id="login-code-request-error" value={send.error} />
          <button type="submit" className="primary" disabled={send.pending}>{send.pending ? '正在发送…' : '发送验证码'}</button>
        </form>
      ) : (
        <form onSubmit={verify.run}>
          <Field name="code" label="6 位验证码" autoComplete="one-time-code" inputMode="numeric" value={code} onChange={setCode} autoFocus errorId={verify.errorPath === 'code' ? 'login-code-verify-error' : undefined} />
          <ErrorText id="login-code-verify-error" value={verify.error} />
          <button type="submit" className="primary" disabled={verify.pending}>{verify.pending ? '正在验证…' : '登录'}</button>
          <p className="cooldown" role="status">{cooldownSeconds > 0 ? `${cooldownSeconds} 秒后可重新发送` : '可以重新发送验证码'}</p>
          <button type="button" className="link" disabled={send.pending || cooldownSeconds > 0} onClick={send.run}>重新发送验证码</button>
          <button type="button" className="link" onClick={() => { setCode(''); props.setChallengeId(''); setResendAvailableAt(0); }}>更换邮箱</button>
        </form>
      )}
    </>
  );
}

function Registration(props: FlowProps & { screen: AuthScreen }) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirmation, setPasswordConfirmation] = useState('');
  const passwordConfirmationRef = useRef<HTMLInputElement>(null);
  const [terms, setTerms] = useState(false);
  const send = useSubmit(async () => {
    const result = await props.auth.requestRegistrationCode({ email: props.email });
    props.setChallengeId(result.challengeId);
    props.navigate('register-code');
    props.setChallengeId(result.challengeId);
  });
  const verify = useSubmit(async () => {
    const result = await props.auth.verifyRegistrationCode({ challengeId: props.challengeId, email: props.email, code });
    setCode('');
    props.navigate('register-profile');
    props.setFlowHandle(result.flowHandle);
  });
  const create = useSubmit(async () => {
    try {
      if (password !== passwordConfirmation) {
        passwordConfirmationRef.current?.focus();
        throw Object.assign(new Error('password confirmation differs'), { code: 'PASSWORD_CONFIRMATION_MISMATCH', path: 'passwordConfirmation' });
      }
      await props.auth.register({
        flowHandle: props.flowHandle,
        email: props.email,
        displayName: name,
        password,
        termsVersion: '2026-09-01',
      });
      props.setFlowHandle('');
    } catch (error) {
      if ((error as CodedError).code === 'REGISTRATION_CONTEXT_EXPIRED') {
        props.setNotice('验证已过期，请重新验证邮箱。');
        props.navigate('register-email');
        return;
      }
      if ((error as CodedError).code === 'REGISTRATION_RESULT_UNKNOWN') {
        props.setNotice('账号可能已创建，请尝试登录确认。');
        props.navigate('password');
        return;
      }
      throw error;
    } finally {
      setPassword('');
      setPasswordConfirmation('');
    }
  });

  if (props.screen === 'register-email') {
    return (
      <>
        <Back onClick={() => props.navigate('password')} />
        <p className="eyebrow">第 1 步，共 3 步</p><h2>创建账号</h2>
        <p className="muted">先验证你的工作邮箱。</p>
        {props.notice ? <p className="success" role="status">{props.notice}</p> : null}
        <form onSubmit={send.run}>
          <Field name="email" label="邮箱" type="email" autoComplete="email" value={props.email} onChange={props.setEmail} autoFocus errorId={send.errorPath === 'email' ? 'registration-code-request-error' : undefined} />
          <ErrorText id="registration-code-request-error" value={send.error} />
          <button type="submit" className="primary" disabled={send.pending}>{send.pending ? '正在发送注册验证码…' : '发送注册验证码'}</button>
        </form>
      </>
    );
  }
  if (props.screen === 'register-code') {
    return (
      <>
        <Back onClick={() => props.navigate('register-email')} />
        <p className="eyebrow">第 2 步，共 3 步</p><h2>验证邮箱</h2>
        <p className="muted">验证码已发送至 {props.email}</p>
        <form onSubmit={verify.run}>
          <Field name="code" label="6 位验证码" autoComplete="one-time-code" inputMode="numeric" value={code} onChange={setCode} autoFocus errorId={verify.errorPath === 'code' ? 'registration-code-verify-error' : undefined} />
          <ErrorText id="registration-code-verify-error" value={verify.error} />
          <button type="submit" className="primary" disabled={verify.pending}>{verify.pending ? '正在验证邮箱…' : '验证邮箱'}</button>
        </form>
      </>
    );
  }
  return (
    <>
      <Back onClick={() => props.navigate('register-email')} />
      <p className="eyebrow">第 3 步，共 3 步</p><h2>设置账号</h2>
      <form onSubmit={create.run}>
        <Field name="displayName" label="姓名" autoComplete="name" value={name} onChange={setName} autoFocus errorId={create.errorPath === 'displayName' ? 'registration-create-error' : undefined} />
        <Field name="password" label="密码" type="password" autoComplete="new-password" value={password} onChange={setPassword} errorId={create.errorPath === 'password' ? 'registration-create-error' : undefined} />
        <Field name="passwordConfirmation" label="确认密码" type="password" autoComplete="new-password" value={passwordConfirmation} onChange={setPasswordConfirmation} inputRef={passwordConfirmationRef} errorId={create.errorPath === 'passwordConfirmation' ? 'registration-create-error' : undefined} />
        <label className="check"><input required type="checkbox" checked={terms} onChange={(event) => setTerms(event.target.checked)} aria-invalid={create.errorPath === 'termsVersion' ? true : undefined} aria-describedby={create.errorPath === 'termsVersion' ? 'registration-create-error' : undefined} />我同意服务条款和隐私政策</label>
        <ErrorText id="registration-create-error" value={create.error} />
        <button type="submit" className="primary" disabled={create.pending || !terms}>{create.pending ? '正在创建账号…' : '创建账号'}</button>
      </form>
    </>
  );
}

function PasswordReset(props: FlowProps & { screen: AuthScreen }) {
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const send = useSubmit(async () => {
    const result = await props.auth.requestPasswordResetCode({ email: props.email });
    props.navigate('reset-code');
    props.setChallengeId(result.challengeId);
  });
  const verify = useSubmit(async () => {
    const result = await props.auth.verifyPasswordResetCode({ challengeId: props.challengeId, email: props.email, code });
    setCode('');
    props.navigate('reset-password');
    props.setFlowHandle(result.flowHandle);
  });
  const reset = useSubmit(async () => {
    try {
      await props.auth.resetPassword({ flowHandle: props.flowHandle, email: props.email, newPassword: password });
      props.navigate('password');
    } catch (error) {
      if ((error as CodedError).code === 'PASSWORD_RESET_CONTEXT_EXPIRED') {
        props.setNotice('验证已过期，请重新验证邮箱。');
        props.navigate('reset-email');
        return;
      }
      throw error;
    } finally {
      setPassword('');
      props.setFlowHandle('');
    }
  });

  if (props.screen === 'reset-email') {
    return <><Back onClick={() => props.navigate('password')} /><p className="eyebrow">找回账号</p><h2>重置密码</h2><p className="muted">我们会向你的邮箱发送验证码。</p>{props.notice ? <p className="success" role="status">{props.notice}</p> : null}<form onSubmit={send.run}><Field name="email" label="邮箱" type="email" autoComplete="email" value={props.email} onChange={props.setEmail} autoFocus errorId={send.errorPath === 'email' ? 'reset-code-request-error' : undefined} /><ErrorText id="reset-code-request-error" value={send.error} /><button type="submit" className="primary" disabled={send.pending}>{send.pending ? '正在发送重置验证码…' : '发送重置验证码'}</button></form></>;
  }
  if (props.screen === 'reset-code') {
    return <><Back onClick={() => props.navigate('reset-email')} /><p className="eyebrow">验证身份</p><h2>输入验证码</h2><form onSubmit={verify.run}><Field name="code" label="6 位验证码" autoComplete="one-time-code" inputMode="numeric" value={code} onChange={setCode} autoFocus errorId={verify.errorPath === 'code' ? 'reset-code-verify-error' : undefined} /><ErrorText id="reset-code-verify-error" value={verify.error} /><button type="submit" className="primary" disabled={verify.pending}>{verify.pending ? '正在验证…' : '继续'}</button></form></>;
  }
  return <><Back onClick={() => props.navigate('password')} /><p className="eyebrow">最后一步</p><h2>设置新密码</h2><form onSubmit={reset.run}><Field name="newPassword" label="新密码" type="password" autoComplete="new-password" value={password} onChange={setPassword} autoFocus errorId={reset.errorPath === 'newPassword' ? 'reset-password-error' : undefined} /><ErrorText id="reset-password-error" value={reset.error} /><button type="submit" className="primary" disabled={reset.pending}>{reset.pending ? '正在更新密码…' : '更新密码'}</button></form></>;
}

function WorkspaceExperience({ api, session }: { api: TaskPilotDesktopApi; session: Extract<SessionView, { status: 'authenticated' }> }) {
  const [workspaceList, setWorkspaceList] = useState<WorkspaceList | null>(null);
  const [active, setActive] = useState<string>();
  const [error, setError] = useState('');
  const loadGeneration = useRef(0);

  const load = useCallback(async (restore = false) => {
    const generation = ++loadGeneration.current;
    setError('');
    try {
      const result = await api.workspaces.listWorkspaces();
      if (generation !== loadGeneration.current) return;
      setWorkspaceList(result);
      const available = result.items.map((item) => item.workspaceId);
      const restored = restore
        ? await api.workspaces.restoreActiveWorkspace({ availableWorkspaceIds: available })
        : undefined;
      if (generation !== loadGeneration.current) return;
      const next = restored?.workspaceId ?? (result.items.length === 1 ? result.items[0].workspaceId : undefined);
      setActive(next);
      if (next && !restored?.workspaceId) await api.workspaces.selectWorkspace({ workspaceId: next });
    } catch (caught) {
      if (generation === loadGeneration.current) setError(errorMessage(caught));
    }
  }, [api]);

  useEffect(() => {
    queueMicrotask(() => void load(true));
    return () => { loadGeneration.current += 1; };
  }, [load, session.currentUser.userId]);

  const select = useCallback(async (workspaceId: string) => {
    await api.workspaces.selectWorkspace({ workspaceId });
    setActive(workspaceId);
  }, [api]);
  const invalidate = useCallback(async () => {
    setActive(undefined);
    await api.workspaces.clearActiveWorkspace();
    await load(false);
  }, [api, load]);

  if (!workspaceList) {
    return (
      <Shell user={session.currentUser.displayName} onLogout={() => api.auth.logout()}>
        {error ? (
          <section className="notice" aria-labelledby="workspace-load-error">
            <h1 id="workspace-load-error">无法加载 Workspace</h1>
            <ErrorText value={error} />
            <button type="button" onClick={() => void load(true)}>重试</button>
          </section>
        ) : <p role="status">正在加载 Workspace…</p>}
      </Shell>
    );
  }
  if (!active) {
    return (
      <Shell user={session.currentUser.displayName} onLogout={() => api.auth.logout()}>
        <WorkspaceChooser list={workspaceList} api={api} onSelect={select} reload={() => load(false)} />
      </Shell>
    );
  }
  const workspace = workspaceList.items.find((item) => item.workspaceId === active);
  return (
    <Shell
      user={session.currentUser.displayName}
      onLogout={() => api.auth.logout()}
      workspace={workspace?.name}
      onSwitchWorkspace={() => setActive(undefined)}
    >
      <ProjectList
        key={`${session.currentUser.userId}:${active}`}
        api={api}
        workspaceId={active}
        onInvalid={invalidate}
      />
    </Shell>
  );
}

function Shell({ children, user, onLogout, workspace, onSwitchWorkspace }: {
  children: React.ReactNode;
  user: string;
  onLogout(): void;
  workspace?: string;
  onSwitchWorkspace?(): void;
}) {
  return (
    <div className="shell">
      <a className="skip-link" href="#main-content">跳到主要内容</a>
      <header>
        <div className="wordmark dark"><span>TP</span> TaskPilot</div>
        <nav aria-label="当前位置"><span className="user-content">{workspace ?? '选择 Workspace'}</span><b>/</b><span>Projects</span></nav>
        <div className="account">
          {onSwitchWorkspace ? <button type="button" className="ghost" onClick={onSwitchWorkspace}>切换 Workspace</button> : null}
          <span className="account-name user-content">{user}</span>
          <button type="button" className="ghost" onClick={onLogout}>退出</button>
        </div>
      </header>
      <main id="main-content" className="content">{children}</main>
    </div>
  );
}

function workspaceCreationReason(code?: string): string {
  if (code === 'PLAN_LIMIT_REACHED') return '当前方案已达到 Workspace 上限。';
  if (code === 'POLICY_RESTRICTED') return '当前组织策略不允许创建 Workspace。';
  return '当前无法创建新的 Workspace。请联系管理员或稍后重试。';
}

function WorkspaceChooser({ list, api, onSelect, reload }: {
  list: WorkspaceList;
  api: TaskPilotDesktopApi;
  onSelect(workspaceId: string): Promise<void>;
  reload(): Promise<void>;
}) {
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [request, setRequest] = useState<{ name: string; creationRequestId: string }>();
  const nameRef = useRef<HTMLInputElement>(null);
  const retryingIndeterminate = Boolean(request && error);

  const submit = async (event?: React.FormEvent) => {
    event?.preventDefault();
    if (creating) return;
    if (!name.trim()) {
      setError('Workspace 名称不能为空');
      nameRef.current?.focus();
      return;
    }
    const input = request ?? { name: name.trim(), creationRequestId: crypto.randomUUID() };
    setRequest(input);
    setCreating(true);
    setError('');
    try {
      const item = await api.workspaces.createWorkspace(input);
      setRequest(undefined);
      await reload();
      await onSelect(item.workspaceId);
    } catch (caught) {
      const code = (caught as CodedError).code;
      setError(errorMessage(caught));
      if (code !== 'WORKSPACE_RESULT_UNKNOWN' && code !== 'IDEMPOTENCY_IN_PROGRESS') setRequest(undefined);
    } finally {
      setCreating(false);
    }
  };
  const changeName = (value: string) => {
    setName(value);
    setRequest(undefined);
    setError('');
  };

  return (
    <section className="workspace-entry" aria-labelledby="workspace-heading">
      <p className="eyebrow">工作上下文</p>
      <h1 id="workspace-heading">选择一个 Workspace</h1>
      <p className="muted">Workspace 隔离团队成员、项目与权限。</p>
      {list.items.length > 0 ? (
        <ul className="workspace-list">
          {list.items.map((item) => (
            <li key={item.workspaceId}>
              <button type="button" onClick={() => void onSelect(item.workspaceId)}>
                <span className="workspace-name user-content">{item.name}</span><small>{item.type === 'ORGANIZATION' ? '组织' : '个人'}</small><b aria-hidden="true">→</b>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {list.capabilities.canCreateWorkspace ? (
        <>
          <div className="section-rule"><span>创建组织 Workspace</span></div>
          <form onSubmit={submit} className="inline-form">
            <Field name="workspaceName" label="Workspace 名称" value={name} onChange={changeName} autoFocus={list.items.length === 0} inputRef={nameRef} />
            <ErrorText value={error} />
            <button type="submit" className="primary" disabled={creating}>{creating ? '正在确认…' : retryingIndeterminate ? '重试创建' : '创建 Workspace'}</button>
          </form>
        </>
      ) : (
        <p className="policy-note" role="note">{workspaceCreationReason(list.capabilities.createWorkspaceReasonCode)}</p>
      )}
    </section>
  );
}

type ProjectState =
  | { status: 'loading' }
  | { status: 'ready'; items: ProjectItem[]; nextCursor?: string; loadingMore: boolean }
  | { status: 'error'; message: string };

function ProjectList({ api, workspaceId, onInvalid }: {
  api: TaskPilotDesktopApi;
  workspaceId: string;
  onInvalid(): Promise<void>;
}) {
  const [state, setState] = useState<ProjectState>({ status: 'loading' });
  const request = useRef(0);
  const loadingMore = useRef(false);

  const load = useCallback(async (cursor?: string) => {
    if (cursor && loadingMore.current) return;
    if (cursor) loadingMore.current = true;
    const id = ++request.current;
    if (!cursor) setState({ status: 'loading' });
    else setState((old) => old.status === 'ready' ? { ...old, loadingMore: true } : old);
    try {
      const page = await api.projects.listProjects({ workspaceId, cursor, limit: 50 });
      if (id !== request.current) return;
      setState((old) => ({
        status: 'ready',
        items: cursor && old.status === 'ready' ? [...old.items, ...page.items] : page.items,
        nextCursor: page.nextCursor,
        loadingMore: false,
      }));
    } catch (caught) {
      if (id !== request.current) return;
      if ((caught as CodedError).code === 'WORKSPACE_NOT_FOUND') {
        await onInvalid();
        return;
      }
      setState({ status: 'error', message: errorMessage(caught) });
    } finally {
      if (cursor) loadingMore.current = false;
    }
  }, [api, onInvalid, workspaceId]);

  useEffect(() => {
    queueMicrotask(() => void load());
    return () => { request.current += 1; loadingMore.current = false; };
  }, [load]);

  if (state.status === 'loading') return <section><p className="eyebrow">Projects</p><h1>项目</h1><p role="status">正在加载项目…</p></section>;
  if (state.status === 'error') return <section className="notice"><h1>无法加载项目</h1><p role="alert">{state.message}</p><button type="button" onClick={() => void load()}>重试</button></section>;
  return (
    <section>
      <div className="page-title"><div><p className="eyebrow">Projects</p><h1>项目</h1></div><button type="button" className="ghost" onClick={() => void load()}>刷新</button></div>
      {state.items.length === 0 ? (
        <div className="empty"><span className="empty-mark" aria-hidden="true">◇</span><h2>这里还没有可访问的项目</h2><p>刷新列表，或切换到其他 Workspace。</p><button type="button" onClick={() => void load()}>刷新</button></div>
      ) : (
        <ul className="project-list">{state.items.map((project) => <li key={project.projectId}><span className="project-glyph" aria-hidden="true">P</span><div className="project-copy"><h2 className="user-content">{project.name}</h2><small className="user-content">{project.projectId}</small></div></li>)}</ul>
      )}
      {state.nextCursor ? <button type="button" className="secondary load-more" disabled={state.loadingMore} onClick={() => void load(state.nextCursor)}>{state.loadingMore ? '正在加载…' : '加载更多'}</button> : null}
    </section>
  );
}
