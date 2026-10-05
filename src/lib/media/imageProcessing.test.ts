import { describe, expect, it } from 'vitest'
import { fitWithin, qualitySteps } from './imageProcessing'

describe('fitWithin', () => {
  it('skaliert Kamerafotos auf 1600 px lange Kante', () => {
    expect(fitWithin(4032, 3024, 1600)).toEqual({ width: 1600, height: 1200 })
    expect(fitWithin(3024, 4032, 1600)).toEqual({ width: 1200, height: 1600 })
  })
  it('erzeugt Thumbnails mit 320 px', () => {
    expect(fitWithin(4000, 2250, 320)).toEqual({ width: 320, height: 180 })
  })
  it('vergrößert kleine Bilder nicht', () => {
    expect(fitWithin(800, 600, 1600)).toEqual({ width: 800, height: 600 })
  })
  it('liefert mindestens 1 px', () => {
    expect(fitWithin(10000, 2, 320)).toEqual({ width: 320, height: 1 })
  })
})

describe('qualitySteps', () => {
  it('senkt die Qualität in 0,1er-Schritten bis zum Minimum', () => {
    expect(qualitySteps(0.75, 0.5)).toEqual([0.75, 0.65, 0.55])
    expect(qualitySteps(0.7, 0.45)).toEqual([0.7, 0.6, 0.5])
  })
})
