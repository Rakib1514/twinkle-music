import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { Play, Users, Plus, LogIn } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { generateRoomCode, getName, getUserId, setName as saveName } from "@/lib/identity";

const Index = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [name, setNameState] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setNameState(getName());
    const j = searchParams.get("join");
    if (j) setCode(j.toUpperCase().slice(0, 4));
  }, [searchParams]);

  const ensureName = () => {
    const n = name.trim();
    if (n.length < 2) {
      toast.error("Enter your name (min 2 chars)");
      return null;
    }
    saveName(n);
    return n;
  };

  const createRoom = async () => {
    const n = ensureName();
    if (!n) return;
    setLoading(true);
    try {
      const uid = getUserId();
      // try a few codes in case of collision
      for (let attempt = 0; attempt < 5; attempt++) {
        const newCode = generateRoomCode();
        const { data: room, error } = await supabase
          .from("rooms")
          .insert({ code: newCode, owner_id: uid })
          .select()
          .single();
        if (!error && room) {
          await supabase.from("room_members").insert({ room_id: room.id, user_id: uid, name: n });
          navigate(`/room/${newCode}`);
          return;
        }
        if (error && !error.message.toLowerCase().includes("duplicate")) {
          throw error;
        }
      }
      toast.error("Could not generate a unique code");
    } catch (e: any) {
      toast.error(e.message ?? "Failed to create room");
    } finally {
      setLoading(false);
    }
  };

  const joinRoom = async () => {
    const n = ensureName();
    if (!n) return;
    const c = code.trim().toUpperCase();
    if (c.length !== 4) {
      toast.error("Code must be 4 characters");
      return;
    }
    setLoading(true);
    try {
      const { data: room, error } = await supabase
        .from("rooms")
        .select("*")
        .eq("code", c)
        .maybeSingle();
      if (error) throw error;
      if (!room) {
        toast.error("Room not found");
        return;
      }
      const uid = getUserId();
      // upsert membership; capacity enforced by trigger
      const { data: existing } = await supabase
        .from("room_members")
        .select("id")
        .eq("room_id", room.id)
        .eq("user_id", uid)
        .maybeSingle();
      if (!existing) {
        const { error: joinErr } = await supabase
          .from("room_members")
          .insert({ room_id: room.id, user_id: uid, name: n });
        if (joinErr) {
          if (joinErr.message.includes("full")) toast.error("Room is full (max 6)");
          else toast.error(joinErr.message);
          return;
        }
      }
      navigate(`/room/${c}`);
    } catch (e: any) {
      toast.error(e.message ?? "Failed to join");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-md space-y-8">
        <header className="text-center space-y-3">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl gradient-primary glow">
            <Play className="w-8 h-8 text-white fill-white" />
          </div>
          <h1 className="text-5xl font-bold tracking-tight">
            Group<span className="text-gradient">Play</span>
          </h1>
          <p className="text-muted-foreground">Watch YouTube together. In sync. With friends.</p>
        </header>

        <Card className="p-6 space-y-5 bg-card/60 backdrop-blur border-border/50">
          <div className="space-y-2">
            <label className="text-sm font-medium flex items-center gap-2">
              <Users className="w-4 h-4" /> Your name
            </label>
            <Input
              value={name}
              onChange={(e) => setNameState(e.target.value)}
              placeholder="e.g. Alex"
              maxLength={24}
            />
          </div>

          <Button
            onClick={createRoom}
            disabled={loading}
            className="w-full gradient-primary text-primary-foreground hover:opacity-90 font-semibold"
            size="lg"
          >
            <Plus className="w-4 h-4 mr-2" /> Create Room
          </Button>

          <div className="flex items-center gap-3">
            <div className="flex-1 h-px bg-border" />
            <span className="text-xs text-muted-foreground">OR</span>
            <div className="flex-1 h-px bg-border" />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Room code</label>
            <div className="flex gap-2">
              <Input
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="ABCD"
                maxLength={4}
                className="font-mono text-center text-lg tracking-[0.4em] uppercase"
              />
              <Button onClick={joinRoom} disabled={loading} variant="secondary">
                <LogIn className="w-4 h-4 mr-2" /> Join
              </Button>
            </div>
          </div>
        </Card>

        <p className="text-center text-xs text-muted-foreground">
          Up to 6 friends per room · No login required
        </p>
      </div>
    </main>
  );
};

export default Index;
