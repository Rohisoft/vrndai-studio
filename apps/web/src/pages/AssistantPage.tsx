import { ArrowRight, ArrowUp, MessageCircle, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppConfig } from '../hooks/useAppConfig.js';
import { useAssistantChat } from '../hooks/useAssistantChat.js';

const SUGGESTIONS = [
  { title: 'Turn an idea into a prompt', description: 'Describe it loosely, get a detailed prompt' },
  { title: 'Improve my prompt', description: 'Tighten camera, motion and lighting' },
  { title: 'Which model should I use?', description: 'Compare Wan 2.2 and LTX-2.5' },
  { title: 'Explain advanced options', description: 'Duration, resolution and seed' },
];

export function AssistantPage() {
  const { messages, sending, error, sendMessage, reset } = useAssistantChat();
  const { config } = useAppConfig();
  const [input, setInput] = useState('');
  const [draftPrompt, setDraftPrompt] = useState('');
  const [draftModelId, setDraftModelId] = useState('');
  const navigate = useNavigate();

  // Keeps the draft panel in sync with whatever the assistant last said --
  // streams in live as tokens arrive, same as the chat bubble itself. Once
  // a response is finished the user can freely hand-edit the draft without
  // it being touched again until the *next* assistant message starts.
  useEffect(() => {
    const last = messages[messages.length - 1];
    if (last?.role === 'assistant') {
      setDraftPrompt(last.content);
    }
  }, [messages]);

  useEffect(() => {
    if (!draftModelId && config) {
      setDraftModelId(config.defaultModelId);
    }
  }, [config, draftModelId]);

  function submit(content: string) {
    if (!content.trim() || sending) {
      return;
    }
    setInput('');
    void sendMessage(content.trim());
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    submit(input);
  }

  function useInCreate() {
    navigate('/', { state: { prefillPrompt: draftPrompt, continueFrom: undefined, prefillModelId: draftModelId || undefined } });
  }

  return (
    <div className="flex h-full">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-start justify-between gap-4 border-b border-neutral-900 p-6">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Assistant</h1>
            <p className="mt-1 text-sm text-neutral-500">Get help writing prompts, picking a model and tuning settings.</p>
          </div>
          <button
            onClick={reset}
            className="flex flex-none items-center gap-1.5 rounded-lg border border-neutral-800 px-3 py-2 text-sm text-neutral-300 hover:border-neutral-600"
          >
            <Plus className="h-4 w-4" strokeWidth={2} /> New chat
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-6">
          {messages.length === 0 && (
            <div className="flex h-full flex-col items-center justify-center gap-6 text-center">
              <div>
                <MessageCircle className="mx-auto h-8 w-8 text-violet-400" strokeWidth={1.5} />
                <h2 className="mt-3 text-lg font-semibold">How can I help with your next video?</h2>
                <p className="mt-1 text-sm text-neutral-500">Start from a suggestion or ask anything below.</p>
              </div>
              <div className="grid w-full max-w-lg grid-cols-1 gap-2 sm:grid-cols-2">
                {SUGGESTIONS.map((suggestion) => (
                  <button
                    key={suggestion.title}
                    onClick={() => submit(suggestion.title)}
                    className="rounded-xl border border-neutral-800 bg-neutral-900 p-3 text-left shadow-md shadow-black/30 transition-colors hover:border-neutral-600"
                  >
                    <p className="text-sm font-medium text-neutral-200">{suggestion.title}</p>
                    <p className="mt-0.5 text-xs text-neutral-500">{suggestion.description}</p>
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages
            .filter((message) => message.role !== 'system')
            .map((message, index) => (
              <div key={index} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-lg rounded-2xl px-4 py-3 text-sm shadow-md shadow-black/20 ${
                    message.role === 'user' ? 'bg-blue-600 text-white' : 'border border-neutral-800 bg-neutral-900 text-neutral-200'
                  }`}
                >
                  <p className="whitespace-pre-wrap">{message.content || (sending ? '…' : '')}</p>
                </div>
              </div>
            ))}

          {error && (
            <p className="rounded-lg border border-red-900 bg-red-950/40 p-3 text-sm text-red-300">
              {error} -- make sure Ollama is running on your Mac (<code>ollama serve</code>).
            </p>
          )}
        </div>

        <form onSubmit={handleSubmit} className="flex gap-2 border-t border-neutral-900 p-4">
          <input
            type="text"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="Ask for a prompt, a model recommendation, or settings help…"
            className="flex-1 rounded-xl border border-neutral-700 bg-neutral-950 px-4 py-2.5 text-sm placeholder:text-neutral-600 focus:border-neutral-500 focus:outline-none"
          />
          <button
            type="submit"
            disabled={sending || !input.trim()}
            className="flex items-center justify-center rounded-xl bg-gradient-to-r from-blue-600 to-violet-600 px-5 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {sending ? 'Thinking…' : <ArrowUp className="h-4 w-4" strokeWidth={2.5} />}
          </button>
        </form>
        <p className="px-4 pb-4 text-xs text-neutral-600">
          The assistant runs locally. Answers can be wrong, so check settings before long renders.
        </p>
      </div>

      {/* Persistent prompt draft -- updates live as the assistant responds,
          freely editable, and carries both the text and a chosen model
          over to Create in one hand-off. */}
      <div className="w-80 flex-none space-y-4 border-l border-neutral-800 bg-neutral-900 p-6">
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-sm font-semibold text-neutral-300">Prompt draft</span>
            <span className="text-xs text-neutral-600">Editable</span>
          </div>
          <textarea
            value={draftPrompt}
            onChange={(event) => setDraftPrompt(event.target.value)}
            rows={8}
            placeholder="Prompts the assistant writes for you will land here."
            className="w-full resize-none rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2.5 text-sm shadow-inner shadow-black/30 placeholder:text-neutral-600 focus:border-neutral-500 focus:outline-none"
          />
        </div>

        {config && (
          <div>
            <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-neutral-500">Model</label>
            <select
              value={draftModelId}
              onChange={(event) => setDraftModelId(event.target.value)}
              className="w-full rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2.5 text-sm text-neutral-300"
            >
              {config.models.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.label}
                </option>
              ))}
            </select>
          </div>
        )}

        <button
          onClick={useInCreate}
          disabled={!draftPrompt.trim()}
          className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-blue-600 to-violet-600 px-4 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          Use in Create <ArrowRight className="h-4 w-4" strokeWidth={2} />
        </button>

        <div className="rounded-xl border border-neutral-700 bg-neutral-800 p-3 shadow-md shadow-black/30">
          <p className="text-xs font-medium text-neutral-300">Tips for better clips</p>
          <p className="mt-1 text-xs text-neutral-500">Name one subject, one action and one camera move. Add lighting and a film style last.</p>
        </div>
      </div>
    </div>
  );
}
