export interface Note {
  pitch: number     // MIDI 21..108
  start: number     // seconds
  duration: number  // seconds
  velocity: number  // 1..127
  hand?: 0 | 1      // 0 = right hand (upper staff), 1 = left hand; unknown for recordings
  hold?: number     // seconds the sound lasts when the pedal keeps it on after the key is let go (the falling note shows `duration`, the key)
}

/** When the sound of a note is let go: the end of the key, or later under the pedal. */
export const soundEnd = (n: Note) => n.start + Math.max(n.duration, n.hold ?? 0)

export const end = (n: Note) => n.start + n.duration

/** Which hand plays this note; without information, middle C and above is the right hand. */
export const handOf = (n: Pick<Note, 'pitch' | 'hand'>): 0 | 1 => n.hand ?? (n.pitch >= 60 ? 0 : 1)
