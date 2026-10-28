import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const fromDevtools = createRequire(require.resolve('react-devtools-core/package.json'));
const { quote, parse } = fromDevtools('shell-quote');

test('DevTools shell quoting rejects line terminators after comment tokens (GHSA-pqg4-j6r4-53mv)', () => {
  // Exercise the actual transitive dependency. Never execute the resulting command.
  for (const newline of ['\n', '\r', '\u2028', '\u2029']) {
    assert.throws(() => quote(['echo', 'safe', { comment: 'end' }, `value${newline}INJECTED;#`]), TypeError);
  }
});

test('DevTools shell quoting preserves literal spaces, quotes and shell metacharacters', () => {
  const values = ['echo', 'two words', "single'quote", '$(placeholder)', 'a;b', ''];
  assert.deepEqual(parse(quote(values)), values);
});
