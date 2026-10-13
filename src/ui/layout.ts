import { stripVTControlCharacters } from 'node:util';

const segments = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

// Remove terminal commands while retaining paragraphs in descriptions and notes.
export function clean(value: string, multiline = false): string {
  const safe = stripVTControlCharacters(value).replace(/\r\n?/g, '\n')
    .replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, ' ').replace(/\t/g, '  ');
  return multiline ? safe : safe.replace(/\n/g, ' ');
}

function graphemeWidth(value: string): number {
  if (/^[\p{Mark}\p{Format}]+$/u.test(value)) return 0;
  if (/[\p{Emoji_Presentation}\uFE0F\u20E3]/u.test(value)) return 2;
  const code = value.codePointAt(0)!;
  return code >= 0x1100 && (
    code <= 0x115f || code === 0x2329 || code === 0x232a ||
    (code >= 0x2e80 && code <= 0xa4cf && code !== 0x303f) ||
    (code >= 0xac00 && code <= 0xd7a3) || (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe10 && code <= 0xfe19) || (code >= 0xfe30 && code <= 0xfe6f) ||
    (code >= 0xff01 && code <= 0xff60) || (code >= 0xffe0 && code <= 0xffe6) ||
    (code >= 0x20000 && code <= 0x3fffd)
  ) ? 2 : 1;
}

export function displayWidth(value: string): number {
  return Array.from(segments.segment(stripVTControlCharacters(value)), part => graphemeWidth(part.segment))
    .reduce((sum, width) => sum + width, 0);
}

export function pad(value: string, width: number): string {
  return value + ' '.repeat(Math.max(0, width - displayWidth(value)));
}

export function terminalWidth(): number {
  return Math.max(20, process.stdout.columns || 80);
}

// Wrap by terminal cells without splitting emoji or combining sequences.
export function wrap(value: string, width: number): string[] {
  width = Math.max(2, width);
  return value.split('\n').flatMap(line => {
    const indent = ' '.repeat(Math.min(line.match(/^ */)![0].length, width - 2));
    let rest = line.trimStart();
    const result: string[] = [];
    const available = width - indent.length;
    while (displayWidth(rest) > available) {
      let length = 0;
      let cells = 0;
      for (const { segment } of segments.segment(rest)) {
        const size = graphemeWidth(segment);
        if (cells + size > available) break;
        cells += size;
        length += segment.length;
      }
      const space = rest.lastIndexOf(' ', length);
      const end = space > 0 ? space : length;
      result.push(indent + rest.slice(0, end).trimEnd());
      rest = rest.slice(end).trimStart();
    }
    result.push(rest ? indent + rest : '');
    return result;
  });
}
