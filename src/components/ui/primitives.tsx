// Adapted from the PersianLabs consumer registry, revision 91b3f70d1baf90bb26e9e86f47525820d45ec2ff.
import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { Input as InputPrimitive } from "@base-ui/react/input";
import { Select } from "@base-ui/react/select";
import { Dialog } from "@base-ui/react/dialog";
import { Switch } from "@base-ui/react/switch";
import { Check, ChevronDown } from "lucide-react";
import { useId, type ComponentProps, type ReactNode } from "react";

export function Button({
  tone = "primary",
  className,
  children,
  ...props
}: ButtonPrimitive.Props & { tone?: "primary" | "quiet" | "danger" }) {
  return (
    <ButtonPrimitive
      type="button"
      data-slot="button"
      className={`button button--${tone} ${className ?? ""}`}
      {...props}
    >
      {children}
    </ButtonPrimitive>
  );
}

type FieldProps = { label: string; error?: string; hint?: string };
function Field({
  label,
  error,
  hint,
  children,
}: FieldProps & { children: (id: string, description?: string) => ReactNode }) {
  const id = useId();
  const descriptiveText = error ?? hint;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children(id, descriptiveText ? `${id}-hint` : undefined)}
      {descriptiveText && (
        <p id={`${id}-hint`} className={error ? "field-error" : "field-hint"}>
          {descriptiveText}
        </p>
      )}
    </div>
  );
}

export function Input({
  label,
  error,
  hint,
  ...props
}: FieldProps & Omit<ComponentProps<"input">, "id">) {
  return (
    <Field label={label} error={error} hint={hint}>
      {(id, description) => (
        <InputPrimitive
          {...props}
          id={id}
          data-slot="input"
          className="control"
          aria-invalid={error ? true : undefined}
          aria-describedby={description}
        />
      )}
    </Field>
  );
}

export function Textarea({
  label,
  error,
  hint,
  ...props
}: FieldProps & Omit<ComponentProps<"textarea">, "id">) {
  return (
    <Field label={label} error={error} hint={hint}>
      {(id, description) => (
        <textarea
          {...props}
          id={id}
          data-slot="textarea"
          className="control textarea"
          aria-invalid={error ? true : undefined}
          aria-describedby={description}
        />
      )}
    </Field>
  );
}

export type Choice<T extends string = string> = { value: T; label: string };

export function Picker<T extends string>({
  label,
  value,
  choices,
  onChange,
  error,
  hint,
  disabled,
}: FieldProps & {
  value: T;
  choices: Choice<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  return (
    <Field label={label} error={error} hint={hint}>
      {(id, description) => (
        <Select.Root
          items={choices}
          value={value}
          disabled={disabled}
          onValueChange={(choice) => {
            if (choice !== null) onChange(choice);
          }}
        >
          <Select.Trigger
            id={id}
            className="control select-trigger"
            aria-describedby={description}
            aria-invalid={!!error}
          >
            <Select.Value>
              {choices.find((choice) => choice.value === value)?.label ?? "—"}
            </Select.Value>
            <Select.Icon>
              <ChevronDown aria-hidden size={17} />
            </Select.Icon>
          </Select.Trigger>
          <Select.Portal>
            <Select.Positioner sideOffset={6} className="popup-position">
              <Select.Popup className="popover">
                <Select.List className="choices">
                  {choices.map((choice) => (
                    <Select.Item
                      value={choice.value}
                      key={choice.value}
                      className="choice"
                    >
                      <Select.ItemText>{choice.label}</Select.ItemText>
                      <Select.ItemIndicator>
                        <Check aria-hidden size={16} />
                      </Select.ItemIndicator>
                    </Select.Item>
                  ))}
                </Select.List>
              </Select.Popup>
            </Select.Positioner>
          </Select.Portal>
        </Select.Root>
      )}
    </Field>
  );
}

export function Modal({
  title,
  description,
  open,
  onOpenChange,
  children,
}: {
  title: string;
  description?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="dialog-background" />
        <Dialog.Popup className="dialog">
          <Dialog.Title>{title}</Dialog.Title>
          {description && (
            <Dialog.Description>{description}</Dialog.Description>
          )}
          {children}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function Toggle({
  label,
  enabled,
  onChange,
}: {
  label: string;
  enabled: boolean;
  onChange: (enabled: boolean) => void;
}) {
  const id = useId();
  return (
    <div className="toggle-row">
      <label htmlFor={id}>{label}</label>
      <Switch.Root
        id={id}
        checked={enabled}
        onCheckedChange={onChange}
        className="switch"
      >
        <Switch.Thumb className="switch-thumb" />
      </Switch.Root>
    </div>
  );
}
