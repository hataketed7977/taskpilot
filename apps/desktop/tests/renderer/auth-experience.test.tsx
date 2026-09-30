// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/renderer/App';
import type { SessionView, TaskPilotDesktopApi } from '../../src/shared/contracts';

function signedOutApi(): TaskPilotDesktopApi {
  const signedOut: SessionView = { status: 'signedOut' };
  return {
    auth: {
      getSessionView: vi.fn().mockResolvedValue(signedOut), subscribeSessionView: vi.fn().mockReturnValue(() => undefined), logout: vi.fn(),
      signInWithPassword: vi.fn().mockRejectedValue(Object.assign(new Error('bad'), { code: 'INVALID_CREDENTIALS' })),
      requestLoginCode: vi.fn().mockResolvedValue({ challengeId: '11111111-1111-4111-8111-111111111111', retryAfterSeconds: 30 }), verifyLoginCode: vi.fn(),
      requestRegistrationCode: vi.fn().mockResolvedValue({ challengeId: '11111111-1111-4111-8111-111111111111', retryAfterSeconds: 30 }),
      verifyRegistrationCode: vi.fn().mockResolvedValue({ flowHandle: '22222222-2222-4222-8222-222222222222', expiresAt: '2030-01-01T00:00:00Z' }), register: vi.fn(),
      requestPasswordResetCode: vi.fn().mockResolvedValue({ challengeId: '11111111-1111-4111-8111-111111111111', retryAfterSeconds: 30 }),
      verifyPasswordResetCode: vi.fn().mockResolvedValue({ flowHandle: '22222222-2222-4222-8222-222222222222', expiresAt: '2030-01-01T00:00:00Z' }), resetPassword: vi.fn(),
    },
    workspaces: { listWorkspaces: vi.fn(), createWorkspace: vi.fn(), restoreActiveWorkspace: vi.fn(), selectWorkspace: vi.fn(), clearActiveWorkspace: vi.fn() },
    projects: { listProjects: vi.fn() },
  };
}
afterEach(cleanup);

describe('first-party authentication UX', () => {
  it('provides stable form metadata and a keyboard skip target', async () => {
    const api = signedOutApi(); const operator = userEvent.setup(); render(<App api={api} />);
    const email = await screen.findByLabelText('邮箱');
    expect(screen.getByRole('link', { name: '跳到主要内容' })).toHaveAttribute('href', '#main-content');
    expect(screen.getByRole('main')).toHaveAttribute('id', 'main-content');
    expect(email).toHaveAttribute('name', 'email');
    expect(email).toHaveAttribute('spellcheck', 'false');
    expect(screen.getByLabelText('密码')).toHaveAttribute('name', 'password');

    await operator.click(screen.getByRole('button', { name: '使用邮箱验证码登录' }));
    await operator.type(screen.getByLabelText('邮箱'), 'ada@example.com');
    await operator.click(screen.getByRole('button', { name: '发送验证码' }));
    const code = await screen.findByLabelText('6 位验证码');
    expect(code).toHaveAttribute('name', 'code');
    expect(code).toHaveAttribute('spellcheck', 'false');
  });
  it('associates a server-identified validation error with the focused field', async () => {
    const api = signedOutApi();
    vi.mocked(api.auth.signInWithPassword).mockRejectedValue(Object.assign(new Error('invalid'), {
      code: 'VALIDATION_FAILED',
      path: 'password',
    }));
    const operator = userEvent.setup();
    render(<App api={api} />);
    await operator.type(await screen.findByLabelText('邮箱'), 'ada@example.com');
    await operator.type(screen.getByLabelText('密码'), 'invalid-secret');
    await operator.click(screen.getByRole('button', { name: /^登录$/ }));

    const error = await screen.findByRole('alert');
    const password = screen.getByLabelText('密码');
    expect(password).toHaveFocus();
    expect(password).toHaveAttribute('aria-invalid', 'true');
    expect(password).toHaveAttribute('aria-describedby', error.id);
  });
  it('announces a registration request pending state and rejects duplicate submission', async () => {
    const api = signedOutApi();
    let finish!: () => void;
    vi.mocked(api.auth.requestRegistrationCode).mockReturnValue(new Promise((resolve) => {
      finish = () => resolve({ challengeId: 'challenge', retryAfterSeconds: 30 });
    }));
    const operator = userEvent.setup();
    render(<App api={api} />);
    await operator.click(await screen.findByRole('button', { name: /创建 TaskPilot 账号/ }));
    await operator.type(screen.getByLabelText('邮箱'), 'ada@example.com');
    const submit = screen.getByRole('button', { name: '发送注册验证码' });
    await operator.click(submit);
    await operator.click(submit);

    expect(screen.getByRole('button', { name: '正在发送注册验证码…' })).toBeDisabled();
    expect(api.auth.requestRegistrationCode).toHaveBeenCalledTimes(1);
    finish();
    expect(await screen.findByRole('heading', { name: '验证邮箱' })).toBeInTheDocument();
  });
  it('keeps login and registration distinct while preserving only the email across flows', async () => {
    const api = signedOutApi(); const operator = userEvent.setup(); render(<App api={api} />);
    expect(await screen.findByRole('heading', { name: '登录 TaskPilot' })).toBeInTheDocument();
    await operator.type(screen.getByLabelText('邮箱'), 'ada@example.com');
    await operator.type(screen.getByLabelText('密码'), 'wrong-secret');
    await operator.click(screen.getByRole('button', { name: /^登录$/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('邮箱或密码不正确');
    expect(screen.getByLabelText('密码')).toHaveValue('');
    await operator.click(screen.getByRole('button', { name: /创建 TaskPilot 账号/ }));
    expect(await screen.findByRole('heading', { name: '创建账号' })).toBeInTheDocument();
    expect(screen.getByLabelText('邮箱')).toHaveValue('ada@example.com');
    expect(api.workspaces.listWorkspaces).not.toHaveBeenCalled();
  });
  it('clears OTP and returns to login recovery after an unknown registration outcome', async () => {
    const api = signedOutApi(); const operator = userEvent.setup();
    vi.mocked(api.auth.register).mockRejectedValue(Object.assign(new Error('unknown'), { code: 'REGISTRATION_RESULT_UNKNOWN' }));
    render(<App api={api} />);
    await screen.findByRole('heading', { name: '登录 TaskPilot' });
    await operator.click(screen.getByRole('button', { name: /创建 TaskPilot 账号/ }));
    await operator.type(screen.getByLabelText('邮箱'), 'ada@example.com');
    await operator.click(screen.getByRole('button', { name: '发送注册验证码' }));
    await operator.type(await screen.findByLabelText('6 位验证码'), '123456');
    await operator.click(screen.getByRole('button', { name: '验证邮箱' }));
    await operator.type(await screen.findByLabelText('姓名'), 'Ada');
    await operator.type(screen.getByLabelText('密码'), 'a-long-secret-password');
    await operator.type(screen.getByLabelText('确认密码'), 'a-long-secret-password');
    await operator.click(screen.getByRole('checkbox'));
    await operator.click(screen.getByRole('button', { name: '创建账号' }));
    expect(await screen.findByRole('heading', { name: '登录 TaskPilot' })).toBeInTheDocument();
    expect(screen.getByLabelText('邮箱')).toHaveValue('ada@example.com');
    expect(screen.getByLabelText('密码')).toHaveValue('');
    expect(screen.getByRole('status')).toHaveTextContent('账号可能已创建');
    expect(document.body.textContent).not.toContain('123456');
    expect(document.body.textContent).not.toContain('a-long-secret-password');
  });
  it('prevents duplicate password login submission while pending', async () => {
    const api = signedOutApi(); const operator = userEvent.setup(); let finish!: () => void;
    vi.mocked(api.auth.signInWithPassword).mockReturnValue(new Promise(resolve => { finish = () => resolve({ status: 'signedOut' }); }));
    render(<App api={api} />); await screen.findByRole('heading', { name: '登录 TaskPilot' });
    await operator.type(screen.getByLabelText('邮箱'), 'ada@example.com'); await operator.type(screen.getByLabelText('密码'), 'secret');
    const submit = screen.getByRole('button', { name: /^登录$/ });
    await operator.click(submit); await operator.click(submit);
    expect(api.auth.signInWithPassword).toHaveBeenCalledTimes(1); finish();
    await waitFor(() => expect(screen.getByRole('button', { name: /^登录$/ })).toBeEnabled());
  });
  it('blocks registration when password confirmation differs and restores focus', async () => {
    const api = signedOutApi();
    vi.mocked(api.auth.requestRegistrationCode).mockResolvedValue({ challengeId: 'challenge', retryAfterSeconds: 30 });
    vi.mocked(api.auth.verifyRegistrationCode).mockResolvedValue({ flowHandle: 'flow', expiresAt: '2030-01-01T00:00:00Z' });
    const operator = userEvent.setup();
    render(<App api={api} />);
    await operator.click(await screen.findByRole('button', { name: /创建 TaskPilot 账号/ }));
    await operator.type(screen.getByLabelText('邮箱'), 'ada@example.com');
    await operator.click(screen.getByRole('button', { name: '发送注册验证码' }));
    await operator.type(await screen.findByLabelText('6 位验证码'), '123456');
    await operator.click(screen.getByRole('button', { name: '验证邮箱' }));
    await operator.type(await screen.findByLabelText('姓名'), 'Ada');
    await operator.type(screen.getByLabelText('密码'), 'correct horse battery staple');
    await operator.type(screen.getByLabelText('确认密码'), 'different secret');
    await operator.click(screen.getByRole('checkbox'));
    await operator.click(screen.getByRole('button', { name: '创建账号' }));
    expect(api.auth.register).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('两次输入的密码不一致');
    expect(screen.getByLabelText('确认密码')).toHaveFocus();
  });

  it('shows resend cooldown and a safe rate-limit retry delay', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const api = signedOutApi(); const operator = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<App api={api} />); await screen.findByRole('heading', { name: '登录 TaskPilot' });
    await operator.click(screen.getByRole('button', { name: '使用邮箱验证码登录' }));
    await operator.type(screen.getByLabelText('邮箱'), 'ada@example.com');
    await operator.click(screen.getByRole('button', { name: '发送验证码' }));
    expect(await screen.findByText('30 秒后可重新发送')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重新发送验证码' })).toBeDisabled();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(screen.getByRole('button', { name: '重新发送验证码' })).toBeEnabled();
    vi.mocked(api.auth.verifyLoginCode).mockRejectedValue(Object.assign(new Error('limited'), { code: 'AUTHENTICATION_RATE_LIMITED', retryAfterSeconds: 45 }));
    await operator.type(screen.getByLabelText('6 位验证码'), '123456');
    await operator.click(screen.getByRole('button', { name: /^登录$/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('45 秒后再试');
    vi.useRealTimers();
  });

  it('returns an expired registration continuation to email verification and clears secrets', async () => {
    const api = signedOutApi();
    vi.mocked(api.auth.register).mockRejectedValue(Object.assign(new Error('expired'), { code: 'REGISTRATION_CONTEXT_EXPIRED' }));
    const operator = userEvent.setup();
    render(<App api={api} />);
    await operator.click(await screen.findByRole('button', { name: /创建 TaskPilot 账号/ }));
    await operator.type(screen.getByLabelText('邮箱'), 'ada@example.com');
    await operator.click(screen.getByRole('button', { name: '发送注册验证码' }));
    await operator.type(await screen.findByLabelText('6 位验证码'), '123456');
    await operator.click(screen.getByRole('button', { name: '验证邮箱' }));
    await operator.type(await screen.findByLabelText('姓名'), 'Ada');
    await operator.type(screen.getByLabelText('密码'), 'expired-secret');
    await operator.type(screen.getByLabelText('确认密码'), 'expired-secret');
    await operator.click(screen.getByRole('checkbox'));
    await operator.click(screen.getByRole('button', { name: '创建账号' }));

    expect(await screen.findByRole('heading', { name: '创建账号' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('验证已过期');
    expect(screen.getByLabelText('邮箱')).toHaveValue('ada@example.com');
    expect(document.body.textContent).not.toContain('expired-secret');
  });

  it('returns an expired password reset continuation to email verification and clears the password', async () => {
    const api = signedOutApi();
    vi.mocked(api.auth.resetPassword).mockRejectedValue(Object.assign(new Error('expired'), { code: 'PASSWORD_RESET_CONTEXT_EXPIRED' }));
    const operator = userEvent.setup();
    render(<App api={api} />);
    await operator.type(await screen.findByLabelText('邮箱'), 'ada@example.com');
    await operator.click(screen.getByRole('button', { name: '忘记密码？' }));
    await operator.click(screen.getByRole('button', { name: '发送重置验证码' }));
    await operator.type(await screen.findByLabelText('6 位验证码'), '123456');
    await operator.click(screen.getByRole('button', { name: '继续' }));
    await operator.type(await screen.findByLabelText('新密码'), 'expired-secret');
    await operator.click(screen.getByRole('button', { name: '更新密码' }));

    expect(await screen.findByRole('heading', { name: '重置密码' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('验证已过期');
    expect(screen.getByLabelText('邮箱')).toHaveValue('ada@example.com');
    expect(document.body.textContent).not.toContain('expired-secret');
  });

  it('completes password reset and returns to password login with secrets cleared', async () => {
    const api = signedOutApi(); const operator = userEvent.setup();
    render(<App api={api} />); await screen.findByRole('heading', { name: '登录 TaskPilot' });
    await operator.type(screen.getByLabelText('邮箱'), 'ada@example.com');
    await operator.click(screen.getByRole('button', { name: '忘记密码？' }));
    await operator.click(screen.getByRole('button', { name: '发送重置验证码' }));
    await operator.type(await screen.findByLabelText('6 位验证码'), '123456');
    await operator.click(screen.getByRole('button', { name: '继续' }));
    await operator.type(await screen.findByLabelText('新密码'), 'new-secret-password');
    await operator.click(screen.getByRole('button', { name: '更新密码' }));
    expect(await screen.findByRole('heading', { name: '登录 TaskPilot' })).toBeInTheDocument();
    expect(screen.getByLabelText('邮箱')).toHaveValue('ada@example.com');
    expect(document.body.textContent).not.toContain('123456');
    expect(document.body.textContent).not.toContain('new-secret-password');
    expect(api.auth.resetPassword).toHaveBeenCalledWith(expect.objectContaining({ email: 'ada@example.com' }));
  });

});
