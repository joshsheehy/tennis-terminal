import { describe, expect, it } from 'vitest';
import { displayName, nameBuckets, nameParts, samePlayer } from './player-name';

describe('samePlayer', () => {
  it('matches the published "Last, First" against our "First Last"', () => {
    expect(samePlayer('Royer, Valentin', 'Valentin Royer')).toBe(true);
  });

  it('tolerates a middle name on one side only', () => {
    // The list prints "Gómez, Federico"; our data holds his full name.
    expect(samePlayer('Gómez, Federico', 'Federico Agustin Gomez')).toBe(true);
  });

  it('handles a compound surname, where taking the last word would fail', () => {
    expect(samePlayer('Prado Angelo, Juan Carlos', 'Juan Carlos Prado Angelo')).toBe(true);
  });

  it('ignores accents and punctuation', () => {
    expect(samePlayer('Martínez, Pedro', 'Pedro Martinez')).toBe(true);
    expect(samePlayer("Christopher O'Connell", 'OConnell, Christopher')).toBe(true);
  });

  it('does not match two players who only share a surname', () => {
    expect(samePlayer('Gomez, Federico', 'Gomez, Alejandro')).toBe(false);
    expect(samePlayer('Federico Gomez', 'Alejandro Gomez')).toBe(false);
  });

  it('does not match on a first name alone', () => {
    expect(samePlayer('Juan Martin Del Potro', 'Juan Manuel Cerundolo')).toBe(false);
  });

  it('rejects an empty name rather than matching everything', () => {
    expect(samePlayer('', 'Valentin Royer')).toBe(false);
    expect(samePlayer('   ', '')).toBe(false);
  });

  it('matches a single-word name only against itself', () => {
    expect(samePlayer('Nadal', 'Nadal')).toBe(true);
    expect(samePlayer('Nadal', 'Rafael Nadal')).toBe(false);
  });
});

describe('nameParts', () => {
  it('splits on punctuation and drops accents', () => {
    expect(nameParts('Gómez, Federico')).toEqual(['gomez', 'federico']);
  });
});

describe('nameBuckets', () => {
  it('shares a bucket between the two spellings of one player', () => {
    const left = nameBuckets('Gómez, Federico');
    const right = nameBuckets('Federico Agustin Gomez');
    expect(left.some((bucket) => right.includes(bucket))).toBe(true);
  });

  it('leaves out parts too short to narrow anything', () => {
    expect(nameBuckets('Wu, Yibing')).toEqual(['yibing']);
  });
});

describe('displayName', () => {
  it('puts the given name first', () => {
    expect(displayName('Gómez, Federico')).toBe('Federico Gómez');
    expect(displayName('Prado Angelo, Juan Carlos')).toBe('Juan Carlos Prado Angelo');
  });

  it('leaves an already-ordered name alone', () => {
    expect(displayName('Valentin Royer')).toBe('Valentin Royer');
  });

  it('leaves a malformed comma form alone rather than mangling it', () => {
    expect(displayName('Royer,')).toBe('Royer,');
    expect(displayName(', Valentin')).toBe(', Valentin');
  });
});
