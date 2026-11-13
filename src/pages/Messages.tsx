/**
 * In-app chat. Convex subscriptions make both the thread list and the open
 * conversation update live as messages arrive.
 */

import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useMutation } from "convex/react";
import { ArrowRight, Send } from "lucide-react";

import { useLang } from "@/lib/lang";
import { useAuthQuery } from "@/lib/useAuthQuery";
import { api } from "@/convex/_generated/api";
import { formatRelativeTime } from "@/lib/catalog";
import { EmptyState } from "@/components/marketplace";

export function Messages() {
  const { threadId } = useParams<{ threadId?: string }>();
  const navigate = useNavigate();
  const { t, lang } = useLang();

  const threads = useAuthQuery(
    api.contact.myThreads, {});
  const messages = useAuthQuery(
    api.contact.threadMessages,
    threadId ? { threadId: threadId as never } : "skip",
  );
  const send = useMutation(api.contact.sendMessage);
  const markRead = useMutation(api.contact.markThreadRead);

  const [draft, setDraft] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  // Mark incoming messages read and keep the pane pinned to the newest one.
  useEffect(() => {
    if (threadId) void markRead({ threadId: threadId as never });
  }, [threadId, markRead, messages?.length]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages?.length]);

  if (threads === undefined) {
    return <div className="skeleton h-32 rounded-lg bg-neutral-100" />;
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft.trim() || !threadId) return;
    await send({ threadId: threadId as never, body: draft });
    setDraft("");
  };

  if (threads.length === 0) {
    return (
      <EmptyState
        title={t.navMessages}
        hint={lang === "ar"
          ? "افتح منتج و اضغط «محادثة داخل التطبيق» باش تبدا."
          : "Ouvrez un produit et cliquez sur « Discuter dans l'app »."}
        action={
          <Link to="/search" className="mt-2 text-xs font-semibold text-[#006233] underline">
            {t.navSearch}
          </Link>
        }
      />
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-[280px_minmax(0,1fr)]">
      {/* Thread list */}
      <nav
        className={`space-y-1 md:block md:max-h-[70vh] md:overflow-y-auto ${
          threadId ? "hidden" : "block"
        }`}
        data-route-scroll
        aria-label={t.navMessages}
      >
        {threads.map((thread) => (
          <button
            key={thread.id}
            onClick={() => navigate(`/messages/${thread.id}`)}
            className={`tap-target w-full rounded-lg border p-3 text-start ${
              thread.id === threadId
                ? "border-[#006233] bg-[#eef6f1]"
                : "border-[#e3e8e5]"
            }`}
          >
            <span className="block truncate text-sm font-medium text-black">
              {thread.counterpartName}
            </span>
            <span className="mt-0.5 block truncate text-xs text-neutral-600">
              {thread.lastMessagePreview}
            </span>
            <span className="mt-0.5 block text-[11px] text-neutral-500">
              {formatRelativeTime(thread.lastMessageAt, lang)}
            </span>
          </button>
        ))}
      </nav>

      {/* Conversation */}
      <section
        className={`flex h-[calc(100dvh-210px)] min-h-[420px] flex-col rounded-lg border border-[#e3e8e5] md:flex md:h-[70vh] ${
          threadId ? "flex" : "hidden"
        }`}
      >
        {!threadId ? (
          <div className="flex flex-1 items-center justify-center text-sm text-neutral-500">
            {lang === "ar" ? "اختر محادثة" : "Choisissez une conversation"}
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2 border-b border-[#e3e8e5] p-3 text-sm font-semibold text-black">
              <button
                type="button"
                onClick={() => navigate("/messages")}
                aria-label={t.navMessages}
                className="tap-target flex size-9 items-center justify-center rounded-lg border border-[#e3e8e5] md:hidden"
              >
                <ArrowRight
                  className={`size-4 ${lang === "fr" ? "rotate-180" : ""}`}
                  aria-hidden
                />
              </button>
              <span className="truncate">
                {threads.find((x) => x.id === threadId)?.counterpartName}
              </span>
            </div>

            <div className="flex-1 space-y-2 overflow-y-auto p-3" data-route-scroll>
              {messages === undefined ? (
                <div className="skeleton h-16 rounded bg-neutral-100" />
              ) : (
                messages.map((message) => (
                  <div
                    key={message.id}
                    className={`flex ${message.mine ? "justify-end" : "justify-start"}`}
                  >
                    <div
                      className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
                        message.mine
                          ? "bg-[#006233] text-white"
                          : "border border-[#e3e8e5] bg-white text-black"
                      }`}
                    >
                      <p className="whitespace-pre-wrap break-words">{message.body}</p>
                      <p
                        className={`mt-1 text-[10px] ${
                          message.mine ? "text-white/70" : "text-neutral-500"
                        }`}
                      >
                        {formatRelativeTime(message.createdAt, lang)}
                      </p>
                    </div>
                  </div>
                ))
              )}
              <div ref={bottomRef} />
            </div>

            <form onSubmit={submit} className="flex gap-2 border-t border-[#e3e8e5] p-3">
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={t.openChat}
                maxLength={1000}
                className="tap-target flex-1 rounded-lg border border-[#e3e8e5] px-3 text-sm outline-none focus:border-[#006233]"
              />
              <button
                type="submit"
                disabled={!draft.trim()}
                aria-label={t.save}
                className="tap-target rounded-lg bg-[#006233] px-4 text-white disabled:opacity-60"
              >
                <Send className="size-4" aria-hidden />
              </button>
            </form>
          </>
        )}
      </section>
    </div>
  );
}