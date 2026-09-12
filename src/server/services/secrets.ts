import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { Effect } from "effect";
import { SettingsError } from "../domain/errors";

const PREFIX = "v1";
const SALT = "maintainer-os-settings-v1";
const MASTER_ENV = "SETTINGS_SECRET";

const deriveKey = (master: string): Buffer => scryptSync(master, SALT, 32);

const masterKey = (): Effect.Effect<string, SettingsError> =>
  process.env[MASTER_ENV]
    ? Effect.succeed(process.env[MASTER_ENV] as string)
    : Effect.fail(
        new SettingsError({
          message: `${MASTER_ENV} is not set — cannot store secrets. Set it and restart, or use env vars for keys.`,
        }),
      );

/** AES-256-GCM encryption for secret settings. Format: `v1:<iv>:<tag>:<ciphertext>` (base64). */
export const encryptSetting = (plaintext: string): Effect.Effect<string, SettingsError> =>
  Effect.flatMap(masterKey(), (master) =>
    Effect.try({
      try: () => {
        const key = deriveKey(master);
        const iv = randomBytes(12);
        const cipher = createCipheriv("aes-256-gcm", key, iv);
        const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
        const tag = cipher.getAuthTag();
        return `${PREFIX}:${iv.toString("base64")}:${tag.toString("base64")}:${ct.toString("base64")}`;
      },
      catch: () => new SettingsError({ message: "failed to encrypt setting" }),
    }),
  );

export const isEncryptedValue = (stored: string): boolean => stored.startsWith(`${PREFIX}:`);

/** Decrypt a value produced by `encryptSetting`. Fails closed on any mismatch. */
export const decryptSetting = (stored: string): Effect.Effect<string, SettingsError> =>
  Effect.flatMap(masterKey(), (master) => {
    const parts = stored.split(":");
    if (parts.length !== 4 || parts[0] !== PREFIX) {
      return Effect.fail(new SettingsError({ message: "stored secret has an unknown format" }));
    }
    return Effect.try({
      try: () => {
        const key = deriveKey(master);
        const [, ivB64, tagB64, ctB64] = parts;
        const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64"));
        decipher.setAuthTag(Buffer.from(tagB64, "base64"));
        return Buffer.concat([
          decipher.update(Buffer.from(ctB64, "base64")),
          decipher.final(),
        ]).toString("utf8");
      },
      catch: () =>
        new SettingsError({
          message: "failed to decrypt setting — wrong SETTINGS_SECRET or corrupted value",
        }),
    });
  });
