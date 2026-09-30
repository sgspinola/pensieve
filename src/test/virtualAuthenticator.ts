import { createHash, generateKeyPairSync, randomBytes, sign as signWithKey, type KeyObject } from "node:crypto";
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { cose, isoBase64URL, isoCBOR, isoUint8Array } from "@simplewebauthn/server/helpers";

// SimpleWebAuthn types binary data as `Uint8Array<ArrayBuffer>`
// specifically, not the wider (and now-default) `Uint8Array<ArrayBufferLike>`
// — this alias keeps that concrete everywhere below.
type Bytes = Uint8Array<ArrayBuffer>;
type CBORValue = Parameters<typeof isoCBOR.encode>[0];

const AAGUID: Bytes = new Uint8Array(16);
const FLAG_USER_PRESENT = 1 << 0;
const FLAG_USER_VERIFIED = 1 << 2;
const FLAG_ATTESTED_CREDENTIAL_DATA = 1 << 6;

/**
 * A software stand-in for a real WebAuthn authenticator (a hardware key or
 * platform authenticator), for use in service-layer tests only. It produces
 * real, cryptographically valid registration/authentication responses (ES256,
 * "none" attestation) that @simplewebauthn/server's verify functions accept
 * as-is — nothing about the server-side verification path is mocked.
 */
export class VirtualAuthenticator {
  private readonly privateKey: KeyObject;
  private readonly publicKey: KeyObject;
  private readonly credentialId: Bytes;
  private counter = 0;

  constructor() {
    const { privateKey, publicKey } = generateKeyPairSync("ec", {
      namedCurve: "P-256",
    });
    this.privateKey = privateKey;
    this.publicKey = publicKey;
    this.credentialId = new Uint8Array(randomBytes(32));
  }

  register(
    options: PublicKeyCredentialCreationOptionsJSON,
    origin: string,
  ): RegistrationResponseJSON {
    this.counter += 1;
    const authenticatorData = this.buildAuthenticatorData(
      options.rp.id ?? "localhost",
      FLAG_USER_PRESENT | FLAG_USER_VERIFIED | FLAG_ATTESTED_CREDENTIAL_DATA,
      this.encodeCredentialPublicKey(),
    );

    const attestationObject = isoCBOR.encode(
      new Map<string | number, CBORValue>([
        ["fmt", "none"],
        ["attStmt", new Map<string | number, CBORValue>()],
        ["authData", authenticatorData],
      ]),
    );

    const clientDataJSON = buildClientDataJSON(
      "webauthn.create",
      options.challenge,
      origin,
    );

    return {
      id: isoBase64URL.fromBuffer(this.credentialId),
      rawId: isoBase64URL.fromBuffer(this.credentialId),
      response: {
        clientDataJSON: isoBase64URL.fromBuffer(clientDataJSON),
        attestationObject: isoBase64URL.fromBuffer(attestationObject),
        transports: ["internal"],
      },
      clientExtensionResults: {},
      type: "public-key",
      authenticatorAttachment: "platform",
    };
  }

  authenticate(
    options: PublicKeyCredentialRequestOptionsJSON,
    origin: string,
  ): AuthenticationResponseJSON {
    this.counter += 1;
    const authenticatorData = this.buildAuthenticatorData(
      options.rpId ?? "localhost",
      FLAG_USER_PRESENT | FLAG_USER_VERIFIED,
    );
    const clientDataJSON = buildClientDataJSON(
      "webauthn.get",
      options.challenge,
      origin,
    );
    const clientDataHash = sha256(clientDataJSON);
    const signedData = isoUint8Array.concat([authenticatorData, clientDataHash]);
    const signature = signWithKey("sha256", Buffer.from(signedData), this.privateKey);

    return {
      id: isoBase64URL.fromBuffer(this.credentialId),
      rawId: isoBase64URL.fromBuffer(this.credentialId),
      response: {
        clientDataJSON: isoBase64URL.fromBuffer(clientDataJSON),
        authenticatorData: isoBase64URL.fromBuffer(authenticatorData),
        signature: isoBase64URL.fromBuffer(new Uint8Array(signature)),
      },
      clientExtensionResults: {},
      type: "public-key",
      authenticatorAttachment: "platform",
    };
  }

  private encodeCredentialPublicKey(): Bytes {
    const jwk = this.publicKey.export({ format: "jwk" }) as {
      x: string;
      y: string;
    };
    const coseKey = new Map<string | number, CBORValue>([
      [cose.COSEKEYS.kty, cose.COSEKTY.EC2],
      [cose.COSEKEYS.alg, cose.COSEALG.ES256],
      [cose.COSEKEYS.crv, cose.COSECRV.P256],
      [cose.COSEKEYS.x, isoBase64URL.toBuffer(jwk.x)],
      [cose.COSEKEYS.y, isoBase64URL.toBuffer(jwk.y)],
    ]);
    return isoCBOR.encode(coseKey);
  }

  private buildAuthenticatorData(
    rpID: string,
    flags: number,
    credentialPublicKey?: Bytes,
  ): Bytes {
    const rpIdHash = sha256(isoUint8Array.fromUTF8String(rpID));
    const flagsByte = new Uint8Array([flags]);
    const counterBytes = new Uint8Array(4);
    new DataView(counterBytes.buffer).setUint32(0, this.counter, false);

    const parts = [rpIdHash, flagsByte, counterBytes];

    if (credentialPublicKey) {
      const credentialIdLength = new Uint8Array(2);
      new DataView(credentialIdLength.buffer).setUint16(
        0,
        this.credentialId.byteLength,
        false,
      );
      parts.push(AAGUID, credentialIdLength, this.credentialId, credentialPublicKey);
    }

    return isoUint8Array.concat(parts);
  }
}

function buildClientDataJSON(
  type: "webauthn.create" | "webauthn.get",
  challenge: string,
  origin: string,
): Bytes {
  const json = JSON.stringify({ type, challenge, origin, crossOrigin: false });
  return isoUint8Array.fromUTF8String(json);
}

function sha256(data: Bytes): Bytes {
  return new Uint8Array(createHash("sha256").update(data).digest());
}
