import { emitKeypressEvents, type Key } from 'node:readline';
import { PassThrough } from 'node:stream';
import { StringDecoder } from 'node:string_decoder';
import { clean, displayWidth, wrap } from './layout.js';
import { color } from './theme.js';
import type { Colors } from 'picocolors/types.js';

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/** Text offsets are UTF-16 offsets, always moved along grapheme boundaries. */
export class EditorBuffer {
  value: string;
  cursor: number;
  anchor: number | undefined;
  private column: number | undefined;

  constructor(initial = '', readonly multiline = true) {
    this.value = this.normalize(initial);
    this.cursor = this.value.length;
  }

  private normalize(value: string): string {
    return clean(value.replace(/[\u2028\u2029]/gu, '\n'), this.multiline);
  }

  private boundaries(): number[] {
    return [...Array.from(segmenter.segment(this.value), p => p.index), this.value.length];
  }

  private adjacent(direction: number): number {
    const points = this.boundaries();
    return direction < 0 ? points.filter(p => p < this.cursor).at(-1) ?? 0
      : points.find(p => p > this.cursor) ?? this.value.length;
  }

  private word(direction: number): number {
    const before = this.value.slice(0, this.cursor);
    const after = this.value.slice(this.cursor);
    return direction < 0 ? before.replace(/\S+\s*$/u, '').length
      : this.cursor + (after.match(/^\s*\S+\s*/u)?.[0].length ?? after.length);
  }

  insert(value: string): void {
    const start = Math.min(this.anchor ?? this.cursor, this.cursor);
    const end = Math.max(this.anchor ?? this.cursor, this.cursor);
    value = this.normalize(value);
    this.value = this.value.slice(0, start) + value + this.value.slice(end);
    this.cursor = start + value.length;
    this.anchor = undefined;
    this.column = undefined;
  }

  delete(direction: number, word = false): void {
    if (this.anchor === undefined || this.anchor === this.cursor) {
      this.anchor = word ? this.word(direction) : this.adjacent(direction);
    }
    this.insert('');
  }

  move(name: string, shift = false, ctrl = false, width = 80): void {
    const old = this.cursor;
    if (shift) this.anchor ??= old;
    else if (this.anchor !== undefined && (name === 'left' || name === 'right') && !ctrl) {
      this.cursor = name === 'left' ? Math.min(old, this.anchor) : Math.max(old, this.anchor);
      this.anchor = undefined;
      this.column = undefined;
      return;
    }
    if (name === 'left' || name === 'right') {
      this.cursor = ctrl ? this.word(name === 'left' ? -1 : 1) : this.adjacent(name === 'left' ? -1 : 1);
    } else if (name === 'home') {
      this.cursor = ctrl ? 0 : this.value.lastIndexOf('\n', old - 1) + 1;
      if (old === 0) this.cursor = 0;
    } else if (name === 'end') {
      const end = this.value.indexOf('\n', old);
      this.cursor = ctrl || end < 0 ? this.value.length : end;
    } else if (name === 'up' || name === 'down') {
      const rows = this.rows(width);
      const index = rows.findIndex(row => row.some(cell => cell.offset === old));
      const row = rows[index]!;
      this.column ??= row.find(cell => cell.offset === old)!.column;
      const target = rows[index + (name === 'up' ? -1 : 1)];
      if (target) this.cursor = target.filter(cell => cell.column <= this.column!).at(-1)!.offset;
    }
    if (name !== 'up' && name !== 'down') this.column = undefined;
    if (!shift) this.anchor = undefined;
  }

  /** Each visual row includes a cursor cell at its end; wrapped boundaries belong to the next row. */
  rows(width: number): Cell[][] {
    width = Math.max(2, width);
    const rows: Cell[][] = [[]];
    let column = 0;
    for (const { segment, index } of segmenter.segment(this.value)) {
      if (segment !== '\n' && column + displayWidth(segment) >= width) {
        rows.push([]);
        column = 0;
      }
      rows.at(-1)!.push({ text: segment === '\n' ? ' ' : segment, offset: index, column });
      if (segment === '\n') { rows.push([]); column = 0; }
      else column += displayWidth(segment);
    }
    rows.at(-1)!.push({ text: ' ', offset: this.value.length, column });
    return rows;
  }
}

interface Cell { text: string; offset: number; column: number }

export interface EditorOptions {
  message: string;
  initialValue?: string;
  required?: boolean;
  multiline?: boolean;
}

export function editorFrame(buffer: EditorBuffer, options: EditorOptions, width: number, height: number,
  state: 'active' | 'saved' | 'cancelled' = 'active', error = '', colors: Colors = color): string[] {
  const label = clean(options.message);
  if (state !== 'active') {
    const cancelled = state === 'cancelled';
    const marker = cancelled ? colors.dim('×') : colors.green('✓');
    const text = cancelled ? (value: string) => colors.dim(colors.strikethrough(value)) : colors.dim;
    return [...wrap(label + (cancelled ? ' · Cancelled' : ' · Saved'), width).map((line, index) =>
      `${index === 0 ? marker : colors.dim('│')} ${colors.bold(colors.cyan(line))}`),
      ...buffer.rows(width).map(row => colors.dim('│') + ' ' + text(row.filter(cell => cell.offset < buffer.value.length)
        .map(cell => cell.text).join(''))), colors.dim('╵')];
  }
  const rows = buffer.rows(width);
  const cursorRow = rows.findIndex(row => row.some(cell => cell.offset === buffer.cursor));
  const visible = Math.max(1, Math.min(8, height - 4));
  const start = Math.max(0, cursorRow - visible + 1);
  const low = Math.min(buffer.anchor ?? buffer.cursor, buffer.cursor);
  const high = Math.max(buffer.anchor ?? buffer.cursor, buffer.cursor);
  const guide = error ? colors.yellow('│') : colors.cyan('│');
  const body = rows.slice(start, start + visible).map(row => guide + ' ' + row.map(cell => {
    const selected = cell.offset >= low && cell.offset < high;
    // The cursor is an editing affordance even when decorative colors are disabled.
    return selected || cell.offset === buffer.cursor ? `\x1b[7m${cell.text}\x1b[27m` : cell.text;
  }).join(''));
  const actions = buffer.multiline
    ? [['Enter', 'save'], ['Ctrl+J / Shift+Enter', 'newline'], ['Ctrl+C / Esc', 'cancel']]
    : [['Enter', 'save'], ['Ctrl+C / Esc', 'cancel']];
  const hint = actions.map(([key, action]) => `${key}: ${action}`).join(' · ');
  const footer = wrap(error || hint, width).map(line => {
    if (error) return colors.yellow(line);
    return colors.dim(line.replace(/Enter|Ctrl\+J|Shift\+Enter|Ctrl\+C|Esc/g, key => colors.cyan(key)));
  });
  return [...wrap(label, width).map((line, index) =>
    `${index === 0 ? (error ? colors.yellow('▲') : colors.cyan('◇')) : guide} ${colors.bold(colors.cyan(line))}`),
    ...body, ...footer.map((line, index) => (index === footer.length - 1 ? colors.dim('╵') : guide) + ' ' + line)];
}

/** Own the terminal only while this prompt is active, restoring it on every exit. */
export function editText(options: EditorOptions): Promise<string | undefined> {
  const input = process.stdin;
  const output = process.stdout;
  const buffer = new EditorBuffer(options.initialValue, options.multiline ?? true);
  const decoder = new PassThrough();
  emitKeypressEvents(decoder);
  return new Promise((resolve, reject) => {
    let frameLines = 0;
    let error = '';
    let pending = '';
    let pasted: string | undefined;
    let finished = false;
    let escapeTimer: ReturnType<typeof setTimeout> | undefined;
    const utf8 = new StringDecoder('utf8');
    const wasRaw = input.isRaw;
    const wasPaused = input.readableFlowing !== true;
    const width = () => Math.max(2, (output.columns || 80) - 3);
    const render = (state: 'active' | 'saved' | 'cancelled' = 'active') => {
      const lines = editorFrame(buffer, options, width(), output.rows || 24, state, error);
      if (frameLines > 1) output.write(`\r\x1b[${frameLines - 1}A`);
      output.write('\r\x1b[J' + lines.join('\n'));
      frameLines = lines.length;
    };
    const onResize = () => render();
    const finish = (value: string | undefined, failure?: Error) => {
      if (finished) return;
      finished = true;
      render(value === undefined ? 'cancelled' : 'saved');
      input.off('data', onData);
      input.off('error', onError);
      output.off('resize', onResize);
      process.off('SIGTERM', onTerminate);
      clearTimeout(escapeTimer);
      decoder.destroy();
      input.setRawMode(wasRaw);
      if (wasPaused) input.pause();
      output.write('\x1b[?2004l\x1b[?25h\n');
      failure ? reject(failure) : resolve(value);
    };
    const onError = (err: Error) => finish(undefined, err);
    const onTerminate = () => { finish(undefined); process.kill(process.pid, 'SIGTERM'); };
    const save = () => {
      if (options.required !== false && !buffer.value.trim()) { error = 'Enter a value.'; render(); }
      else finish(buffer.value);
    };
    decoder.on('keypress', (text: string | undefined, key: Key) => {
      if (finished) return;
      error = '';
      if (key.ctrl && key.name === 'c' || key.name === 'escape') { finish(undefined); return; }
      if (key.name === 'return' && !key.shift && !key.meta && !key.ctrl) { save(); return; }
      if (key.name === 'enter' || key.name === 'return' && key.shift || key.ctrl && key.name === 'j') {
        if (buffer.multiline) buffer.insert('\n');
      } else if (['left', 'right', 'up', 'down', 'home', 'end'].includes(key.name ?? '')) {
        buffer.move(key.name!, key.shift, key.ctrl || key.meta, width());
      } else if (key.name === 'backspace' || key.name === 'delete') {
        buffer.delete(key.name === 'backspace' ? -1 : 1, key.ctrl || key.meta);
      } else if (key.ctrl && key.name === 'a') {
        buffer.anchor = 0; buffer.cursor = buffer.value.length;
      } else if (text && !key.ctrl && !key.meta && !text.startsWith('\x1b')) buffer.insert(text);
      render();
    });
    // Bracketed paste is parsed before keypress decoding so embedded Enter never submits.
    // Recognize CSI-u and xterm Shift+Enter without depending on readline's protocol support.
    const markers = ['\x1b[200~', '\x1b[201~', '\x1b[13;2u', '\x1b[27;2;13~'];
    const onData = (chunk: Buffer | string) => {
      clearTimeout(escapeTimer);
      pending += typeof chunk === 'string' ? chunk : utf8.write(chunk);
      while (pending && !finished) {
        const marker = markers.find(sequence => pending.startsWith(sequence));
        if (marker) {
          pending = pending.slice(marker.length);
          if (marker === markers[0]) pasted = '';
          else if (marker === markers[1]) {
            if (pasted !== undefined) { buffer.insert(pasted); pasted = undefined; render(); }
          } else if (pasted !== undefined) pasted += marker;
          else { if (buffer.multiline) buffer.insert('\n'); render(); }
        } else if (markers.some(sequence => sequence.startsWith(pending))) {
          // A lone Escape must still cancel; allow split terminal sequences to arrive first.
          escapeTimer = setTimeout(() => {
            if (pasted !== undefined) pasted += pending;
            else if (pending === '\x1b') finish(undefined);
            else decoder.write(pending);
            pending = '';
          }, 100);
          return;
        }
        else {
          const point = String.fromCodePoint(pending.codePointAt(0)!);
          pending = pending.slice(point.length);
          if (pasted !== undefined) pasted += point;
          else decoder.write(point);
        }
      }
    };
    input.setRawMode(true);
    input.on('data', onData);
    input.on('error', onError);
    output.on('resize', onResize);
    process.on('SIGTERM', onTerminate);
    output.write('\x1b[?25l\x1b[?2004h');
    input.resume();
    render();
  });
}
