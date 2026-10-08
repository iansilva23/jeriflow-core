import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { managementMutation } from '../apps/api/src/account-input.ts';

test('municipality HTML pattern compiles with the browser v flag and preserves server validation', () => {
  const source = readFileSync(new URL('../apps/admin/app/paineis/mestre/contas/panel.tsx', import.meta.url), 'utf8');
  const pattern = source.match(/Identificador do município<input[^>]*pattern="([^"]+)"/)?.[1];
  assert.ok(pattern, 'municipality input must provide its validation pattern');
  const compiled = new RegExp(`^(?:${pattern})$`, 'v');
  const valid = ['ab', '12', 'cidade-teste', 'a--b', 'a'.repeat(63)];
  const invalid = ['', 'a', 'Cidade', '-cidade', 'cidade-', 'cidade com espaco', 'cidade_teste', 'cidade/abc', 'município', 'a'.repeat(64)];
  for (const [values, expected] of [[valid, true], [invalid, false]]) {
    for (const slug of values) {
      assert.equal(compiled.test(slug), expected, `HTML validity for ${JSON.stringify(slug)}`);
      const validate = () => managementMutation({ operation:'create-municipality', slug, displayName:'Município fictício', password:'Senha apenas ficticia 123!', code:'123456' });
      if (expected) assert.doesNotThrow(validate); else assert.throws(validate);
    }
  }
});
