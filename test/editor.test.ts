import assert from 'node:assert/strict';
import { test } from 'node:test';
import pc from 'picocolors';
import { stripVTControlCharacters } from 'node:util';
import { displayWidth } from '../src/ui/layout.js';
import { EditorBuffer, editorFrame } from '../src/ui/editor.js';

test('multiline insertion and logical line/document movement preserve blank lines', () => {
  const editor = new EditorBuffer('first\n\nlast');
  editor.move('home');
  assert.equal(editor.cursor, 7);
  editor.insert('new ');
  assert.equal(editor.value, 'first\n\nnew last');
  editor.move('home', false, true);
  assert.equal(editor.cursor, 0);
  editor.move('home');
  assert.equal(editor.cursor, 0);
  editor.move('end');
  assert.equal(editor.cursor, 5);
  editor.move('end', false, true);
  assert.equal(editor.cursor, editor.value.length);
});

test('selection supports replacement, deletion, extension and collapse', () => {
  const editor = new EditorBuffer('one two');
  editor.move('left', true, true);
  assert.equal(editor.cursor, 4);
  editor.insert('three');
  assert.equal(editor.value, 'one three');
  editor.move('home', true);
  editor.delete(1);
  assert.equal(editor.value, '');
  editor.insert('abc');
  editor.move('left', true);
  editor.move('left');
  assert.equal(editor.cursor, 2);
  assert.equal(editor.anchor, undefined);
  editor.move('home', true);
  editor.move('right', true);
  editor.insert('X');
  assert.equal(editor.value, 'aXc');
});

test('vertical movement follows wrapped rows and remembers the preferred column', () => {
  const editor = new EditorBuffer('abcdef\nx\nabcdef');
  editor.move('home', false, true);
  editor.move('right'); editor.move('right'); editor.move('right');
  editor.move('down');
  assert.equal(editor.cursor, 8);
  editor.move('down');
  assert.equal(editor.cursor, 12);
  editor.move('up'); editor.move('up');
  assert.equal(editor.cursor, 3);
  const wrapped = new EditorBuffer('abcdefghij');
  wrapped.move('home');
  wrapped.move('right');
  wrapped.move('down', false, false, 5);
  assert.equal(wrapped.cursor, 5);
  wrapped.move('down', true, false, 5);
  assert.equal(wrapped.cursor, 9);
  assert.equal(wrapped.anchor, 5);
});

test('movement and deletion do not split emoji or combining characters', () => {
  const editor = new EditorBuffer('a👩🏽‍💻e\u0301');
  editor.delete(-1);
  assert.equal(editor.value, 'a👩🏽‍💻');
  editor.move('left');
  assert.equal(editor.cursor, 1);
  editor.delete(1);
  assert.equal(editor.value, 'a');
});

test('single-line titles normalize pasted newlines and strip terminal commands', () => {
  const editor = new EditorBuffer('', false);
  editor.insert('first\r\nsecond\nthird\x1b[31m!\x1b[0m');
  assert.equal(editor.value, 'first second third!');
  assert.equal(editor.rows(80).length, 1);
});

test('word deletion and empty optional text behave at document boundaries', () => {
  const editor = new EditorBuffer('one two');
  editor.delete(-1, true);
  assert.equal(editor.value, 'one ');
  editor.move('home');
  editor.delete(-1);
  editor.delete(1, true);
  assert.equal(editor.value, '');
  editor.move('up'); editor.move('down'); editor.move('left'); editor.move('right');
  assert.equal(editor.cursor, 0);
});

// State rendering must remove editing affordances and keep the entire cancelled draft.
test('cancelled drafts are crossed out in full, including content outside the editing viewport', () => {
  const editor = new EditorBuffer(Array.from({ length: 15 }, (_, i) => `Line ${i}`).join('\n'));
  editor.anchor = 0;
  const frame = editorFrame(editor, { message: 'Description' }, 40, 12, 'cancelled', '', pc.createColors(true)).join('\n');
  assert.match(frame, /\x1b\[9m/);
  assert.doesNotMatch(frame, /\x1b\[7m|Ctrl\+J|Enter: save/);
  const plain = stripVTControlCharacters(frame);
  assert.match(plain, /Description · Cancelled/);
  assert.match(plain, /Line 0/);
  assert.match(plain, /Line 14/);
});

test('editor states share semantic colors and remain readable with decoration disabled', () => {
  const editor = new EditorBuffer('Draft');
  for (const state of ['active', 'saved', 'cancelled'] as const) {
    for (const width of [18, 40, 80]) {
      const frame = editorFrame(editor, { message: 'A long description label' }, width, 24, state, '', pc.createColors(false));
      assert.ok(frame.every(line => displayWidth(line) <= width + 2));
      const output = frame.join('\n');
      if (state !== 'active') assert.doesNotMatch(output, /\x1b/);
      assert.match(stripVTControlCharacters(output), /Draft/);
    }
  }
  const colors = pc.createColors(true);
  assert.match(editorFrame(editor, { message: 'Description' }, 80, 24, 'active', '', colors).join('\n'), /\x1b\[36m/);
  assert.match(editorFrame(editor, { message: 'Description' }, 80, 24, 'saved', '', colors).join('\n'), /\x1b\[32m/);
  assert.match(editorFrame(editor, { message: 'Description' }, 80, 24, 'active', 'Enter a value.', colors).join('\n'), /\x1b\[33m/);
});
