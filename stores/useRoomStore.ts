"use client";

import { create } from "zustand";
import type { ChatMessage } from "@/lib/rooms";

export interface SeatOccupant {
  id: string;
  name: string;
  role: "host" | "speaker";
  muted: boolean;
  color: string;
}

type Seat = SeatOccupant | null;

interface RoomState {
  activeRoomSlug: string;
  seats: Seat[];
  listeners: string[];
  messages: ChatMessage[];
  micOn: boolean;
  setActiveRoom: (slug: string) => void;
  takeSeat: (index: number) => void;
  leaveSeat: (index: number) => void;
  toggleMute: (index: number) => void;
  toggleMic: () => void;
  sendMessage: (user: string, text: string) => void;
  pushSystemMessage: (text: string) => void;
  pushGiftMessage: (user: string, text: string) => void;
  resetDemoRoom: () => void;
}

const SEAT_COLORS = [
  "#e8b4b8",
  "#a8d5ba",
  "#a8c8ec",
  "#e8d5a8",
  "#c8b4e8",
  "#b4e0e8",
  "#e8c8a8",
  "#b8e8c8",
];

function makeId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

const initialSeats: Seat[] = [
  { id: "user-maya", name: "Maya", role: "host", muted: false, color: SEAT_COLORS[0] },
  { id: "user-omar", name: "Omar", role: "speaker", muted: false, color: SEAT_COLORS[1] },
  { id: "user-jules", name: "Jules", role: "speaker", muted: true, color: SEAT_COLORS[2] },
  null,
  null,
  null,
  null,
  null,
];

const initialMessages: ChatMessage[] = [
  { id: "m1", user: "System", text: "Welcome to the room. Be kind, stay on mic etiquette.", createdAt: Date.now() - 1000 * 60 * 6, kind: "system" },
  { id: "m2", user: "Maya", text: "Night owls check in — how are we feeling?", createdAt: Date.now() - 1000 * 60 * 4, kind: "chat" },
  { id: "m3", user: "Omar", text: "Playing a new loop in a minute, tell me if it slaps", createdAt: Date.now() - 1000 * 60 * 2, kind: "chat" },
];

export const useRoomStore = create<RoomState>((set) => ({
  activeRoomSlug: "late-check-in",
  seats: initialSeats,
  listeners: ["Nova", "Kiki", "Rami", "Sofia", "Dev", "Lena", "Marco", "Priya", "Theo", "Aisha", "Jon", "Elif"],
  messages: initialMessages,
  micOn: false,
  setActiveRoom: (slug) => set({ activeRoomSlug: slug }),
  takeSeat: (index) =>
    set((s) => {
      if (index < 0 || index > 7 || s.seats[index]) return s;
      const next = [...s.seats];
      next[index] = {
        id: "user-you",
        name: "You",
        role: index === 0 ? "host" : "speaker",
        muted: false,
        color: SEAT_COLORS[index % SEAT_COLORS.length],
      };
      return {
        seats: next,
        messages: [
          ...s.messages,
          { id: makeId("m"), user: "System", text: `You took seat ${index + 1}.`, createdAt: Date.now(), kind: "system" },
        ],
      };
    }),
  leaveSeat: (index) =>
    set((s) => {
      if (index < 0 || index > 7 || !s.seats[index]) return s;
      const next = [...s.seats];
      next[index] = null;
      return {
        seats: next,
        messages: [
          ...s.messages,
          { id: makeId("m"), user: "System", text: `Seat ${index + 1} is now open.`, createdAt: Date.now(), kind: "system" },
        ],
      };
    }),
  toggleMute: (index) =>
    set((s) => {
      const next = [...s.seats];
      const seat = next[index];
      if (!seat) return s;
      next[index] = { ...seat, muted: !seat.muted };
      return { seats: next };
    }),
  toggleMic: () => set((s) => ({ micOn: !s.micOn })),
  sendMessage: (user, text) =>
    set((s) => ({
      messages: [...s.messages, { id: makeId("m"), user, text, createdAt: Date.now(), kind: "chat" }],
    })),
  pushSystemMessage: (text) =>
    set((s) => ({
      messages: [...s.messages, { id: makeId("m"), user: "System", text, createdAt: Date.now(), kind: "system" }],
    })),
  pushGiftMessage: (user, text) =>
    set((s) => ({
      messages: [...s.messages, { id: makeId("m"), user, text, createdAt: Date.now(), kind: "gift" }],
    })),
  resetDemoRoom: () =>
    set({ seats: initialSeats, messages: initialMessages, micOn: false }),
}));
