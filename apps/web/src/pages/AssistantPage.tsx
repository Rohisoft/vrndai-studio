import { ArrowRight, ArrowUp, Lightbulb, MessageCircle, Plus, Wand2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppConfig } from '../hooks/useAppConfig.js';
import { useAssistantChat } from '../hooks/useAssistantChat.js';
import { useMultiJobEvents } from '../hooks/useMultiJobEvents.js';
import { ProgressBar } from '../components/ProgressBar.js';
import { StatusBadge } from '../components/StatusBadge.js';
import { api } from '../lib/api-client.js';

interface ContentIdea {
  title: string;
  hook: string;
  prompt: string;
}

interface AgentMessage {
  role: 'user' | 'assistant';
  content: string;
}

type AgentChatResult = { type: 'text'; content: string } | { type: 'proposed_action'; arguments: Record<string, unknown>; summary: string };

const AGENT_SYSTEM_PROMPT = {
  role: 'system' as const,
  content:
    'You are a helpful assistant embedded in a video generation app that can create videos directly using the ' +
    "create_video tool. Ask clarifying questions (topic, engine, language, length) if you don't have enough detail " +
    'yet -- only call create_video once you genuinely do. Keep replies short.',
};

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
  const [niche, setNiche] = useState('');
  const [ideas, setIdeas] = useState<ContentIdea[]>([]);
  const [loadingIdeas, setLoadingIdeas] = useState(false);
  const [ideasError, setIdeasError] = useState<string | null>(null);
  const navigate = useNavigate();

  // "Create for me" mode -- a separate conversation from the plain chat
  // above (different backend endpoint, different system prompt), so the
  // two are kept in entirely separate state rather than branching one
  // shared history.
  const [mode, setMode] = useState<'chat' | 'agent'>('chat');
  const [agentMessages, setAgentMessages] = useState<AgentMessage[]>([]);
  const [agentInput, setAgentInput] = useState('');
  const [agentSending, setAgentSending] = useState(false);
  const [agentError, setAgentError] = useState<string | null>(null);
  const [proposedAction, setProposedAction] = useState<{ arguments: Record<string, unknown>; summary: string } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [confirmedJobId, setConfirmedJobId] = useState<string | null>(null);
  const { jobsById: agentJobsById } = useMultiJobEvents(confirmedJobId ? [confirmedJobId] : []);
  const confirmedJob = confirmedJobId ? agentJobsById[confirmedJobId] : null;

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

  async function getIdeas(event: React.FormEvent) {
    event.preventDefault();
    if (!niche.trim() || loadingIdeas) {
      return;
    }
    setLoadingIdeas(true);
    setIdeasError(null);
    try {
      setIdeas(await api.post<ContentIdea[]>('/api/assistant/ideas', { niche: niche.trim() }));
    } catch (err) {
      setIdeasError(err instanceof Error ? err.message : 'Failed to generate ideas.');
    } finally {
      setLoadingIdeas(false);
    }
  }

  function useIdea(idea: ContentIdea) {
    setDraftPrompt(idea.prompt);
  }

  async function sendAgentMessage(event: React.FormEvent) {
    event.preventDefault();
    const content = agentInput.trim();
    if (!content || agentSending) {
      return;
    }
    const history = [...agentMessages, { role: 'user' as const, content }];
    setAgentMessages(history);
    setAgentInput('');
    setAgentSending(true);
    setAgentError(null);
    try {
      const result = await api.post<AgentChatResult>('/api/assistant/agent-chat', { messages: [AGENT_SYSTEM_PROMPT, ...history] });
      if (result.type === 'text') {
        setAgentMessages([...history, { role: 'assistant', content: result.content }]);
      } else {
        setAgentMessages([...history, { role: 'assistant', content: result.summary }]);
        setProposedAction({ arguments: result.arguments, summary: result.summary });
      }
    } catch (err) {
      setAgentError(err instanceof Error ? err.message : 'Failed to reach the assistant.');
    } finally {
      setAgentSending(false);
    }
  }

  async function confirmProposedAction() {
    if (!proposedAction) {
      return;
    }
    setConfirming(true);
    setAgentError(null);
    try {
      const job = await api.post<{ id: string }>('/api/assistant/agent-confirm', { arguments: proposedAction.arguments });
      setConfirmedJobId(job.id);
      setProposedAction(null);
    } catch (err) {
      setAgentError(err instanceof Error ? err.message : 'Failed to create the video.');
    } finally {
      setConfirming(false);
    }
  }

  function cancelProposedAction() {
    setProposedAction(null);
    setAgentMessages((current) => [...current, { role: 'assistant', content: "No problem -- let me know if you'd like to try something else." }]);
  }

  function resetAgent() {
    setAgentMessages([]);
    setAgentError(null);
    setProposedAction(null);
    setConfirmedJobId(null);
  }

  return (
    <div className="flex h-full">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-start justify-between gap-4 border-b border-neutral-900 p-6">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Assistant</h1>
            <p className="mt-1 text-sm text-neutral-500">Get help writing prompts, picking a model and tuning settings.</p>
          </div>
          <div className="flex flex-none items-center gap-2">
            <div className="flex gap-1 rounded-full border border-neutral-800 bg-neutral-900 p-1">
              <button
                onClick={() => setMode('chat')}
                className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  mode === 'chat' ? 'bg-white text-black' : 'text-neutral-400 hover:text-neutral-200'
                }`}
              >
                Chat
              </button>
              <button
                onClick={() => setMode('agent')}
                className={`flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  mode === 'agent' ? 'bg-white text-black' : 'text-neutral-400 hover:text-neutral-200'
                }`}
              >
                <Wand2 className="h-3 w-3" strokeWidth={2} /> Create for me
              </button>
            </div>
            <button
              onClick={mode === 'chat' ? reset : resetAgent}
              className="flex flex-none items-center gap-1.5 rounded-lg border border-neutral-800 px-3 py-2 text-sm text-neutral-300 hover:border-neutral-600"
            >
              <Plus className="h-4 w-4" strokeWidth={2} /> New chat
            </button>
          </div>
        </div>

        {mode === 'chat' ? (
          <>
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
                  {error} -- check your AI provider configuration (Settings, or the server's <code>LLM_PROVIDER</code> env var).
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
          </>
        ) : (
          <>
            <div className="flex-1 space-y-4 overflow-y-auto p-6">
              {agentMessages.length === 0 && (
                <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
                  <Wand2 className="mx-auto h-8 w-8 text-violet-400" strokeWidth={1.5} />
                  <h2 className="mt-2 text-lg font-semibold">Tell me what video to make</h2>
                  <p className="max-w-sm text-sm text-neutral-500">
                    e.g. "make me a 30 second video about morning stretches, in Hindi" -- I'll ask if I need more detail, then
                    show you exactly what I'll create before doing anything.
                  </p>
                </div>
              )}

              {agentMessages.map((message, index) => (
                <div key={index} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div
                    className={`max-w-lg rounded-2xl px-4 py-3 text-sm shadow-md shadow-black/20 ${
                      message.role === 'user' ? 'bg-blue-600 text-white' : 'border border-neutral-800 bg-neutral-900 text-neutral-200'
                    }`}
                  >
                    <p className="whitespace-pre-wrap">{message.content}</p>
                  </div>
                </div>
              ))}

              {proposedAction && (
                <div className="max-w-lg rounded-2xl border border-violet-800 bg-violet-950/40 p-4 shadow-md shadow-black/20">
                  <p className="text-sm text-neutral-200">{proposedAction.summary}</p>
                  <div className="mt-3 flex gap-2">
                    <button
                      onClick={confirmProposedAction}
                      disabled={confirming}
                      className="rounded-lg bg-gradient-to-r from-blue-600 to-violet-600 px-4 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
                    >
                      {confirming ? 'Starting…' : 'Confirm, create it'}
                    </button>
                    <button
                      onClick={cancelProposedAction}
                      disabled={confirming}
                      className="rounded-lg border border-neutral-700 px-4 py-1.5 text-xs text-neutral-300 hover:bg-neutral-800 disabled:opacity-40"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {confirmedJobId && confirmedJob && (
                <div className="max-w-lg space-y-2 rounded-2xl border border-neutral-800 bg-neutral-900 p-4 shadow-md shadow-black/20">
                  <div className="flex items-center justify-between">
                    <StatusBadge status={confirmedJob.status} />
                    {(confirmedJob.status === 'queued' || confirmedJob.status === 'running') && (
                      <span className="text-xs text-neutral-500">{confirmedJob.progress}%</span>
                    )}
                  </div>
                  {(confirmedJob.status === 'queued' || confirmedJob.status === 'running') && <ProgressBar percent={confirmedJob.progress} />}
                  {confirmedJob.videoUrl && (
                    <video src={confirmedJob.videoUrl} controls className="w-full rounded-lg" />
                  )}
                </div>
              )}

              {agentError && <p className="rounded-lg border border-red-900 bg-red-950/40 p-3 text-sm text-red-300">{agentError}</p>}
            </div>

            <form onSubmit={sendAgentMessage} className="flex gap-2 border-t border-neutral-900 p-4">
              <input
                type="text"
                value={agentInput}
                onChange={(event) => setAgentInput(event.target.value)}
                placeholder="Describe the video you want…"
                className="flex-1 rounded-xl border border-neutral-700 bg-neutral-950 px-4 py-2.5 text-sm placeholder:text-neutral-600 focus:border-neutral-500 focus:outline-none"
              />
              <button
                type="submit"
                disabled={agentSending || !agentInput.trim()}
                className="flex items-center justify-center rounded-xl bg-gradient-to-r from-blue-600 to-violet-600 px-5 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
              >
                {agentSending ? 'Thinking…' : <ArrowUp className="h-4 w-4" strokeWidth={2.5} />}
              </button>
            </form>
            <p className="px-4 pb-4 text-xs text-neutral-600">
              Nothing is created until you confirm. Works best with Groq or Gemini -- Ollama's tool-calling reliability varies by model.
            </p>
          </>
        )}
      </div>

      {/* Persistent prompt draft -- updates live as the assistant responds,
          freely editable, and carries both the text and a chosen model
          over to Create in one hand-off. */}
      <div className="w-80 flex-none space-y-4 overflow-y-auto border-l border-neutral-800 bg-neutral-900 p-6">
        {/* Content ideas -- for the "I don't know what to make" moment,
            not just "help me polish what I already have" (the chat below
            it). Reuses the same draft panel as its hand-off target. */}
        <div className="rounded-xl border border-neutral-700 bg-neutral-800 p-3 shadow-md shadow-black/30">
          <div className="mb-2 flex items-center gap-1.5">
            <Lightbulb className="h-3.5 w-3.5 text-amber-400" strokeWidth={2} />
            <span className="text-sm font-semibold text-neutral-300">Content ideas</span>
          </div>
          <form onSubmit={getIdeas} className="flex gap-1.5">
            <input
              type="text"
              value={niche}
              onChange={(event) => setNiche(event.target.value)}
              placeholder="A niche or topic…"
              className="min-w-0 flex-1 rounded-lg border border-neutral-700 bg-neutral-950 px-2.5 py-1.5 text-xs placeholder:text-neutral-600 focus:border-neutral-500 focus:outline-none"
            />
            <button
              type="submit"
              disabled={loadingIdeas || !niche.trim()}
              className="flex-none rounded-lg bg-gradient-to-r from-blue-600 to-violet-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
            >
              {loadingIdeas ? '…' : 'Get ideas'}
            </button>
          </form>
          {ideasError && <p className="mt-2 text-xs text-red-400">{ideasError}</p>}
          {ideas.length > 0 && (
            <div className="mt-2 space-y-1.5">
              {ideas.map((idea, index) => (
                <button
                  key={index}
                  onClick={() => useIdea(idea)}
                  className="block w-full rounded-lg border border-neutral-700 bg-neutral-900 p-2 text-left hover:border-neutral-500"
                >
                  <p className="text-xs font-medium text-neutral-200">{idea.title}</p>
                  <p className="mt-0.5 line-clamp-2 text-[11px] text-neutral-500">{idea.hook}</p>
                </button>
              ))}
            </div>
          )}
        </div>

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
