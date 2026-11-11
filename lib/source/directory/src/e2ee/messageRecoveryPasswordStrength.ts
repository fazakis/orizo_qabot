import { ZxcvbnFactory } from '@zxcvbn-ts/core';
import * as common from '@zxcvbn-ts/language-common';
import { randomBytes } from '@noble/hashes/utils.js';

const estimator = new ZxcvbnFactory({ ...common });
const dicewareWords = common.dictionary['diceware-common'];

const feedbackFor = (warning: string | null, suggestions: string[]) => {
  if (warning === 'userInputs') return 'Avoid your name, username, email, or Orizo.';
  if (['topTen', 'topHundred', 'common', 'similarToCommon', 'wordByItself'].includes(String(warning))) {
    return 'This password is too common. Add several unrelated words.';
  }
  if (warning === 'sequences' || suggestions.includes('sequences')) {
    return 'Avoid keyboard, alphabet, number, and year sequences.';
  }
  if (warning === 'simpleRepeat' || warning === 'extendedRepeat' || suggestions.includes('repeated')) {
    return 'Avoid repeated characters, words, or patterns.';
  }
  if (warning === 'dates') return 'Avoid dates and years that others could guess.';
  return 'Add another unrelated word or make the password less predictable.';
};

export const assessRecoveryPasswordWithDictionary = (
  password: string,
  personalInputs: string[],
) => {
  const result = estimator.check(password, personalInputs);
  return {
    score: Number(result.score),
    guesses: Number(result.guesses),
    feedback: feedbackFor(
      result.feedback.warning ? String(result.feedback.warning) : null,
      result.feedback.suggestions.map(String),
    ),
  };
};

const unbiasedRandomIndex = (upperBound: number) => {
  if (!Number.isSafeInteger(upperBound) || upperBound <= 0 || upperBound > 0x1_0000_0000) {
    throw new Error('Recovery password dictionary is invalid.');
  }
  const range = 0x1_0000_0000;
  const limit = range - (range % upperBound);
  while (true) {
    const bytes = randomBytes(4);
    const value = (
      bytes[0] * 0x1000000
      + bytes[1] * 0x10000
      + bytes[2] * 0x100
      + bytes[3]
    );
    bytes.fill(0);
    if (value < limit) return value % upperBound;
  }
};

export const generateFiveWordRecoveryPassword = () => {
  if (dicewareWords.length !== 7776) throw new Error('Recovery password dictionary is unavailable.');
  const selected = new Set<number>();
  while (selected.size < 5) selected.add(unbiasedRandomIndex(dicewareWords.length));
  return Array.from(selected, (index) => dicewareWords[index]).join(' ');
};
