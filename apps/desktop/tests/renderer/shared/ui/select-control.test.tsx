/** @vitest-environment jsdom */
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Select, type SelectOption } from '../../../../src/renderer/shared/ui/select';

const options: readonly SelectOption[] = [
  { value: 'backlog', label: '待处理' },
  { value: 'doing', label: '进行中' },
  { value: 'done', label: '已完成' },
];

function ControlledSelect({ onValueChange = () => undefined }: { onValueChange?(value: string): void }) {
  const [value, setValue] = useState('backlog');
  return (
    <Select
      ariaLabel="所在列表"
      value={value}
      options={options}
      onValueChange={(next) => {
        setValue(next);
        onValueChange(next);
      }}
    />
  );
}

afterEach(cleanup);

describe('shared Select', () => {
  it('commits one stable value and exposes the selected option semantically', async () => {
    const onValueChange = vi.fn();
    const operator = userEvent.setup();
    render(<ControlledSelect onValueChange={onValueChange} />);

    const trigger = screen.getByRole('combobox', { name: '所在列表' });
    await operator.click(trigger);
    expect(screen.getByRole('option', { name: '待处理' })).toHaveAttribute('aria-selected', 'true');
    await operator.click(screen.getByRole('option', { name: '进行中' }));

    expect(onValueChange).toHaveBeenCalledOnce();
    expect(onValueChange).toHaveBeenCalledWith('doing');
    expect(trigger).toHaveTextContent('进行中');
    expect(trigger).toHaveFocus();
  });

  it('cancels with Escape without changing the value and restores trigger focus', async () => {
    const onValueChange = vi.fn();
    const operator = userEvent.setup();
    render(<ControlledSelect onValueChange={onValueChange} />);

    const trigger = screen.getByRole('combobox', { name: '所在列表' });
    await operator.click(trigger);
    await operator.keyboard('{ArrowDown}{Escape}');

    expect(screen.queryByRole('option')).not.toBeInTheDocument();
    expect(trigger).toHaveTextContent('待处理');
    expect(trigger).toHaveFocus();
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it('does not open or change while disabled', async () => {
    const onValueChange = vi.fn();
    const operator = userEvent.setup();
    render(
      <Select
        ariaLabel="所在列表"
        value="backlog"
        options={options}
        onValueChange={onValueChange}
        disabled
      />,
    );

    const trigger = screen.getByRole('combobox', { name: '所在列表' });
    expect(trigger).toBeDisabled();
    await operator.click(trigger);
    expect(screen.queryByRole('option')).not.toBeInTheDocument();
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it('uses labelledBy as the field name and marks unavailable options disabled', async () => {
    const operator = userEvent.setup();
    render(
      <>
        <span id="column-label">所在列表</span>
        <Select
          labelledBy="column-label"
          value="backlog"
          options={[...options, { value: 'archived', label: '已归档', disabled: true }]}
          onValueChange={() => undefined}
        />
      </>,
    );

    await operator.click(screen.getByRole('combobox', { name: '所在列表' }));
    expect(screen.getByRole('option', { name: '已归档' })).toHaveAttribute('data-disabled');
  });
});
