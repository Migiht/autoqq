import * as clack from "@clack/prompts";

export interface PickerOption {
  value: string;
  label: string;
  hint?: string;
}

interface PickerConfig {
  message: string;
  options: PickerOption[];
  maxItems?: number; // visible window, 5-7 rows
  placeholder?: string;
  initialValue?: string;
}

function handleCancel(value: unknown): void {
  if (clack.isCancel(value)) {
    clack.cancel("Cancelled.");
    process.exit(0);
  }
}

/** Single choice — filter by typing, arrows, enter. */
export async function pickOne(config: PickerConfig): Promise<string> {
  const result = await clack.autocomplete({
    message: config.message,
    placeholder: config.placeholder ?? "Type to filter...",
    maxItems: config.maxItems ?? 6,
    options: config.options,
    initialValue: config.initialValue,
  });
  handleCancel(result);
  return result as string;
}

/** Multiple choice — same navigation + space to toggle. */
export async function pickMany(
  config: PickerConfig & { required?: boolean }
): Promise<string[]> {
  const result = await clack.autocompleteMultiselect({
    message: config.message,
    placeholder: config.placeholder ?? "Type to filter, space to toggle, enter to confirm",
    maxItems: config.maxItems ?? 6,
    options: config.options,
    required: config.required ?? true,
  });
  handleCancel(result);
  return result as string[];
}

/** Free-text input with an editable default; Enter submits it as-is. */
export async function ask(config: {
  message: string;
  initialValue?: string;
  validate?: (value: string | undefined) => string | Error | undefined;
}): Promise<string> {
  const result = await clack.text(config);
  handleCancel(result);
  return result as string;
}

export async function askConfirm(config: {
  message: string;
  initialValue?: boolean;
}): Promise<boolean> {
  const result = await clack.confirm(config);
  handleCancel(result);
  return result as boolean;
}

/** Raw ANSI 256 orange — clack/picocolors have no built-in orange. */
export function orange(text: string): string {
  return `\x1b[38;5;208m${text}\x1b[0m`;
}

export const intro = clack.intro;
export const outro = clack.outro;
export const note = clack.note;
export const log = clack.log;
export const spinner = clack.spinner;
export const group = clack.group;
export const isCancel = clack.isCancel;
export const cancel = clack.cancel;
