import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import dotenv from 'dotenv';

dotenv.config();

const app = initializeApp({
  credential: applicationDefault()
});

export const db = getFirestore(app);
