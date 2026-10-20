import * as SelectPrimitive from '@radix-ui/react-select';

export type SelectOption = {
  value: string;
  label: string;
  disabled?: boolean;
};

type SelectAccessibleName =
  | { ariaLabel: string; labelledBy?: never }
  | { ariaLabel?: never; labelledBy: string };

export type SelectProps = SelectAccessibleName & {
  value: string;
  options: readonly SelectOption[];
  onValueChange(value: string): void;
  disabled?: boolean;
  variant?: 'default' | 'compact';
};

export function Select({
  value,
  options,
  onValueChange,
  ariaLabel,
  labelledBy,
  disabled = false,
  variant = 'default',
}: SelectProps) {
  return (
    <SelectPrimitive.Root value={value} onValueChange={onValueChange} disabled={disabled}>
      <SelectPrimitive.Trigger
        className={`tp-select-trigger tp-select-trigger--${variant}`}
        aria-label={ariaLabel}
        aria-labelledby={labelledBy}
      >
        <SelectPrimitive.Value />
        <SelectPrimitive.Icon className="tp-select-trigger__icon" aria-hidden="true">
          <ChevronDownIcon />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          className="tp-select-content"
          data-taskpilot-select-content=""
          position="popper"
          sideOffset={6}
          collisionPadding={10}
          onEscapeKeyDown={(event) => event.stopPropagation()}
        >
          <SelectPrimitive.ScrollUpButton className="tp-select-scroll-button" aria-hidden="true">
            <ChevronUpIcon />
          </SelectPrimitive.ScrollUpButton>
          <SelectPrimitive.Viewport className="tp-select-viewport">
            {options.map((option) => (
              <SelectPrimitive.Item
                className="tp-select-item"
                disabled={option.disabled}
                key={option.value}
                value={option.value}
                title={option.label}
              >
                <SelectPrimitive.ItemIndicator className="tp-select-item__indicator">
                  <CheckIcon />
                </SelectPrimitive.ItemIndicator>
                <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
          <SelectPrimitive.ScrollDownButton className="tp-select-scroll-button" aria-hidden="true">
            <ChevronDownIcon />
          </SelectPrimitive.ScrollDownButton>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}

function ChevronDownIcon() {
  return <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg>;
}

function ChevronUpIcon() {
  return <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 10 4-4 4 4" /></svg>;
}

function CheckIcon() {
  return <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3.5 8 3 3 6-6" /></svg>;
}
