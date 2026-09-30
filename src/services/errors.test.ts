import { describe, it, expect, vi } from 'vitest';
import { AppError, UnauthorizedError, NotFoundError, ValidationError } from '@/services/errors';

describe('AppError Taxonomy Refactor', () => {
  // --- AppError Base Class Tests ---
  describe('AppError Base Class', () => {
    it('should extend Error and have status and code properties', () => {
      const error = new AppError('Test message', 500);
      expect(error instanceof Error).toBe(true);
      expect(error).toHaveProperty('code');
      expect(error).toHaveProperty('status');
      expect(error.status).toBe(500);
      expect(typeof error.code).toBe('string');
    });
    
    it('should derive code correctly from subclass name (TestError)', () => {
      class TestError extends AppError {
        constructor(message = "Test") {
          super(message, 500);
        }
      }
      const error = new TestError();
      expect(error.code).toBe('TEST');
    });
  });

  // --- UnauthorizedError Tests ---
  describe('UnauthorizedError', () => {
    it('should correctly default status and code', () => {
      const err = new UnauthorizedError();
      expect(err.status).toBe(401);
      expect(err.code).toBe('UNAUTHORIZED');
      expect(err.message).toBe("Unauthorized");
    });

    it('should accept custom message and maintain status/code', () => {
      const message = "Session expired";
      const err = new UnauthorizedError(message);
      expect(err.status).toBe(401);
      expect(err.code).toBe('UNAUTHORIZED');
      expect(err.message).toBe(message);
    });

    it('should be an instance of AppError', () => {
      const err = new UnauthorizedError();
      expect(err instanceof AppError).toBe(true);
    });
  });

  // --- NotFoundError Tests ---
  describe('NotFoundError', () => {
    it('should correctly default status and code', () => {
      const err = new NotFoundError();
      expect(err.status).toBe(404);
      expect(err.code).toBe('NOT_FOUND');
      expect(err.message).toBe("Not found");
    });

    it('should accept custom message and maintain status/code', () => {
      const message = "Resource ID 123 does not exist";
      const err = new NotFoundError(message);
      expect(err.status).toBe(404);
      expect(err.code).toBe('NOT_FOUND');
      expect(err.message).toBe(message);
    });

    it('should be an instance of AppError', () => {
      const err = new NotFoundError();
      expect(err instanceof AppError).toBe(true);
    });
  });

  // --- ValidationError Tests ---
  describe('ValidationError', () => {
    it('should correctly default status and code', () => {
      const err = new ValidationError();
      expect(err.status).toBe(400);
      expect(err.code).toBe('VALIDATION');
      expect(err.message).toBe("Validation failed");
      expect(err.issues).toEqual([]);
    });

    it('should accept custom message and maintain status/code', () => {
      const message = "A field failed validation";
      const err = new ValidationError(message);
      expect(err.status).toBe(400);
      expect(err.code).toBe('VALIDATION');
      expect(err.message).toBe(message);
      expect(err.issues).toEqual([]);
    });

    it('should correctly initialize and manage the issues array when passed', () => {
      const issues = [{ field: 'email', message: 'Invalid format' }, { field: 'password', message: 'Too short' }];
      const err = new ValidationError("Multiple issues found", issues);
      expect(err.issues).toEqual(issues);
    });
    
    it('should be an instance of AppError', () => {
      const err = new ValidationError();
      expect(err instanceof AppError).toBe(true);
    });
  });
});