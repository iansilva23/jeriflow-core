import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const cliRoot = dirname(require.resolve('@expo/cli/package.json'));
const fromCli = createRequire(join(cliRoot, 'package.json'));
const { z } = fromCli('zod');
const { PluginSchema, DevToolsPluginOutputSchema } = require(join(cliRoot, 'build/src/start/server/DevToolsPlugin.schema.js'));
const { createMCPDevToolsExtensionSchema } = require(join(cliRoot, 'build/src/start/server/createMCPDevToolsExtensionSchema.js'));
const { addMcpCapabilities } = require(join(cliRoot, 'build/src/start/server/MCPDevToolsPluginCLIExtensions.js'));

const plugin = {
  packageName: 'synthetic-tools', packageRoot: '/synthetic/plugin', bannerTitle: false,
  cliExtensions: { description: 'Synthetic compatibility fixture', entryPoint: 'index.js', commands: [
    { name: 'inspect', title: 'Inspect', environments: ['cli', 'mcp'], parameters: [
      { name: 'label', type: 'text', description: 'Label' },
      { name: 'count', type: 'number' }, { name: 'enabled', type: 'confirm' },
    ] },
    { name: 'local', title: 'Local only', environments: ['cli'] },
  ] },
};

test('Expo DevTools accepts the existing plugin contract and strips unknown descriptor fields', () => {
  const result = PluginSchema.parse({ ...plugin, untrustedExtra: 'discard' });
  assert.deepEqual(result, plugin);
  assert(Object.isFrozen(result.cliExtensions.commands[0].environments));
});

test('Expo DevTools still rejects malformed plugins and exposes readable validation issues', () => {
  for (const changes of [
    { packageName: '' }, { packageRoot: 4 }, { bannerTitle: 4 },
    { cliExtensions: { ...plugin.cliExtensions, commands: [] } },
    { cliExtensions: { ...plugin.cliExtensions, entryPoint: '' } },
    { cliExtensions: { ...plugin.cliExtensions, commands: [{ name: 'x', title: 'x', environments: ['invalid'] }] } },
  ]) {
    const result = PluginSchema.safeParse({ ...plugin, ...changes });
    assert.equal(result.success, false);
    assert(result.error.issues.length > 0);
    assert(result.error.issues.every(issue => typeof issue.message === 'string'));
  }
});

test('Expo DevTools output schemas preserve text, image and audio validation', () => {
  const valid = [
    { type: 'text', text: 'Synthetic result', level: 'info' },
    { type: 'image', url: 'https://example.invalid/image.png' },
    { type: 'audio', url: 'https://example.invalid/audio.mp3', text: 'Synthetic' },
  ];
  assert.deepEqual(DevToolsPluginOutputSchema.parse(valid), valid);
  for (const invalid of [
    [{ type: 'text', text: 'x', level: 'unknown' }],
    [{ type: 'image', url: 'invalid-url' }],
    [{ type: 'audio' }], [{ type: 'other', text: 'x' }],
  ]) assert.equal(DevToolsPluginOutputSchema.safeParse(invalid).success, false);
});

test('Expo MCP command schema retains enums, primitive parameter types and strict unknown-key rejection', () => {
  const schema = createMCPDevToolsExtensionSchema(plugin);
  const valid = { command: 'inspect', label: 'sample', count: 2, enabled: true };
  assert.deepEqual(schema.parse(valid), valid);
  assert.deepEqual(schema.parse({ command: 'local' }), { command: 'local' });
  for (const invalid of [
    { command: 'unknown' }, { command: 'inspect', count: '2' },
    { command: 'inspect', enabled: 'true' }, { command: 'inspect', label: 2 },
    { command: 'inspect', extra: true },
  ]) assert.equal(schema.safeParse(invalid).success, false);
  assert.throws(() => createMCPDevToolsExtensionSchema({ ...plugin, cliExtensions: undefined }));
});

test('Expo registers MCP-enabled commands only, with validation retained at the actual registration boundary', async () => {
  const registered = [];
  await addMcpCapabilities({ registerTool: (...args) => registered.push(args) }, {
    devtoolsPluginManager: { queryPluginsAsync: async () => [plugin] },
  });
  assert.equal(registered.length, 1);
  const [name, options, execute] = registered[0];
  assert.equal(name, plugin.packageName);
  assert.equal(typeof execute, 'function');
  const schema = options.inputSchema.parameters;
  assert.equal(schema.safeParse({ command: 'inspect' }).success, true);
  assert.equal(schema.safeParse({ command: 'local' }).success, false);
  assert.equal(schema.safeParse({ command: 'inspect', count: '2' }).success, false);
});

test('Zod used by Expo rejects oversized constrained collections before parsing their elements', () => {
  let parsedElements = 0;
  const item = z.string().transform(value => { parsedElements++; return value; });
  const schema = z.array(item).max(2);
  assert.equal(schema.safeParse(['a', 'b', 'c']).success, false);
  assert.equal(parsedElements, 0, 'oversized arrays must be rejected before element work');
  assert.deepEqual(schema.parse(['a', 'b']), ['a', 'b']);
  assert.equal(parsedElements, 2);
});
