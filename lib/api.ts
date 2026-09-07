import type { LobbyRoom } from "@/lib/rooms";

export const API_BASE =
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/+$/, "") ??
  "https://bestaudiobackend.mahmoudnabil03.workers.dev";

interface ApiRoomRow {
  id: string;
  slug: string;
  title: string;
  description: string;
  host_name: string;
  category: string;
  listener_count: number;
  speaker_count: number;
  cover_color: string;
}

function toLobbyRoom(row: ApiRoomRow): LobbyRoom {
  const category =
    row.category === "Chill" || row.category === "Music" || row.category === "Community"
      ? row.category
      : "Chat";
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    description: row.description,
    hostName: row.host_name,
    category,
    listenerCount: row.listener_count,
    speakerCount: row.speaker_count,
    coverColor: row.cover_color,
  };
}

export async function fetchRooms(): Promise<LobbyRoom[]> {
  const res = await fetch(`${API_BASE}/api/rooms`, { cache: "no-store" });
  if (!res.ok) throw new Error(`rooms request failed: ${res.status}`);
  const data = (await res.json()) as { ok: boolean; rooms?: ApiRoomRow[] };
  if (!data.ok || !Array.isArray(data.rooms)) throw new Error("bad rooms payload");
  return data.rooms.map(toLobbyRoom);
}
