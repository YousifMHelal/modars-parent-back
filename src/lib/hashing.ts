import * as argon2 from "argon2";

const ARGON2_OPTIONS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 65536, // 64 MiB — ~150-300ms on modest hardware
  timeCost: 3,
  parallelism: 1,
};

// Dummy hash used for constant-time comparison when the account doesn't exist
const DUMMY_HASH =
  "$argon2id$v=19$m=65536,t=3,p=1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

export async function hashSecret(secret: string): Promise<string> {
  return argon2.hash(secret, ARGON2_OPTIONS);
}

export async function verifySecret(hash: string, secret: string): Promise<boolean> {
  return argon2.verify(hash, secret);
}

/** Always runs argon2.verify against a dummy hash when the account is missing,
 *  so the response time is indistinguishable from a real account lookup. */
export async function dummyVerify(): Promise<false> {
  await argon2.verify(DUMMY_HASH, "dummy-secret");
  return false;
}
