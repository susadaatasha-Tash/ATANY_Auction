import { describe, test, expect } from 'vitest';

function validateReview({ rating, comment }) {
  if (rating < 1 || rating > 5) throw new Error('rating 1-5');
  if (comment && comment.length > 500) throw new Error('too long');
  return true;
}

describe('product_reviews validation (beyond spec)', () => {
  test('accepts 1-5', () => expect(validateReview({ rating: 5, comment: 'Beautiful' })).toBe(true));
  test('rejects 6', () => expect(() => validateReview({ rating: 6 })).toThrow());
  test('rejects >500 chars', () => expect(() => validateReview({ rating: 4, comment: 'a'.repeat(501) })).toThrow());
});
