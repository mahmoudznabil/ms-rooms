export type RoomCategory = "Chill" | "Music" | "Community" | "Chat";

export interface LobbyRoom {
  id: string;
  slug: string;
  title: string;
  description: string;
  hostName: string;
  category: RoomCategory;
  listenerCount: number;
  speakerCount: number;
  coverColor: string;
}

export interface ChatMessage {
  id: string;
  user: string;
  text: string;
  createdAt: number;
  kind: "chat" | "gift" | "system";
}

export interface GiftItem {
  id: string;
  name: string;
  emoji: string;
  cost: number;
}

export const MOCK_ROOMS: LobbyRoom[] = [
  {
    id: "room-late-check-in",
    slug: "late-check-in",
    title: "Late Check-In",
    description: "A soft place to land after a long day.",
    hostName: "Maya Rose",
    category: "Chill",
    listenerCount: 1842,
    speakerCount: 5,
    coverColor: "#5e6579",
  },
  {
    id: "room-behind-the-beat",
    slug: "behind-the-beat",
    title: "Behind the Beat",
    description: "Unreleased loops, honest opinions, zero skips.",
    hostName: "Omar Sound",
    category: "Music",
    listenerCount: 936,
    speakerCount: 4,
    coverColor: "#7c5948",
  },
  {
    id: "room-tiny-joys",
    slug: "tiny-joys",
    title: "Tiny Joys Club",
    description: "Share the small things keeping you going.",
    hostName: "Jules After Dark",
    category: "Community",
    listenerCount: 428,
    speakerCount: 3,
    coverColor: "#526d64",
  },
];

export const MOCK_LISTENERS: string[] = [
  "Nova",
  "Kiki",
  "Rami",
  "Sofia",
  "Dev",
  "Lena",
  "Marco",
  "Priya",
  "Theo",
  "Aisha",
  "Jon",
  "Elif",
];

export const GIFT_CATALOG: GiftItem[] = [
  { id: "rose", name: "Rose", emoji: "🌹", cost: 10 },
  { id: "coffee", name: "Coffee", emoji: "☕", cost: 25 },
  { id: "mic", name: "Golden Mic", emoji: "🎙️", cost: 100 },
  { id: "rocket", name: "Rocket", emoji: "🚀", cost: 250 },
];

export const DAILY_REWARD_AMOUNT = 100;

export function formatCount(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return `${n}`;
}
