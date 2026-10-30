import { spawnSync } from 'node:child_process';
import { createServer, createConnection } from 'node:net';
import { Worker } from 'node:worker_threads';
import { fauxProvider, fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai';
import { createAgentSession, createExtensionRuntime, ModelRuntime, SessionManager, SettingsManager } from '@earendil-works/pi-coding-agent';

const expected = process.argv[2];
if (!['filtered', 'control'].includes(expected)) throw new Error('Choose filtered or control.');
const resources = {
  getExtensions: () => ({ extensions: [], errors: [], runtime: createExtensionRuntime() }),
  getSkills: () => ({ skills: [], diagnostics: [] }), getPrompts: () => ({ prompts: [], diagnostics: [] }),
  getThemes: () => ({ themes: [], diagnostics: [] }), getAgentsFiles: () => ({ agentsFiles: [] }),
  getSystemPrompt: () => undefined, getSystemPromptSource: () => undefined,
  getAppendSystemPrompt: () => [], getAppendSystemPromptSources: () => [], extendResources: () => {}, reload: async () => {},
};
const runtime = await ModelRuntime.create({ authPath: '/tmp/probe/auth.json', modelsPath: '/tmp/probe/models.json' });
const { session } = await createAgentSession({ cwd: '/probe', agentDir: '/tmp/probe', modelRuntime: runtime,
  resourceLoader: resources, noTools: true, sessionManager: SessionManager.inMemory('/probe'),
  settingsManager: SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } }) });
try {
  const faux = fauxProvider();
  runtime.registerNativeProvider(faux.provider);
  faux.setResponses([
    fauxAssistantMessage(fauxToolCall('synthetic_echo', { value: 'fixture' }), { stopReason: 'toolUse' }),
    fauxAssistantMessage('fixture complete'),
  ]);
  let toolCalls = 0;
  const tool = { name: 'synthetic_echo', label: 'Synthetic echo', description: 'Return the synthetic fixture.',
    parameters: { type: 'object', properties: { value: { type: 'string', const: 'fixture' } }, required: ['value'], additionalProperties: false },
    execute: async (_id, args) => { toolCalls++; return { content: [{ type: 'text', text: args.value }], details: {} }; } };
  const created = await createAgentSession({ cwd: '/probe', agentDir: '/tmp/probe', modelRuntime: runtime, model: faux.getModel(),
    resourceLoader: resources, tools: ['synthetic_echo'], customTools: [tool], sessionManager: SessionManager.inMemory('/probe'),
    settingsManager: SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } }) });
  try {
    await runtime.setRuntimeApiKey('faux', 'synthetic-fixture-only');
    await created.session.prompt('Run the synthetic fixture.');
    const active = created.session.getActiveToolNames();
    if (active.length !== 1 || active[0] !== 'synthetic_echo' || toolCalls !== 1 || faux.state.callCount !== 2 || created.session.getLastAssistantText() !== 'fixture complete') {
      throw new Error('Synthetic model/tool workflow did not complete as expected.');
    }
    faux.setResponses([
      fauxAssistantMessage(fauxToolCall('synthetic_echo', { value: 'invalid', url: 'https://invalid.example' }), { stopReason: 'toolUse' }),
      fauxAssistantMessage('invalid fixture handled'),
      fauxAssistantMessage(fauxToolCall('bash', { command: 'echo forbidden' }), { stopReason: 'toolUse' }),
      fauxAssistantMessage('unknown tool handled'),
    ]);
    await created.session.prompt('Attempt an invalid synthetic call.');
    await created.session.prompt('Attempt an unavailable tool.');
    const failures = created.session.messages.filter((message) => message.role === 'toolResult' && message.isError).map((message) => message.toolName);
    if (toolCalls !== 1 || faux.state.callCount !== 6 || failures.filter((name) => name === 'synthetic_echo').length !== 1 || failures.filter((name) => name === 'bash').length !== 1) {
      throw new Error('Invalid arguments or unavailable tool were not rejected.');
    }
    console.log(JSON.stringify({ mode: expected, syntheticModelCalls: faux.state.callCount, syntheticToolCalls: toolCalls, activeTools: active, rejectedCalls: failures }));
  } finally { created.session.dispose(); }
  const workerCode = await new Promise((resolve, reject) => {
    const worker = new Worker("const {parentPort}=require('node:worker_threads'); const {spawnSync}=require('node:child_process'); const r=spawnSync('/bin/sh',['-c','exit 0']); parentPort.postMessage(r.error?.code ?? r.status);", { eval: true });
    worker.once('message', resolve); worker.once('error', reject);
  });
  const shell = spawnSync('/bin/sh', ['-c', 'exit 0']);
  const node = spawnSync(process.execPath, ['-e', 'process.exit(0)']);
  const server = createServer((socket) => socket.end('ok'));
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  try {
    const loopback = await new Promise((resolve, reject) => {
      const client = createConnection(server.address().port, '127.0.0.1');
      client.once('data', (data) => resolve(data.toString())); client.once('error', reject);
    });
    const actual = { mode: expected, node: process.version, activeTools: session.getActiveToolNames(),
      shell: shell.error?.code ?? shell.status, childNode: node.error?.code ?? node.status, workerShell: workerCode,
      syntheticEnvironmentVisible: process.env.SYNTHETIC_BROKER_MARKER === 'test-fixture', loopback };
    console.log(JSON.stringify(actual));
    const expectedCode = expected === 'filtered' ? 'EPERM' : 0;
    if (actual.activeTools.length || actual.shell !== expectedCode || actual.childNode !== expectedCode ||
        actual.workerShell !== expectedCode || !actual.syntheticEnvironmentVisible || actual.loopback !== 'ok') {
      throw new Error('Experiment did not match expected outcomes.');
    }
  } finally { server.close(); }
} finally { session.dispose(); }
