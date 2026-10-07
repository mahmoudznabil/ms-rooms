export type RoomCategory = "Chill" | "Music" | "Community" | "Karaoke" | "Games" | "Chat";

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
