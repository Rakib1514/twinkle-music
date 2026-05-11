import { useEffect, useRef, useState } from "react";
import { Send } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { z } from "zod";
import { toast } from "sonner";

export interface ChatMessage {
  id: string;
  user_id: string;
  name: string;
  text: string;
  ts: number;
}

interface Props {
  messages: ChatMessage[];
  onSend: (text: string) => void;
  myUserId: string;
}

const schema = z.string().trim().min(1).max(500);

export const ChatPanel = ({ messages, onSend, myUserId }: Props) => {
  const [text, setText] = useState("");
  const scrollerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollerRef.current) {
      scrollerRef.current.scrollTop = scrollerRef.current.scrollHeight;
    }
  }, [messages]);

  const send = () => {
    const r = schema.safeParse(text);
    if (!r.success) {
      toast.error("Message must be 1–500 characters");
      return;
    }
    onSend(r.data);
    setText("");
  };

  return (
    <div className="flex flex-col h-full bg-card/40 backdrop-blur border border-border/50 rounded-lg overflow-hidden">
      <div className="px-4 py-3 border-b border-border/50">
        <h3 className="font-semibold text-sm">Chat</h3>
      </div>
      <div ref={scrollerRef} className="flex-1 overflow-y-auto p-3 space-y-2 min-h-0">
        {messages.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-6">
            Say hi to your friends 👋
          </p>
        ) : (
          messages.map((m) => {
            const mine = m.user_id === myUserId;
            return (
              <div key={m.id} className={`flex flex-col ${mine ? "items-end" : "items-start"}`}>
                <span className="text-[10px] text-muted-foreground px-1">{m.name}</span>
                <div
                  className={`max-w-[85%] px-3 py-1.5 rounded-2xl text-sm break-words ${
                    mine ? "gradient-primary text-primary-foreground" : "bg-secondary"
                  }`}
                >
                  {m.text}
                </div>
              </div>
            );
          })
        )}
      </div>
      <div className="p-2 border-t border-border/50 flex gap-2">
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          placeholder="Type a message..."
          maxLength={500}
        />
        <Button size="icon" onClick={send} className="gradient-primary">
          <Send className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
};
