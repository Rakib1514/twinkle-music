
-- Add votes count to queue_items
ALTER TABLE public.queue_items ADD COLUMN votes INTEGER DEFAULT 0;

-- Track individual votes to prevent duplicates
CREATE TABLE public.queue_item_votes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  queue_item_id UUID NOT NULL REFERENCES public.queue_items(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  vote_type INTEGER NOT NULL, -- 1 for upvote, -1 for downvote
  UNIQUE(queue_item_id, user_id)
);

-- Trigger to update votes count automatically
CREATE OR REPLACE FUNCTION update_queue_item_votes()
RETURNS TRIGGER AS $$
BEGIN
  IF (TG_OP = 'INSERT') THEN
    UPDATE public.queue_items 
    SET votes = votes + NEW.vote_type
    WHERE id = NEW.queue_item_id;
  ELSIF (TG_OP = 'DELETE') THEN
    UPDATE public.queue_items 
    SET votes = votes - OLD.vote_type
    WHERE id = OLD.queue_item_id;
  ELSIF (TG_OP = 'UPDATE') THEN
    UPDATE public.queue_items 
    SET votes = votes - OLD.vote_type + NEW.vote_type
    WHERE id = NEW.queue_item_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_update_votes
AFTER INSERT OR UPDATE OR DELETE ON public.queue_item_votes
FOR EACH ROW EXECUTE FUNCTION update_queue_item_votes();

-- Enable RLS and add policy
ALTER TABLE public.queue_item_votes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "votes_all" ON public.queue_item_votes FOR ALL USING (true) WITH CHECK (true);

-- Add to realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.queue_item_votes;
