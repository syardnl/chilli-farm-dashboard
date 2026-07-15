import {
  cert,
  getApps,
  initializeApp,
} from "firebase-admin/app";

import {
  getMessaging,
} from "firebase-admin/messaging";

function getFirebaseAdminApp() {
  if (getApps().length > 0) {
    return getApps()[0];
  }

  const projectId =
    process.env.FIREBASE_ADMIN_PROJECT_ID;

  const clientEmail =
    process.env.FIREBASE_ADMIN_CLIENT_EMAIL;

  const privateKey =
    process.env.FIREBASE_ADMIN_PRIVATE_KEY
      ?.replace(/^"|"$/g, "")
      .replace(/\\n/g, "\n")
      .trim();

  if (!projectId) {
    throw new Error(
      "FIREBASE_ADMIN_PROJECT_ID is missing."
    );
  }

  if (!clientEmail) {
    throw new Error(
      "FIREBASE_ADMIN_CLIENT_EMAIL is missing."
    );
  }

  if (!privateKey) {
    throw new Error(
      "FIREBASE_ADMIN_PRIVATE_KEY is missing."
    );
  }

  if (
    !privateKey.startsWith(
      "-----BEGIN PRIVATE KEY-----"
    ) ||
    !privateKey.endsWith(
      "-----END PRIVATE KEY-----"
    )
  ) {
    throw new Error(
      "FIREBASE_ADMIN_PRIVATE_KEY has an invalid format."
    );
  }

  return initializeApp({
    credential: cert({
      projectId,
      clientEmail,
      privateKey,
    }),
  });
}

export function getFirebaseAdminMessaging() {
  return getMessaging(getFirebaseAdminApp());
}