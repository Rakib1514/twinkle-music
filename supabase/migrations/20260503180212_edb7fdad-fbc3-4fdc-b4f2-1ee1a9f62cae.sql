
-- Rooms
CREATE TABLE public.rooms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  owner_id UUID NOT NULL,
  current_video_id TEXT,
  current_video_title TEXT,
  is_playing BOOLEAN NOT NULL DEFAULT false,
  position_seconds NUMERIC NOT NULL DEFAULT 0,
  last_state_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.room_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  name TEXT NOT NULL,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (room_id, user_id)
);

CREATE TABLE public.queue_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  video_id TEXT NOT NULL,
  title TEXT NOT NULL,
  thumbnail TEXT,
  channel TEXT,
  added_by_name TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_queue_room ON public.queue_items(room_id, position, created_at);
CREATE INDEX idx_members_room ON public.room_members(room_id, joined_at);

-- Capacity trigger: max 6 members
CREATE OR REPLACE FUNCTION public.enforce_room_capacity()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF (SELECT COUNT(*) FROM public.room_members WHERE room_id = NEW.room_id) >= 6 THEN
    RAISE EXCEPTION 'Room is full (max 6 members)';
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER trg_room_capacity
BEFORE INSERT ON public.room_members
FOR EACH ROW EXECUTE FUNCTION public.enforce_room_capacity();

-- Owner handoff: when owner leaves, transfer to next oldest; if empty, delete room
CREATE OR REPLACE FUNCTION public.handle_member_leave()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  new_owner UUID;
BEGIN
  IF EXISTS (SELECT 1 FROM public.rooms WHERE id = OLD.room_id AND owner_id = OLD.user_id) THEN
    SELECT user_id INTO new_owner
    FROM public.room_members
    WHERE room_id = OLD.room_id
    ORDER BY joined_at ASC
    LIMIT 1;
    IF new_owner IS NULL THEN
      DELETE FROM public.rooms WHERE id = OLD.room_id;
    ELSE
      UPDATE public.rooms SET owner_id = new_owner WHERE id = OLD.room_id;
    END IF;
  END IF;
  RETURN OLD;
END; $$;

CREATE TRIGGER trg_member_leave
AFTER DELETE ON public.room_members
FOR EACH ROW EXECUTE FUNCTION public.handle_member_leave();

-- RLS: open since no auth (app validates owner client-side and via realtime)
ALTER TABLE public.rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.room_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.queue_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rooms_all" ON public.rooms FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "members_all" ON public.room_members FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "queue_all" ON public.queue_items FOR ALL USING (true) WITH CHECK (true);

-- Realtime
ALTER TABLE public.rooms REPLICA IDENTITY FULL;
ALTER TABLE public.room_members REPLICA IDENTITY FULL;
ALTER TABLE public.queue_items REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.rooms;
ALTER PUBLICATION supabase_realtime ADD TABLE public.room_members;
ALTER PUBLICATION supabase_realtime ADD TABLE public.queue_items;
