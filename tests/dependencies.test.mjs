import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
test("Override de segurança: xcode usa uuid corrigido e mantém geração de identificadores", () => {
  const fromXcode = createRequire(require.resolve("xcode/package.json"));
  assert.equal(fromXcode("uuid/package.json").version, "11.1.1");
  const uuid = fromXcode("uuid");
  assert.throws(() => uuid.v5("diagnostic", uuid.v5.DNS, new Uint8Array(8), 4), RangeError);
  const project = require("xcode").project("in-memory-test.pbxproj");
  project.hash = { project: { objects: {} } };
  const ids = new Set(Array.from({ length: 100 }, () => project.generateUuid()));
  assert.equal(ids.size, 100);
  assert([...ids].every(id => /^[A-F0-9]{24}$/.test(id)));
});
