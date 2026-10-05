import { describe, expect, it } from 'vitest'
import { filterPresets } from './fonts'

describe('searching the instruments of a SoundFont', () => {
  const names = ['Acoustic Grand Piano', 'Bright Acoustic Piano', 'Electric Guitar (jazz)', 'Violin', 'Piano pad (ngân hàng 8)']
  it('keeps every instrument for an empty search', () => {
    expect(filterPresets(names, '')).toEqual([0, 1, 2, 3, 4])
    expect(filterPresets(names, '   ')).toEqual([0, 1, 2, 3, 4])
  })
  it('matches words in any order, ignoring case and accents', () => {
    expect(filterPresets(names, 'piano')).toEqual([0, 1, 4])
    expect(filterPresets(names, 'PIANO acoustic')).toEqual([0, 1])
    expect(filterPresets(names, 'ngan hang')).toEqual([4])
  })
  it('finds nothing when no name holds all the words', () => {
    expect(filterPresets(names, 'piano guitar')).toEqual([])
  })
})
