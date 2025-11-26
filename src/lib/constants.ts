// src/lib/constants.ts

export const APP_NAME = "Circles";

export const CATEGORIES = ["All", "Games", "Study", "Outdoors"] as const;

export const GAME_LIST = [
  { id: "hokm",   name: "Hokm",        blurb: "Classic Persian card game",      tag: "Games",    online: 120, groups: 8,  image: "🎴" },
  { id: "takhtenard",   name: "Takhte Nard", blurb: "Traditional backgammon",         tag: "Games",    online: 95,  groups: 6,  image: "🎲" },
  { id: "mafia",  name: "Mafia",       blurb: "Social deduction party game",     tag: "Games",    online: 210, groups: 12, image: "🕵️" },
  { id: "mono",   name: "Monopoly",    blurb: "Buy, sell, and trade properties", tag: "Games",    online: 180, groups: 10, image: "💰" },
  { id: "uno",    name: "Uno",         blurb: "Colorful card matching fun",      tag: "Games",    online: 250, groups: 15, image: "🃏" },
  { id: "chess",  name: "Chess",       blurb: "Classic strategy board game",     tag: "Games",    online: 130, groups: 9,  image: "♟️" },
  { id: "mathematics",   name: "Mathematics", blurb: "Study numbers", tag: "Study",   online: 75,  groups: 5,  image: "📐" },
  { id: "biology",    name: "Biology",     blurb: "Explore life sciences",             tag: "Study",   online: 60,  groups: 4,  image: "🧬" },
  { id: "chemistry",   name: "Chemistry",   blurb: "Chemicals and reactions", tag: "Study",  online: 50,  groups: 3,  image: "⚗️" },
  { id: "history",   name: "History",     blurb: "Past events and cultures",  tag: "Study",  online: 45,  groups: 3,  image: "📜" },
  { id: "hiking",  name: "Hiking", blurb: "Join a hike up the mountain", tag: "Outdoors", online: 40, groups: 3,  image: "⛰️" },
  { id: "visit",   name: "Visiting",    blurb: "Cultural and city visits",            tag: "Outdoors", online: 55, groups: 4,  image: "🏛️" },
  { id: "camp",    name: "Camping",     blurb: "Overnight outdoor trips",     tag: "Outdoors", online: 35, groups: 2,  image: "🏕️" },
  { id: "kayak",   name: "Kayaking",    blurb: "Water adventures", tag: "Outdoors", online: 30, groups: 2, image: "🛶" },
];