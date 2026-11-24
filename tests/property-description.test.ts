import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizePropertyDescription } from '../shared/property-description';

test('property descriptions keep one paragraph gap across repeated and whitespace-only blank lines', () => {
  assert.equal(normalizePropertyDescription('  Первый абзац\r\n\r\n \t\r\n\u00a0\r\nВторой абзац\r\n\r\n  '), 'Первый абзац\n\nВторой абзац');
  assert.equal(normalizePropertyDescription('\n\t\n\u00a0\n'), '');
});

test('normalization preserves single line breaks, paragraph breaks, list text and indentation', () => {
  const description = 'Описание\nПродолжение\n\nПреимущества:\n• Вид на море\n• Терраса\n  - Крытая зона\n  - Открытая зона\n\nЗвоните.';
  assert.equal(normalizePropertyDescription(description), description);
  assert.equal(normalizePropertyDescription(normalizePropertyDescription(description)), description);
});
