"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Check, CheckCheck, Phone, Send, Sparkles, Languages, Video, X } from "lucide-react";
import { useSession } from "@/stores/useSession";
import {
  getConversation,
  listConversations,
  getOrCreateDirectConversation,
  listMessages,
  sendMessage,
  markConversationRead,
  type ConversationWithParticipants,
  type Message,
} from "@/lib/api";
import { placeCall } from "@/lib/calls";
import { aiModerateContent, aiTranslate, aiSummarizeConversation, aiSuggestReplies } from "@/lib/ai";
import { logChatEvent } from "@/lib/metrics";

interface ChatPanelProps {
  userId?: string;
  conversationId?: string;
  onClose?: () => void;
}

export default function ChatPanel({ userId, conversationId: initialId, onClose }: ChatPanelProps) {
  const user = useSession((s) => s.user);
  const router = useRouter();
  const [conversations, setConversations] = useState<ConversationWithParticipants[]>([]);
  const [activeId, setActiveId] = useState<string | null>(initialId ?? null);
  const [activeConv, setActiveConv] = useState<ConversationWithParticipants | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [sending, setSending] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [translations, setTranslations] = useState<Record<string, string>>({});
  const [translatingId, setTranslatingId] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [summarizing, setSummarizing] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);

  const scrollBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, []);

  const loadList = useCallback(async () => {
    try {
      const { conversations } = await listConversations();
      setConversations(conversations);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load conversations.");
    }
  }, []);

  const openConversation = useCallback(async (id: string) => {
    setActiveId(id);
    setMessages([]);
    setHasMore(true);
    setSummary(null);
    setSuggestions([]);
    setError(null);
    setLoading(true);
    try {
      const [{ messages }, conv] = await Promise.all([
        listMessages(id, 50),
        getConversation(id).catch(() => null),
      ]);
      setMessages(messages);
      if (conv) setActiveConv(conv.conversation);
      void markConversationRead(id).catch(() => undefined);
      logChatEvent("open_conversation", { conversation_id: id });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load messages.");
    } finally {
      setLoading(false);
    }
  }, []);

  // Boot: DM target -> get-or-create; explicit id -> open; else list
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        if (userId) {
          const { conversation } = await getOrCreateDirectConversation(userId);
          if (!cancelled) {
            setActiveId(conversation.id);
            setActiveConv(conversation);
            const { messages } = await listMessages(conversation.id, 50);
            if (!cancelled) {
              setMessages(messages);
              void markConversationRead(conversation.id).catch(() => undefined);
            }
          }
        } else if (initialId) {
          if (!cancelled) await openConversation(initialId);
        } else {
          await loadList();
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not load chat.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, initialId, loadList, openConversation]);

  // Poll active thread
  useEffect(() => {
    if (!activeId) return;
    const t = setInterval(async () => {
      try {
        const { messages } = await listMessages(activeId, 50);
        setMessages((prev) => {
          const ids = new Set(prev.map((m) => m.id));
          const fresh = messages.filter((m) => !ids.has(m.id));
          return fresh.length ? [...prev, ...fresh] : prev;
        });
      } catch {
        // silent — last state stays
      }
    }, 4000);
    return () => clearInterval(t);
  }, [activeId]);

  useEffect(() => {
    scrollBottom();
  }, [messages.length, scrollBottom]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 2600);
    return () => clearTimeout(t);
  }, [notice]);

  const handleSend = async () => {
    const content = draft.trim();
    if (!content || !activeId || sending) return;
    setSending(true);
    setError(null);
    try {
      const mod = await aiModerateContent(content, "dm");
      if (!mod.allowed && mod.severity === "high") {
        setError(`Blocked: ${mod.reason || "inappropriate content"}`);
        return;
      }
      const tempId = `temp-${Date.now()}`;
      const optimistic: Message = {
        id: tempId,
        conversation_id: activeId,
        sender_id: user?.id ?? "me",
        content,
        type: "text",
        reply_to_id: null,
        metadata: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        deleted_at: null,
        sender: user ? { id: user.id, username: user.username, display_name: user.display_name, avatar_url: user.avatar_url } : undefined,
      };
      setMessages((prev) => [...prev, optimistic]);
      setDraft("");
      const { message } = await sendMessage({ conversation_id: activeId, content });
      setMessages((prev) => prev.map((m) => (m.id === tempId ? message : m)));
      void markConversationRead(activeId).catch(() => undefined);
      logChatEvent("send");
      // Refresh suggestions in background
      void aiSuggestReplies(messages.slice(-5).map((m) => ({ sender: m.sender?.display_name ?? "them", content: m.content }))).then(setSuggestions).catch(() => undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Send failed.");
    } finally {
      setSending(false);
    }
  };

  const handleTranslate = async (m: Message) => {
    if (translations[m.id]) {
      setTranslations((prev) => {
        const next = { ...prev };
        delete next[m.id];
        return next;
      });
      return;
    }
    setTranslatingId(m.id);
    try {
      const { translatedText } = await aiTranslate(m.content);
      setTranslations((prev) => ({ ...prev, [m.id]: translatedText }));
    } catch {
      setNotice("Translation unavailable right now.");
    } finally {
      setTranslatingId(null);
    }
  };

  const handleSummarize = async () => {
    if (summarizing || messages.length === 0) return;
    setSummarizing(true);
    try {
      const out = await aiSummarizeConversation(messages.slice(-30).map((m) => ({ sender: m.sender?.display_name ?? "them", content: m.content })));
      setSummary(`${out.summary} (${out.sentiment}) · ${out.keyTopics.slice(0, 3).join(", ") || "general chat"}`);
    } catch {
      setNotice("Summary unavailable right now.");
    } finally {
      setSummarizing(false);
    }
  };

  const loadMore = async () => {
    if (!activeId || messages.length === 0 || !hasMore || loadingMore) return;
    setLoadingMore(true);
    try {
      const { messages: older } = await listMessages(activeId, 50, messages[0].created_at);
      if (older.length === 0) setHasMore(false);
      else {
        setMessages((prev) => {
          const ids = new Set(prev.map((m) => m.id));
          return [...older.filter((m) => !ids.has(m.id)), ...prev];
        });
      }
    } catch {
      // silent
    } finally {
      setLoadingMore(false);
    }
  };

  if (!user) return <p className="p-6 text-center text-sm text-white/50">Sign in to message.</p>;

  // List view
  if (!activeId) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex items-center justify-between border-b border-white/10 p-4">
          <h2 className="text-base font-extrabold">Messages</h2>
          {onClose && (
            <button onClick={onClose} aria-label="Close messages" className="rounded-full p-1.5 text-white/50 hover:bg-white/10 hover:text-white">
              <X size={16} />
            </button>
          )}
        </div>
        <div className="flex-1 overflow-y-auto p-3">
          {loading ? (
            <p className="py-10 text-center text-sm text-white/40">Loading conversations…</p>
          ) : error ? (
            <div className="rounded-2xl bg-red-500/10 p-4 text-center text-sm text-red-300">{error}</div>
          ) : conversations.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-white/15 p-8 text-center">
              <p className="font-bold text-white/80">No conversations yet</p>
              <p className="mt-1 text-sm text-white/45">Open someone&apos;s profile and tap Message.</p>
            </div>
          ) : (
            <ul className="space-y-2">
              {conversations.map((c) => {
                const others = c.participants.filter((p) => p.user_id !== user.id);
                const title = others.map((p) => p.user.display_name).join(", ") || "Chat";
                return (
                  <li key={c.id}>
                    <button onClick={() => void openConversation(c.id)} className="flex w-full items-center gap-3 rounded-2xl bg-white/5 p-3 text-left transition hover:bg-white/10">
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-violet-500 to-fuchsia-500 text-sm font-extrabold">
                        {title.slice(0, 1).toUpperCase()}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-bold">{title}</span>
                        <span className="block truncate text-xs text-white/45">{c.last_message?.content ?? "No messages yet"}</span>
                      </span>
                      {c.unread_count > 0 && (
                        <span className="rounded-full bg-violet-500 px-2 py-0.5 text-xs font-bold">{c.unread_count > 99 ? "99+" : c.unread_count}</span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    );
  }

  // Thread view
  const others = (activeConv?.participants ?? []).filter((p) => p.user_id !== user?.id);
  const isDirect = activeConv != null && activeConv.type === "direct" && others.length === 1;
  const threadPeer = isDirect ? others[0] : null;
  const peerLastRead = threadPeer?.last_read_at ? new Date(threadPeer.last_read_at).getTime() : 0;

  const callPeer = async (media: "audio" | "video") => {
    if (!user || !threadPeer) return;
    const err = await placeCall(threadPeer.user_id, user.id, media, router);
    if (err) setNotice(err);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-white/10 p-3">
        <button onClick={() => { setActiveId(null); setActiveConv(null); void loadList(); }} aria-label="Back to conversations" className="rounded-full p-1.5 text-white/60 hover:bg-white/10 hover:text-white">
          <ArrowLeft size={16} />
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold">{threadPeer ? threadPeer.user.display_name : "Conversation"}</p>
          <p className="text-xs text-white/40">{messages.length} messages</p>
        </div>
        {threadPeer && (
          <>
            <button onClick={() => void callPeer("audio")} aria-label="Voice call" title="Voice call" className="rounded-full bg-white/5 p-2 text-white/70 transition hover:bg-white/10 hover:text-white">
              <Phone size={15} />
            </button>
            <button onClick={() => void callPeer("video")} aria-label="Video call" title="Video call" className="rounded-full bg-white/5 p-2 text-white/70 transition hover:bg-white/10 hover:text-white">
              <Video size={15} />
            </button>
          </>
        )}
        <button onClick={handleSummarize} disabled={summarizing || messages.length === 0} className="flex items-center gap-1 rounded-full bg-white/5 px-3 py-1.5 text-xs font-bold text-white/70 hover:bg-white/10 disabled:opacity-40">
          <Sparkles size={13} /> {summarizing ? "…" : "Summary"}
        </button>
        {onClose && (
          <button onClick={onClose} aria-label="Close messages" className="rounded-full p-1.5 text-white/50 hover:bg-white/10 hover:text-white">
            <X size={16} />
          </button>
        )}
      </div>

      {summary && <p className="border-b border-white/5 bg-violet-500/10 px-4 py-2 text-xs text-violet-200">{summary}</p>}
      {notice && <p className="border-b border-white/5 bg-white/5 px-4 py-2 text-center text-xs font-semibold text-amber-200">{notice}</p>}
      {error && <p className="border-b border-white/5 bg-red-500/10 px-4 py-2 text-center text-xs font-semibold text-red-300">{error}</p>}

      <div
        className="chat-scroll flex-1 space-y-2 overflow-y-auto px-3 py-3"
        onWheel={(e) => {
          const el = e.currentTarget;
          if (e.deltaY < 0 && el.scrollTop === 0) void loadMore();
        }}
      >
        {loading && <p className="py-6 text-center text-sm text-white/40">Loading messages…</p>}
        {loadingMore && <p className="py-1 text-center text-xs text-white/30">Loading older…</p>}
        {!loading && messages.length === 0 && (
          <div className="rounded-2xl border border-dashed border-white/15 p-6 text-center">
            <p className="text-sm font-bold text-white/70">Say hi 👋</p>
            <p className="mt-1 text-xs text-white/40">Messages sync across devices.</p>
          </div>
        )}
        {messages.map((m) => {
          const mine = m.sender_id === user.id;
          const translated = translations[m.id];
          // Standard 1:1 ticks: ✓ sent (on server), ✓✓ seen (peer read past it).
          const seen = mine && threadPeer != null && peerLastRead > 0 && new Date(m.created_at).getTime() <= peerLastRead;
          return (
            <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[78%] rounded-2xl px-3 py-2 text-sm ${mine ? "bg-white text-black" : "bg-white/10 text-white/90"}`}>
                {!mine && <p className="mb-0.5 text-[11px] font-bold text-white/50">{m.sender?.display_name ?? "Them"}</p>}
                <p>{translated ?? m.content}</p>
                {translated && <p className="mt-1 text-[11px] opacity-60">Original: {m.content}</p>}
                <div className="mt-1 flex items-center gap-2">
                  <span className="text-[10px] opacity-50">
                    {new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </span>
                  {mine && threadPeer != null && (
                    seen ? (
                      <span className="flex items-center gap-0.5 text-[10px] font-bold text-sky-600" aria-label="Seen">
                        <CheckCheck size={11} /> Seen
                      </span>
                    ) : (
                      <span className="flex items-center gap-0.5 text-[10px] opacity-50" aria-label="Sent">
                        <Check size={11} /> Sent
                      </span>
                    )
                  )}
                  <button onClick={() => void handleTranslate(m)} disabled={translatingId === m.id} className="flex items-center gap-0.5 text-[10px] font-bold opacity-60 hover:opacity-100 disabled:opacity-30">
                    <Languages size={10} /> {translated ? "Original" : translatingId === m.id ? "…" : "Translate"}
                  </button>
                </div>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {suggestions.length > 0 && (
        <div className="flex gap-1.5 overflow-x-auto border-t border-white/5 px-3 pt-2">
          {suggestions.map((s) => (
            <button key={s} onClick={() => setDraft(s)} className="shrink-0 rounded-full bg-white/5 px-3 py-1.5 text-xs text-white/70 hover:bg-white/10">
              {s}
            </button>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2 p-3">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void handleSend();
            }
          }}
          placeholder="Message…"
          maxLength={2000}
          className="min-w-0 flex-1 rounded-2xl border border-white/10 bg-white/5 px-3.5 py-2.5 text-sm text-white placeholder:text-white/30 focus:border-violet-400/50 focus:outline-none"
        />
        <button
          onClick={() => void handleSend()}
          disabled={!draft.trim() || sending}
          aria-label="Send message"
          className="rounded-2xl bg-white p-2.5 text-black transition hover:bg-white/85 active:scale-95 disabled:opacity-40"
        >
          <Send size={16} />
        </button>
      </div>
    </div>
  );
}
