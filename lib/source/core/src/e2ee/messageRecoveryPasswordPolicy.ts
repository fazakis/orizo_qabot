export const RECOVERY_PASSWORD_MIN_LENGTH = 8;
export const RECOVERY_PASSWORD_MAX_LENGTH = 256;
export const RECOVERY_PASSWORD_MIN_GUESSES = 1_000_000_000_000;

export type RecoveryPasswordAssessment = {
  normalizedPassword: string;
  score: number;
  guesses: number;
  strong: boolean;
  feedback: string;
};

type RecoveryPasswordProfile = {
  username?: string | null;
  email?: string | null;
  firstName?: string | null;
  lastName?: string | null;
};

const codePointLength = (value: string) => Array.from(value).length;

/**
 * Stable normalization used for both creating and unlocking recovery
 * credentials. It deliberately does not enforce the current setup policy:
 * existing vaults must remain unlockable after a future policy change.
 */
export const normalizeRecoveryPassphrase = (value: string) => {
  if (typeof value !== 'string') throw new Error('Recovery password is invalid.');
  const normalized = value.normalize('NFKC');
  const length = codePointLength(normalized);
  if (length === 0 || length > RECOVERY_PASSWORD_MAX_LENGTH) {
    throw new Error('Recovery password is invalid.');
  }
  return normalized;
};

/** Bounds for a newly created or changed recovery password. */
export const validateNewRecoveryPassphraseBounds = (value: string) => {
  if (typeof value !== 'string') throw new Error('Recovery password is invalid.');
  const normalized = value.normalize('NFKC');
  const length = codePointLength(normalized);
  if (length < RECOVERY_PASSWORD_MIN_LENGTH) {
    throw new Error(`Use at least ${RECOVERY_PASSWORD_MIN_LENGTH} characters for your recovery password.`);
  }
  if (length > RECOVERY_PASSWORD_MAX_LENGTH) {
    throw new Error(`Use no more than ${RECOVERY_PASSWORD_MAX_LENGTH} characters for your recovery password.`);
  }
  return normalized;
};

export const recoveryPasswordPersonalInputs = (profile: RecoveryPasswordProfile = {}) => {
  const email = String(profile.email || '').trim();
  const firstName = String(profile.firstName || '').trim();
  const lastName = String(profile.lastName || '').trim();
  const candidates = [
    'Orizo',
    profile.username,
    email,
    email.split('@')[0],
    firstName,
    lastName,
    `${firstName} ${lastName}`.trim(),
    `${firstName}${lastName}`.trim(),
  ];
  const seen = new Set<string>();
  return candidates
    .map((value) => String(value || '').trim())
    .filter((value) => {
      const key = value.toLocaleLowerCase();
      if (value.length < 2 || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
};

const boundsAssessment = (password: string, error: unknown): RecoveryPasswordAssessment => ({
  normalizedPassword: typeof password === 'string' ? password.normalize('NFKC') : '',
  score: 0,
  guesses: 0,
  strong: false,
  feedback: error instanceof Error ? error.message : 'Recovery password is invalid.',
});

/** Loads the sizeable dictionary only when a new-password editor needs it. */
export const assessRecoveryPassword = async (
  password: string,
  personalInputs: string[] = [],
): Promise<RecoveryPasswordAssessment> => {
  let normalizedPassword: string;
  try {
    normalizedPassword = validateNewRecoveryPassphraseBounds(password);
  } catch (error) {
    return boundsAssessment(password, error);
  }
  const { assessRecoveryPasswordWithDictionary } = await import('./messageRecoveryPasswordStrength');
  const result = assessRecoveryPasswordWithDictionary(normalizedPassword, personalInputs);
  const strong = result.score === 4 && result.guesses >= RECOVERY_PASSWORD_MIN_GUESSES;
  return {
    normalizedPassword,
    score: result.score,
    guesses: result.guesses,
    strong,
    feedback: strong ? 'Strong chat password.' : result.feedback,
  };
};

export const assertStrongRecoveryPassword = async (
  password: string,
  personalInputs: string[] = [],
) => {
  const assessment = await assessRecoveryPassword(password, personalInputs);
  if (!assessment.strong) throw new Error(assessment.feedback || 'Choose a stronger chat password.');
  return assessment.normalizedPassword;
};

export const generateSuggestedRecoveryPassword = async () => {
  const { generateFiveWordRecoveryPassword } = await import('./messageRecoveryPasswordStrength');
  // Every five-word suggestion has ~64.6 bits before zxcvbn's conservative
  // pattern analysis. Still verify the actual phrase before offering it.
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const password = generateFiveWordRecoveryPassword();
    const assessment = await assessRecoveryPassword(password, ['Orizo']);
    if (assessment.strong) return password;
  }
  throw new Error('Could not generate a strong password. Try again.');
};
