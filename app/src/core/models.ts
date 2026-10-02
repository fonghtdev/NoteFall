export interface Note {
  pitch: number     // MIDI 21..108
  start: number     // seconds
  duration: number  // seconds
  velocity: number  // 1..127
  hand?: 0 | 1      // 0 = right hand (upper staff), 1 = left hand; unknown for recordings
}

export const end = (n: Note) => n.start + n.duration

/** Which hand plays this note; without information, middle C and above is the right hand. */
export const handOf = (n: Pick<Note, 'pitch' | 'hand'>): 0 | 1 => n.hand ?? (n.pitch >= 60 ? 0 : 1)
