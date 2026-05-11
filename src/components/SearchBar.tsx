import { useEffect, useRef, useState } from "react";
import { Search, X, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export interface SearchResult {
  videoId: string;
  title: string;
  channel: string;
  thumbnail: string;
}

interface Props {
  onAdd: (item: SearchResult) => void;
}

export const SearchBar = ({ onAdd }: Props) => {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    if (timer.current) window.clearTimeout(timer.current);
    const term = q.trim();
    if (!term) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    timer.current = window.setTimeout(async () => {
      try {
        const res = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/youtube-search?q=${encodeURIComponent(term)}`,
          { headers: { apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY } }
        );
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "Search failed");
        setResults(json.items || []);
      } catch (e: any) {
        toast.error(e.message || "Search failed");
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 450);
    return () => { if (timer.current) window.clearTimeout(timer.current); };
  }, [q]);

  const clear = () => { setQ(""); setResults([]); };

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search YouTube..."
          className="pl-9 pr-10"
        />
        {loading && (
          <Loader2 className="absolute right-9 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-muted-foreground" />
        )}
        {q && (
          <Button
            size="icon"
            variant="ghost"
            className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7"
            onClick={clear}
          >
            <X className="w-4 h-4" />
          </Button>
        )}
      </div>

      {results.length > 0 && (
        <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
          {results.map((r) => (
            <button
              key={r.videoId}
              onClick={() => onAdd(r)}
              className="w-full flex gap-3 p-2 rounded-lg hover:bg-secondary/60 text-left transition"
            >
              <img src={r.thumbnail} alt="" className="w-24 h-14 object-cover rounded flex-shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium line-clamp-2">{r.title}</p>
                <p className="text-xs text-muted-foreground truncate">{r.channel}</p>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
