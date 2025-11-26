import { useEffect, useState, useCallback, lazy, Suspense } from "react";
import { createPortal } from "react-dom";

const ChatPanel = lazy(() => import("./ChatPanel"));

type Props = {
  groupId: string;
  label?: string; // button label
  user?: any;
};

export default function ChatPopup({ groupId, label = "Chat", user }: Props) {
  const [open, setOpen] = useState(false);

  const onKey = useCallback((e: KeyboardEvent) => {
    if (e.key === "Escape") setOpen(false);
  }, []);

  useEffect(() => {
    if (!open) return;
    document.addEventListener("keydown", onKey);
    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
    return () => {
      document.documentElement.style.overflow = "";
      document.body.style.overflow = "";
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onKey]);

  return (
    <>
      {/* Floating button bottom-right */}
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-5 right-5 z-[9999] rounded-full shadow-lg border bg-white px-4 py-3 text-sm font-medium hover:shadow-xl"
        aria-label="Open chat"
      >
        {label}
      </button>

      {open &&
        createPortal(
          <div className="fixed inset-0 z-[2147483647] pointer-events-auto">
            {/* Solid dark backdrop (click to close) */}
            <div
              className="absolute inset-0 bg-black/80"
              onClick={() => setOpen(false)}
            />
            {/* Centered modal container */}
            <div className="absolute inset-0 flex items-center justify-center p-4">
              <div
                className="relative w-[760px] max-w-[92vw] h-[640px] max-h-[94vh] rounded-2xl overflow-hidden shadow-2xl ring-1 ring-black/10 bg-white"
                role="dialog"
                aria-modal="true"
                aria-label="Group Chat"
              >
                {/* Header */}
                <div className="flex items-center justify-between border-b px-3 py-2">
                  <b>Group Chat</b>
                  <button
                    onClick={() => setOpen(false)}
                    className="rounded-md px-2 py-1 text-sm hover:bg-black/5"
                    aria-label="Close"
                    title="Close"
                  >
                    ✕
                  </button>
                </div>
                {/* Chat body */}
                <div className="h-[calc(100%-44px)]">
                  <Suspense
                    fallback={
                      <div className="flex h-full w-full items-center justify-center text-neutral-500">
                        Loading chat...
                      </div>
                    }
                  >
                    <ChatPanel
                      key={groupId}
                      groupId={groupId}
                      user={user}
                      onClose={() => setOpen(false)}
                      full={true}
                      setFull={() => {}}
                    />
                  </Suspense>
                </div>
              </div>
            </div>
          </div>,
          document.body
        )
      }
    </>
  );
}