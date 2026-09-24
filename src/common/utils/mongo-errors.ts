const DUPLICATE_KEY_ERROR_CODE = 11000;

export const isDuplicateKeyError = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && 'code' in error && (error as { code?: number }).code === DUPLICATE_KEY_ERROR_CODE;

/**
 * True if a bulkWrite failed ONLY because some rows already existed
 * (e.g. two requests upserting the same new document at the same moment).
 */
export const isOnlyDuplicateKeyErrors = (error: unknown): boolean => {
  if (isDuplicateKeyError(error)) return true;
  const writeErrors = (error as { writeErrors?: Array<{ code?: number }> } | null)?.writeErrors;
  return Array.isArray(writeErrors) && writeErrors.length > 0 && writeErrors.every((writeError) => writeError.code === DUPLICATE_KEY_ERROR_CODE);
};
