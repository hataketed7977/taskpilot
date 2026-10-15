import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type ReactNode, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  ProjectHomeView,
  ProjectResponseKey,
  ProjectView,
  SessionView,
  TaskPilotDesktopApi,
} from '../shared/contracts';
import { useLocale } from './i18n/locale-state';
import { displayNameInitials } from './profile';

type AuthenticatedSession = Extract<SessionView, { status: 'authenticated' }>;
type Surface = 'home' | 'settings' | 'archived';
type LoadState = { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; home: ProjectHomeView; key: ProjectResponseKey };
type ArchivedState = { kind: 'idle' | 'loading' | 'error' } | { kind: 'ready'; items: ProjectView[] };
type CodedError = { code?: string; recovery?: string };

export function ProjectHome({ api, session }: { api: TaskPilotDesktopApi; session: AuthenticatedSession }) {
  const { t } = useTranslation();
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [surface, setSurface] = useState<Surface>('home');
  const [archived, setArchived] = useState<ArchivedState>({ kind: 'idle' });
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteProject, setDeleteProject] = useState<ProjectView>();
  const [accountOpen, setAccountOpen] = useState(false);
  const [errorSignOutPending, setErrorSignOutPending] = useState(false);
  const requestGeneration = useRef(0);
  const selectionGeneration = useRef(0);
  const archivedGeneration = useRef(0);
  const acceptedKey = useRef<ProjectResponseKey | undefined>(undefined);

  const accepts = useCallback((key: ProjectResponseKey, expected?: { workspaceId?: string; projectId?: string; status?: 'ACTIVE' | 'ARCHIVED' }) => {
    if (key.userId !== session.currentUser.userId) return false;
    const current = acceptedKey.current;
    if (current && key.sessionGeneration !== current.sessionGeneration) return false;
    if (expected?.workspaceId && key.workspaceId !== expected.workspaceId) return false;
    if (expected?.projectId && key.projectId !== expected.projectId) return false;
    if (expected?.status && key.status !== expected.status) return false;
    return true;
  }, [session.currentUser.userId]);

  const loadHome = useCallback(async (showLoading = true) => {
    const request = ++requestGeneration.current;
    if (showLoading) setState({ kind: 'loading' });
    try {
      const result = await api.projects.resolveHome();
      if (request !== requestGeneration.current || !accepts(result.key)) return;
      acceptedKey.current = result.key;
      setState({ kind: 'ready', home: result.value, key: result.key });
    } catch (error) {
      if (request !== requestGeneration.current) return;
      if ((error as CodedError).recovery === 'SIGN_IN') return;
      setState({ kind: 'error' });
    }
  }, [accepts, api.projects]);

  useEffect(() => {
    const request = ++requestGeneration.current;
    void api.projects.resolveHome().then((result) => {
      if (request !== requestGeneration.current || !accepts(result.key)) return;
      acceptedKey.current = result.key;
      setState({ kind: 'ready', home: result.value, key: result.key });
    }).catch((error: unknown) => {
      if (request !== requestGeneration.current || (error as CodedError).recovery === 'SIGN_IN') return;
      setState({ kind: 'error' });
    });
    return () => { requestGeneration.current += 1; };
  }, [accepts, api.projects]);

  const showArchived = useCallback(async () => {
    if (state.kind !== 'ready') return;
    const request = ++archivedGeneration.current;
    setSurface('archived');
    setArchived({ kind: 'loading' });
    try {
      const workspaceId = state.home.workspace.workspaceId;
      const items: ProjectView[] = [];
      const seenCursors = new Set<string>();
      let cursor: string | undefined;
      do {
        const result = await api.projects.list({
          workspaceId, status: 'ARCHIVED', limit: 50, ...(cursor ? { cursor } : {}),
        });
        if (request !== archivedGeneration.current || !accepts(result.key, { workspaceId, status: 'ARCHIVED' })) return;
        items.push(...result.value.items);
        cursor = result.value.nextCursor ?? undefined;
        if (cursor && seenCursors.has(cursor)) throw new Error('Project pagination cursor repeated');
        if (cursor) seenCursors.add(cursor);
      } while (cursor);
      if (request === archivedGeneration.current) setArchived({ kind: 'ready', items });
    } catch (error) {
      if (request === archivedGeneration.current && (error as CodedError).recovery !== 'SIGN_IN') setArchived({ kind: 'error' });
    }
  }, [accepts, api.projects, state]);

  if (state.kind === 'loading') return <ProjectShellSkeleton user={session.currentUser} />;
  if (state.kind === 'error') {
    return (
      <main id="main-content" className="project-load-state">
        <section role="alert" aria-labelledby="project-load-error">
          <p className="workspace-kicker">{t('project.personalSpace')}</p>
          <h1 id="project-load-error">{t('project.loadErrorTitle')}</h1>
          <p>{t('project.loadErrorDetail')}</p>
          <div className="project-load-state__actions">
            <button type="button" className="project-button project-button--primary" onClick={() => void loadHome()}>{t('common.retry')}</button>
            <button type="button" className="project-button" disabled={errorSignOutPending} onClick={() => {
              setErrorSignOutPending(true);
              void api.auth.logout().finally(() => setErrorSignOutPending(false));
            }}>{errorSignOutPending ? t('account.loggingOut') : t('project.loadErrorSignOut')}</button>
          </div>
        </section>
      </main>
    );
  }

  const { home, key } = state;
  const current = home.currentProject;
  const replaceProject = (project: ProjectView) => setState(previous => previous.kind === 'ready' ? {
    ...previous,
    home: { ...previous.home, currentProject: project, projects: previous.home.projects.map(item => item.projectId === project.projectId ? project : item) },
  } : previous);
  const selectProject = async (project: ProjectView) => {
    const request = ++selectionGeneration.current;
    setSurface('home');
    try {
      const result = await api.projects.open({ workspaceId: home.workspace.workspaceId, projectId: project.projectId });
      if (request !== selectionGeneration.current || !accepts(result.key, { workspaceId: home.workspace.workspaceId, projectId: project.projectId })) return;
      setState(previous => previous.kind === 'ready' ? { ...previous, home: { ...previous.home, currentProject: result.value } } : previous);
    } catch (error) {
      if (request === selectionGeneration.current && (error as CodedError).recovery !== 'SIGN_IN') setState({ kind: 'error' });
    }
  };

  return (
    <main id="main-content" className="project-shell">
      <header className="project-titlebar"><span className="project-wordmark" translate="no">TaskPilot</span></header>
      <aside className="project-sidebar" aria-label={t('project.navigation')}>
        <div className="workspace-context">
          <span className="workspace-symbol" aria-hidden="true">P</span>
          <div><span>{t('project.personalSpace')}</span><small>{t('project.workspaceOwner')}</small></div>
        </div>
        <div className="project-nav-heading">
          <span className="project-nav-heading__label"><ProjectCollectionIcon />{t('project.projects')}</span>
          <button type="button" className="icon-action" aria-label={t('project.createAction')} title={t('project.createAction')} onClick={() => setCreateOpen(true)}>+</button>
        </div>
        <nav className="project-list" aria-label={t('project.projectList')}>
          {home.projects.map(project => (
            <button key={project.projectId} type="button" className={`project-nav-item${project.projectId === current?.projectId ? ' is-current' : ''}`}
              aria-current={project.projectId === current?.projectId ? 'page' : undefined} title={project.name}
              onClick={() => void selectProject(project)}>
              <span className="project-nav-item__label">{project.name}</span>
            </button>
          ))}
        </nav>
        <button type="button" className={`sidebar-action${surface === 'archived' ? ' is-active' : ''}`} onClick={() => void showArchived()}>
          <ArchiveIcon />{t('project.archivedAction')}
        </button>
        <div className="account-dock">
          <button type="button" className="account-trigger" aria-expanded={accountOpen} aria-label={t('project.openAccountMenu')} onClick={() => setAccountOpen(value => !value)}>
            <Avatar user={session.currentUser} size="small" />
            <span className="account-trigger__name">{session.currentUser.displayName}</span><span aria-hidden="true">⌃</span>
          </button>
          {accountOpen ? <AccountMenu api={api} user={session.currentUser} /> : null}
        </div>
      </aside>
      <section className="project-workspace">
        {surface === 'archived' ? (
          <ArchivedProjects state={archived} current={current} workspaceId={home.workspace.workspaceId} api={api} accepts={accepts}
            onBack={() => { archivedGeneration.current += 1; setSurface('home'); }} onRetry={() => void showArchived()} onRestored={(project) => {
              setArchived(previous => previous.kind === 'ready' ? { kind: 'ready', items: previous.items.filter(item => item.projectId !== project.projectId) } : previous);
              void loadHome(false);
            }} onDelete={setDeleteProject} />
        ) : current ? (
          surface === 'settings' ? (
            <ProjectSettings project={current} workspaceId={home.workspace.workspaceId} api={api} accepts={accepts}
              onBack={() => setSurface('home')} onSaved={(project) => { replaceProject(project); setSurface('home'); }}
              onArchived={() => { setSurface('home'); void loadHome(); }} onDelete={() => setDeleteProject(current)} />
          ) : (
            <ProjectSurface project={current} onSettings={() => setSurface('settings')} />
          )
        ) : (
          <EmptyProjects onCreate={() => setCreateOpen(true)} onArchived={() => void showArchived()} />
        )}
      </section>
      {createOpen ? <CreateProjectDialog workspaceId={home.workspace.workspaceId} api={api} accepts={accepts} onClose={() => setCreateOpen(false)}
        onCreated={(project, responseKey) => {
          acceptedKey.current = responseKey;
          setState(previous => previous.kind === 'ready' ? { ...previous, key: responseKey, home: { ...previous.home, projects: [...previous.home.projects, project], currentProject: project } } : previous);
          setSurface('home'); setCreateOpen(false);
        }} /> : null}
      {deleteProject ? <DeleteProjectDialog project={deleteProject} workspaceId={home.workspace.workspaceId} api={api} accepts={accepts}
        onClose={() => setDeleteProject(undefined)} onDeleted={() => { setDeleteProject(undefined); setSurface('home'); void loadHome(); }} /> : null}
      <span className="visually-hidden" aria-live="polite">{key.sessionGeneration}</span>
    </main>
  );
}

function ProjectSurface({ project, onSettings }: { project: ProjectView; onSettings(): void }) {
  const { t } = useTranslation();
  return <div className="project-page"><header className="project-page__header"><div><p>{t('project.personalSpace')}</p><h1>{project.name}</h1>{project.description ? <p className="project-description">{project.description}</p> : null}</div><button type="button" className="project-button" onClick={onSettings}><SettingsIcon />{t('project.settingsAction')}</button></header><div className="project-start"><span className="project-start__mark" aria-hidden="true">TP</span><h2>{t('project.readyTitle')}</h2><p>{t('project.readyDetail')}</p></div></div>;
}

function EmptyProjects({ onCreate, onArchived }: { onCreate(): void; onArchived(): void }) {
  const { t } = useTranslation();
  return <div className="project-page project-page--empty"><div className="empty-projects"><span aria-hidden="true">+</span><h1>{t('project.emptyTitle')}</h1><p>{t('project.emptyDetail')}</p><button type="button" className="project-button project-button--primary" onClick={onCreate}>{t('project.createAction')}</button><button type="button" className="text-action" onClick={onArchived}>{t('project.archivedAction')}</button></div></div>;
}

function ProjectSettings({ project, workspaceId, api, accepts, onBack, onSaved, onArchived, onDelete }: {
  project: ProjectView; workspaceId: string; api: TaskPilotDesktopApi; accepts(key: ProjectResponseKey, expected?: { workspaceId?: string; projectId?: string }): boolean;
  onBack(): void; onSaved(project: ProjectView): void; onArchived(): void; onDelete(): void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description);
  const [pending, setPending] = useState<'save' | 'archive'>();
  const [error, setError] = useState(false);
  const fieldErrors = projectFieldErrors(name, description);
  const save = async (event: FormEvent) => {
    event.preventDefault(); if (!normalizeProjectText(name) || fieldErrors.invalid || pending) return;
    setPending('save'); setError(false);
    try {
      const result = await api.projects.edit({ workspaceId, projectId: project.projectId, expectedVersion: project.version, name: normalizeProjectText(name), description: normalizeProjectText(description) });
      if (accepts(result.key, { workspaceId, projectId: project.projectId })) onSaved(result.value);
    } catch { setError(true); } finally { setPending(undefined); }
  };
  const archive = async () => {
    if (pending) return; setPending('archive'); setError(false);
    try {
      const result = await api.projects.archive({ workspaceId, projectId: project.projectId, expectedVersion: project.version });
      if (accepts(result.key, { workspaceId, projectId: project.projectId })) onArchived();
    } catch { setError(true); } finally { setPending(undefined); }
  };
  return <div className="project-page settings-page"><header className="settings-header"><button type="button" className="back-action" onClick={onBack}>← {t('project.back')}</button><p>{t('project.personalSpace')}</p><h1>{t('project.settingsTitle')}</h1></header><form className="settings-form" aria-describedby={error ? 'project-settings-error' : undefined} onSubmit={(event) => void save(event)}><ProjectFields name={name} description={description} setName={setName} setDescription={setDescription} /><div className="form-actions"><button type="submit" className="project-button project-button--primary" disabled={!normalizeProjectText(name) || fieldErrors.invalid || Boolean(pending)}>{pending === 'save' ? t('project.saving') : t('project.save')}</button></div>{error ? <p id="project-settings-error" className="project-error" role="alert">{t('project.mutationError')}</p> : null}</form><section className="settings-section"><div><h2>{t('project.archiveTitle')}</h2><p>{t('project.archiveDetail')}</p></div><button type="button" className="project-button" disabled={Boolean(pending)} onClick={() => void archive()}>{pending === 'archive' ? t('project.archiving') : t('project.archiveAction')}</button></section><section className="settings-section settings-section--danger"><div><h2>{t('project.dangerTitle')}</h2><p>{t('project.dangerDetail')}</p></div><button type="button" className="project-button project-button--danger" onClick={onDelete}>{t('project.deleteAction')}</button></section></div>;
}

function ArchivedProjects({ state, current, workspaceId, api, accepts, onBack, onRetry, onRestored, onDelete }: {
  state: ArchivedState; current?: ProjectView; workspaceId: string; api: TaskPilotDesktopApi;
  accepts(key: ProjectResponseKey, expected?: { workspaceId?: string; projectId?: string }): boolean; onBack(): void; onRetry(): void; onRestored(project: ProjectView): void; onDelete(project: ProjectView): void;
}) {
  const { t } = useTranslation();
  const [pending, setPending] = useState<string>();
  const [restoreError, setRestoreError] = useState(false);
  const items = state.kind === 'ready' ? state.items : [];
  const restore = async (project: ProjectView) => {
    setPending(project.projectId); setRestoreError(false);
    try {
      const result = await api.projects.restore({ workspaceId, projectId: project.projectId, expectedVersion: project.version });
      if (accepts(result.key, { workspaceId, projectId: project.projectId })) onRestored(result.value);
    } catch (error) {
      if ((error as CodedError).recovery !== 'SIGN_IN') setRestoreError(true);
    } finally { setPending(undefined); }
  };
  return <div className="project-page archived-page"><header className="settings-header"><button type="button" className="back-action" onClick={onBack}>← {t('project.back')}</button><p>{current ? t('project.currentProject', { name: current.name }) : t('project.personalSpace')}</p><h1>{t('project.archivedTitle')}</h1></header>{restoreError ? <p className="project-error" role="alert">{t('project.restoreError')}</p> : null}{state.kind === 'loading' || state.kind === 'idle' ? <p role="status">{t('project.loadingArchived')}</p> : state.kind === 'error' ? <div role="alert" className="inline-state"><p>{t('project.archivedError')}</p><button type="button" className="project-button" onClick={onRetry}>{t('common.retry')}</button></div> : items.length === 0 ? <p className="quiet-state">{t('project.noArchived')}</p> : <ul className="archived-list">{items.map(project => <li key={project.projectId}><div><strong>{project.name}</strong>{project.description ? <p>{project.description}</p> : null}</div><div><button type="button" className="project-button" disabled={Boolean(pending)} aria-label={t('project.restoreNamed', { name: project.name })} onClick={() => void restore(project)}>{pending === project.projectId ? t('project.restoring') : t('project.restoreAction')}</button><button type="button" className="icon-action icon-action--danger" aria-label={t('project.deleteNamed', { name: project.name })} title={t('project.deleteAction')} onClick={() => onDelete(project)}>×</button></div></li>)}</ul>}</div>;
}

function CreateProjectDialog({ workspaceId, api, accepts, onClose, onCreated }: {
  workspaceId: string; api: TaskPilotDesktopApi; accepts(key: ProjectResponseKey, expected?: { workspaceId?: string; projectId?: string }): boolean;
  onClose(): void; onCreated(project: ProjectView, key: ProjectResponseKey): void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(''); const [description, setDescription] = useState(''); const [pending, setPending] = useState(false); const [error, setError] = useState(false);
  const input = useRef<HTMLInputElement>(null); const requestIdentity = useRef<{ fingerprint: string; requestId: string } | undefined>(undefined);
  const fieldErrors = projectFieldErrors(name, description);
  useInitialFocus(input);
  const submit = async (event: FormEvent) => {
    event.preventDefault(); if (!normalizeProjectText(name) || fieldErrors.invalid || pending) return; setPending(true); setError(false);
    const fingerprint = JSON.stringify([normalizeProjectText(name), normalizeProjectText(description)]);
    if (requestIdentity.current?.fingerprint !== fingerprint) requestIdentity.current = { fingerprint, requestId: crypto.randomUUID() };
    try { const result = await api.projects.create({ workspaceId, requestId: requestIdentity.current.requestId, name: normalizeProjectText(name), description: normalizeProjectText(description) }); if (accepts(result.key, { workspaceId, projectId: result.value.projectId })) onCreated(result.value, result.key); }
    catch { setError(true); } finally { setPending(false); }
  };
  return <Modal title={t('project.createTitle')} onClose={onClose} pending={pending}><form aria-describedby={error ? 'project-create-error' : undefined} onSubmit={(event) => void submit(event)}><ProjectFields inputRef={input} name={name} description={description} setName={setName} setDescription={setDescription} /><div className="dialog-actions"><button type="button" className="project-button" disabled={pending} onClick={onClose}>{t('project.cancel')}</button><button type="submit" className="project-button project-button--primary" disabled={pending || !normalizeProjectText(name) || fieldErrors.invalid}>{pending ? t('project.creating') : t('project.create')}</button></div>{error ? <p id="project-create-error" className="project-error" role="alert">{t('project.mutationError')}</p> : null}</form></Modal>;
}

function DeleteProjectDialog({ project, workspaceId, api, accepts, onClose, onDeleted }: {
  project: ProjectView; workspaceId: string; api: TaskPilotDesktopApi; accepts(key: ProjectResponseKey, expected?: { workspaceId?: string; projectId?: string }): boolean; onClose(): void; onDeleted(): void;
}) {
  const { t } = useTranslation(); const [confirmation, setConfirmation] = useState(''); const [pending, setPending] = useState(false); const [error, setError] = useState(false); const input = useRef<HTMLInputElement>(null);
  useInitialFocus(input);
  const submit = async (event: FormEvent) => { event.preventDefault(); if (confirmation !== project.name || pending) return; setPending(true); setError(false); try { const result = await api.projects.permanentlyDelete({ workspaceId, projectId: project.projectId, expectedVersion: project.version, confirmationName: confirmation }); if (accepts(result.key, { workspaceId, projectId: project.projectId })) onDeleted(); } catch { setError(true); } finally { setPending(false); } };
  return <Modal title={t('project.deleteTitle', { name: project.name })} onClose={onClose} pending={pending} danger><p className="dialog-copy">{t('project.deleteDetail')}</p><form aria-describedby={error ? 'project-delete-error' : undefined} onSubmit={(event) => void submit(event)}><label className="project-field"><span>{t('project.deleteConfirmation', { name: project.name })}</span><input ref={input} name="projectNameConfirmation" autoComplete="off" value={confirmation} onChange={event => setConfirmation(event.target.value)} /></label><div className="dialog-actions"><button type="button" className="project-button" disabled={pending} onClick={onClose}>{t('project.cancel')}</button><button type="submit" className="project-button project-button--danger" disabled={pending || confirmation !== project.name}>{pending ? t('project.deleting') : t('project.delete')}</button></div>{error ? <p id="project-delete-error" className="project-error" role="alert">{t('project.deleteError')}</p> : null}</form></Modal>;
}

function Modal({ title, children, onClose, pending, danger = false }: { title: string; children: ReactNode; onClose(): void; pending: boolean; danger?: boolean }) {
  const { t } = useTranslation();
  const dialog = useRef<HTMLElement>(null);
  useEffect(() => {
    const returnTarget = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    return () => { returnTarget?.focus(); };
  }, []);

  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !pending) {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !dialog.current) return;
      const focusable = [...dialog.current.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])')];
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, [onClose, pending]);

  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !pending) onClose(); }}><section ref={dialog} className={`project-dialog${danger ? ' project-dialog--danger' : ''}`} role="dialog" aria-modal="true" aria-labelledby="dialog-title"><header><h2 id="dialog-title">{title}</h2><button type="button" className="icon-action" aria-label={t('project.close')} disabled={pending} onClick={onClose}>×</button></header>{children}</section></div>;
}

function ProjectFields({ name, description, setName, setDescription, inputRef }: { name: string; description: string; setName(value: string): void; setDescription(value: string): void; inputRef?: RefObject<HTMLInputElement | null> }) {
  const { t } = useTranslation();
  const id = useId();
  const errors = projectFieldErrors(name, description);
  const nameErrorId = `${id}-project-name-error`;
  const descriptionErrorId = `${id}-project-description-error`;
  return <div className="project-fields"><label className="project-field"><span>{t('project.name')}</span><input ref={inputRef} name="projectName" autoComplete="off" required value={name} aria-invalid={errors.name || undefined} aria-describedby={errors.name ? nameErrorId : undefined} onChange={event => setName(event.target.value)} />{errors.name ? <span id={nameErrorId} className="project-error" role="alert">{t('project.nameTooLong')}</span> : null}</label><label className="project-field"><span>{t('project.description')}</span><textarea name="projectDescription" autoComplete="off" rows={4} value={description} aria-invalid={errors.description || undefined} aria-describedby={errors.description ? descriptionErrorId : undefined} onChange={event => setDescription(event.target.value)} />{errors.description ? <span id={descriptionErrorId} className="project-error" role="alert">{t('project.descriptionTooLong')}</span> : null}</label></div>;
}

function projectFieldErrors(name: string, description: string) {
  const nameTooLong = [...normalizeProjectText(name)].length > 200;
  const descriptionTooLong = [...normalizeProjectText(description)].length > 2000;
  return { name: nameTooLong, description: descriptionTooLong, invalid: nameTooLong || descriptionTooLong };
}

function normalizeProjectText(value: string) {
  let start = 0;
  let end = value.length;
  while (start < end && value.charCodeAt(start) <= 0x20) start += 1;
  while (end > start && value.charCodeAt(end - 1) <= 0x20) end -= 1;
  return value.slice(start, end);
}

function AccountMenu({ api, user }: { api: TaskPilotDesktopApi; user: AuthenticatedSession['currentUser'] }) {
  const { t } = useTranslation(); const [pending, setPending] = useState(false);
  return <section className="account-menu" aria-label={t('project.accountMenu')}><div className="account-menu__identity"><Avatar user={user} size="large" /><div><strong>{user.displayName}</strong><span>{t('project.signedIn')}</span></div></div><LanguageSelectorInline /><button type="button" className="account-menu__logout" disabled={pending} onClick={() => { setPending(true); void api.auth.logout().finally(() => setPending(false)); }}>{pending ? t('account.loggingOut') : t('account.logout')}</button></section>;
}

function LanguageSelectorInline() { const { locale, changeLocale } = useLocale(); const { t } = useTranslation(); return <label className="account-language"><span>{t('language.label')}</span><select aria-label={t('language.label')} value={locale} onChange={event => void changeLocale(event.target.value as 'zh-CN' | 'en')}><option value="zh-CN">{t('language.chinese')}</option><option value="en">{t('language.english')}</option></select></label>; }
function Avatar({ user, size }: { user: AuthenticatedSession['currentUser']; size: 'small' | 'large' }) { return user.avatarUrl ? <img className={`shell-avatar shell-avatar--${size}`} src={user.avatarUrl} alt="" width={size === 'small' ? 28 : 36} height={size === 'small' ? 28 : 36} referrerPolicy="no-referrer" /> : <span className={`shell-avatar shell-avatar--${size} shell-avatar--fallback`} aria-hidden="true">{displayNameInitials(user.displayName)}</span>; }
function ProjectShellSkeleton({ user }: { user: AuthenticatedSession['currentUser'] }) { const { t } = useTranslation(); return <main id="main-content" className="project-shell project-shell--loading" aria-busy="true"><header className="project-titlebar"><span className="project-wordmark" translate="no">TaskPilot</span></header><aside className="project-sidebar"><div className="workspace-context"><span className="workspace-symbol">P</span><div><span>{t('project.personalSpace')}</span><small>{t('project.workspaceOwner')}</small></div></div><div className="skeleton skeleton--row" /><div className="skeleton skeleton--row" /><div className="skeleton skeleton--row" /><div className="account-dock"><Avatar user={user} size="small" /></div></aside><section className="project-workspace"><div className="project-page"><div className="skeleton skeleton--title" /><div className="skeleton skeleton--copy" /><p role="status" className="visually-hidden">{t('project.loading')}</p></div></section></main>; }
function useInitialFocus(input: RefObject<HTMLElement | null>) { useEffect(() => { input.current?.focus(); }, [input]); }
function ProjectCollectionIcon() { return <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M1.75 4.75h4.1l1.3 1.5h7.1v6.25a1.5 1.5 0 0 1-1.5 1.5h-9.5a1.5 1.5 0 0 1-1.5-1.5z" /><path d="M2.25 4.75v-1.25A1.5 1.5 0 0 1 3.75 2h3.1l1.3 1.5h4.1a1.5 1.5 0 0 1 1.5 1.5v1.25" /></svg>; }
function ArchiveIcon() { return <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 4.5h11v8h-11zM2 2.5h12v2H2zm4 4h4" /></svg>; }
function SettingsIcon() { return <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="2.2" /><path d="M8 1.8v1.4M8 12.8v1.4M1.8 8h1.4M12.8 8h1.4M3.6 3.6l1 1M11.4 11.4l1 1M12.4 3.6l-1 1M4.6 11.4l-1 1" /></svg>; }
