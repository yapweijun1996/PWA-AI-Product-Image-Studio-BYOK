import assert from 'node:assert/strict';
import { createProvider, fauxAssistantMessage, fauxProvider } from '@earendil-works/pi-ai';
import { createAgentSession, ModelRuntime, SessionManager, SettingsManager } from '@earendil-works/pi-coding-agent';

// This in-process fixture establishes SDK plumbing only; it is not an IPC or security boundary.
export async function runSyntheticProviderBridge(resources) {
  const faux = fauxProvider({ provider: 'synthetic-bridge' });
  const model = faux.getModel();
  let forwarded = 0;
  const forward = (method, selected, context, options) => {
    if (selected.provider !== model.provider || selected.id !== model.id) throw new Error('Unexpected synthetic model.');
    forwarded++;
    return faux.provider[method](selected, context, options);
  };
  const provider = createProvider({
    id: model.provider,
    auth: { apiKey: { name: 'Synthetic fixture', resolve: async () => ({ auth: {} }) } },
    models: [model],
    api: {
      stream: (selected, context, options) => forward('stream', selected, context, options),
      streamSimple: (selected, context, options) => forward('streamSimple', selected, context, options),
    },
  });
  assert.throws(() => provider.streamSimple({ ...model, id: 'unexpected-fixture' }, { messages: [] }), /Unexpected synthetic model/);
  assert.throws(() => provider.streamSimple({ ...model, provider: 'unexpected-fixture' }, { messages: [] }), /Unexpected synthetic model/);
  assert.equal(forwarded, 0, 'An unexpected synthetic model never reaches the fake provider.');
  const runtime = await ModelRuntime.create({ authPath: '/tmp/probe/bridge-auth.json', modelsPath: '/tmp/probe/bridge-models.json' });
  runtime.registerNativeProvider(provider);
  faux.setResponses([(context) => {
    const user = context.messages.find((message) => message.role === 'user');
    const text = typeof user?.content === 'string' ? user.content : user?.content?.filter((part) => part.type === 'text').map((part) => part.text).join('');
    assert.equal(text, 'Run the synthetic bridge fixture.');
    return fauxAssistantMessage('synthetic bridge complete');
  }]);
  const { session } = await createAgentSession({
    cwd: '/probe', agentDir: '/tmp/probe', modelRuntime: runtime, model, resourceLoader: resources,
    noTools: true, sessionManager: SessionManager.inMemory('/probe'),
    settingsManager: SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } }),
  });
  try {
    await session.prompt('Run the synthetic bridge fixture.');
    assert.equal(session.getLastAssistantText(), 'synthetic bridge complete');
    assert.equal(forwarded, 1);
    assert.equal(faux.state.callCount, 1);
    assert.deepEqual(session.getActiveToolNames(), []);
    return { forwarded, fakeModelCalls: faux.state.callCount, unexpectedModelRejected: true };
  } finally { session.dispose(); }
}
