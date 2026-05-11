import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Copy, LogOut, Users, Crown, X, SkipForward, Play, Share2, ThumbsUp, ThumbsDown } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { getName, getUserId } from "@/lib/identity";
import { YouTubePlayer, type PlayerHandle } from "@/components/YouTubePlayer";
import { SearchBar, type SearchResult } from "@/components/SearchBar";
import { ChatPanel, type ChatMessage } from "@/components/ChatPanel";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { setName as saveName } from "@/lib/identity";

interface Room {
  id: string;
  code: string;
  owner_id: string;
  current_video_id: string | null;
  current_video_title: string | null;
  is_playing: boolean;
  position_seconds: number;
  last_state_at: string;
}

interface Member {
  id: string;
  user_id: string;
  name: string;
  joined_at: string;
}

interface QueueItem {
  id: string;
  video_id: string;
  title: string;
  thumbnail: string | null;
  channel: string | null;
  added_by_name: string;
  position: number;
  votes: number;
  created_at: string;
}

const Room = () => {
  const { code = "" } = useParams();
  const navigate = useNavigate();
  const uid = useMemo(() => getUserId(), []);
  const myName = useMemo(() => getName() || "Guest", []);

  const [room, setRoom] = useState<Room | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNameModal, setShowNameModal] = useState(false);
  const [pendingName, setPendingName] = useState("");
  const [isJoining, setIsJoining] = useState(false);

  const playerRef = useRef<PlayerHandle | null>(null);
  const lastBroadcastRef = useRef<number>(0);
  const suppressNextStateRef = useRef(false);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  const isOwner = !!room && room.owner_id === uid;

  useEffect(() => {
    let cancelled = false;
    const c = code.toUpperCase();
    
    (async () => {
      const { data: r, error } = await supabase
        .from("rooms")
        .select("*")
        .eq("code", c)
        .maybeSingle();
      
      if (cancelled) return;
      
      if (error || !r) {
        toast.error("Room not found");
        navigate("/");
        return;
      }
      setRoom(r as Room);

      const name = getName();
      if (!name) {
        setShowNameModal(true);
        setLoading(false);
        return;
      }

      // ensure I'm a member (in case of refresh)
      const { data: existing } = await supabase
        .from("room_members")
        .select("id")
        .eq("room_id", r.id)
        .eq("user_id", uid)
        .maybeSingle();
        
      if (!existing && !cancelled) {
        const { error: joinErr } = await supabase
          .from("room_members")
          .insert({ room_id: r.id, user_id: uid, name });
        if (joinErr) {
          toast.error(joinErr.message.includes("full") ? "Room is full" : joinErr.message);
          navigate("/");
          return;
        }
      }

      const [{ data: mems }, { data: q }] = await Promise.all([
        supabase.from("room_members").select("*").eq("room_id", r.id).order("joined_at"),
        supabase.from("queue_items").select("*").eq("room_id", r.id).order("votes", { ascending: false }).order("created_at"),
      ]);
      
      if (cancelled) return;
      setMembers((mems as Member[]) || []);
      setQueue((q as QueueItem[]) || []);
      setLoading(false);
    })();

    return () => { cancelled = true; };
  }, [code, navigate, uid]);

  // Realtime subscriptions
  useEffect(() => {
    if (!room) return;
    const channel = supabase
      .channel(`room-${room.id}`, { config: { broadcast: { self: false } } })
      .on("postgres_changes", { event: "*", schema: "public", table: "rooms", filter: `id=eq.${room.id}` },
        (payload) => {
          if (payload.eventType === "DELETE") {
            toast("Room closed");
            navigate("/");
            return;
          }
          setRoom(payload.new as Room);
        })
      .on("postgres_changes", { event: "*", schema: "public", table: "room_members", filter: `room_id=eq.${room.id}` },
        async () => {
          const { data } = await supabase
            .from("room_members")
            .select("*")
            .eq("room_id", room.id)
            .order("joined_at");
          setMembers((data as Member[]) || []);
        })
      .on("postgres_changes", { event: "*", schema: "public", table: "queue_items", filter: `room_id=eq.${room.id}` },
        async () => {
          const { data } = await supabase
            .from("queue_items")
            .select("*")
            .eq("room_id", room.id)
            .order("votes", { ascending: false })
            .order("created_at");
          setQueue((data as QueueItem[]) || []);
        })
      .on("broadcast", { event: "chat" }, ({ payload }) => {
        setMessages((m) => [...m, payload as ChatMessage].slice(-100));
      })
      .on("broadcast", { event: "playback" }, ({ payload }) => {
        if (isOwner) return; // owner ignores own broadcasts
        const p = payload as { action: string; time: number; videoId?: string };
        const player = playerRef.current;
        if (!player) return;
        suppressNextStateRef.current = true;
        if (p.action === "play") {
          if (Math.abs(player.getCurrentTime() - p.time) > 1.5) player.seek(p.time);
          player.play();
        } else if (p.action === "pause") {
          player.pause();
          if (Math.abs(player.getCurrentTime() - p.time) > 1.5) player.seek(p.time);
        } else if (p.action === "seek") {
          player.seek(p.time);
        } else if (p.action === "load" && p.videoId) {
          player.load(p.videoId, p.time);
        }
      })
      .subscribe();
    channelRef.current = channel;

    return () => { supabase.removeChannel(channel); channelRef.current = null; };
  }, [room?.id, isOwner, navigate]);

  // Leave on unmount/unload
  useEffect(() => {
    if (!room) return;
    const leave = () => {
      // best-effort
      navigator.sendBeacon?.(
        `${import.meta.env.VITE_SUPABASE_URL}/rest/v1/room_members?room_id=eq.${room.id}&user_id=eq.${uid}`,
        new Blob([], { type: "application/json" })
      );
    };
    window.addEventListener("beforeunload", leave);
    return () => window.removeEventListener("beforeunload", leave);
  }, [room?.id, uid]);

  // When non-owner and current video changes via DB sync, load it
  useEffect(() => {
    if (!room || isOwner || !playerRef.current) return;
    if (room.current_video_id) {
      playerRef.current.load(room.current_video_id, room.position_seconds);
      if (!room.is_playing) setTimeout(() => playerRef.current?.pause(), 300);
    }
  }, [room?.current_video_id]);

  const broadcast = (action: string, time: number, videoId?: string) => {
    channelRef.current?.send({
      type: "broadcast",
      event: "playback",
      payload: { action, time, videoId },
    });
  };

  const handlePlayerReady = (h: PlayerHandle) => {
    playerRef.current = h;
    if (room?.current_video_id) {
      h.load(room.current_video_id, room.position_seconds);
      if (!room.is_playing) setTimeout(() => h.pause(), 300);
    }
  };

  const handlePlayerStateChange = async (state: number, time: number) => {
    if (!isOwner || !room) return;
    if (suppressNextStateRef.current) {
      suppressNextStateRef.current = false;
      return;
    }
    // throttle
    const now = Date.now();
    if (now - lastBroadcastRef.current < 200) return;
    lastBroadcastRef.current = now;

    // YT.PlayerState: 1=playing, 2=paused
    if (state === 1) {
      broadcast("play", time);
      await supabase.from("rooms").update({
        is_playing: true, position_seconds: time, last_state_at: new Date().toISOString(),
      }).eq("id", room.id);
    } else if (state === 2) {
      broadcast("pause", time);
      await supabase.from("rooms").update({
        is_playing: false, position_seconds: time, last_state_at: new Date().toISOString(),
      }).eq("id", room.id);
    }
  };

  const playNext = async () => {
    if (!room || queue.length === 0) return;
    const next = queue[0];
    await supabase.from("rooms").update({
      current_video_id: next.video_id,
      current_video_title: next.title,
      is_playing: true,
      position_seconds: 0,
      last_state_at: new Date().toISOString(),
    }).eq("id", room.id);
    await supabase.from("queue_items").delete().eq("id", next.id);
    if (isOwner) {
      playerRef.current?.load(next.video_id, 0);
      broadcast("load", 0, next.video_id);
    }
  };

  const handleEnded = () => { if (isOwner) playNext(); };

  const addToQueue = async (item: SearchResult) => {
    if (!room) return;
    // if no current video, load directly
    if (!room.current_video_id) {
      await supabase.from("rooms").update({
        current_video_id: item.videoId,
        current_video_title: item.title,
        is_playing: true,
        position_seconds: 0,
        last_state_at: new Date().toISOString(),
      }).eq("id", room.id);
      if (isOwner) {
        playerRef.current?.load(item.videoId, 0);
        broadcast("load", 0, item.videoId);
      }
      toast.success("Now playing");
      return;
    }
    await supabase.from("queue_items").insert({
      room_id: room.id,
      video_id: item.videoId,
      title: item.title,
      thumbnail: item.thumbnail,
      channel: item.channel,
      added_by_name: myName,
    });
    toast.success("Added to queue");
  };

  const removeFromQueue = async (id: string) => {
    if (!isOwner) {
      toast.error("Only the owner can remove items");
      return;
    }
    await supabase.from("queue_items").delete().eq("id", id);
  };

  const sendChat = (text: string) => {
    if (!room) return;
    const msg: ChatMessage = {
      id: crypto.randomUUID(),
      user_id: uid,
      name: myName,
      text,
      ts: Date.now(),
    };
    setMessages((m) => [...m, msg].slice(-100));
    channelRef.current?.send({
      type: "broadcast",
      event: "chat",
      payload: msg,
    });
  };

  const leaveRoom = async () => {
    if (!room) return;
    await supabase.from("room_members").delete().eq("room_id", room.id).eq("user_id", uid);
    navigate("/");
  };

  const copyCode = () => {
    navigator.clipboard.writeText(code.toUpperCase());
    toast.success("Code copied");
  };

  const copyInvite = () => {
    const url = `${window.location.origin}/?join=${code.toUpperCase()}`;
    navigator.clipboard.writeText(url);
    toast.success("Invite link copied");
  };

  const handleJoin = async () => {
    if (!room || isJoining) return;
    const name = pendingName.trim();
    if (name.length < 2) {
      toast.error("Name must be at least 2 characters");
      return;
    }
    setIsJoining(true);
    try {
      saveName(name);
      const { error: joinErr } = await supabase
        .from("room_members")
        .insert({ room_id: room.id, user_id: uid, name });
      
      if (joinErr) {
        if (joinErr.message.includes("full")) toast.error("Room is full");
        else toast.error(joinErr.message);
        return;
      }
      
      const [{ data: mems }, { data: q }] = await Promise.all([
        supabase.from("room_members").select("*").eq("room_id", room.id).order("joined_at"),
        supabase.from("queue_items").select("*").eq("room_id", room.id).order("created_at"),
      ]);
      
      setMembers((mems as Member[]) || []);
      setQueue((q as QueueItem[]) || []);
      setShowNameModal(false);
    } catch (e: any) {
      toast.error(e.message || "Failed to join");
    } finally {
      setIsJoining(false);
    }
  };

  const vote = async (itemId: string, type: 1 | -1) => {
    // Upsert vote; trigger handles count in queue_items
    const { error } = await supabase
      .from("queue_item_votes")
      .upsert({ queue_item_id: itemId, user_id: uid, vote_type: type }, { onConflict: "queue_item_id,user_id" });
    
    if (error) {
      toast.error(error.message);
    } else {
      toast.success(type === 1 ? "Upvoted" : "Downvoted");
    }
  };

  if (loading || !room) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-muted-foreground">Loading room...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      {/* Navbar */}
      <header className="border-b border-border/50 bg-card/40 backdrop-blur sticky top-0 z-20">
        <div className="container mx-auto px-4 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg gradient-primary flex items-center justify-center">
              <Play className="w-4 h-4 text-white fill-white" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground leading-none">Room</p>
              <button onClick={copyCode} className="font-mono font-bold text-lg tracking-widest hover:text-gradient flex items-center gap-2">
                {room.code}
                <Copy className="w-3.5 h-3.5 opacity-60" />
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-1 justify-center flex-wrap">
            <Badge variant="secondary" className="gap-1.5">
              <Users className="w-3 h-3" /> {members.length}/6
            </Badge>
            <div className="flex gap-1.5 flex-wrap">
              {members.map((m) => (
                <Badge key={m.id} variant="outline" className="gap-1">
                  {m.user_id === room.owner_id && <Crown className="w-3 h-3 text-accent" />}
                  {m.name}
                </Badge>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-1">
            <Button size="sm" variant="secondary" onClick={copyInvite}>
              <Share2 className="w-4 h-4 mr-1" /> Invite
            </Button>
            <Button size="sm" variant="ghost" onClick={leaveRoom}>
              <LogOut className="w-4 h-4 mr-1" /> Leave
            </Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-6 flex-1 grid lg:grid-cols-[1fr_340px] gap-6">
        {/* Left column */}
        <div className="space-y-4 min-w-0">
          {room.current_video_id ? (
            <YouTubePlayer
              key={`${isOwner}`} // re-create if ownership changes
              videoId={room.current_video_id}
              isOwner={isOwner}
              onReady={handlePlayerReady}
              onStateChange={handlePlayerStateChange}
              onEnded={handleEnded}
            />
          ) : (
            <Card className="aspect-video flex items-center justify-center bg-card/40 backdrop-blur border-border/50">
              <div className="text-center space-y-2">
                <Play className="w-12 h-12 mx-auto text-muted-foreground/40" />
                <p className="text-muted-foreground">Search and add a video to get started</p>
              </div>
            </Card>
          )}

          {room.current_video_title && (
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-medium line-clamp-1">{room.current_video_title}</p>
              {isOwner && queue.length > 0 && (
                <Button size="sm" variant="secondary" onClick={playNext}>
                  <SkipForward className="w-4 h-4 mr-1" /> Skip
                </Button>
              )}
            </div>
          )}

          <Card className="p-4 bg-card/40 backdrop-blur border-border/50">
            <SearchBar onAdd={addToQueue} />
          </Card>

          <Card className="p-4 bg-card/40 backdrop-blur border-border/50">
            <h3 className="font-semibold text-sm mb-3 flex items-center justify-between">
              Queue <span className="text-xs text-muted-foreground font-normal">{queue.length} item{queue.length !== 1 ? "s" : ""}</span>
            </h3>
            {queue.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-4">Queue is empty</p>
            ) : (
              <ul className="space-y-2">
                {queue.map((q, i) => (
                  <li key={q.id} className="flex gap-3 items-center p-2 rounded-lg hover:bg-secondary/40">
                    <span className="text-xs text-muted-foreground w-5 text-center">{i + 1}</span>
                    {q.thumbnail && (
                      <img src={q.thumbnail} alt="" className="w-20 h-12 rounded object-cover" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium line-clamp-1">{q.title}</p>
                      <p className="text-xs text-muted-foreground">added by {q.added_by_name}</p>
                    </div>

                    <div className="flex items-center gap-1 mr-2">
                      <Button size="icon" variant="ghost" className="h-8 w-8 hover:text-green-500" onClick={() => vote(q.id, 1)}>
                        <ThumbsUp className="w-3.5 h-3.5" />
                      </Button>
                      <span className={`text-xs font-bold w-6 text-center ${q.votes > 0 ? "text-green-500" : q.votes < 0 ? "text-red-500" : ""}`}>
                        {q.votes || 0}
                      </span>
                      <Button size="icon" variant="ghost" className="h-8 w-8 hover:text-red-500" onClick={() => vote(q.id, -1)}>
                        <ThumbsDown className="w-3.5 h-3.5" />
                      </Button>
                    </div>

                    {isOwner && (
                      <Button size="icon" variant="ghost" onClick={() => removeFromQueue(q.id)}>
                        <X className="w-4 h-4" />
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        {/* Right column: chat */}
        <div className="lg:h-[calc(100vh-7rem)] lg:sticky lg:top-20 h-[480px]">
          <ChatPanel messages={messages} onSend={sendChat} myUserId={uid} />
        </div>
      </main>

      <Dialog open={showNameModal} onOpenChange={(open) => !open && navigate("/")}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Enter your name</DialogTitle>
            <DialogDescription>
              Choose a name to join the room and start watching together.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <Input
              value={pendingName}
              onChange={(e) => setPendingName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleJoin()}
              placeholder="e.g. Alex"
              maxLength={24}
              autoFocus
            />
            <Button 
              className="w-full gradient-primary" 
              onClick={handleJoin}
              disabled={isJoining || !pendingName.trim()}
            >
              Join Room
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Room;
