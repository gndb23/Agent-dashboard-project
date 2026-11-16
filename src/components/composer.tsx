"use client";

import { forwardRef, useState } from "react";
import { ArrowUp, Square } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "./ui/button";

/** Message box: Enter sends, Shift+Enter adds a line, Stop while busy. */
export const Composer = forwardRef<HTMLTextAreaElement, { busy: boolean; disabled?: boolean; placeholder: string; onSend: (t: string) => void; onStop: () => void; hint?: string }>(
  function Composer({ busy, disabled, placeholder, onSend, onStop, hint }, ref) {
    const [text, setText] = useState("");
    const send = () => {
      if (!text.trim() || busy || disabled) return;
      onSend(text);
      setText("");
    };
    return (
      <form
        className="border-t border-border p-3"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <div className={cn("flex items-end gap-2 rounded-card border bg-surface-2 p-1.5 pl-3.5 transition-colors focus-within:border-accent", disabled ? "border-border opacity-60" : "border-border-strong")}>
          <textarea
            ref={ref}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send();
              }
            }}
            rows={1}
            disabled={disabled}
            placeholder={placeholder}
            aria-label={placeholder}
            className="max-h-40 min-h-8 flex-1 resize-none bg-transparent py-1.5 text-sm text-fg outline-none placeholder:text-fg-subtle [field-sizing:content]"
          />
          {busy ? (
            <Button type="button" size="icon" variant="secondary" onClick={onStop} aria-label="Stop" title="Stop">
              <Square size={12} fill="currentColor" />
            </Button>
          ) : (
            <Button type="submit" size="icon" variant="primary" disabled={disabled || !text.trim()} aria-label="Send" title="Send (Enter)">
              <ArrowUp size={15} strokeWidth={2.5} />
            </Button>
          )}
        </div>
        <div className="mt-1.5 px-1 text-2xs text-fg-subtle">{hint ?? "Enter to send · Shift+Enter for a new line"}</div>
      </form>
    );
  },
);
