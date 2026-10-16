import pc from 'picocolors';
import type { Priority } from '../core/model.js';

// One palette and color policy for both static output and interactive prompts.
export function terminalColors(stream: { isTTY?: boolean }) {
  return pc.createColors(pc.isColorSupported && Boolean(stream.isTTY) && !('NO_COLOR' in process.env));
}

export const color = terminalColors(process.stdout);
export const errorColor = terminalColors(process.stderr);

export function aiBadge(colors = color): string {
  return colors.isColorSupported ? '\x1b[38;2;208;135;112m◆ AI\x1b[39m' : '◆ AI';
}

export function priorityColor(value: Priority): string {
  return value === 'high' ? color.red(value) : value === 'normal' ? color.yellow(value) : color.dim(value);
}
