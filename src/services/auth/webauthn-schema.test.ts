import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { ValidationError } from "@/services/errors";
import { parseOrThrow } from "@/lib/validation";
import {
  authenticationResponseSchema,
  registrationResponseSchema,
} from "./webauthn-schema";

/**
 * Shape-only validation for the WebAuthn response envelope (ticket 14) —
 * this never re-checks what @simplewebauthn/server itself verifies
 * (signature, challenge, origin/RP-ID). A structurally valid envelope here
 * may still fail that cryptographic verification, and that's fine; the
 * point is only to reject garbage before it reaches the library.
 */

const validRegistrationEnvelope = {
  id: "AQIDBA",
  rawId: "AQIDBA",
  response: {
    clientDataJSON: "eyJ0eXBlIjoid2ViYXV0aG4uY3JlYXRlIn0",
    attestationObject: "o2NmbXRkbm9uZQ",
  },
  clientExtensionResults: {},
  type: "public-key",
};

const validAuthenticationEnvelope = {
  id: "AQIDBA",
  rawId: "AQIDBA",
  response: {
    clientDataJSON: "eyJ0eXBlIjoid2ViYXV0aG4uZ2V0In0",
    authenticatorData: "kZ7hI7BJmYXVWDF71-",
    signature: "MEUCIQ",
  },
  clientExtensionResults: {},
  type: "public-key",
};

describe("registrationResponseSchema", () => {
  it("passes a structurally valid registration envelope through unchanged", () => {
    expect(parseOrThrow(registrationResponseSchema, validRegistrationEnvelope)).toEqual(
      validRegistrationEnvelope,
    );
  });

  it("rejects a missing id", () => {
    const { id: _id, ...rest } = validRegistrationEnvelope;
    let caught: ValidationError | undefined;
    try {
      parseOrThrow(registrationResponseSchema, rest);
    } catch (err) {
      caught = err as ValidationError;
    }
    expect(caught).toBeInstanceOf(ValidationError);
    expect(caught?.issues.map((i) => i.field)).toContain("id");
  });

  it("rejects a missing rawId", () => {
    const { rawId: _rawId, ...rest } = validRegistrationEnvelope;
    let caught: ValidationError | undefined;
    try {
      parseOrThrow(registrationResponseSchema, rest);
    } catch (err) {
      caught = err as ValidationError;
    }
    expect(caught).toBeInstanceOf(ValidationError);
    expect(caught?.issues.map((i) => i.field)).toContain("rawId");
  });

  it("rejects a wrong type literal", () => {
    const body = { ...validRegistrationEnvelope, type: "not-public-key" };
    let caught: ValidationError | undefined;
    try {
      parseOrThrow(registrationResponseSchema, body);
    } catch (err) {
      caught = err as ValidationError;
    }
    expect(caught).toBeInstanceOf(ValidationError);
    expect(caught?.issues.map((i) => i.field)).toContain("type");
  });

  it("rejects a missing nested response object", () => {
    const { response: _response, ...rest } = validRegistrationEnvelope;
    let caught: ValidationError | undefined;
    try {
      parseOrThrow(registrationResponseSchema, rest);
    } catch (err) {
      caught = err as ValidationError;
    }
    expect(caught).toBeInstanceOf(ValidationError);
    expect(caught?.issues.map((i) => i.field)).toContain("response");
  });

  it("rejects a response missing attestationObject", () => {
    const body = {
      ...validRegistrationEnvelope,
      response: { clientDataJSON: validRegistrationEnvelope.response.clientDataJSON },
    };
    let caught: ValidationError | undefined;
    try {
      parseOrThrow(registrationResponseSchema, body);
    } catch (err) {
      caught = err as ValidationError;
    }
    expect(caught).toBeInstanceOf(ValidationError);
    expect(caught?.issues.map((i) => i.field)).toContain("response.attestationObject");
  });

  it("rejects an id that isn't base64url", () => {
    const body = { ...validRegistrationEnvelope, id: "not base64url!!" };
    expect(() => parseOrThrow(registrationResponseSchema, body)).toThrow(ValidationError);
  });

  it("rejects a non-object body", () => {
    expect(() => parseOrThrow(registrationResponseSchema, "nope")).toThrow(ValidationError);
    expect(() => parseOrThrow(registrationResponseSchema, null)).toThrow(ValidationError);
    expect(() => parseOrThrow(registrationResponseSchema, undefined)).toThrow(ValidationError);
  });
});

describe("authenticationResponseSchema", () => {
  it("passes a structurally valid authentication envelope through unchanged", () => {
    expect(parseOrThrow(authenticationResponseSchema, validAuthenticationEnvelope)).toEqual(
      validAuthenticationEnvelope,
    );
  });

  it("rejects a missing id", () => {
    const { id: _id, ...rest } = validAuthenticationEnvelope;
    let caught: ValidationError | undefined;
    try {
      parseOrThrow(authenticationResponseSchema, rest);
    } catch (err) {
      caught = err as ValidationError;
    }
    expect(caught).toBeInstanceOf(ValidationError);
    expect(caught?.issues.map((i) => i.field)).toContain("id");
  });

  it("rejects a missing rawId", () => {
    const { rawId: _rawId, ...rest } = validAuthenticationEnvelope;
    let caught: ValidationError | undefined;
    try {
      parseOrThrow(authenticationResponseSchema, rest);
    } catch (err) {
      caught = err as ValidationError;
    }
    expect(caught).toBeInstanceOf(ValidationError);
    expect(caught?.issues.map((i) => i.field)).toContain("rawId");
  });

  it("rejects a wrong type literal", () => {
    const body = { ...validAuthenticationEnvelope, type: "not-public-key" };
    let caught: ValidationError | undefined;
    try {
      parseOrThrow(authenticationResponseSchema, body);
    } catch (err) {
      caught = err as ValidationError;
    }
    expect(caught).toBeInstanceOf(ValidationError);
    expect(caught?.issues.map((i) => i.field)).toContain("type");
  });

  it("rejects a missing nested response object", () => {
    const { response: _response, ...rest } = validAuthenticationEnvelope;
    let caught: ValidationError | undefined;
    try {
      parseOrThrow(authenticationResponseSchema, rest);
    } catch (err) {
      caught = err as ValidationError;
    }
    expect(caught).toBeInstanceOf(ValidationError);
    expect(caught?.issues.map((i) => i.field)).toContain("response");
  });

  it("rejects a response missing signature", () => {
    const body = {
      ...validAuthenticationEnvelope,
      response: {
        clientDataJSON: validAuthenticationEnvelope.response.clientDataJSON,
        authenticatorData: validAuthenticationEnvelope.response.authenticatorData,
      },
    };
    let caught: ValidationError | undefined;
    try {
      parseOrThrow(authenticationResponseSchema, body);
    } catch (err) {
      caught = err as ValidationError;
    }
    expect(caught).toBeInstanceOf(ValidationError);
    expect(caught?.issues.map((i) => i.field)).toContain("response.signature");
  });

  it("rejects a response missing authenticatorData", () => {
    const body = {
      ...validAuthenticationEnvelope,
      response: {
        clientDataJSON: validAuthenticationEnvelope.response.clientDataJSON,
        signature: validAuthenticationEnvelope.response.signature,
      },
    };
    let caught: ValidationError | undefined;
    try {
      parseOrThrow(authenticationResponseSchema, body);
    } catch (err) {
      caught = err as ValidationError;
    }
    expect(caught).toBeInstanceOf(ValidationError);
    expect(caught?.issues.map((i) => i.field)).toContain("response.authenticatorData");
  });
});

/**
 * Property-based coverage: throws every schema against a wide space of
 * structurally-varied, mostly-malformed envelopes (wrong primitive types,
 * missing keys, extra nesting, arrays where an object is expected, etc.)
 * and asserts two invariants hold no matter what fast-check generates:
 *
 *  1. parseOrThrow never throws anything other than ValidationError.
 *  2. Anything the schema *accepts* is genuinely structurally valid — id/
 *     rawId/type are the right primitive types and type is the literal
 *     "public-key" (a residual, cheap re-check independent of the schema's
 *     own logic, so a schema bug that over-accepts wouldn't just pass
 *     trivially).
 */
const arbitraryEnvelopeValue: fc.Arbitrary<unknown> = fc.oneof(
  { maxDepth: 3 },
  fc.constant(undefined),
  fc.constant(null),
  fc.boolean(),
  fc.integer(),
  fc.string(),
  fc.array(fc.string()),
  fc.dictionary(fc.string(), fc.string()),
);

const arbitraryMalformedEnvelope = fc.dictionary(
  fc.constantFrom("id", "rawId", "response", "type", "clientExtensionResults", "authenticatorAttachment", "extra"),
  arbitraryEnvelopeValue,
  { minKeys: 0, maxKeys: 7 },
);

describe("WebAuthn schemas — property-based fuzzing", () => {
  const schemas = [
    ["registrationResponseSchema", registrationResponseSchema] as const,
    ["authenticationResponseSchema", authenticationResponseSchema] as const,
  ];

  for (const [name, schema] of schemas) {
    it(`${name}: never throws anything but ValidationError, and never accepts structural garbage`, () => {
      fc.assert(
        fc.property(arbitraryMalformedEnvelope, (candidate) => {
          try {
            const parsed = parseOrThrow(schema, candidate);
            // If it was accepted, it must genuinely satisfy the envelope shape.
            expect(typeof parsed.id).toBe("string");
            expect(typeof parsed.rawId).toBe("string");
            expect(parsed.type).toBe("public-key");
            expect(parsed.response).toBeTypeOf("object");
            expect(parsed.response).not.toBeNull();
          } catch (err) {
            expect(err).toBeInstanceOf(ValidationError);
          }
        }),
        { numRuns: 500 },
      );
    });
  }

  it("also never throws anything but ValidationError against raw JSON-primitive garbage (non-object bodies)", () => {
    fc.assert(
      fc.property(fc.jsonValue(), (candidate) => {
        for (const [, schema] of schemas) {
          try {
            parseOrThrow(schema, candidate);
          } catch (err) {
            expect(err).toBeInstanceOf(ValidationError);
          }
        }
      }),
      { numRuns: 500 },
    );
  });
});
